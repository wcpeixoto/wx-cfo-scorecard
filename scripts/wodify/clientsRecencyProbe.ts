/**
 * `/clients` DIRECT-RECENCY suitability probe.   LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * Purpose (RETENTION_FINISH_PLAN.md §5, "Next steps" item 5)
 *   #428's `/clients` shape discovery proved recency lives ON `/clients` directly
 *   (`last_attendance`, `last_class_sign_in`, `days_since_last_attendance`, plus `is_at_risk` /
 *   `total_class_sign_ins`), and #427 confirmed the per-client sign-ins ENDPOINT is still not found.
 *   This probe evaluates whether those direct `/clients` recency fields are SUFFICIENT to source the
 *   first live Silent Churn slice's `lastCheckIn` — WITHOUT the per-client sign-ins endpoint.
 *
 *   The target is `silentChurn.ts`'s `classifyMember`, which parses `member.lastCheckIn` as a strict
 *   `YYYY-MM-DD` string (`parseYmdLocal`) and computes `daysAbsent` against an `asOf` (today) anchor.
 *   So the question is concretely: are `last_attendance` / `last_class_sign_in` DATE-LIKE and
 *   well-populated enough (after the `1900-01-01` null-sentinel guard) to feed `lastCheckIn`, letting
 *   the LOCKED classifier compute `daysAbsent` itself (preserving the today-anchor) — rather than
 *   trusting Wodify's precomputed `days_since_last_attendance`?
 *
 *   It does NOT wire live data, build UI, iterate clients, call per-client sign-ins endpoints, or do
 *   §6 work. ONE `/clients` page is sampled; only the safe aggregate below is printed.
 *
 * Safety contract (RETENTION_FINISH_PLAN.md §4/§5 — enforced by construction; same posture as the
 * merged sibling probes `clientsShapeDiscovery.ts` / `classSigninProbe.ts`)
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, never logged,
 *     never printed, never echoed in errors. If unset, exits WITHOUT making any request.
 *   - Reads recency field VALUES in memory ONLY to derive aggregates. Emits ONLY counts, booleans,
 *     HTTP status classes, an allowlisted status-category breakdown, the records-array KEY NAME, and
 *     verdict enums. NEVER values of any kind — no names, IDs (even hashed), exact dates / timestamps,
 *     dues, raw rows, raw / echoed API responses, pagination VALUES, or the substituted URL.
 *   - Treats `1900-01-01` as a NULL SENTINEL — counted separately, never a real `lastCheckIn` and
 *     never folded into "usable".
 *   - Status values are bucketed into an ALLOWLIST of category names defined HERE (active / inactive /
 *     paused / … / other / unknown) — a raw `client_status` value is never emitted as a key.
 *   - The records-array key name is passed through the ID-like-key guard before emission.
 *   - Detects a Wodify ERROR ENVELOPE at transport-2xx (top-level DeveloperMessage / ErrorCode /
 *     HTTPCode / UserMessage) and reports it as a failure; the in-body HTTPCode is reduced to a status
 *     CLASS only (raw value + message text never read).
 *   - Makes NO per-client / per-ID calls; does NOT iterate clients; does NOT import `silentChurn.ts`
 *     / `classifyMember` (date validation is a small, self-contained reimplementation).
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   Network-free safe-output self-test FIRST (makes NO request, needs NO key):
 *     npx tsx scripts/wodify/clientsRecencyProbe.ts --selftest
 *   Live run — worktree-safe: point --env-file at the primary clone's gitignored env by ABSOLUTE path:
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/clientsRecencyProbe.ts
 *   See scripts/wodify/README.md. Never inline-paste the key (it lands in shell history).
 *
 * Call budget — ONE `/clients` call only (page 1, the same request the sibling probes make). If the
 * response signals more pages, that is reported as a boolean ONLY; this script does NOT fetch page 2.
 * A broader / multi-page run needs separate approval, so coverage here is PAGE-1-ONLY, not global.
 */

// ─── CONFIG — scoped to the single `/clients` endpoint (field names per #428's shape discovery) ────
const BASE_URL = 'https://api.wodify.com/v1'; // §5 reported base URL; auth via x-api-key header.
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100; // §5: Wodify caps at 100/page. Reproduce the sibling probes' exact request.

// Records-array key candidates (exact-case, first match wins). `clients` is #428's confirmed key; the
// rest are fallbacks in case the shape shifts. A bare top-level array is also handled.
const RECORD_ARRAY_KEYS = ['clients', 'data', 'results', 'result', 'items', 'records', 'value', 'rows'];

// Recency / status field-name candidates (exact-case, first match wins). #428 confirmed the snake_case
// names; case variants are belt-and-suspenders against a shape shift.
const LAST_ATTENDANCE_FIELDS = ['last_attendance', 'lastAttendance', 'LastAttendance'];
const LAST_CLASS_SIGNIN_FIELDS = ['last_class_sign_in', 'lastClassSignIn', 'LastClassSignIn'];
const DAYS_SINCE_FIELDS = ['days_since_last_attendance', 'daysSinceLastAttendance', 'DaysSinceLastAttendance'];
const TOTAL_SIGNINS_FIELDS = ['total_class_sign_ins', 'totalClassSignIns', 'TotalClassSignIns'];
const IS_AT_RISK_FIELDS = ['is_at_risk', 'isAtRisk', 'IsAtRisk'];
const STATUS_FIELDS = ['client_status', 'clientStatus', 'ClientStatus', 'status'];

const SENTINEL_DATE = '1900-01-01'; // §5: Wodify surfaces null dates as this. Treat as MISSING.

// Status → ALLOWLISTED category name. Emitted keys come from THIS list (plus 'other' / 'unknown'),
// never from a raw response value. Order matters (first regex match wins).
const STATUS_BUCKETS: Array<[string, RegExp]> = [
  ['active', /^active$/i],
  ['inactive', /^in-?active$/i],
  ['paused', /paus|frozen|freeze|hold/i],
  ['suspended', /suspend/i],
  ['cancelled', /cancel/i],
  ['expired', /expir/i],
  ['ended', /\bend(ed)?\b/i],
  ['deleted', /delet|archiv/i],
  ['prospect', /prospect|lead/i],
  ['trial', /trial/i],
];

// §5 / #423: Wodify error-envelope markers (matched case-insensitively; values are NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// "More pages?" signal — boolean key names only (their boolean value is safe; never a count value).
const HAS_MORE_KEY_NAMES = ['has_more', 'hasMore', 'hasNext', 'has_next', 'more', 'next_page', 'nextPage'];
const META_CONTAINER_KEYS = ['pagination', 'paging', 'meta', '_meta', 'page_info', 'pageInfo', 'links'];

// Coverage threshold (share of ACTIVE records with a usable recency date) at/above which `/clients`
// direct recency is judged SUFFICIENT to source the first slice's lastCheckIn on its own.
const SUFFICIENCY_COVERAGE_THRESHOLD = 0.8;

// ─── Safe output contract ────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';

// Per date-like field: how its values classify (counts only; a value is NEVER emitted).
interface DateFieldStats {
  presentCount: number; // key present + non-null + non-empty (a sentinel/invalid value still "present")
  missingCount: number; // absent / null / empty string
  sentinelCount: number; // exactly the 1900-01-01 null sentinel (never "usable")
  strictYmdCount: number; // exactly YYYY-MM-DD, valid calendar — directly parseYmdLocal-compatible
  datedWithTimeCount: number; // valid YYYY-MM-DD prefix + a time component — needs a date-slice first
  unparseableCount: number; // present, non-sentinel, but not date-like
  usableDateCount: number; // strictYmd + datedWithTime (a real, non-sentinel date)
}

// Per numeric field.
interface NumericFieldStats {
  presentCount: number;
  missingCount: number;
  numericCount: number; // parses to a finite number (incl. negative)
  negativeCount: number; // subset of numericCount that is < 0 (a sanity flag)
  nonNumericCount: number; // present but not a finite number
}

// Per boolean field.
interface BooleanFieldStats {
  presentCount: number;
  missingCount: number;
  trueCount: number;
  falseCount: number;
  nonBooleanCount: number; // present but not a (coercible) boolean
}

type DerivableVerdict = 'yes' | 'partial' | 'no';
type Suitability = 'sufficient' | 'insufficient' | 'unproven';
type NormalizationNeeded = 'none' | 'date_slice' | 'unknown';

interface ClientsRecencyResult {
  probe: 'clientsRecencyProbe';
  path: string; // PATH only — never a query string / substituted URL.
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  perClientIdLikelyRequired: boolean; // 403 + "Missing Authentication Token" marker (no body shown).
  jsonParseable: boolean | null;
  recordArrayKey: string | null; // SAFE key name (ID-like redacted) the records were found under.
  sampledPageRecordCount: number; // records on the ONE page sampled (<= 100). NOT a global total.
  pagesFetched: number; // always 1 (call budget); proves only one page was read.
  morePagesAvailable: boolean | null; // from a pagination has_more-style boolean, if present.

  // Status breakdown — keys are ALLOWLISTED category names (never raw status values).
  statusCategoryCounts: Record<string, number>;
  activeRecordCount: number; // records whose client_status buckets to 'active' (the classifier cohort).

  // Recency field analysis over ALL sampled records (date-like-ness; values never emitted).
  lastAttendance: DateFieldStats;
  lastClassSignIn: DateFieldStats;
  daysSinceLastAttendance: NumericFieldStats;
  totalClassSignIns: NumericFieldStats;
  isAtRisk: BooleanFieldStats;

  // Coverage among the ACTIVE cohort (the members classifyMember would keep) — the decision-relevant
  // numbers. Counts only; share is left for the reader to compute from these + activeRecordCount.
  activeWithUsableLastAttendance: number;
  activeWithUsableLastClassSignIn: number;
  activeWithUsableEitherDate: number; // last_attendance OR last_class_sign_in usable
  activeWithDaysSinceNumeric: number;
  activeWithUsableDateAndDaysSince: number; // both signals present on the same active record

  // Verdict (a convenience; recomputable from the counts above).
  firstSliceLastCheckInDerivable: DerivableVerdict;
  lastCheckInNormalizationNeeded: NormalizationNeeded;
  suitability: Suitability;
}

// ─── Helpers (pure; none emit, log, or retain values) ────────────────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ID-like key guard (from the shape-discovery probes): redact a key NAME that looks like an
// identifier/value so even an unexpected wrapper key cannot leak an ID.
function isIdLikeKey(key: string): boolean {
  if (key.length > 40) return true;
  if (/^\d{3,}$/.test(key)) return true;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(key)) return true;
  if (/^[0-9a-fA-F]{12,}$/.test(key)) return true;
  return false;
}

/** First present, non-empty candidate field value, else undefined. Read in memory only. */
function pickField(rec: Record<string, unknown>, candidates: string[]): unknown {
  for (const k of candidates) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

/** Strict calendar validity for a YYYY-MM-DD token — rejects impossible dates (e.g. 2026-02-30). */
function isStrictCalendarDate(token: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d)); // validity check only — never used for date math
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

type DateClass = 'missing' | 'sentinel' | 'strict_ymd' | 'dated_with_time' | 'unparseable';

/**
 * Classify a recency value WITHOUT retaining or emitting it. `strict_ymd` is directly compatible with
 * silentChurn.ts's `parseYmdLocal`; `dated_with_time` carries a valid date prefix but a time component
 * (so the server-side normalizer must slice the date before reusing `parseYmdLocal`).
 */
function classifyDateValue(raw: unknown): DateClass {
  if (raw === undefined || raw === null) return 'missing';
  const s = String(raw).trim();
  if (s === '') return 'missing';
  const token = s.split(/[T ]/)[0]; // leading date token; time component (if any) dropped
  if (token === SENTINEL_DATE) return 'sentinel'; // sentinel BEFORE validity, regardless of any time
  if (!isStrictCalendarDate(token)) return 'unparseable';
  return s.length > token.length ? 'dated_with_time' : 'strict_ymd';
}

function emptyDateStats(): DateFieldStats {
  return {
    presentCount: 0,
    missingCount: 0,
    sentinelCount: 0,
    strictYmdCount: 0,
    datedWithTimeCount: 0,
    unparseableCount: 0,
    usableDateCount: 0,
  };
}

/** Fold a date value into its field stats; returns whether the value is a usable (real) date. */
function tallyDate(stats: DateFieldStats, raw: unknown): boolean {
  const cls = classifyDateValue(raw);
  if (cls === 'missing') {
    stats.missingCount++;
    return false;
  }
  stats.presentCount++;
  switch (cls) {
    case 'sentinel':
      stats.sentinelCount++;
      return false;
    case 'unparseable':
      stats.unparseableCount++;
      return false;
    case 'strict_ymd':
      stats.strictYmdCount++;
      stats.usableDateCount++;
      return true;
    case 'dated_with_time':
      stats.datedWithTimeCount++;
      stats.usableDateCount++;
      return true;
  }
}

function emptyNumericStats(): NumericFieldStats {
  return { presentCount: 0, missingCount: 0, numericCount: 0, negativeCount: 0, nonNumericCount: 0 };
}

function tallyNumber(stats: NumericFieldStats, raw: unknown): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    stats.missingCount++;
    return false;
  }
  stats.presentCount++;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) {
    stats.nonNumericCount++;
    return false;
  }
  stats.numericCount++;
  if (n < 0) stats.negativeCount++;
  return true;
}

function emptyBooleanStats(): BooleanFieldStats {
  return { presentCount: 0, missingCount: 0, trueCount: 0, falseCount: 0, nonBooleanCount: 0 };
}

function tallyBoolean(stats: BooleanFieldStats, raw: unknown): void {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    stats.missingCount++;
    return;
  }
  stats.presentCount++;
  if (typeof raw === 'boolean') {
    if (raw) stats.trueCount++;
    else stats.falseCount++;
    return;
  }
  const s = String(raw).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') stats.trueCount++;
  else if (s === 'false' || s === '0' || s === 'no') stats.falseCount++;
  else stats.nonBooleanCount++;
}

/** Bucket a raw status value to an ALLOWLISTED category name (raw value never emitted). */
function bucketStatus(raw: unknown): string {
  if (raw === undefined || raw === null) return 'unknown';
  const s = String(raw).trim();
  if (s === '') return 'unknown';
  for (const [name, re] of STATUS_BUCKETS) if (re.test(s)) return name;
  return 'other';
}

function extractRecords(parsed: unknown): { records: Record<string, unknown>[]; key: string | null } {
  if (Array.isArray(parsed)) return { records: parsed as Record<string, unknown>[], key: '(root)' };
  if (isPlainObject(parsed)) {
    for (const key of RECORD_ARRAY_KEYS) {
      const v = parsed[key];
      if (Array.isArray(v)) return { records: v as Record<string, unknown>[], key: isIdLikeKey(key) ? '<id-like>' : key };
    }
  }
  return { records: [], key: null };
}

interface ErrorEnvelopeInfo {
  detected: boolean;
  embeddedStatusClass: HttpStatusClass | null;
}

function detectErrorEnvelope(parsed: unknown): ErrorEnvelopeInfo {
  if (!isPlainObject(parsed)) return { detected: false, embeddedStatusClass: null };
  const actualByLower = new Map<string, string>();
  for (const k of Object.keys(parsed)) actualByLower.set(k.toLowerCase(), k);
  const markerHits = ERROR_ENVELOPE_MARKER_KEYS.filter((m) => actualByLower.has(m));
  const httpCodeKey = actualByLower.get('httpcode');
  const detected = httpCodeKey !== undefined || markerHits.length >= 2;
  if (!detected) return { detected: false, embeddedStatusClass: null };
  let embeddedStatusClass: HttpStatusClass | null = null;
  if (httpCodeKey !== undefined) {
    const code = Number(parsed[httpCodeKey]); // reduced to a class; raw value never emitted
    if (Number.isFinite(code) && code >= 100 && code < 600) embeddedStatusClass = statusClassOf(code);
  }
  return { detected, embeddedStatusClass };
}

/** Detect a pagination "more pages" boolean (the BOOLEAN value is safe; a count value is not). */
function detectMorePages(parsed: unknown): boolean | null {
  if (!isPlainObject(parsed)) return null;
  const readBool = (obj: Record<string, unknown>): boolean | null => {
    for (const k of HAS_MORE_KEY_NAMES) {
      const v = obj[k];
      if (typeof v === 'boolean') return v;
    }
    return null;
  };
  const top = readBool(parsed);
  if (top !== null) return top;
  for (const container of META_CONTAINER_KEYS) {
    const c = parsed[container];
    if (isPlainObject(c)) {
      const nested = readBool(c);
      if (nested !== null) return nested;
    }
  }
  return null;
}

// ─── Derivation (pure; the self-test exercises this with synthetic PII) ───────────────────────────
interface RecencyInput {
  status: number;
  parsed: unknown; // JSON.parse result, or undefined if non-JSON / parse failed
  missingIdHint: boolean;
}

function blankResult(): ClientsRecencyResult {
  return {
    probe: 'clientsRecencyProbe',
    path: CLIENTS_PATH,
    endpointReached: true,
    httpStatusClass: 'network_error',
    errorEnvelopeDetected: false,
    embeddedHttpStatusClass: null,
    perClientIdLikelyRequired: false,
    jsonParseable: null,
    recordArrayKey: null,
    sampledPageRecordCount: 0,
    pagesFetched: 0,
    morePagesAvailable: null,
    statusCategoryCounts: {},
    activeRecordCount: 0,
    lastAttendance: emptyDateStats(),
    lastClassSignIn: emptyDateStats(),
    daysSinceLastAttendance: emptyNumericStats(),
    totalClassSignIns: emptyNumericStats(),
    isAtRisk: emptyBooleanStats(),
    activeWithUsableLastAttendance: 0,
    activeWithUsableLastClassSignIn: 0,
    activeWithUsableEitherDate: 0,
    activeWithDaysSinceNumeric: 0,
    activeWithUsableDateAndDaysSince: 0,
    firstSliceLastCheckInDerivable: 'no',
    lastCheckInNormalizationNeeded: 'unknown',
    suitability: 'unproven',
  };
}

function deriveRecency(input: RecencyInput): ClientsRecencyResult {
  const result = blankResult();
  result.httpStatusClass = statusClassOf(input.status);
  result.perClientIdLikelyRequired = input.missingIdHint;

  if (result.httpStatusClass !== '2xx') {
    result.suitability = 'unproven';
    return result;
  }
  result.pagesFetched = 1;
  if (input.parsed === undefined) {
    result.jsonParseable = false;
    result.suitability = 'unproven';
    return result;
  }
  result.jsonParseable = true;

  const { records, key } = extractRecords(input.parsed);
  if (records.length === 0) {
    // No records — could be a genuinely empty page or an error envelope. Distinguish, then bail.
    const envelope = detectErrorEnvelope(input.parsed);
    if (envelope.detected) {
      result.errorEnvelopeDetected = true;
      result.embeddedHttpStatusClass = envelope.embeddedStatusClass;
    }
    result.recordArrayKey = key;
    result.suitability = 'unproven';
    return result;
  }

  result.recordArrayKey = key;
  result.sampledPageRecordCount = records.length;
  result.morePagesAvailable = detectMorePages(input.parsed);

  const statusCounts: Record<string, number> = {};
  for (const rec of records) {
    if (!isPlainObject(rec)) continue;

    const bucket = bucketStatus(pickField(rec, STATUS_FIELDS));
    statusCounts[bucket] = (statusCounts[bucket] ?? 0) + 1;
    const isActive = bucket === 'active';
    if (isActive) result.activeRecordCount++;

    const laUsable = tallyDate(result.lastAttendance, pickField(rec, LAST_ATTENDANCE_FIELDS));
    const lcsUsable = tallyDate(result.lastClassSignIn, pickField(rec, LAST_CLASS_SIGNIN_FIELDS));
    const daysNumeric = tallyNumber(result.daysSinceLastAttendance, pickField(rec, DAYS_SINCE_FIELDS));
    tallyNumber(result.totalClassSignIns, pickField(rec, TOTAL_SIGNINS_FIELDS));
    tallyBoolean(result.isAtRisk, pickField(rec, IS_AT_RISK_FIELDS));

    if (isActive) {
      if (laUsable) result.activeWithUsableLastAttendance++;
      if (lcsUsable) result.activeWithUsableLastClassSignIn++;
      if (laUsable || lcsUsable) result.activeWithUsableEitherDate++;
      if (daysNumeric) result.activeWithDaysSinceNumeric++;
      if ((laUsable || lcsUsable) && daysNumeric) result.activeWithUsableDateAndDaysSince++;
    }
  }
  result.statusCategoryCounts = statusCounts;

  // Normalization: do the usable dates carry a time component (need a slice) or are they strict YMD?
  const datedWithTime = result.lastAttendance.datedWithTimeCount + result.lastClassSignIn.datedWithTimeCount;
  const strictYmd = result.lastAttendance.strictYmdCount + result.lastClassSignIn.strictYmdCount;
  result.lastCheckInNormalizationNeeded =
    datedWithTime > 0 ? 'date_slice' : strictYmd > 0 ? 'none' : 'unknown';

  // Verdict — coverage among the ACTIVE cohort (the classifier's denominator).
  if (result.activeRecordCount === 0) {
    result.firstSliceLastCheckInDerivable = 'no';
    result.suitability = 'unproven'; // can't measure the cohort that matters
    return result;
  }
  const coverage = result.activeWithUsableEitherDate / result.activeRecordCount;
  result.firstSliceLastCheckInDerivable = coverage >= SUFFICIENCY_COVERAGE_THRESHOLD ? 'yes' : coverage > 0 ? 'partial' : 'no';
  result.suitability = coverage >= SUFFICIENCY_COVERAGE_THRESHOLD ? 'sufficient' : 'insufficient';
  return result;
}

// ─── Live network layer (body read for derivation only; never logged / returned as text) ──────────
async function fetchClients(apiKey: string): Promise<RecencyInput> {
  // Reproduce the sibling probes' exact request. The query carries only structural paging params (no
  // IDs/dates/values), so the PATH is the only thing emitted; the full URL is never shown.
  const url = new URL(BASE_URL + CLIENTS_PATH);
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
  if (res.status >= 200 && res.status < 300) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = undefined;
    }
  }
  return { status: res.status, parsed, missingIdHint };
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO key) ────────
function runSelfTest(): void {
  const SECRETS = [
    'SECRET_FIRST_NAME',
    'SECRET_LAST_NAME',
    'secret@example.com',
    '70001', // a fake numeric client-ID VALUE
    '4242.42', // a fake dues VALUE (no dues field on /clients, but plant it to be safe)
    '2021-03-09', // a fake exact strict check-in date
    '2022-08-14', // a fake exact ISO date prefix
    '31337', // a fake days_since VALUE — must never leak (only counts may)
    '999777', // a fake total_class_sign_ins VALUE — must never leak (only counts may)
    'ZZZ_SECRET_STATUS', // a raw status VALUE — must bucket to 'other', never be emitted
  ];
  // Synthetic /clients body under the confirmed `clients` key. 6 records exercise every branch:
  //  r1 active   — last_attendance strict, last_class_sign_in ISO+time, days numeric, at-risk true
  //  r2 active   — last_attendance SENTINEL, last_class_sign_in null   (active but NO usable date)
  //  r3 'other'  — last_attendance strict                              (excluded from active cohort)
  //  r4 active   — last_attendance unparseable, last_class_sign_in strict (usable via last_class)
  //  r5 active   — last_attendance ISO+time, days missing              (usable via last_attendance)
  //  r6 active   — last_attendance strict
  // → active = 5; usable-either among active = 4 (r1, r4, r5, r6); coverage 0.8 → sufficient / 'yes'.
  const synthetic = {
    clients: [
      {
        id: 70001,
        first_name: 'SECRET_FIRST_NAME',
        last_name: 'SECRET_LAST_NAME',
        email: 'secret@example.com',
        client_status: 'Active',
        last_attendance: '2021-03-09',
        last_class_sign_in: '2022-08-14T09:30:00Z',
        days_since_last_attendance: 31337,
        total_class_sign_ins: 999777,
        is_at_risk: true,
        monthly_dues: 4242.42,
      },
      {
        id: 70002,
        client_status: 'Active',
        last_attendance: '1900-01-01',
        last_class_sign_in: null,
        days_since_last_attendance: 31337,
        is_at_risk: false,
      },
      { id: 70003, client_status: 'ZZZ_SECRET_STATUS', last_attendance: '2021-03-09' },
      { id: 70004, client_status: 'Active', last_attendance: 'N/A', last_class_sign_in: '2021-03-09' },
      { id: 70005, client_status: 'active', last_attendance: '2022-08-14T09:30:00Z' },
      { id: 70006, client_status: 'Active', last_attendance: '2021-03-09' },
    ],
    pagination: { page: 1, page_size: 100, has_more: true },
  };

  const result = deriveRecency({ status: 200, parsed: synthetic, missingIdHint: false });
  const serialized = JSON.stringify(result, null, 2);

  const leaks = SECRETS.filter((tok) => serialized.includes(tok));
  console.log(serialized);
  if (leaks.length > 0) {
    console.error(`SELFTEST FAIL: output contained disallowed token(s): ${leaks.join(', ')}`);
    process.exit(1);
    return;
  }
  const r = result;
  const expectations: Array<[string, boolean]> = [
    ['recordArrayKey==clients', r.recordArrayKey === 'clients'],
    ['sampledPageRecordCount==6', r.sampledPageRecordCount === 6],
    ['morePagesAvailable==true', r.morePagesAvailable === true],
    ['status active==5', r.statusCategoryCounts.active === 5],
    ['status other==1 (raw value bucketed, not emitted)', r.statusCategoryCounts.other === 1],
    ['activeRecordCount==5', r.activeRecordCount === 5],
    ['lastAttendance.strictYmd==3', r.lastAttendance.strictYmdCount === 3],
    ['lastAttendance.datedWithTime==1', r.lastAttendance.datedWithTimeCount === 1],
    ['lastAttendance.sentinel==1', r.lastAttendance.sentinelCount === 1],
    ['lastAttendance.unparseable==1', r.lastAttendance.unparseableCount === 1],
    ['lastAttendance.usable==4', r.lastAttendance.usableDateCount === 4],
    ['lastClassSignIn.usable==2', r.lastClassSignIn.usableDateCount === 2],
    ['lastClassSignIn.missing==4', r.lastClassSignIn.missingCount === 4],
    ['daysSince.numeric==2', r.daysSinceLastAttendance.numericCount === 2],
    ['isAtRisk.true==1 && false==1', r.isAtRisk.trueCount === 1 && r.isAtRisk.falseCount === 1],
    ['activeWithUsableEitherDate==4', r.activeWithUsableEitherDate === 4],
    ['activeWithUsableLastAttendance==3', r.activeWithUsableLastAttendance === 3],
    ['activeWithUsableLastClassSignIn==2', r.activeWithUsableLastClassSignIn === 2],
    ['activeWithDaysSinceNumeric==2', r.activeWithDaysSinceNumeric === 2],
    ['normalization==date_slice', r.lastCheckInNormalizationNeeded === 'date_slice'],
    ['derivable==yes (coverage 0.8)', r.firstSliceLastCheckInDerivable === 'yes'],
    ['suitability==sufficient', r.suitability === 'sufficient'],
  ];
  const failed = expectations.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    console.error(`SELFTEST FAIL: behavioral expectation(s) not met: ${failed.join(', ')}`);
    process.exit(1);
    return;
  }

  // Also exercise the error-envelope + non-2xx + empty branches (no synthetic secret needed).
  const envelope = deriveRecency({
    status: 200,
    parsed: { DeveloperMessage: 'x', ErrorCode: 'y', HTTPCode: 403, UserMessage: 'z' },
    missingIdHint: false,
  });
  const branchChecks: Array<[string, boolean]> = [
    ['envelope detected', envelope.errorEnvelopeDetected === true],
    ['envelope embedded class==4xx', envelope.embeddedHttpStatusClass === '4xx'],
    ['envelope suitability==unproven', envelope.suitability === 'unproven'],
    ['non-2xx → unproven', deriveRecency({ status: 403, parsed: undefined, missingIdHint: true }).suitability === 'unproven'],
    ['empty page → unproven', deriveRecency({ status: 200, parsed: { clients: [] }, missingIdHint: false }).suitability === 'unproven'],
  ];
  const branchFailed = branchChecks.filter(([, ok]) => !ok).map(([name]) => name);
  if (branchFailed.length > 0) {
    console.error(`SELFTEST FAIL: branch expectation(s) not met: ${branchFailed.join(', ')}`);
    process.exit(1);
    return;
  }

  console.error('SELFTEST PASS: no synthetic secret token in output; behavioral + branch checks passed; no network call made.');
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
        'scripts/wodify/clientsRecencyProbe.ts. No request was made.',
    );
    process.exit(1);
    return;
  }

  let input: RecencyInput;
  try {
    input = await fetchClients(apiKey);
  } catch {
    // Network / DNS failure — no HTTP response. Never log the error (it can echo the URL/host).
    const result = blankResult();
    result.endpointReached = false;
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = deriveRecency(input);
  // ONLY the safe aggregate is printed — no rows, values, IDs, dates, URLs, key, or raw responses.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('clients recency probe failed before producing a result (no data emitted).');
  process.exit(1);
});
