// sync-wodify-retention Edge Function (RETENTION_FINISH_PLAN.md §6).
//
// THIN SHELL by design — the only logic here is the request gate + fetch +
// persist. All normalization/aggregation lives in the typechecked, vitest-covered
// src/lib/gym/wodifyRetentionAggregate.ts, and the pure gate helpers
// (classifySyncError / verifyTriggerSecret) in src/lib/gym/wodifyRetentionSync.ts,
// so the Deno shell holds no untypechecked business logic. The shared-module
// import across the runtime boundary is RESOLVED via Option A (explicit `.ts`
// import + allowImportingTsExtensions, #435) — esbuild inlines it and the
// Supabase deploy/eszip bundler resolves it. Mirrors ai-proxy: dependency-free
// raw `fetch`, no SDK, secrets server-side only, never logs bodies or the key
// (zero `console.*` — the 502 diagnostic `code` is returned in-body only).
//
// Request gate (strict order): non-POST → 405 (before any secret/env/Wodify
// work, preserving the Step 0 probe) → SYNC_TRIGGER_SECRET unset → 500 (FAIL
// CLOSED) → x-sync-trigger-secret header mismatch → 403 (constant-time compare)
// → WODIFY_API_KEY/SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing → 500 → fetch.
//
// Flow: gate → paginate Wodify /clients → computeRetentionAggregate → persist the
// NON-PII aggregate row via the Supabase REST API (service role). Raw /clients
// rows are transient in memory; they are never logged or persisted. The browser
// never calls Wodify and never sees the key.
//
// GATED: not invoked live in this PR. First live invoke requires Reviewer audit +
// Wesley's explicit authorization to set SYNC_TRIGGER_SECRET + WODIFY_API_KEY and
// run it with the x-sync-trigger-secret header (README).

import {
  computeRetentionAggregate,
  tenureBandActiveTotals,
  type RawWodifyClient,
  type RetentionAggregate,
} from '../../../src/lib/gym/wodifyRetentionAggregate.ts';
import {
  classifySyncError,
  gymLocalDay,
  verifyTriggerSecret,
} from '../../../src/lib/gym/wodifyRetentionSync.ts';

// Wodify /clients request — the exact proven shape from the §5 probes
// (scripts/wodify/clientsRecencyProbe.ts #429): page/pageSize params, records
// under `clients`, pagination via top-level `pagination.has_more`.
const WODIFY_BASE_URL = 'https://api.wodify.com/v1';
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100; // Wodify caps at 100/page
const MAX_PAGES = 50; // hard safety cap (~5000 clients) so a stuck has_more can't loop forever
const WODIFY_TIMEOUT_MS = 15000;

const RETENTION_TABLE = 'wodify_retention_aggregate';

// The gym's IANA business-day zone. asOf is resolved to this zone (not the UTC
// Edge runtime) so the (workspace_id, as_of) idempotency key and the recency
// day-diff anchor bucket to the day the gym is actually open. Single gym → a
// const, not env/config (no premature abstraction).
const GYM_TZ = 'America/New_York';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Paginate all /clients pages. Returns raw rows (transient) + the page count +
// reachedPageCap (true if we stopped at MAX_PAGES with has_more still true, so the
// snapshot is partial — surfaced, never silently truncated). Throws with an HTTP
// status only — never the response body (it could echo PII).
async function fetchAllClients(
  apiKey: string,
): Promise<{ rows: RawWodifyClient[]; pagesFetched: number; reachedPageCap: boolean }> {
  const rows: RawWodifyClient[] = [];
  let pagesFetched = 0;
  let reachedPageCap = false;

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
    // More pages remain but this was the last allowed page — flag the partial snapshot.
    if (page === MAX_PAGES) reachedPageCap = true;
  }

  return { rows, pagesFetched, reachedPageCap };
}

// Persist the NON-PII aggregate via the Supabase REST API using the service-role
// key (bypasses RLS; never exposed to the browser). IDEMPOTENT UPSERT keyed on
// (workspace_id, as_of): a same-day re-pull REPLACES the day's row instead of
// duplicating it — PostgREST `on_conflict` + `Prefer: resolution=merge-duplicates`,
// backed by the unique constraint in wodify_retention_schema.sql. Needs service-role
// INSERT + UPDATE on the table.
async function persistAggregate(
  supabaseUrl: string,
  serviceKey: string,
  agg: RetentionAggregate,
): Promise<void> {
  const row = {
    workspace_id: 'default', // explicit conflict target (matches the column default + anon read policy)
    source: agg.source,
    as_of: agg.asOf,
    fetched_at: agg.fetchedAt,
    active_total: agg.activeTotal,
    inactive_total: agg.inactiveTotal, // Member Movement census (§6, binary rescope)
    days_absent_histogram: agg.daysAbsentHistogram,
    // Churn-by-Tenure (§6 aggregate extension): per-band recency counts +
    // bandEdges contract. Counts only — non-PII like every other column.
    tenure_band_histogram: agg.tenureBandHistogram,
    unknown_count: agg.unknown,
    monthly_dues_at_risk: agg.silentChurn.monthlyDuesAtRisk,
    missing_monthly_dues: agg.silentChurn.missingMonthlyDues,
    wodify_at_risk_count: agg.diagnostics.wodifyAtRiskCount,
    unknown_status: agg.dataQuality.unknownStatus,
    future_last_check_in: agg.dataQuality.futureLastCheckIn,
    pages_fetched: agg.dataQuality.pagesFetched,
    reached_page_cap: agg.dataQuality.reachedPageCap,
    clients_scanned: agg.dataQuality.clientsScanned,
  };

  // on_conflict names the unique key so PostgREST emits ON CONFLICT … DO UPDATE;
  // resolution=merge-duplicates makes the POST an upsert (latest pull wins).
  const url = `${supabaseUrl}/rest/v1/${RETENTION_TABLE}?on_conflict=workspace_id,as_of`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`persist_http_${res.status}`); // status only
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    // 1. Method guard FIRST — non-POST short-circuits before any secret / env /
    //    Wodify work, preserving the Step 0 (GET → 405) reachability probe.
    if (req.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' });
    }

    // 2. Structural trigger gate. verify_jwt (platform) only proves the caller
    //    holds the PUBLIC anon JWT (it ships in the SPA bundle); this shared
    //    secret is what actually authorizes an invoke. FAIL CLOSED if it is not
    //    configured server-side — never fall open to an unguarded endpoint.
    const triggerSecret = Deno.env.get('SYNC_TRIGGER_SECRET');
    if (!triggerSecret) {
      return jsonResponse(500, { error: 'internal_error' });
    }
    // 3. Constant-time compare of the provided header against the secret.
    //    Missing or mismatched → generic 403 (never reveal which).
    const providedSecret = req.headers.get('x-sync-trigger-secret') ?? '';
    if (!(await verifyTriggerSecret(triggerSecret, providedSecret))) {
      return jsonResponse(403, { error: 'forbidden' });
    }

    // 4. Only after the trigger gate passes do we read the data secrets.
    const apiKey = Deno.env.get('WODIFY_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!apiKey || !supabaseUrl || !serviceKey) {
      // Generic — never reveal which secret is missing.
      return jsonResponse(500, { error: 'internal_error' });
    }

    // asOf = the gym's local business day (the day-diff anchor); fetchedAt stays
    // a true UTC instant. Both member dates and this anchor pass through the same
    // parseYmdLocal in the aggregate, so the whole-day math is internally
    // consistent.
    const asOf = gymLocalDay(new Date(), GYM_TZ);
    const fetchedAt = new Date().toISOString();

    const { rows, pagesFetched, reachedPageCap } = await fetchAllClients(apiKey);
    const aggregate = computeRetentionAggregate(rows, {
      asOf,
      fetchedAt,
      pagesFetched,
      reachedPageCap,
    });
    await persistAggregate(supabaseUrl, serviceKey, aggregate);

    // Counts-only summary back to the caller — NO raw rows, NO PII. The tenure
    // entry is per-band ACTIVE TOTALS only (a count per band id), so a post-pull
    // verify can eyeball the band split without reading the table.
    return jsonResponse(200, {
      ok: true,
      asOf: aggregate.asOf,
      activeTotal: aggregate.activeTotal,
      unknown: aggregate.unknown,
      tenure: tenureBandActiveTotals(aggregate.tenureBandHistogram),
      missingMonthlyDues: aggregate.silentChurn.missingMonthlyDues,
      diagnostics: aggregate.diagnostics,
      dataQuality: aggregate.dataQuality,
    });
  } catch (err) {
    // Sanitized, fixed-vocabulary diagnostic code in-body — never raw err.message,
    // URLs, headers, rows, or secrets (see classifySyncError). No logging, so the
    // function keeps its zero-`console.*` invariant.
    return jsonResponse(502, { error: 'sync_failed', code: classifySyncError(err) });
  }
});
