// sync-wodify-retention Edge Function (RETENTION_FINISH_PLAN.md §6).
//
// THIN SHELL by design — the only logic here is fetch + persist. All
// normalization and aggregation lives in the typechecked, vitest-covered
// src/lib/gym/wodifyRetentionAggregate.ts so the Deno function holds no
// untypechecked business logic (the bundle/import of that shared module is
// proven — see README "Bundle/import proof"). Mirrors ai-proxy: dependency-free
// raw `fetch`, no SDK, secrets server-side only, never logs bodies or the key.
//
// Flow: read server-side secrets → paginate Wodify /clients → computeRetentionAggregate
// → persist the NON-PII aggregate row via the Supabase REST API (service role).
// Raw /clients rows are transient in memory; they are never logged or persisted.
// The browser never calls Wodify and never sees the key.
//
// GATED: not invoked live in this PR. First live invoke requires Reviewer audit
// + Wesley's explicit authorization to set WODIFY_API_KEY and run it (README).

import {
  computeRetentionAggregate,
  type RawWodifyClient,
  type RetentionAggregate,
} from '../../../src/lib/gym/wodifyRetentionAggregate.ts';

// Wodify /clients request — the exact proven shape from the §5 probes
// (scripts/wodify/clientsRecencyProbe.ts #429): page/pageSize params, records
// under `clients`, pagination via top-level `pagination.has_more`.
const WODIFY_BASE_URL = 'https://api.wodify.com/v1';
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100; // Wodify caps at 100/page
const MAX_PAGES = 50; // hard safety cap (~5000 clients) so a stuck has_more can't loop forever
const WODIFY_TIMEOUT_MS = 15000;

const RETENTION_TABLE = 'wodify_retention_aggregate';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Today as YYYY-MM-DD (the day-diff anchor) and the fetch timestamp. Both member
// dates and this anchor pass through the same parseYmdLocal in the aggregate, so
// the whole-day math is internally consistent.
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

// Paginate all /clients pages. Returns raw rows (transient) + the page count.
// Throws with an HTTP status only — never the response body (it could echo PII).
async function fetchAllClients(
  apiKey: string,
): Promise<{ rows: RawWodifyClient[]; pagesFetched: number }> {
  const rows: RawWodifyClient[] = [];
  let pagesFetched = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(WODIFY_BASE_URL + CLIENTS_PATH);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(PAGE_SIZE));

    const res = await fetch(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' }, // key never logged
      signal: AbortSignal.timeout(WODIFY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`wodify_clients_http_${res.status}`); // status only

    const body = await res.json();
    const pageRows: unknown[] = Array.isArray(body?.clients) ? body.clients : [];
    for (const r of pageRows) rows.push(r as RawWodifyClient);
    pagesFetched += 1;

    const hasMore = body?.pagination?.has_more === true;
    if (!hasMore || pageRows.length === 0) break;
  }

  return { rows, pagesFetched };
}

// Persist the NON-PII aggregate via the Supabase REST API using the service-role
// key (bypasses RLS; never exposed to the browser). Append-only snapshot insert.
async function persistAggregate(
  supabaseUrl: string,
  serviceKey: string,
  agg: RetentionAggregate,
): Promise<void> {
  const row = {
    source: agg.source,
    as_of: agg.asOf,
    fetched_at: agg.fetchedAt,
    active_total: agg.activeTotal,
    days_absent_histogram: agg.daysAbsentHistogram,
    unknown_count: agg.unknown,
    monthly_dues_at_risk: agg.silentChurn.monthlyDuesAtRisk,
    missing_monthly_dues: agg.silentChurn.missingMonthlyDues,
    wodify_at_risk_count: agg.diagnostics.wodifyAtRiskCount,
    unknown_status: agg.dataQuality.unknownStatus,
    future_last_check_in: agg.dataQuality.futureLastCheckIn,
    pages_fetched: agg.dataQuality.pagesFetched,
    clients_scanned: agg.dataQuality.clientsScanned,
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/${RETENTION_TABLE}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`persist_http_${res.status}`); // status only
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    const apiKey = Deno.env.get('WODIFY_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!apiKey || !supabaseUrl || !serviceKey) {
      // Generic — never reveal which secret is missing.
      return jsonResponse(500, { error: 'internal_error' });
    }

    const asOf = todayYmd();
    const fetchedAt = new Date().toISOString();

    const { rows, pagesFetched } = await fetchAllClients(apiKey);
    const aggregate = computeRetentionAggregate(rows, {
      asOf,
      fetchedAt,
      pagesFetched,
    });
    await persistAggregate(supabaseUrl, serviceKey, aggregate);

    // Counts-only summary back to the caller — NO raw rows, NO PII.
    return jsonResponse(200, {
      ok: true,
      asOf: aggregate.asOf,
      activeTotal: aggregate.activeTotal,
      unknown: aggregate.unknown,
      missingMonthlyDues: aggregate.silentChurn.missingMonthlyDues,
      diagnostics: aggregate.diagnostics,
      dataQuality: aggregate.dataQuality,
    });
  } catch (_err) {
    // Never echo error detail — it can carry the URL, headers, or the key.
    return jsonResponse(502, { error: 'sync_failed' });
  }
});
