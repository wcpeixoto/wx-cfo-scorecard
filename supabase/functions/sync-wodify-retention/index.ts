// sync-wodify-retention Edge Function (WO-2 v3).
//
// The scheduled pull is split into bounded page requests. mode=page fetches one
// /clients page, calls detail only for exact-Active clients, and upserts a
// counts-only draft. mode=finalize independently rebuilds the existing complete
// retention aggregate, fail-closed validates every draft, and only then upserts
// the final aggregate row. No person-level value is logged, persisted, or
// returned. Wodify and service-role credentials remain server-side.

import {
  cohortActiveTotals,
  cohortLapsedTotals,
  computeRetentionAggregate,
  tenureBandActiveTotals,
  type RawWodifyClient,
  type RetentionAggregate,
} from '../../../src/lib/gym/wodifyRetentionAggregate.ts';
import {
  CENSUS_PAGE_SIZE,
  CENSUS_MAX_PAGES,
  buildRetentionPersistenceRow,
  classifyActiveClientDetail,
  isExactlyActiveClient,
  normalizeClientId,
  parseCensusRequest,
  summarizeCensusPage,
  validateAndMergeCensus,
  type CensusObservation,
  type CensusPageDraft,
  type UnclassifiedDetailReason,
} from '../../../src/lib/gym/wodifyStudentCensus.ts';
import {
  classifySyncError,
  SyncDeadline,
  gymLocalDay,
  verifyTriggerSecret,
} from '../../../src/lib/gym/wodifyRetentionSync.ts';
import { buildStudentRetentionAggregate, parseStudentRetentionAggregate } from '../../../src/lib/gym/studentRetentionAggregate.ts';

const WODIFY_BASE_URL = 'https://api.wodify.com/v1';
const CLIENTS_PATH = '/clients';
const MAX_PAGES = CENSUS_MAX_PAGES;
const BULK_PAGE_SIZE = 100;
const BULK_MAX_PAGES = 50;
const REQUEST_DEADLINE_MS = 55_000;
const WODIFY_TIMEOUT_MS = 15_000;
const DETAIL_MAX_ATTEMPTS = 3;
const DETAIL_CADENCE_MS = 500;

import { parseUpstreamJson, WodifyParseError, type ParseStage } from '../../../src/lib/gym/wodifyParseDiagnostics.ts';

const RETENTION_TABLE = 'wodify_retention_aggregate';
const CENSUS_RUNS_TABLE = 'wodify_census_runs';
const GYM_TZ = 'America/New_York';

type UnknownRecord = Record<string, unknown>;
type WodifyListRow = RawWodifyClient & { id?: unknown };
type WodifyClientsPage = {
  rows: WodifyListRow[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerField(record: UnknownRecord, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SyntaxError('invalid aggregate counter');
  }
  return value;
}

function booleanField(record: UnknownRecord, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new SyntaxError('invalid aggregate boolean');
  return value;
}

// Fetch exactly one Wodify page. The real pagination envelope exposes only
// page, page_size, and has_more; all three are validated instead of inferring a
// total page/client count.
async function fetchClientsPage(apiKey: string, requestedPage: number, deadline: SyncDeadline,
  pageSizeRequested = CENSUS_PAGE_SIZE, maxPages = MAX_PAGES): Promise<WodifyClientsPage> {
  const url = new URL(WODIFY_BASE_URL + CLIENTS_PATH);
  url.searchParams.set('page', String(requestedPage));
  url.searchParams.set('page_size', String(pageSizeRequested));

  const res = await deadline.fetch(url, {
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(WODIFY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`wodify_clients_http_${res.status}`);

  const { body, metadata } = await parseUpstreamJson(res, 'clients_json_decode', (operation) => deadline.run(operation));
  if (!isRecord(body) || !Array.isArray(body.clients) || !isRecord(body.pagination)) {
    throw new WodifyParseError('clients_envelope', metadata);
  }
  const page = body.pagination.page;
  const pageSize = body.pagination.page_size;
  const hasMore = body.pagination.has_more;
  if (
    page !== requestedPage
    || pageSize !== pageSizeRequested
    || typeof hasMore !== 'boolean'
    || body.clients.length > pageSizeRequested
    || (hasMore && (body.clients.length === 0 || requestedPage === maxPages))
  ) {
    throw new WodifyParseError('clients_pagination', metadata);
  }

  const seen = new Set<string>();
  for (const row of body.clients) {
    if (!isRecord(row) || (row.client_status !== 'Active' && row.client_status !== 'Inactive')) {
      throw new WodifyParseError('clients_row', metadata);
    }
    const id = normalizeClientId(row.id);
    if (id === null) throw new WodifyParseError('clients_identifier', metadata);
    if (seen.has(id)) throw new WodifyParseError('clients_duplicate', metadata);
    seen.add(id);
  }

  return {
    rows: body.clients as WodifyListRow[],
    page,
    pageSize,
    hasMore,
  };
}

// Current fast-path aggregate fetch: page through /clients without detail calls,
// preserving computeRetentionAggregate's existing semantics exactly.
async function fetchAllClients(
  apiKey: string,
  deadline: SyncDeadline,
): Promise<{ rows: RawWodifyClient[]; pagesFetched: number; reachedPageCap: boolean }> {
  const rows: RawWodifyClient[] = [];
  const seen = new Set<string>(); // transient, only within this request

  for (let page = 1; page <= BULK_MAX_PAGES; page += 1) {
    const result = await fetchClientsPage(apiKey, page, deadline, BULK_PAGE_SIZE, BULK_MAX_PAGES);
    for (const row of result.rows) {
      const id = normalizeClientId(row.id)!;
      if (seen.has(id)) throw new SyntaxError('duplicate clients row');
      seen.add(id);
    }
    rows.push(...result.rows);
    if (!result.hasMore) {
      return { rows, pagesFetched: page, reachedPageCap: false };
    }
  }

  return { rows, pagesFetched: BULK_MAX_PAGES, reachedPageCap: true };
}

type DetailFetchResult =
  | { ok: true; detail: unknown; callsMade: number }
  | { ok: false; callsMade: number };

// Request-local, counts-only diagnostics. Never added to persisted drafts or
// success responses. HTTP counts include non-2xx attempts, including retries;
// network/JSON failures have no failed HTTP status to count.
type PageFailureDiagnostics = {
  unclassified_reasons: Record<UnclassifiedDetailReason | 'invalid_client_id' | 'detail_fetch_failed', number>;
  detail_http_status_counts: Record<string, number>;
};

// Sequential caller with a fixed inter-call cadence. 429 aborts the whole page
// so the workflow stops and no draft/final row can be written. Timeouts, network
// errors, malformed JSON, and 5xx responses get at most three attempts.
async function fetchClientDetail(
  apiKey: string,
  clientId: string,
  deadline: SyncDeadline,
  diagnostics: PageFailureDiagnostics,
): Promise<DetailFetchResult> {
  let callsMade = 0;

  for (let attempt = 1; attempt <= DETAIL_MAX_ATTEMPTS; attempt += 1) {
    await deadline.wait(DETAIL_CADENCE_MS);
    callsMade += 1;
    try {
      const res = await deadline.fetch(`${WODIFY_BASE_URL}${CLIENTS_PATH}/${encodeURIComponent(clientId)}`, {
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(WODIFY_TIMEOUT_MS),
      });
      if (!res.ok) {
        const status = String(res.status);
        diagnostics.detail_http_status_counts[status] = (diagnostics.detail_http_status_counts[status] ?? 0) + 1;
      }
      if (res.status === 429) throw new Error('wodify_detail_http_429');
      if (!res.ok) {
        const retryable = res.status === 408 || res.status >= 500;
        if (retryable && attempt < DETAIL_MAX_ATTEMPTS) continue;
        return { ok: false, callsMade };
      }

      try {
        const { body } = await parseUpstreamJson(res, 'detail_json_decode', (operation) => deadline.run(operation));
        return { ok: true, detail: body, callsMade };
      } catch {
        if (attempt === DETAIL_MAX_ATTEMPTS) return { ok: false, callsMade };
      }
    } catch (err) {
      deadline.check();
      if (err instanceof Error && err.message === 'wodify_detail_http_429') throw err;
      if (attempt === DETAIL_MAX_ATTEMPTS) return { ok: false, callsMade };
    }
  }

  return { ok: false, callsMade };
}

async function buildCensusDraft(
  apiKey: string,
  page: WodifyClientsPage,
  deadline: SyncDeadline,
  createdAt: string,
  diagnostics: PageFailureDiagnostics,
): Promise<CensusPageDraft> {
  const observations: CensusObservation[] = [];
  const students: RawWodifyClient[] = []; // request-local only; persistence holds counts

  // Deliberately sequential. Inactive and unknown-status rows never cause a
  // detail request; exact Active is the only admitted status.
  for (const row of page.rows) {
    if (!isExactlyActiveClient(row.client_status)) continue;

    const clientId = normalizeClientId(row.id);
    if (clientId === null) {
      diagnostics.unclassified_reasons.invalid_client_id += 1;
      observations.push({
        classification: { kind: 'unclassified' },
        detailCallsMade: 0,
        detailFailed: true,
      });
      continue;
    }

    const fetched = await fetchClientDetail(apiKey, clientId, deadline, diagnostics);
    if (!fetched.ok) {
      diagnostics.unclassified_reasons.detail_fetch_failed += 1;
      observations.push({
        classification: { kind: 'unclassified' },
        detailCallsMade: fetched.callsMade,
        detailFailed: true,
      });
      continue;
    }
    const classification = classifyActiveClientDetail(fetched.detail, (reason) => {
      diagnostics.unclassified_reasons[reason] += 1;
    });
    if (classification.kind === 'student') students.push(row);
    observations.push({
      classification,
      detailCallsMade: fetched.callsMade,
      detailFailed: false,
    });
  }

  return summarizeCensusPage({
    studentAggregate: buildStudentRetentionAggregate(students, gymLocalDay(new Date(createdAt), GYM_TZ)),
    createdAt,
    page: page.page,
    pageSize: page.pageSize,
    hasMore: page.hasMore,
    rowsSeen: page.rows.length,
    observations,
  });
}

async function persistCensusDraft(
  supabaseUrl: string,
  serviceKey: string,
  runId: string,
  draft: CensusPageDraft,
  deadline: SyncDeadline,
): Promise<void> {
  const row = {
    student_retention: draft.studentAggregate,
    created_at: draft.createdAt,
    run_id: runId,
    page: draft.page,
    page_size: draft.pageSize,
    has_more: draft.hasMore,
    rows_seen: draft.rowsSeen,
    active_clients_seen: draft.activeClientsSeen,
    student_total: draft.studentTotal,
    student_member: draft.studentsByPath.member,
    student_dependent: draft.studentsByPath.dependent,
    student_guardian_with_signin: draft.studentsByPath.guardian_with_signin,
    student_no_group_with_signin: draft.studentsByPath.no_group_with_signin,
    guardian_only: draft.guardianOnly,
    unclassified: draft.unclassified,
    ambiguous_no_signin_with_membership: draft.ambiguousNoSigninWithMembership,
    detail_calls_made: draft.detailCallsMade,
    detail_clients_failed: draft.detailClientsFailed,
  };

  const url = `${supabaseUrl}/rest/v1/${CENSUS_RUNS_TABLE}?on_conflict=run_id,page`;
  const res = await deadline.fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`census_persist_http_${res.status}`);
}

async function readCensusDrafts(
  supabaseUrl: string,
  serviceKey: string,
  runId: string,
  deadline: SyncDeadline,
): Promise<CensusPageDraft[]> {
  const url = new URL(`${supabaseUrl}/rest/v1/${CENSUS_RUNS_TABLE}`);
  url.searchParams.set('run_id', `eq.${runId}`);
  url.searchParams.set(
    'select',
    'student_retention,created_at,page,page_size,has_more,rows_seen,active_clients_seen,student_total,student_member,student_dependent,student_guardian_with_signin,student_no_group_with_signin,guardian_only,unclassified,ambiguous_no_signin_with_membership,detail_calls_made,detail_clients_failed',
  );
  url.searchParams.set('order', 'page.asc');
  url.searchParams.set('limit', String(MAX_PAGES + 1));

  const res = await deadline.fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`census_read_http_${res.status}`);

  const body: unknown = await deadline.run(res.json());
  if (!Array.isArray(body)) throw new SyntaxError('invalid census rows');
  return body.map((raw): CensusPageDraft => {
    if (!isRecord(raw)) throw new SyntaxError('invalid census row');
    return {
      studentAggregate: parseStudentRetentionAggregate(raw.student_retention,
        isRecord(raw.student_retention) ? raw.student_retention.asOf : '', raw.student_total),
      createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
      page: integerField(raw, 'page'),
      pageSize: integerField(raw, 'page_size'),
      hasMore: booleanField(raw, 'has_more'),
      rowsSeen: integerField(raw, 'rows_seen'),
      activeClientsSeen: integerField(raw, 'active_clients_seen'),
      studentTotal: integerField(raw, 'student_total'),
      studentsByPath: {
        member: integerField(raw, 'student_member'),
        dependent: integerField(raw, 'student_dependent'),
        guardian_with_signin: integerField(raw, 'student_guardian_with_signin'),
        no_group_with_signin: integerField(raw, 'student_no_group_with_signin'),
      },
      guardianOnly: integerField(raw, 'guardian_only'),
      unclassified: integerField(raw, 'unclassified'),
      ambiguousNoSigninWithMembership: integerField(raw, 'ambiguous_no_signin_with_membership'),
      detailCallsMade: integerField(raw, 'detail_calls_made'),
      detailClientsFailed: integerField(raw, 'detail_clients_failed'),
    };
  });
}

async function cleanupExpiredDrafts(
  supabaseUrl: string,
  serviceKey: string,
  currentRunId: string,
  now: Date,
  deadline: SyncDeadline,
): Promise<void> {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL(`${supabaseUrl}/rest/v1/${CENSUS_RUNS_TABLE}`);
  url.searchParams.set('created_at', `lt.${cutoff}`);
  // Never weaken the just-validated run, even if an unusually old run is being
  // finalized. A later finalize can clean it once it is no longer current.
  url.searchParams.set('run_id', `neq.${currentRunId}`);

  const res = await deadline.fetch(url, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=minimal',
    },
  });
  if (!res.ok) throw new Error(`census_cleanup_http_${res.status}`);
}

async function persistAggregate(
  supabaseUrl: string,
  serviceKey: string,
  row: ReturnType<typeof buildRetentionPersistenceRow>,
  deadline: SyncDeadline,
): Promise<void> {
  const url = `${supabaseUrl}/rest/v1/${RETENTION_TABLE}?on_conflict=workspace_id,as_of`;
  const res = await deadline.fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`persist_http_${res.status}`);
}

function pageResponse(draft: CensusPageDraft): unknown {
  return {
    ok: true,
    mode: 'page',
    page: draft.page,
    pageSize: draft.pageSize,
    hasMore: draft.hasMore,
    rowsSeen: draft.rowsSeen,
    activeClientsSeen: draft.activeClientsSeen,
    studentTotal: draft.studentTotal,
    studentsByPath: draft.studentsByPath,
    guardianOnly: draft.guardianOnly,
    unclassified: draft.unclassified,
    ambiguousNoSigninWithMembership: draft.ambiguousNoSigninWithMembership,
    detailCallsMade: draft.detailCallsMade,
    detailClientsFailed: draft.detailClientsFailed,
  };
}

function finalizeResponse(aggregate: RetentionAggregate, census: ReturnType<typeof validateAndMergeCensus>): unknown {
  if (!census.ok) throw new Error('unreachable invalid census');
  return {
    ok: true,
    mode: 'finalize',
    asOf: aggregate.asOf,
    fetchedAt: aggregate.fetchedAt,
    activeTotal: aggregate.activeTotal,
    inactiveTotal: aggregate.inactiveTotal,
    unknown: aggregate.unknown,
    tenure: tenureBandActiveTotals(aggregate.tenureBandHistogram),
    cohort: cohortActiveTotals(aggregate.cohortHistogram),
    cohortLapsed: cohortLapsedTotals(aggregate.cohortHistogram),
    missingMonthlyDues: aggregate.silentChurn.missingMonthlyDues,
    diagnostics: aggregate.diagnostics,
    dataQuality: aggregate.dataQuality,
    studentTotal: census.totals.studentTotal,
    guardianOnlyTotal: census.totals.guardianOnlyTotal,
    studentsByPath: census.totals.studentsByPath,
    unclassifiedTotal: census.totals.unclassifiedTotal,
    ambiguousNoSigninWithMembership: census.totals.ambiguousNoSigninWithMembership,
    detailCallsMade: census.totals.detailCallsMade,
    detailClientsFailed: census.totals.detailClientsFailed,
    pagesExpected: census.totals.pagesExpected,
    pagesCompleted: census.totals.pagesCompleted,
  };
}

export async function handleRequest(req: Request): Promise<Response> {
  const startedAt = new Date().toISOString();
  const deadline = new SyncDeadline(REQUEST_DEADLINE_MS);
  let pageParseStage: ParseStage | null = null;
  try {
    if (req.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    const triggerSecret = Deno.env.get('SYNC_TRIGGER_SECRET');
    if (!triggerSecret) return jsonResponse(500, { error: 'internal_error' });
    const providedSecret = req.headers.get('x-sync-trigger-secret') ?? '';
    if (!(await verifyTriggerSecret(triggerSecret, providedSecret))) {
      return jsonResponse(403, { error: 'forbidden' });
    }

    let rawRequest: unknown;
    try {
      rawRequest = await deadline.run(req.json());
    } catch {
      return jsonResponse(400, { error: 'invalid_request' });
    }
    const input = parseCensusRequest(rawRequest);
    if (input === null) return jsonResponse(400, { error: 'invalid_request' });

    const apiKey = Deno.env.get('WODIFY_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!apiKey || !supabaseUrl || !serviceKey) {
      return jsonResponse(500, { error: 'internal_error' });
    }

    if (input.mode === 'page') {
      pageParseStage = 'clients_fetch';
      const clientsPage = await fetchClientsPage(apiKey, input.page, deadline);
      const diagnostics: PageFailureDiagnostics = {
        unclassified_reasons: {
          invalid_detail_record: 0,
          invalid_no_group_signins: 0,
          invalid_group_or_missing_role: 0,
          unrecognized_group_role: 0,
          invalid_guardian_signins: 0,
          invalid_client_id: 0,
          detail_fetch_failed: 0,
        },
        detail_http_status_counts: {},
      };
      pageParseStage = 'page_build_draft';
      const draft = await buildCensusDraft(apiKey, clientsPage, deadline, startedAt, diagnostics);
      if (draft.unclassified !== 0 || draft.detailClientsFailed !== 0) {
        return jsonResponse(409, {
          error: 'page_classification_failed',
          unclassified_total: draft.unclassified,
          detail_clients_failed: draft.detailClientsFailed,
          ...diagnostics,
        });
      }
      pageParseStage = 'page_persist_draft';
      await persistCensusDraft(supabaseUrl, serviceKey, input.runId, draft, deadline);
      pageParseStage = 'page_success_response';
      return jsonResponse(200, pageResponse(draft));
    }

    const now = new Date();
    const asOf = gymLocalDay(now, GYM_TZ);
    const fetchedAt = now.toISOString();
    const { rows, pagesFetched, reachedPageCap } = await fetchAllClients(apiKey, deadline);
    const aggregate = computeRetentionAggregate(rows, {
      asOf,
      fetchedAt,
      pagesFetched,
      reachedPageCap,
    });
    const drafts = await readCensusDrafts(supabaseUrl, serviceKey, input.runId, deadline);
    const validated = validateAndMergeCensus(drafts, aggregate, new Date());
    if (!validated.ok) {
      return jsonResponse(409, {
        error: 'finalize_validation_failed',
        code: validated.conflict.code,
        conflict: {
          left: validated.conflict.left,
          right: validated.conflict.right,
        },
      });
    }

    await cleanupExpiredDrafts(supabaseUrl, serviceKey, input.runId, now, deadline);
    const finalValidation = validateAndMergeCensus(drafts, aggregate, new Date());
    if (!finalValidation.ok) return jsonResponse(409, { error: 'finalize_validation_failed', code: finalValidation.conflict.code });
    await persistAggregate(
      supabaseUrl,
      serviceKey,
      buildRetentionPersistenceRow(aggregate, validated.totals),
      deadline,
    );
    return jsonResponse(200, finalizeResponse(aggregate, validated));
  } catch (err) {
    if (pageParseStage !== null && err instanceof SyntaxError) {
      const parsed = err instanceof WodifyParseError ? err : new WodifyParseError(pageParseStage);
      return jsonResponse(502, { error: 'sync_failed', code: 'parse_error', ...parsed.diagnostic() });
    }
    return jsonResponse(502, { error: 'sync_failed', code: classifySyncError(err) });
  } finally {
    deadline.dispose();
  }
}

Deno.serve(handleRequest);
