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
 *   - Detects a Wodify ERROR ENVELOPE returned at transport-2xx (top-level `DeveloperMessage` /
 *     `ErrorCode` / `HTTPCode` / `UserMessage` — observed by the §5 shape discovery, #423) and
 *     reports it as a FAILURE, not as "0 records". The embedded `HTTPCode` is authoritative (the
 *     real status) and is reduced to a status CLASS only — its raw value is never read into output,
 *     logs, or errors. Real rows always win: a non-empty records array is read, and a 2xx embedded
 *     code with an empty array is a real empty dataset, not an error.
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
// §5 shape discovery (#423): Wodify returns errors as a transport-2xx body shaped like an error
// ENVELOPE — top-level keys DeveloperMessage / ErrorCode / HTTPCode / UserMessage and NO records
// array. The in-body HTTPCode carries the REAL status, so a transport-2xx here is not success.
// Matched case-insensitively (lowercased). Values are NEVER emitted: the HTTPCode value is reduced
// to a status CLASS only (per the §5 safe contract), and the message/code text is never read.
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// ─── Safe output contract (RETENTION_FINISH_PLAN.md §5) ─────────────────────────────────────────
// The FIELD NAMES below are the locked §5 contract; their SEMANTICS are PROVISIONAL until the
// first real run, since every count/boolean depends on the unverified CONFIG field mapping
// (e.g. clientRef / checkInDate detection). Treat the output labels as unverified until then.
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';

interface SafeProbeResult {
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  // §5 error-envelope guard: true when a transport-2xx body is actually a Wodify error envelope
  // (DeveloperMessage / ErrorCode / HTTPCode / UserMessage, no records array). Distinguishes a real
  // failure from an empty dataset, so `totalRecordsInspected: 0` is never misread as "no history".
  errorEnvelopeDetected: boolean;
  // Status CLASS derived from the in-body HTTPCode (never the raw value); null if absent/unparseable.
  embeddedHttpStatusClass: HttpStatusClass | null;
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

interface ErrorEnvelopeInfo {
  detected: boolean;
  embeddedStatusClass: HttpStatusClass | null;
}

/**
 * Detect a Wodify ERROR ENVELOPE returned at transport-2xx (§5 / shape discovery #423): a plain
 * object carrying DeveloperMessage / ErrorCode / HTTPCode / UserMessage. Such a body means the real
 * status rides in the payload, so it must be treated as a failure — not read as "0 records". Returns
 * whether the envelope was seen and the status CLASS of the embedded HTTPCode. The raw HTTPCode value
 * is reduced to a class and is otherwise NEVER read into output, logs, or errors (safe contract); the
 * message / error-code TEXT is never read at all.
 */
function detectErrorEnvelope(parsed: unknown): ErrorEnvelopeInfo {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { detected: false, embeddedStatusClass: null };
  }
  const obj = parsed as Record<string, unknown>;
  const actualByLower = new Map<string, string>(); // lowercased key -> actual key (case-insensitive)
  for (const k of Object.keys(obj)) actualByLower.set(k.toLowerCase(), k);
  const markerHits = ERROR_ENVELOPE_MARKER_KEYS.filter((m) => actualByLower.has(m));
  const httpCodeKey = actualByLower.get('httpcode');
  // The authoritative HTTPCode marker, or a quorum (>= 2 markers), identifies the envelope — avoids a
  // false positive on a real payload that merely happens to carry one similarly named key.
  const detected = httpCodeKey !== undefined || markerHits.length >= 2;
  if (!detected) return { detected: false, embeddedStatusClass: null };

  let embeddedStatusClass: HttpStatusClass | null = null;
  if (httpCodeKey !== undefined) {
    const code = Number(obj[httpCodeKey]); // reduced to a class below; the raw value is never emitted
    if (Number.isFinite(code) && code >= 100 && code < 600) embeddedStatusClass = statusClassOf(code);
  }
  return { detected, embeddedStatusClass };
}

interface PageResult {
  status: number;
  records: Record<string, unknown>[];
  missingIdHint: boolean;
  // §5: set when a transport-2xx body is actually a Wodify error envelope (see detectErrorEnvelope).
  errorEnvelope: ErrorEnvelopeInfo;
}

/**
 * Fetch one page. Reads the body to extract records, to detect the §5 missing-ID 403, and to detect
 * a §5 error envelope — the body is NEVER logged or returned; only derived records, booleans, and a
 * status CLASS leave this function.
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
  let errorEnvelope: ErrorEnvelopeInfo = { detected: false, embeddedStatusClass: null };
  if (res.status >= 200 && res.status < 300) {
    try {
      const parsed = JSON.parse(bodyText);
      const extracted = extractRecords(parsed);
      const envelope = detectErrorEnvelope(parsed);
      // Classify as an error envelope only when markers are present, no real rows were extracted, AND
      // the embedded HTTPCode is not a 2xx success. The empty-rows test alone can't tell a MISSING
      // records array (the §5 envelope) from a real-but-empty one like `{ data: [] }`; the embedded
      // status breaks the tie — a 2xx envelope with an empty array is a real empty dataset, not an
      // error. `extracted.length > 0` always wins, so real rows are never discarded for envelope keys.
      if (envelope.detected && extracted.length === 0 && envelope.embeddedStatusClass !== '2xx') {
        errorEnvelope = envelope;
        records = [];
      } else {
        records = extracted;
      }
    } catch {
      records = []; // 2xx but non-JSON — caller sees 0 records and can re-check the shape.
    }
  }
  return { status: res.status, records, missingIdHint, errorEnvelope };
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
  let errorEnvelopeDetected = false;
  let embeddedHttpStatusClass: HttpStatusClass | null = null;

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

    if (pageResult.errorEnvelope.detected) {
      // Transport said 2xx, but the body is a Wodify error envelope — the embedded HTTPCode is the
      // REAL status. Record it as a failure (NOT an empty dataset) and stop. Safe diagnostic only:
      // the status CLASS, never the raw HTTPCode value or any body / message text.
      errorEnvelopeDetected = true;
      embeddedHttpStatusClass = pageResult.errorEnvelope.embeddedStatusClass;
      console.warn(
        'Transport 2xx but the body is a Wodify error envelope (DeveloperMessage / ErrorCode / ' +
          'HTTPCode / UserMessage, no records array). The embedded HTTPCode is the real status' +
          (embeddedHttpStatusClass ? ` (class: ${embeddedHttpStatusClass})` : '') +
          ' — treating as a failure, NOT 0 records. Re-confirm the endpoint path / per-client-ID need.',
      );
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
    errorEnvelopeDetected,
    embeddedHttpStatusClass,
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
