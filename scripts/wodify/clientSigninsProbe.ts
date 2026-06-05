/**
 * Per-client / per-ID Client Sign-ins probe.  LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * Purpose (RETENTION_FINISH_PLAN.md §5 step 2)
 *   The shape-discovery probe (`signinsShapeDiscovery.ts`, #423) found that the LIST-style
 *   sign-ins paths (`/clients/signins`, `/clients/sign-ins`, `/classes/signins`) return Wodify
 *   ERROR ENVELOPES at transport-2xx, and that the BARE paths (`/signins`, `/sign-ins`) return a
 *   `403 "Missing Authentication Token"` — the §5 signal that the sign-ins resource LIKELY REQUIRES
 *   A PER-CLIENT ID IN THE PATH. This probe confirms (or fails to confirm) a `/clients/{id}/signins`
 *   -style per-client path and the dated-check-in FIELD MAPPING, using the SMALLEST deterministic
 *   client sample needed to answer the structural question.
 *
 *   It is structure / mapping discovery, NOT data collection, NOT live wiring, NOT §6 work.
 *
 * Why this needs a real client ID (and why that is safe here)
 *   A per-client path cannot be probed without a real client ID, so this script fetches ONE page of
 *   `/clients`, extracts a small deterministic sample of IDs INTO MEMORY ONLY, and uses them solely to
 *   build the per-client request URL. RETENTION_FINISH_PLAN.md §4 permits TRANSIENT server-side raw
 *   data; the IDs (and the `/clients` body) are never logged, never persisted, never printed, and only
 *   the safe aggregate below is ever emitted. The request URL (which contains a real ID) is NEVER
 *   logged — only the PATH TEMPLATE with a literal `{id}` placeholder leaves this script.
 *
 * Safety contract (RETENTION_FINISH_PLAN.md §4/§5 — enforced by construction here)
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, never logged,
 *     never printed, never echoed in errors. If unset, exits WITHOUT making any request.
 *   - Emits ONLY the aggregate `SafeProbeResult` below: counts, booleans, HTTP status CLASSES, path
 *     TEMPLATES (with `{id}`), and SAFE field NAMES (schema). NEVER values of any kind — no names,
 *     client / member / sign-in IDs (even hashed), exact dates / timestamps, dues, raw rows, raw or
 *     echoed API responses, request URLs, upstream error bodies, auth headers, or keys.
 *   - ID-like-key guard (from the shape-discovery probe): any field NAME that looks like an
 *     identifier/value is redacted and only counted, so an ID can never leak through a "field name".
 *   - Treats `1900-01-01` as a NULL SENTINEL — counted separately, never a real check-in date.
 *   - Detects a Wodify ERROR ENVELOPE at transport-2xx (top-level `DeveloperMessage` / `ErrorCode` /
 *     `HTTPCode` / `UserMessage`, no records array) and reports it as a failure, not "0 records". The
 *     in-body `HTTPCode` is reduced to a status CLASS only — its raw value (and the message / code
 *     text) is never read into output, logs, or errors.
 *   - Distinguishes a real `403` from a missing-required-ID `403` ("Missing Authentication Token").
 *   - Does NOT import `silentChurn.ts` / `classifyMember`. Date validation is a small, self-contained,
 *     STRICTER reimplementation (rejects impossible dates such as 2026-02-30 instead of rolling over).
 *
 * Call budget (RETENTION_FINISH_PLAN.md §5 / task runbook)
 *   - 1 `/clients` page + a SMALL deterministic per-client sample (default 3 clients).
 *   - Finds the working path on the FIRST sampled client (the path does not depend on which client),
 *     then inspects the small sample only to confirm the field mapping + whether multi-date history
 *     exists. Stops EARLY once dated history is confirmed. Hard backstop: `MAX_PER_CLIENT_CALLS`.
 *   - Does NOT broadly iterate all clients. If a larger sample were needed, it stops and reports that
 *     (a larger run needs separate approval).
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   From a git WORKTREE, point --env-file at the primary clone's gitignored env by ABSOLUTE path:
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/clientSigninsProbe.ts
 *   Network-free safe-output self-test (makes NO request, needs NO key):
 *     npx tsx scripts/wodify/clientSigninsProbe.ts --selftest
 *   See scripts/wodify/README.md. Never inline-paste the key (it lands in shell history).
 *
 * Draft status — NOTHING in CONFIG is repo-verified. The per-client PATH TEMPLATES, the `/clients`
 * ID field name, the response SHAPE, and the sign-in FIELD NAMES are all guesses; this probe exists
 * to replace those guesses with observed structure. Confirm / adjust CONFIG on the live run.
 *
 * First run outcome (2026-06-05) — BLOCKED at the `/clients` prerequisite; per-client path UNTESTED.
 *   Run once locally (worktree-safe absolute `--env-file`; key never printed/committed). `/clients`
 *   returned transport-2xx, `errorEnvelopeDetected: false`, but `recordsOnFirstPage: 0` /
 *   `clientIdsExtractedForSample: 0` — so NO client ID could be sampled and the per-client templates
 *   were never tried (`conclusionReasonCode: "could_not_obtain_client_id"`). The 2xx body was NOT an
 *   error envelope, so the current `RECORD_ARRAY_KEYS` / `CLIENT_ID_FIELDS` simply did not match the
 *   `/clients` response shape (Wodify is PascalCase-heavy; these candidates are lowercase). Per the §5
 *   chat-reported prior (a Wodify audit pulled ~912 clients), a response-SHAPE MISMATCH is the likely
 *   cause — NOT a genuinely empty client list — but that is not proven from the safe output alone.
 *   Mapping is therefore UNPROVEN (not disproven): the per-client endpoint was never reached.
 *   NEXT (separately approved): a structure-only `/clients` shape-discovery pass (mirror
 *   `signinsShapeDiscovery.ts` — emit top-level type / safe key names / array key+length / record
 *   field NAMES, never values) to confirm the real records-array key + client-ID field, then re-run
 *   this probe (its per-client machinery + safe-output contract are built, reviewed, and ready).
 */

// ─── CONFIG — CONFIRM / ADJUST ON THE LIVE RUN (none of this is repo-verified) ──────────────────
const BASE_URL = 'https://api.wodify.com/v1'; // §5 reported base URL; auth via x-api-key header.
const CLIENTS_PATH = '/clients'; // §5: returns the client list (per-record `client_status`).
const PAGE_SIZE = 100; // §5: Wodify caps at 100 records/page regardless of requested size.

// Per-client sign-ins path TEMPLATES, most-likely first. `{id}` is substituted with a real client
// ID at fetch time ONLY; the substituted URL is NEVER emitted — only the template (with `{id}`) is.
const PER_CLIENT_SIGNIN_PATH_TEMPLATES: readonly string[] = [
  '/clients/{id}/signins',
  '/clients/{id}/sign-ins',
  '/signins/{id}',
  '/sign-ins/{id}',
];

const CLIENT_SAMPLE_SIZE = 3; // smallest deterministic sample (first N clients on page 1).
const MAX_PER_CLIENT_CALLS = 8; // hard backstop on per-client sign-in calls (excludes the 1 /clients call).

// Candidate field names for the client identifier inside a `/clients` record (first present wins).
const CLIENT_ID_FIELDS = ['Id', 'id', 'client_id', 'clientId', 'ClientId', 'clientID', 'member_id', 'memberId', 'MemberId'];
// Candidate field names inside a SIGN-IN record.
const CLIENT_REF_FIELDS = ['client_id', 'clientId', 'ClientId', 'clientRef', 'member_id', 'memberId', 'MemberId', 'Id', 'id'];
const CHECKIN_DATE_FIELDS = [
  'checkin_date', 'checkInDate', 'CheckinDate', 'CheckInDate', 'date', 'Date', 'signin_date',
  'signinDate', 'SigninDate', 'SignInDate', 'created_at', 'CreatedOn', 'created_on', 'attendanceDate',
];
const SENTINEL_DATE = '1900-01-01'; // §5: Wodify surfaces null dates as this. Treat as MISSING.
// Candidate array keys for a records payload (a bare top-level array is also handled). `clients` is
// the /clients records key proven by the #428 shape discovery (appended last = lowest precedence, so
// it only matches when no sign-in-style key is present — it never shadows a sign-ins records array).
const RECORD_ARRAY_KEYS = ['data', 'results', 'result', 'items', 'records', 'value', 'signins', 'SignIns', 'rows', 'clients'];
// §5 / #423: Wodify error envelope markers (matched case-insensitively; values are NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// ─── Safe output contract (RETENTION_FINISH_PLAN.md §5) ─────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';

type ConclusionReasonCode =
  | 'records_with_checkin_date' // proven: a per-client path returned sign-in records carrying a date
  | 'could_not_obtain_client_id' // unproven: /clients gave no usable ID to probe
  | 'no_working_path_found' // unproven: every candidate template failed (envelope / 4xx / non-JSON)
  | 'working_path_no_records' // unproven: a path returned 2xx + records array but it was empty
  | 'working_path_records_without_checkin_date'; // unproven: records present but no date field matched

interface ClientsListEndpointResult {
  pathTemplate: string; // '/clients' — path only, never a query string
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  recordsOnFirstPage: number; // count only
  clientIdsExtractedForSample: number; // count only — IDs themselves are NEVER emitted
  clientRecordFieldNames: string[]; // SAFE field-NAME union (schema; ID-like redacted)
  redactedClientFieldNameCount: number;
}

interface PerClientSigninsResult {
  candidatePathTemplatesTried: string[]; // templates only (with `{id}`)
  workingPathTemplate: string | null; // the template that returned a usable shape; null if none
  clientsSampled: number; // how many client IDs were actually probed (<= CLIENT_SAMPLE_SIZE)
  perClientCallsMade: number; // total per-client sign-in HTTP calls
  anyEndpointReached: boolean;
  httpStatusClassesSeen: string[]; // distinct transport status classes across calls
  anyErrorEnvelopeDetected: boolean;
  embeddedHttpStatusClassesSeen: string[]; // distinct in-body status classes (envelope cases)
  anyMissingIdSignal: boolean; // a 403 "Missing Authentication Token" was seen on a candidate
  totalRecordsInspected: number;
  fieldPresenceCounts: { clientRef: number; checkInDate: number };
  recordFieldNames: string[]; // SAFE field-NAME union of sign-in records (schema, not values)
  redactedRecordFieldNameCount: number;
  missingDateCount: number;
  invalidDateCount: number;
  sentinelDateCount: number;
  sampledClientsWithAnyCheckIn: number; // count only
  sampledClientsWithMultipleDistinctDates: number; // count only
  datedCheckInHistoryAvailable: boolean; // >= 1 sampled client with >= 2 distinct valid dates
  earliestYear?: number; // optional, calendar-YEAR granularity only
  latestYear?: number;
}

interface SafeProbeResult {
  probe: 'clientSigninsProbe';
  clientsListEndpoint: ClientsListEndpointResult;
  perClientSignins: PerClientSigninsResult;
  conclusion: 'proven' | 'unproven';
  conclusionReasonCode: ConclusionReasonCode;
}

// ─── Helpers (pure; none of these emit, log, or retain values) ──────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * ID-like-key guard (from `signinsShapeDiscovery.ts`). True when a field NAME looks like an
 * identifier/value rather than a schema field name — so it must never be emitted.
 */
function isIdLikeKey(key: string): boolean {
  if (key.length > 40) return true; // suspiciously long — could be a token/value
  if (/^\d{3,}$/.test(key)) return true; // pure digits, 3+ → likely a numeric ID
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(key)) return true; // UUID
  if (/^[0-9a-fA-F]{12,}$/.test(key)) return true; // long hex blob
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(key) && !/[a-z].*[A-Z]|_|-/.test(key)) return true; // base64-ish blob
  return false;
}

/** Partition keys into safe (schema-shaped) names and a redacted count. Sorted, deduped. */
function partitionKeys(keys: string[]): { safe: string[]; redacted: number } {
  const safe = new Set<string>();
  let redacted = 0;
  for (const k of keys) {
    if (isIdLikeKey(k)) redacted++;
    else safe.add(k);
  }
  return { safe: [...safe].sort(), redacted };
}

/** Union of SAFE field NAMES across record objects (schema only — values are never read). */
function collectRecordFieldNames(records: unknown[]): { names: string[]; redacted: number } {
  const keys: string[] = [];
  for (const rec of records) {
    if (isPlainObject(rec)) keys.push(...Object.keys(rec));
  }
  const p = partitionKeys(keys);
  return { names: p.safe, redacted: p.redacted };
}

/** First present, non-empty candidate field value, else undefined. */
function pickField(rec: Record<string, unknown>, candidates: readonly string[]): unknown {
  for (const k of candidates) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

/** Leading YYYY-MM-DD token of an ISO-ish value (drops any time component). Never retained/emitted. */
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
  | { cls: 'missing' }
  | { cls: 'sentinel' }
  | { cls: 'invalid' }
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
 * Detect a Wodify ERROR ENVELOPE at transport-2xx (§5 / #423). The embedded `HTTPCode` is reduced to
 * a status CLASS only; its raw value, and the message / error-code TEXT, are never read into output.
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
  const detected = httpCodeKey !== undefined || markerHits.length >= 2;
  if (!detected) return { detected: false, embeddedStatusClass: null };

  let embeddedStatusClass: HttpStatusClass | null = null;
  if (httpCodeKey !== undefined) {
    const code = Number(obj[httpCodeKey]); // reduced to a class below; the raw value is never emitted
    if (Number.isFinite(code) && code >= 100 && code < 600) embeddedStatusClass = statusClassOf(code);
  }
  return { detected, embeddedStatusClass };
}

/** Decide whether a 2xx body is a real error envelope (vs. a real, possibly-empty records payload). */
function classifyTwoXxBody(parsed: unknown): { records: Record<string, unknown>[]; envelope: ErrorEnvelopeInfo } {
  const extracted = extractRecords(parsed);
  const envelope = detectErrorEnvelope(parsed);
  // Mirror `classSigninProbe`: an envelope only "wins" when there are no real rows AND its embedded
  // code is not 2xx — so real rows are never discarded and a 2xx `{data:[]}` is a real empty dataset.
  if (envelope.detected && extracted.length === 0 && envelope.embeddedStatusClass !== '2xx') {
    return { records: [], envelope };
  }
  return { records: extracted, envelope: { detected: false, embeddedStatusClass: null } };
}

// ─── Per-client sign-in record accumulation (pure; the self-test exercises this) ────────────────
interface Acc {
  totalRecordsInspected: number;
  clientRefPresent: number;
  checkInDatePresent: number;
  missingDateCount: number;
  invalidDateCount: number;
  sentinelDateCount: number;
  validDateCount: number;
  globalMinYear: number;
  globalMaxYear: number;
  recordFieldNames: Set<string>;
  redactedRecordFieldNameCount: number;
  sampledClientsWithAnyCheckIn: number;
  sampledClientsWithMultipleDistinctDates: number;
}

function newAcc(): Acc {
  return {
    totalRecordsInspected: 0,
    clientRefPresent: 0,
    checkInDatePresent: 0,
    missingDateCount: 0,
    invalidDateCount: 0,
    sentinelDateCount: 0,
    validDateCount: 0,
    globalMinYear: Number.POSITIVE_INFINITY,
    globalMaxYear: Number.NEGATIVE_INFINITY,
    recordFieldNames: new Set<string>(),
    redactedRecordFieldNameCount: 0,
    sampledClientsWithAnyCheckIn: 0,
    sampledClientsWithMultipleDistinctDates: 0,
  };
}

/**
 * Fold ONE sampled client's sign-in records into the accumulator. Keyed by NOTHING that identifies
 * the client — distinct-date detection is local to this call (one client's records at a time), so the
 * real client ID never enters any data structure here.
 */
function foldClientRecords(acc: Acc, records: Record<string, unknown>[]): void {
  const distinctValidDatesThisClient = new Set<string>();
  let anyCheckInThisClient = false;

  const fieldNames = collectRecordFieldNames(records);
  for (const n of fieldNames.names) acc.recordFieldNames.add(n);
  acc.redactedRecordFieldNameCount += fieldNames.redacted;

  for (const rec of records) {
    acc.totalRecordsInspected++;

    if (pickField(rec, CLIENT_REF_FIELDS) !== undefined) acc.clientRefPresent++;

    const dateRaw = pickField(rec, CHECKIN_DATE_FIELDS);
    if (dateRaw !== undefined) {
      acc.checkInDatePresent++;
      anyCheckInThisClient = true;
    }

    const classified = classifyCheckInDate(dateRaw);
    if (classified.cls === 'missing') {
      acc.missingDateCount++;
    } else if (classified.cls === 'sentinel') {
      acc.sentinelDateCount++; // counted separately; NEVER treated as a real lastCheckIn
    } else if (classified.cls === 'invalid') {
      acc.invalidDateCount++;
    } else {
      acc.validDateCount++;
      distinctValidDatesThisClient.add(classified.token);
      if (classified.year < acc.globalMinYear) acc.globalMinYear = classified.year;
      if (classified.year > acc.globalMaxYear) acc.globalMaxYear = classified.year;
    }
  }

  if (anyCheckInThisClient || records.length > 0) acc.sampledClientsWithAnyCheckIn++;
  if (distinctValidDatesThisClient.size >= 2) acc.sampledClientsWithMultipleDistinctDates++;
}

function buildPerClientResult(
  acc: Acc,
  meta: {
    candidatePathTemplatesTried: string[];
    workingPathTemplate: string | null;
    clientsSampled: number;
    perClientCallsMade: number;
    anyEndpointReached: boolean;
    httpStatusClassesSeen: Set<string>;
    anyErrorEnvelopeDetected: boolean;
    embeddedHttpStatusClassesSeen: Set<string>;
    anyMissingIdSignal: boolean;
  },
): PerClientSigninsResult {
  const result: PerClientSigninsResult = {
    candidatePathTemplatesTried: meta.candidatePathTemplatesTried,
    workingPathTemplate: meta.workingPathTemplate,
    clientsSampled: meta.clientsSampled,
    perClientCallsMade: meta.perClientCallsMade,
    anyEndpointReached: meta.anyEndpointReached,
    httpStatusClassesSeen: [...meta.httpStatusClassesSeen].sort(),
    anyErrorEnvelopeDetected: meta.anyErrorEnvelopeDetected,
    embeddedHttpStatusClassesSeen: [...meta.embeddedHttpStatusClassesSeen].sort(),
    anyMissingIdSignal: meta.anyMissingIdSignal,
    totalRecordsInspected: acc.totalRecordsInspected,
    fieldPresenceCounts: { clientRef: acc.clientRefPresent, checkInDate: acc.checkInDatePresent },
    recordFieldNames: [...acc.recordFieldNames].sort(),
    redactedRecordFieldNameCount: acc.redactedRecordFieldNameCount,
    missingDateCount: acc.missingDateCount,
    invalidDateCount: acc.invalidDateCount,
    sentinelDateCount: acc.sentinelDateCount,
    sampledClientsWithAnyCheckIn: acc.sampledClientsWithAnyCheckIn,
    sampledClientsWithMultipleDistinctDates: acc.sampledClientsWithMultipleDistinctDates,
    datedCheckInHistoryAvailable: acc.sampledClientsWithMultipleDistinctDates > 0,
  };
  if (acc.validDateCount > 0 && Number.isFinite(acc.globalMinYear)) {
    result.earliestYear = acc.globalMinYear;
    result.latestYear = acc.globalMaxYear;
  }
  return result;
}

function deriveConclusion(per: PerClientSigninsResult): { conclusion: 'proven' | 'unproven'; reason: ConclusionReasonCode } {
  if (per.workingPathTemplate === null) return { conclusion: 'unproven', reason: 'no_working_path_found' };
  if (per.totalRecordsInspected === 0) return { conclusion: 'unproven', reason: 'working_path_no_records' };
  if (per.fieldPresenceCounts.checkInDate === 0) {
    return { conclusion: 'unproven', reason: 'working_path_records_without_checkin_date' };
  }
  return { conclusion: 'proven', reason: 'records_with_checkin_date' };
}

// ─── Live network layer (bodies read for derivation only; never logged / returned as text upward) ──
interface RawResponse {
  status: number;
  parsed: unknown; // JSON.parse result, or undefined if non-JSON / parse failed
  missingIdHint: boolean; // 403 "Missing Authentication Token"
}

/**
 * Fetch one URL. The URL (which may contain a real client ID) is built and used HERE ONLY and is
 * NEVER logged, returned, or printed. Only a status, the parsed JSON, and a boolean leave this fn.
 */
async function fetchJson(apiKey: string, idSubstitutedPath: string): Promise<RawResponse> {
  const url = new URL(BASE_URL + idSubstitutedPath);
  url.searchParams.set('page', '1');
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
  const missingIdHint = res.status === 403 && /Missing Authentication Token/i.test(bodyText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = undefined;
  }
  return { status: res.status, parsed, missingIdHint };
}

/** Fetch `/clients` page 1, extract up to CLIENT_SAMPLE_SIZE client IDs (in memory), summarize safely. */
async function probeClientsList(apiKey: string): Promise<{ listResult: ClientsListEndpointResult; sampleIds: string[] }> {
  const listResult: ClientsListEndpointResult = {
    pathTemplate: CLIENTS_PATH,
    endpointReached: false,
    httpStatusClass: 'network_error',
    errorEnvelopeDetected: false,
    embeddedHttpStatusClass: null,
    recordsOnFirstPage: 0,
    clientIdsExtractedForSample: 0,
    clientRecordFieldNames: [],
    redactedClientFieldNameCount: 0,
  };
  const sampleIds: string[] = [];

  let resp: RawResponse;
  try {
    resp = await fetchJson(apiKey, CLIENTS_PATH);
  } catch {
    return { listResult, sampleIds }; // network failure — status class stays network_error
  }

  listResult.endpointReached = true;
  listResult.httpStatusClass = statusClassOf(resp.status);
  if (listResult.httpStatusClass !== '2xx' || resp.parsed === undefined) return { listResult, sampleIds };

  const { records, envelope } = classifyTwoXxBody(resp.parsed);
  if (envelope.detected) {
    listResult.errorEnvelopeDetected = true;
    listResult.embeddedHttpStatusClass = envelope.embeddedStatusClass;
    return { listResult, sampleIds };
  }

  listResult.recordsOnFirstPage = records.length;
  const fieldNames = collectRecordFieldNames(records);
  listResult.clientRecordFieldNames = fieldNames.names;
  listResult.redactedClientFieldNameCount = fieldNames.redacted;

  for (const rec of records) {
    if (sampleIds.length >= CLIENT_SAMPLE_SIZE) break;
    const idRaw = pickField(rec, CLIENT_ID_FIELDS);
    if (idRaw !== undefined) sampleIds.push(String(idRaw)); // in memory only — never emitted
  }
  listResult.clientIdsExtractedForSample = sampleIds.length;
  return { listResult, sampleIds };
}

interface PerClientCallOutcome {
  statusClass: HttpStatusClass;
  usable: boolean; // 2xx, not an error envelope, JSON-parseable into records (array may be empty)
  records: Record<string, unknown>[];
  envelopeDetected: boolean;
  embeddedStatusClass: HttpStatusClass | null;
  missingIdHint: boolean;
}

async function callPerClient(apiKey: string, template: string, id: string): Promise<PerClientCallOutcome> {
  const path = template.replace('{id}', encodeURIComponent(id)); // id used HERE only; never emitted
  const outcome: PerClientCallOutcome = {
    statusClass: 'network_error',
    usable: false,
    records: [],
    envelopeDetected: false,
    embeddedStatusClass: null,
    missingIdHint: false,
  };
  let resp: RawResponse;
  try {
    resp = await fetchJson(apiKey, path);
  } catch {
    return outcome; // network failure
  }
  outcome.statusClass = statusClassOf(resp.status);
  outcome.missingIdHint = resp.missingIdHint;
  if (outcome.statusClass !== '2xx' || resp.parsed === undefined) return outcome;

  const { records, envelope } = classifyTwoXxBody(resp.parsed);
  if (envelope.detected) {
    outcome.envelopeDetected = true;
    outcome.embeddedStatusClass = envelope.embeddedStatusClass;
    return outcome;
  }
  outcome.usable = true;
  outcome.records = records;
  return outcome;
}

async function runLiveProbe(apiKey: string): Promise<SafeProbeResult> {
  const { listResult, sampleIds } = await probeClientsList(apiKey);

  const acc = newAcc();
  const httpStatusClassesSeen = new Set<string>();
  const embeddedHttpStatusClassesSeen = new Set<string>();
  let workingPathTemplate: string | null = null;
  let perClientCallsMade = 0;
  let anyEndpointReached = false;
  let anyErrorEnvelopeDetected = false;
  let anyMissingIdSignal = false;
  let clientsSampled = 0;

  if (sampleIds.length === 0) {
    const per = buildPerClientResult(acc, {
      candidatePathTemplatesTried: [],
      workingPathTemplate: null,
      clientsSampled: 0,
      perClientCallsMade: 0,
      anyEndpointReached: false,
      httpStatusClassesSeen,
      anyErrorEnvelopeDetected: false,
      embeddedHttpStatusClassesSeen,
      anyMissingIdSignal: false,
    });
    return {
      probe: 'clientSigninsProbe',
      clientsListEndpoint: listResult,
      perClientSignins: per,
      conclusion: 'unproven',
      conclusionReasonCode: 'could_not_obtain_client_id',
    };
  }

  // Phase A — find the working path using the FIRST sampled client (path is client-independent).
  const firstId = sampleIds[0];
  const templatesTried: string[] = [];
  for (const template of PER_CLIENT_SIGNIN_PATH_TEMPLATES) {
    if (perClientCallsMade >= MAX_PER_CLIENT_CALLS) break;
    templatesTried.push(template);
    const outcome = await callPerClient(apiKey, template, firstId);
    perClientCallsMade++;
    anyEndpointReached = true;
    httpStatusClassesSeen.add(outcome.statusClass);
    if (outcome.envelopeDetected) {
      anyErrorEnvelopeDetected = true;
      if (outcome.embeddedStatusClass) embeddedHttpStatusClassesSeen.add(outcome.embeddedStatusClass);
    }
    if (outcome.missingIdHint) anyMissingIdSignal = true;
    if (outcome.usable) {
      workingPathTemplate = template;
      foldClientRecords(acc, outcome.records);
      clientsSampled = 1;
      break;
    }
  }

  // Phase B — if a path works, inspect the rest of the small sample to confirm the mapping + whether
  // multi-date history exists anywhere. Stop EARLY once dated history is confirmed.
  if (workingPathTemplate !== null && acc.sampledClientsWithMultipleDistinctDates === 0) {
    for (let i = 1; i < sampleIds.length; i++) {
      if (perClientCallsMade >= MAX_PER_CLIENT_CALLS) break;
      if (acc.sampledClientsWithMultipleDistinctDates > 0) break; // definitive — stop sampling
      const outcome = await callPerClient(apiKey, workingPathTemplate, sampleIds[i]);
      perClientCallsMade++;
      httpStatusClassesSeen.add(outcome.statusClass);
      if (outcome.envelopeDetected) {
        anyErrorEnvelopeDetected = true;
        if (outcome.embeddedStatusClass) embeddedHttpStatusClassesSeen.add(outcome.embeddedStatusClass);
      }
      if (outcome.missingIdHint) anyMissingIdSignal = true;
      if (outcome.usable) {
        foldClientRecords(acc, outcome.records);
        clientsSampled++;
      }
    }
  }

  const per = buildPerClientResult(acc, {
    candidatePathTemplatesTried: templatesTried,
    workingPathTemplate,
    clientsSampled,
    perClientCallsMade,
    anyEndpointReached,
    httpStatusClassesSeen,
    anyErrorEnvelopeDetected,
    embeddedHttpStatusClassesSeen,
    anyMissingIdSignal,
  });
  const { conclusion, reason } = deriveConclusion(per);
  return {
    probe: 'clientSigninsProbe',
    clientsListEndpoint: listResult,
    perClientSignins: per,
    conclusion,
    conclusionReasonCode: reason,
  };
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO key) ────────
// Feeds synthetic records seeded with obvious fake-secret tokens through the SAME output assembly the
// live path uses, then asserts NONE of those tokens appear in the emitted JSON. This proves the output
// path cannot leak record values, IDs, names, dates, dues, or a substituted URL.
function runSelfTest(): void {
  const SECRETS = [
    'SECRET_CLIENT_ID_4242', // a fake client ID (also used to build a fake substituted path)
    'SECRET_MEMBER_NAME',
    'SECRET_DUES_9999',
    '2023-07-15', // a fake exact check-in date — must never appear (only the YEAR may, as a number)
    '2031-11-02',
  ];
  const syntheticSigninRecords: Record<string, unknown>[] = [
    { ClientId: 'SECRET_CLIENT_ID_4242', memberName: 'SECRET_MEMBER_NAME', CheckinDate: '2023-07-15T08:00:00Z', dues: 'SECRET_DUES_9999' },
    { ClientId: 'SECRET_CLIENT_ID_4242', memberName: 'SECRET_MEMBER_NAME', CheckinDate: '2031-11-02' }, // 2nd distinct date
    { ClientId: 'SECRET_CLIENT_ID_4242', CheckinDate: '1900-01-01' }, // sentinel
    { ClientId: 'SECRET_CLIENT_ID_4242', CheckinDate: '2026-02-30' }, // invalid calendar date
    { ClientId: 'SECRET_CLIENT_ID_4242' }, // missing date
  ];

  const acc = newAcc();
  foldClientRecords(acc, syntheticSigninRecords); // client #1 — 2 distinct valid dates

  // Synthetic /clients list result with an ID-like top-level key to exercise the redaction guard.
  const syntheticClientRecords: Record<string, unknown>[] = [
    { Id: 'SECRET_CLIENT_ID_4242', FirstName: 'SECRET_MEMBER_NAME', client_status: 'Active', '4242424242': 'x' },
  ];
  const clientFields = collectRecordFieldNames(syntheticClientRecords);
  const listResult: ClientsListEndpointResult = {
    pathTemplate: CLIENTS_PATH,
    endpointReached: true,
    httpStatusClass: '2xx',
    errorEnvelopeDetected: false,
    embeddedHttpStatusClass: null,
    recordsOnFirstPage: syntheticClientRecords.length,
    clientIdsExtractedForSample: 1,
    clientRecordFieldNames: clientFields.names,
    redactedClientFieldNameCount: clientFields.redacted,
  };

  // Exercise the error-envelope detector with a synthetic 403 envelope (carries a fake message).
  const envelope = detectErrorEnvelope({
    DeveloperMessage: 'SECRET_MEMBER_NAME not allowed',
    ErrorCode: 'SECRET_DUES_9999',
    HTTPCode: 403,
    UserMessage: 'nope',
  });

  const httpStatusClassesSeen = new Set<string>(['2xx', '4xx']);
  const embeddedHttpStatusClassesSeen = new Set<string>();
  if (envelope.embeddedStatusClass) embeddedHttpStatusClassesSeen.add(envelope.embeddedStatusClass);

  const per = buildPerClientResult(acc, {
    candidatePathTemplatesTried: [...PER_CLIENT_SIGNIN_PATH_TEMPLATES],
    workingPathTemplate: '/clients/{id}/signins', // template only — must stay `{id}`, never the fake ID
    clientsSampled: 1,
    perClientCallsMade: 2,
    anyEndpointReached: true,
    httpStatusClassesSeen,
    anyErrorEnvelopeDetected: envelope.detected,
    embeddedHttpStatusClassesSeen,
    anyMissingIdSignal: true,
  });
  const { conclusion, reason } = deriveConclusion(per);
  const result: SafeProbeResult = {
    probe: 'clientSigninsProbe',
    clientsListEndpoint: listResult,
    perClientSignins: per,
    conclusion,
    conclusionReasonCode: reason,
  };

  const serialized = JSON.stringify(result, null, 2);

  // Assert: no synthetic secret token leaked, and the substituted URL never appears (template stays).
  const leaks: string[] = [];
  for (const token of SECRETS) {
    if (serialized.includes(token)) leaks.push(token);
  }
  if (serialized.includes('/clients/SECRET_CLIENT_ID_4242/')) leaks.push('substituted-url');
  if (!serialized.includes('/clients/{id}/signins')) leaks.push('missing-expected-template');

  console.log(serialized);
  if (leaks.length > 0) {
    console.error(`SELFTEST FAIL: output contained disallowed token(s): ${leaks.join(', ')}`);
    process.exit(1);
    return;
  }
  // Sanity-assert the synthetic accumulation behaved as designed (no values printed).
  const expectations: Array<[string, boolean]> = [
    ['datedCheckInHistoryAvailable', per.datedCheckInHistoryAvailable === true],
    ['sentinelDateCount==1', per.sentinelDateCount === 1],
    ['invalidDateCount==1', per.invalidDateCount === 1],
    ['missingDateCount==1', per.missingDateCount === 1],
    ['conclusion==proven', conclusion === 'proven'],
    ['reason==records_with_checkin_date', reason === 'records_with_checkin_date'],
    ['envelope detected', envelope.detected === true && envelope.embeddedStatusClass === '4xx'],
    ['client id field redacted (4242424242 not in names)', !per.recordFieldNames.includes('4242424242')],
  ];
  const failed = expectations.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    console.error(`SELFTEST FAIL: behavioral expectation(s) not met: ${failed.join(', ')}`);
    process.exit(1);
    return;
  }
  console.error('SELFTEST PASS: no synthetic secret token in output; behavioral checks passed; no network call made.');
}

async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }

  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error(
      'WODIFY_API_KEY is not set. Provide it via a gitignored env file (never commit or paste it), ' +
        'e.g. npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local ' +
        'scripts/wodify/clientSigninsProbe.ts. No request was made.',
    );
    process.exit(1);
    return;
  }

  const result = await runLiveProbe(apiKey);
  // ONLY the safe aggregate is printed — no rows, no values, no IDs, no URLs, no key, no raw responses.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('Per-client sign-ins probe failed before producing a result (no data emitted).');
  process.exit(1);
});
