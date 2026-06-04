/**
 * Class / Client Sign-ins — dated check-in history probe.   DRAFT — DO NOT RUN IN CI OR THE SPA.
 *
 * Purpose
 *   Determine whether Wodify exposes DATED check-in history (per-event sign-in dates), which
 *   gates Silent Churn Recovery and supplies the `lastCheckIn` the first live Retention slice
 *   needs. See RETENTION_FINISH_PLAN.md §4 (architecture) and §5 (this probe + the safe output
 *   contract this file implements).
 *
 * Safety contract (RETENTION_FINISH_PLAN.md §4/§5 — enforced by construction here)
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, never
 *     logged, never printed, never echoed in errors.
 *   - Emits ONLY the aggregate `SafeProbeResult` below: counts, booleans, status enums, and
 *     (optionally) calendar YEARS. Never names, IDs, exact dates/timestamps, dues values, raw
 *     member/sign-in rows, or raw API responses.
 *   - Treats `1900-01-01` as a NULL SENTINEL — counted separately as `sentinelDateCount`, never
 *     treated as a real check-in date.
 *   - Does NOT import `silentChurn.ts` / `classifyMember`. Date validation here is a small,
 *     self-contained, STRICTER reimplementation (it rejects impossible calendar dates such as
 *     2026-02-30 instead of rolling them over). Keeping it standalone honours the §5 rule and
 *     avoids coupling a network probe to the locked classifier.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   PREFERRED — gitignored env file (.env.local is git-ignored here), loaded with --env-file:
 *     npx tsx --env-file=.env.local scripts/wodify/classSigninProbe.ts
 *   ALLOWED but NOT preferred — inline (the key lands in shell history, a leak vector):
 *     WODIFY_API_KEY='…' npx tsx scripts/wodify/classSigninProbe.ts
 *   See scripts/wodify/README.md for details.
 *
 * Draft status — NOTHING below is repo-verified (RETENTION_FINISH_PLAN.md §5: "leads to
 * re-confirm"). The endpoint PATH, response SHAPE, pagination MECHANISM, FIELD NAMES, and the
 * OUTPUT-LABEL SEMANTICS (what each emitted count/boolean actually means) are all PROVISIONAL
 * until the first real run confirms the field mapping. Confirm / adjust the CONFIG block below
 * before trusting the output. This file is for review; running it is a separate, explicitly
 * approved task.
 */

// ─── CONFIG — CONFIRM / ADJUST ON THE LIVE RUN (none of this is repo-verified) ──────────────────
const BASE_URL = 'https://api.wodify.com/v1'; // §5 reported base URL; auth via x-api-key header.
// Dated-check-in endpoint. Wodify calls these "Class Sign-ins" / "Client Sign-ins". CONFIRM the
// real path — it may require a per-client ID path param (e.g. `/clients/{id}/signins`), in which
// case this list-style probe must be adapted to iterate clients (the missing-ID 403 check below
// will surface that case). PLACEHOLDER:
const SIGNINS_PATH = '/clients/signins';
const PAGE_SIZE = 100; // §5: Wodify caps at 100 records/page regardless of requested size.
const MAX_PAGES = 1000; // Infinite-loop backstop only (~100k rows). Warns (no data) if reached.
// Response field names are unknown — count presence across these candidates (first match wins).
const CLIENT_REF_FIELDS = ['client_id', 'clientId', 'clientRef', 'member_id', 'memberId'];
const CHECKIN_DATE_FIELDS = ['checkin_date', 'checkInDate', 'date', 'signin_date', 'signinDate', 'created_at'];
const SENTINEL_DATE = '1900-01-01'; // §5: Wodify surfaces null dates as this. Treat as MISSING.
// Candidate array keys for the records payload (a bare top-level array is also handled).
const RECORD_ARRAY_KEYS = ['data', 'results', 'items', 'records'];

// ─── Safe output contract (RETENTION_FINISH_PLAN.md §5) ─────────────────────────────────────────
// The FIELD NAMES below are the locked §5 contract; their SEMANTICS are PROVISIONAL until the
// first real run, since every count/boolean depends on the unverified CONFIG field mapping
// (e.g. clientRef / checkInDate detection). Treat the output labels as unverified until then.
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';

interface SafeProbeResult {
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  pagesFetched: number;
  totalRecordsInspected: number;
  fieldPresenceCounts: {
    clientRef: number;
    checkInDate: number;
  };
  missingDateCount: number;
  invalidDateCount: number;
  sentinelDateCount: number;
  datedCheckInHistoryAvailable: boolean;
  distinctClientsWithAnyCheckIn: number;
  // Optional, calendar-YEAR granularity only (never exact dates). Omitted when no valid date seen.
  earliestYear?: number;
  latestYear?: number;
}

// ─── Helpers (pure; none of these emit or log anything) ─────────────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx'; // 4xx, plus 1xx/3xx folded into "client must handle" — never reached on success.
}

/** First present, non-empty candidate field value, else undefined. */
function pickField(rec: Record<string, unknown>, candidates: string[]): unknown {
  for (const k of candidates) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

/** Leading YYYY-MM-DD token of an ISO-ish value (drops any time component). Never retained. */
function dateToken(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  return s.split(/[T ]/)[0];
}

/** Strict calendar validity — rejects impossible dates (e.g. 2026-02-30) via UTC round-trip. */
function strictCalendarYear(token: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d)); // validity check only — never used for date math
  const roundTrips = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  return roundTrips ? y : null;
}

type DateClass =
  | { cls: 'missing' | 'sentinel' | 'invalid' }
  | { cls: 'valid'; token: string; year: number };

function classifyCheckInDate(raw: unknown): DateClass {
  const token = dateToken(raw);
  if (token === null) return { cls: 'missing' };
  if (token === SENTINEL_DATE) return { cls: 'sentinel' }; // sentinel BEFORE any validity / math
  const year = strictCalendarYear(token);
  if (year === null) return { cls: 'invalid' };
  return { cls: 'valid', token, year };
}

function extractRecords(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object') {
    for (const key of RECORD_ARRAY_KEYS) {
      const v = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

interface PageResult {
  status: number;
  records: Record<string, unknown>[];
  missingIdHint: boolean;
}

/**
 * Fetch one page. Reads the body to extract records and to detect the §5 missing-ID 403 — the
 * body is NEVER logged or returned; only derived records + a boolean leave this function.
 */
async function fetchPage(apiKey: string, page: number): Promise<PageResult> {
  // ASSUMPTION (unverified): pagination is `page`/`pageSize` query params and the last page is the
  // first returning < PAGE_SIZE records. Confirm the real mechanism (cursor? offset?) on the live
  // run — §5 only confirms the 100/page cap, not the param names or paging style.
  const url = new URL(BASE_URL + SIGNINS_PATH);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(PAGE_SIZE));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'x-api-key': apiKey, accept: 'application/json' }, // key never logged
  });

  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '';
  }

  // §5: a 403 "Missing Authentication Token" can mean an absent required ID param, NOT a real auth
  // failure. Detect the marker locally WITHOUT logging the body.
  const missingIdHint = res.status === 403 && /Missing Authentication Token/i.test(bodyText);

  let records: Record<string, unknown>[] = [];
  if (res.status >= 200 && res.status < 300) {
    try {
      records = extractRecords(JSON.parse(bodyText));
    } catch {
      records = []; // 2xx but non-JSON — caller sees 0 records and can re-check the shape.
    }
  }
  return { status: res.status, records, missingIdHint };
}

async function main(): Promise<void> {
  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    // Fail safe — never make a call without a key, and never reveal anything.
    console.error(
      'WODIFY_API_KEY is not set. Provide it via your shell environment (never commit or paste ' +
        'it) and re-run. No request was made.',
    );
    process.exit(1);
    return;
  }

  // Transient, in-memory ONLY — never logged, never persisted, never emitted. Used solely to
  // derive distinct counts + per-client distinct-date presence (RETENTION_FINISH_PLAN.md §4
  // allows transient server-side raw data; only the aggregate below is output).
  const clientRefsSeen = new Set<string>();
  const perClientDateRange = new Map<string, { min: string; max: string }>();

  let pagesFetched = 0;
  let totalRecordsInspected = 0;
  let clientRefPresent = 0;
  let checkInDatePresent = 0;
  let missingDateCount = 0;
  let invalidDateCount = 0;
  let sentinelDateCount = 0;
  let validDateCount = 0;
  let globalMinYear = Number.POSITIVE_INFINITY;
  let globalMaxYear = Number.NEGATIVE_INFINITY;

  let endpointReached = false;
  let httpStatusClass: HttpStatusClass = 'network_error';

  for (let page = 1; page <= MAX_PAGES; page++) {
    let pageResult: PageResult;
    try {
      pageResult = await fetchPage(apiKey, page);
    } catch {
      // Network / DNS / connection failure — no HTTP response. Do not log the error (it can echo
      // the URL/host). endpointReached stays true only if an earlier page already succeeded.
      httpStatusClass = 'network_error';
      endpointReached = page > 1;
      break;
    }

    endpointReached = true;
    httpStatusClass = statusClassOf(pageResult.status);
    pagesFetched = page;

    if (pageResult.status < 200 || pageResult.status >= 300) {
      // Non-2xx — stop. Emit a SAFE diagnostic (no body) for the 403 / missing-ID case.
      if (pageResult.status === 403) {
        console.warn(
          pageResult.missingIdHint
            ? '403 with "Missing Authentication Token": per §5 this may indicate a missing ' +
                'required ID path param (not an auth failure). Confirm the endpoint shape.'
            : '403 received: likely a real authorization failure (verify the rotated key / tier).',
        );
      }
      break;
    }

    for (const rec of pageResult.records) {
      totalRecordsInspected++;

      const clientRaw = pickField(rec, CLIENT_REF_FIELDS);
      const hasClient = clientRaw !== undefined;
      if (hasClient) {
        clientRefPresent++;
        clientRefsSeen.add(String(clientRaw));
      }

      const dateRaw = pickField(rec, CHECKIN_DATE_FIELDS);
      if (dateRaw !== undefined) checkInDatePresent++; // present (sentinel/invalid still "present")

      const classified = classifyCheckInDate(dateRaw);
      if (classified.cls === 'missing') {
        missingDateCount++;
      } else if (classified.cls === 'sentinel') {
        sentinelDateCount++; // counted separately; NEVER treated as a real lastCheckIn
      } else if (classified.cls === 'invalid') {
        invalidDateCount++;
      } else {
        validDateCount++;
        if (classified.year < globalMinYear) globalMinYear = classified.year;
        if (classified.year > globalMaxYear) globalMaxYear = classified.year;
        if (hasClient) {
          const key = String(clientRaw);
          const cur = perClientDateRange.get(key);
          if (!cur) {
            perClientDateRange.set(key, { min: classified.token, max: classified.token });
          } else {
            if (classified.token < cur.min) cur.min = classified.token;
            if (classified.token > cur.max) cur.max = classified.token;
          }
        }
      }
    }

    if (pageResult.records.length < PAGE_SIZE) break; // last (partial/empty) page
    if (page === MAX_PAGES) {
      console.warn(
        `Reached MAX_PAGES (${MAX_PAGES}) backstop; results may be truncated. Increase MAX_PAGES ` +
          'and re-run to inspect all records.',
      );
    }
  }

  // Dated history = at least one client has >= 2 DISTINCT valid dates (not just one latest value).
  let clientsWithMultipleDistinctDates = 0;
  for (const { min, max } of perClientDateRange.values()) {
    if (min !== max) clientsWithMultipleDistinctDates++;
  }

  const result: SafeProbeResult = {
    endpointReached,
    httpStatusClass,
    pagesFetched,
    totalRecordsInspected,
    fieldPresenceCounts: { clientRef: clientRefPresent, checkInDate: checkInDatePresent },
    missingDateCount,
    invalidDateCount,
    sentinelDateCount,
    datedCheckInHistoryAvailable: clientsWithMultipleDistinctDates > 0,
    distinctClientsWithAnyCheckIn: clientRefsSeen.size,
  };
  if (validDateCount > 0 && Number.isFinite(globalMinYear)) {
    result.earliestYear = globalMinYear;
    result.latestYear = globalMaxYear;
  }

  // ONLY the safe aggregate is printed — no rows, no dates, no IDs, no key, no raw responses.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('Probe failed before producing a result (no data emitted).');
  process.exit(1);
});
