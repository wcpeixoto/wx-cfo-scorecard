/**
 * Wodify `/clients` MEMBERSHIP-START (join date) field-discovery + population-quality probe.
 * LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * Purpose (RETENTION_FINISH_PLAN.md §6 — the Churn-Risk-by-Tenure live/Sample gate)
 *   Churn Risk by Tenure is the next parked Retention card; it buckets ACTIVE members by tenure
 *   (days since membershipStart). The narrow open question: does `/clients` expose a usable
 *   membership start / join date for active members? This probe answers BOTH halves in one sweep:
 *     1. FIELD DISCOVERY — which `/clients` fields are join-date candidates BY NAME, split into
 *        STRONG (member_since / membership_start / join_date / joined_on / start_date …) vs
 *        WEAK/PROXY (created_on / registered_on / signup_date / enrollment_date …) buckets; and
 *     2. POPULATION QUALITY — per candidate, aggregate counts over ACTIVE members only:
 *        present / missing / non-date-shaped / invalid-date / 1900-01-01-sentinel / future-date /
 *        valid, plus min/max VALID YEAR (guarded — see below).
 *
 * Premise note (Reviewer fold-in #6): the 2026-06-10 membership-STATE probe's zero-candidate result
 *   does NOT prove that no membership/enroll-NAMED field exists on `/clients` — its candidate
 *   emission was value-filtered as well as name-filtered (a date-shaped value suppressed emission).
 *   This probe therefore re-discovers by NAME across every field, and value shape only CLASSIFIES
 *   stats (a name-admitted, non-date-shaped field is still reported, with zero date-shaped counts).
 *   Likewise, weak/proxy names (created_on etc.) are an ASSUMPTION until observed — this probe
 *   discovers; it never presumes a field exists.
 *
 * Decision rule (Reviewer fold-in #1 — HARDENED; the human/Reviewer make the real call):
 *   - A STRONG candidate with healthy population quality ⇒ Tenure MAY go live via a separate,
 *     gated aggregate extension (tenure-band histogram on the non-PII table — NOT this probe).
 *   - A WEAK/PROXY-only result does NOT flip Tenure live without explicit owner review:
 *     created/registered/signup dates can predate or postdate the real membership start
 *     (lead records, migrations, re-joins), so they are evidence for a CONVERSATION, not a wiring.
 *   - Zero candidates is a FIRST-CLASS outcome (fold-in #4): the emitted totalFieldsWalked +
 *     explicitly empty buckets are themselves the durable answer (Tenure stays Sample; a different
 *     source — e.g. an Admin export — would be needed).
 *
 * Safety contract (same §4/§5 posture as the merged sibling probes — and STRICTLY TIGHTER than
 * `clientStatusVocab.ts`: this probe emits NO raw upstream value at all, not even an enum string):
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, logged,
 *     printed, or echoed in errors. If unset/empty, exits WITHOUT making any request — and NEVER
 *     sources the key from Supabase secrets or the edge function. `--selftest` returns BEFORE any
 *     env read (no key needed, no key touched).
 *   - Reads candidate-field values IN MEMORY only, classifies them into counts, and discards them.
 *     Output is field NAMES (ID-like segments redacted), type categories, counts, booleans, HTTP
 *     status classes, and min/max VALID YEAR per candidate. NEVER names, member IDs, raw rows,
 *     exact per-member dates (no `YYYY-MM-DD` string ever appears in output — selftest-enforced),
 *     dues, request headers/URLs, keys, or raw/echoed response bodies.
 *   - YEAR-RANGE GUARD (Reviewer fold-in #3): minValidYear/maxValidYear are emitted ONLY when a
 *     candidate has >= MIN_VALID_FOR_YEAR_RANGE (5) valid values among actives; below that the
 *     years are withheld (`yearRangeSuppressed: true`, counts only) — a min/max over a tiny
 *     population approaches a single member's value. Sentinel/invalid/future values NEVER feed
 *     the year range.
 *   - Strict CALENDAR ROUND-TRIP for invalid dates (Reviewer fold-in #2): parse → rebuild via
 *     Date.UTC → require identical Y-M-D components. `parseYmdLocal`-style bare parsing is
 *     insufficient (it rolls 2026-02-30 into March — silentChurn.ts:58-66); this probe counts
 *     2026-02-30 as INVALID (selftest-pinned).
 *   - ACTIVE scoping imports the real `normalizeStatus` from `src/lib/gym/wodifyRetentionAggregate.ts`
 *     (the `clientStatusVocab.ts` faithful-predictor precedent; its only transitive import is the
 *     locked `./silentChurn.ts`, whose only import is TYPE-only — pure and side-effect-free), so
 *     "active" here is byte-identical to what the edge aggregates.
 *   - Detects a Wodify ERROR ENVELOPE at transport-2xx (top-level DeveloperMessage / ErrorCode /
 *     HTTPCode / UserMessage); the in-body HTTPCode is reduced to a status CLASS only.
 *   - Paginates the FULL client set (mirrors the edge `fetchAllClients`: loop while
 *     `pagination.has_more`, MAX_PAGES safety bound); `coverageComplete` surfaces whether the whole
 *     set was scanned — a partial scan is never mistaken for a complete discovery.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   Network-free self-test FIRST (makes NO request, needs NO key, reads NO env):
 *     npx tsx scripts/wodify/clientsMembershipStartDiscovery.ts --selftest
 *   Live run — worktree-safe: point --env-file at the primary clone's gitignored env by ABSOLUTE path:
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/clientsMembershipStartDiscovery.ts
 *   The LIVE run is gated: build + selftest → Reviewer leak-safety/coverage review → explicit
 *   Wesley GO. This probe does NOT deploy, re-arm, invoke, persist, or touch Supabase / the edge fn.
 *
 * Call budget — GET `/clients` pages only (the same request the edge makes), no per-client calls,
 * no writes, no Supabase calls.
 */

import { normalizeStatus } from '../../src/lib/gym/wodifyRetentionAggregate.ts';

// ─── CONFIG — mirrors supabase/functions/sync-wodify-retention/index.ts so the probe predicts the edge ─
const BASE_URL = 'https://api.wodify.com/v1'; // §5 reported base URL; auth via x-api-key header.
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100; // Wodify caps at 100/page (edge PAGE_SIZE).
const MAX_PAGES = 50; // edge MAX_PAGES — ~5000 clients, far above the ~957-client set; reachedPageCap flags a partial.
const REQUEST_TIMEOUT_MS = 15000; // edge WODIFY_TIMEOUT_MS.
const GYM_TZ = 'America/New_York'; // single gym — matches the shipped gymLocalDay decision (#445).

const MAX_NEST_DEPTH = 2; // recurse into nested objects (membership.start_date) like the state probe.
const MIN_VALID_FOR_YEAR_RANGE = 5; // Reviewer fold-in #3 — below this, years are withheld.
const MAX_REPORTED_PER_BUCKET = 16; // no silent caps: overflow beyond this is COUNTED, never dropped silently.
const SENTINEL_NULL_DATE = '1900-01-01'; // Wodify's null sentinel (§5/§8) — counted separately, never "old data".

// §5 / #423: Wodify error-envelope markers (matched case-insensitively; values are NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// ─── Candidate NAME classification (Reviewer fold-in #1) ───────────────────────────────────────────
// Decided on the NORMALIZED LEAF segment only (state-probe precedent): leaf-only so a date-named
// PARENT cannot admit an arbitrary child; normalized (camelCase split, `_`/`.`/digits → spaces) so
// \b-anchored stems behave identically for member_since / MemberSince / membership_start.
//
// STRONG — names that assert membership start directly: join/joined, since, start/started.
//   (membership_start matches via \bstart\b; member_since via \bsince\b; join_date via \bjoin\b.)
const STRONG_NAME_PATTERN = /\bjoin(ed)?\b|\bsince\b|\bstart(ed|s)?\b/i;
// WEAK/PROXY — account-lifecycle names that may proxy membership start but can diverge from it:
//   created/registered/signup (account creation ≠ membership start), enrol(lment), bare
//   member/membership-named dates (ambiguous: could be renewal), first_* (first_class_date is a
//   plausible tenure proxy; first_name is admitted by name but reports zero date-shaped values —
//   the date-shape classification keeps the noise honest).
const WEAK_PROXY_NAME_PATTERN = /creat|regist|signup|\bsign up\b|enrol|\bmember(ship)?\b|\bfirst\b/i;
// Actor-name deny (state-probe round-3 lesson): a leaf ending in ` by` (created_by / registered_by)
// names WHO acted, not when — excluded from candidacy entirely (values are never emitted anyway;
// this keeps the candidate list clean).
const ACTOR_BY_NAME_PATTERN = /(^|\s)by$/i;
// Duration deny: `<time-unit> since …` names a DURATION, not a date — days_since_last_attendance is
// the known /clients recency field, and days_since_joined would be a duration too. Without this,
// \bsince\b/\bjoined\b would wrongly admit them (the selftest pins both).
const DURATION_SINCE_DENY_PATTERN = /\b(day|days|week|weeks|month|months|year|years)\s+since\b/i;

// Normalize a field path segment for stem matching: split camelCase; `_` `.` and digits → spaces.
function normalizeForName(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[._\d]+/g, ' ');
}

type CandidateBucket = 'strong' | 'weak_proxy';

// Classify a field path into a candidate bucket, or null (not a candidate). Strong wins when both match.
function candidateBucketOf(fieldPath: string): CandidateBucket | null {
  const leaf = fieldPath.split('.').pop() ?? fieldPath;
  const n = normalizeForName(leaf).trim();
  if (ACTOR_BY_NAME_PATTERN.test(n)) return null;
  if (DURATION_SINCE_DENY_PATTERN.test(n)) return null;
  if (STRONG_NAME_PATTERN.test(n)) return 'strong';
  if (WEAK_PROXY_NAME_PATTERN.test(n)) return 'weak_proxy';
  return null;
}

// ─── Safe output contract ────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';
type TypeCategory = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
type StatusBucket = 'active' | 'inactive' | 'unknown';
type Conclusion =
  | 'strong_candidate_found' // >=1 STRONG candidate carries >=1 valid active date — quality review next.
  | 'weak_proxy_only' // only WEAK/PROXY candidates carry valid dates — owner review REQUIRED (fold-in #1).
  | 'no_candidates' // FIRST-CLASS outcome (fold-in #4): no field carries a usable join date by name+shape.
  | 'scan_incomplete'; // transport/coverage failure — candidate buckets are NOT trustworthy evidence.

// One candidate's population-quality report. Counts are EXCLUSIVE within their tier:
//   activePresent = activeNullOrEmpty + activeNonDateShaped + activeDateShaped
//   activeDateShaped = sentinel1900 + invalidDate + futureDate + validDate
//   activeKeyAbsent = activeTotal - activePresent;   activeMissing = activeKeyAbsent + activeNullOrEmpty
interface MembershipStartCandidate {
  field: string; // SAFE dot-path name (ID-like segments redacted at walk time); never a value.
  bucket: CandidateBucket;
  types: TypeCategory[]; // observed type categories (sorted), incl. 'null' if any null seen.
  presentCount: number; // records (ALL statuses) in which the key was present — context only.
  activePresentCount: number;
  activeKeyAbsentCount: number; // derived: activeTotal - activePresentCount.
  activeNullOrEmptyCount: number; // present but null / '' / whitespace-only.
  activeMissingCount: number; // the headline "missing": keyAbsent + nullOrEmpty.
  activeNonDateShapedCount: number; // present, non-null, but not a YYYY-MM-DD-prefixed string.
  activeDateShapedCount: number;
  sentinel1900Count: number; // exact 1900-01-01 — Wodify's null sentinel, NEVER a real old date.
  invalidDateCount: number; // date-shaped but fails the strict calendar round-trip (e.g. 2026-02-30).
  futureDateCount: number; // valid calendar date strictly after the gym-local run day.
  validDateCount: number; // valid calendar date, past-or-today — the usable population.
  usableRatePct: number; // validDateCount / activeTotal, 1 decimal place.
  minValidYear: number | null; // ONLY when validDateCount >= MIN_VALID_FOR_YEAR_RANGE; else null.
  maxValidYear: number | null;
  yearRangeSuppressed: boolean; // true ⇒ years withheld by the >=5-valid guard (fold-in #3).
}

interface ClientsMembershipStartResult {
  probe: 'clientsMembershipStartDiscovery';
  path: string; // PATH only — never a query string / substituted URL.
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  jsonParseable: boolean | null;
  recordArrayKey: string | null; // 'clients' — confirms the edge's records-array key/shape.
  pagesFetched: number;
  reachedPageCap: boolean;
  coverageComplete: boolean; // true ⇒ the WHOLE client set was scanned cleanly — discovery is exhaustive.
  totalRecordsScanned: number;
  statusBucketCounts: { active: number; inactive: number; unknown: number }; // census denominators.
  totalFieldsWalked: number; // distinct SAFE field paths discovered (fold-in #4 — emitted even at zero candidates).
  redactedFieldNameCount: number; // distinct ID-like field NAMES suppressed (counted, never emitted).
  strongCandidates: MembershipStartCandidate[]; // fold-in #1 — separate buckets, sorted validDateCount desc.
  weakProxyCandidates: MembershipStartCandidate[];
  reportedCandidateOverflowCount: number; // candidates beyond MAX_REPORTED_PER_BUCKET — counted, not silent.
  conclusion: Conclusion;
  decisionRule: string; // fold-in #1 hardening, restated in-band so the output is self-describing.
}

const DECISION_RULE =
  'A weak_proxy-only result does NOT flip Churn-by-Tenure live without explicit owner review ' +
  '(created/registered/signup dates can diverge from the real membership start). A strong candidate ' +
  'still requires owner + Reviewer sign-off on population quality before any aggregate extension. ' +
  'Zero candidates is itself the durable answer: Tenure stays Sample pending another source.';

// ─── Pure helpers (none emit, log, or retain values) ───────────────────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function typeCategoryOf(v: unknown): TypeCategory {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'object';
}

// ID-like field-NAME guard (clientsShapeDiscovery precedent): a key that looks like an ID/token VALUE
// must never be emitted as a "name" — redacted to a count.
function isIdLikeKey(key: string): boolean {
  if (key.length > 40) return true;
  if (/^\d{3,}$/.test(key)) return true;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(key)) return true;
  if (/^[0-9a-fA-F]{12,}$/.test(key)) return true;
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(key) && !/[a-z].*[A-Z]|_|-/.test(key)) return true;
  return false;
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

// Strict calendar round-trip (Reviewer fold-in #2): parse the 10-char YMD, rebuild via Date.UTC, and
// require IDENTICAL components. 2026-02-30 parses but rebuilds as March 2 → mismatch → invalid.
// (Bare `parseYmdLocal`-style parsing is insufficient — it accepts the rollover; silentChurn.ts:58-66.)
function strictYmdYear(ymd10: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd10);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y;
}

// Gym-local run day (YYYY-MM-DD). en-CA yields ISO order; TZ matches the shipped #445 decision.
// Self-contained on purpose (no gymLocalDay import) — the probe stays sibling-style standalone; the
// classification functions take `todayYmd` as a PARAMETER so the selftest is deterministic.
function gymLocalTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GYM_TZ }).format(new Date());
}

// ─── Field accumulation (pure; the self-test exercises this exact path with synthetic PII) ─────────
interface CandidateAcc {
  bucket: CandidateBucket;
  types: Set<TypeCategory>;
  presentCount: number; // all statuses
  activePresentCount: number;
  activeNullOrEmptyCount: number;
  activeNonDateShapedCount: number;
  sentinel1900Count: number;
  invalidDateCount: number;
  futureDateCount: number;
  validDateCount: number;
  minValidYear: number | null;
  maxValidYear: number | null;
}

function freshCandidateAcc(bucket: CandidateBucket): CandidateAcc {
  return {
    bucket,
    types: new Set(),
    presentCount: 0,
    activePresentCount: 0,
    activeNullOrEmptyCount: 0,
    activeNonDateShapedCount: 0,
    sentinel1900Count: 0,
    invalidDateCount: 0,
    futureDateCount: 0,
    validDateCount: 0,
    minValidYear: null,
    maxValidYear: null,
  };
}

interface ScanCtx {
  candidates: Map<string, CandidateAcc>; // candidate field path -> acc
  allFieldPaths: Set<string>; // every SAFE field path walked (candidate or not) — drives totalFieldsWalked
  redactedFieldNames: Set<string>; // ID-like field NAMES (in memory only; only the COUNT is emitted)
  statusBucketCounts: { active: number; inactive: number; unknown: number };
  totalRecordsScanned: number;
  todayYmd: string; // injected — deterministic in selftest, gym-local on the live run
}

function freshCtx(todayYmd: string): ScanCtx {
  return {
    candidates: new Map(),
    allFieldPaths: new Set(),
    redactedFieldNames: new Set(),
    statusBucketCounts: { active: 0, inactive: 0, unknown: 0 },
    totalRecordsScanned: 0,
    todayYmd,
  };
}

// The edge's exact status mapping (imported), reduced to this probe's three buckets.
function statusBucketOf(rec: Record<string, unknown>): StatusBucket {
  return normalizeStatus(rec['client_status']) ?? 'unknown';
}

// Classify one candidate value (transient; the value is counted, then discarded — never stored/emitted).
function accumulateCandidateValue(acc: CandidateAcc, v: unknown, bucket: StatusBucket, todayYmd: string): void {
  acc.presentCount += 1;
  acc.types.add(typeCategoryOf(v));
  if (bucket !== 'active') return; // quality stats are ACTIVE-scoped (the Tenure card's population)
  acc.activePresentCount += 1;
  if (v === null || v === undefined) {
    acc.activeNullOrEmptyCount += 1;
    return;
  }
  if (typeof v !== 'string') {
    acc.activeNonDateShapedCount += 1; // number/boolean/object/array — count-only, never inspected further
    return;
  }
  const trimmed = v.trim();
  if (trimmed === '') {
    acc.activeNullOrEmptyCount += 1;
    return;
  }
  // Date-shaped = a YYYY-MM-DD prefix (ISO datetimes count via the 10-char slice — the edge's
  // sliceUsableDate posture, wodifyRetentionAggregate.ts:140-155).
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    acc.activeNonDateShapedCount += 1;
    return;
  }
  const ymd10 = trimmed.slice(0, 10);
  if (ymd10 === SENTINEL_NULL_DATE) {
    acc.sentinel1900Count += 1; // the Wodify null sentinel — never fed to year range or "valid"
    return;
  }
  const year = strictYmdYear(ymd10);
  if (year === null) {
    acc.invalidDateCount += 1; // fold-in #2: 2026-02-30 lands here, not in valid
    return;
  }
  if (ymd10 > todayYmd) {
    acc.futureDateCount += 1; // lexical > is chronological > for YYYY-MM-DD (pickLastCheckIn precedent)
    return;
  }
  acc.validDateCount += 1;
  if (acc.minValidYear === null || year < acc.minValidYear) acc.minValidYear = year;
  if (acc.maxValidYear === null || year > acc.maxValidYear) acc.maxValidYear = year;
}

// Walk a record's fields, recursing into nested plain objects up to MAX_NEST_DEPTH (state-probe precedent).
function walkRecord(obj: Record<string, unknown>, prefix: string, level: number, bucket: StatusBucket, ctx: ScanCtx): void {
  for (const [k, v] of Object.entries(obj)) {
    if (isIdLikeKey(k)) {
      ctx.redactedFieldNames.add(prefix ? `${prefix}.${k}` : k);
      continue; // never track an id-like-named field
    }
    const path = prefix ? `${prefix}.${k}` : k;
    ctx.allFieldPaths.add(path);
    const bucketName = candidateBucketOf(path);
    if (bucketName !== null) {
      let acc = ctx.candidates.get(path);
      if (!acc) {
        acc = freshCandidateAcc(bucketName);
        ctx.candidates.set(path, acc);
      }
      accumulateCandidateValue(acc, v, bucket, ctx.todayYmd);
    }
    if (isPlainObject(v) && level < MAX_NEST_DEPTH) walkRecord(v, path, level + 1, bucket, ctx);
  }
}

function tallyRecords(records: readonly unknown[], ctx: ScanCtx): void {
  for (const rec of records) {
    const obj = isPlainObject(rec) ? rec : null;
    const bucket: StatusBucket = obj ? statusBucketOf(obj) : 'unknown';
    ctx.statusBucketCounts[bucket] += 1;
    ctx.totalRecordsScanned += 1;
    if (obj) walkRecord(obj, '', 0, bucket, ctx);
  }
}

// ─── Build the safe result (pure) ──────────────────────────────────────────────────────────────────
interface TransportMeta {
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  jsonParseable: boolean | null;
  recordArrayKey: string | null;
  pagesFetched: number;
  reachedPageCap: boolean;
}

function freshMeta(): TransportMeta {
  return {
    endpointReached: true,
    httpStatusClass: '2xx',
    errorEnvelopeDetected: false,
    embeddedHttpStatusClass: null,
    jsonParseable: null,
    recordArrayKey: null,
    pagesFetched: 0,
    reachedPageCap: false,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function buildCandidate(field: string, acc: CandidateAcc, activeTotal: number): MembershipStartCandidate {
  const activeKeyAbsentCount = activeTotal - acc.activePresentCount;
  const activeDateShapedCount =
    acc.sentinel1900Count + acc.invalidDateCount + acc.futureDateCount + acc.validDateCount;
  const emitYears = acc.validDateCount >= MIN_VALID_FOR_YEAR_RANGE;
  return {
    field,
    bucket: acc.bucket,
    types: [...acc.types].sort(),
    presentCount: acc.presentCount,
    activePresentCount: acc.activePresentCount,
    activeKeyAbsentCount,
    activeNullOrEmptyCount: acc.activeNullOrEmptyCount,
    activeMissingCount: activeKeyAbsentCount + acc.activeNullOrEmptyCount,
    activeNonDateShapedCount: acc.activeNonDateShapedCount,
    activeDateShapedCount,
    sentinel1900Count: acc.sentinel1900Count,
    invalidDateCount: acc.invalidDateCount,
    futureDateCount: acc.futureDateCount,
    validDateCount: acc.validDateCount,
    usableRatePct: activeTotal > 0 ? round1((100 * acc.validDateCount) / activeTotal) : 0,
    minValidYear: emitYears ? acc.minValidYear : null,
    maxValidYear: emitYears ? acc.maxValidYear : null,
    yearRangeSuppressed: !emitYears,
  };
}

function buildResult(ctx: ScanCtx, meta: TransportMeta): ClientsMembershipStartResult {
  const activeTotal = ctx.statusBucketCounts.active;
  const all = [...ctx.candidates.entries()]
    .map(([field, acc]) => buildCandidate(field, acc, activeTotal))
    .sort((a, b) => b.validDateCount - a.validDateCount || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));

  const strongAll = all.filter((c) => c.bucket === 'strong');
  const weakAll = all.filter((c) => c.bucket === 'weak_proxy');
  const strongCandidates = strongAll.slice(0, MAX_REPORTED_PER_BUCKET);
  const weakProxyCandidates = weakAll.slice(0, MAX_REPORTED_PER_BUCKET);
  const reportedCandidateOverflowCount =
    strongAll.length - strongCandidates.length + (weakAll.length - weakProxyCandidates.length);

  const coverageComplete =
    meta.endpointReached &&
    meta.httpStatusClass === '2xx' &&
    !meta.errorEnvelopeDetected &&
    meta.jsonParseable !== false &&
    !meta.reachedPageCap &&
    meta.pagesFetched > 0 &&
    meta.recordArrayKey !== null &&
    ctx.totalRecordsScanned > 0;

  let conclusion: Conclusion;
  if (!coverageComplete) conclusion = 'scan_incomplete';
  else if (strongAll.some((c) => c.validDateCount > 0)) conclusion = 'strong_candidate_found';
  else if (weakAll.some((c) => c.validDateCount > 0)) conclusion = 'weak_proxy_only';
  else conclusion = 'no_candidates';

  return {
    probe: 'clientsMembershipStartDiscovery',
    path: CLIENTS_PATH,
    endpointReached: meta.endpointReached,
    httpStatusClass: meta.httpStatusClass,
    errorEnvelopeDetected: meta.errorEnvelopeDetected,
    embeddedHttpStatusClass: meta.embeddedHttpStatusClass,
    jsonParseable: meta.jsonParseable,
    recordArrayKey: meta.recordArrayKey,
    pagesFetched: meta.pagesFetched,
    reachedPageCap: meta.reachedPageCap,
    coverageComplete,
    totalRecordsScanned: ctx.totalRecordsScanned,
    statusBucketCounts: { ...ctx.statusBucketCounts },
    totalFieldsWalked: ctx.allFieldPaths.size,
    redactedFieldNameCount: ctx.redactedFieldNames.size,
    strongCandidates,
    weakProxyCandidates,
    reportedCandidateOverflowCount,
    conclusion,
    decisionRule: DECISION_RULE,
  };
}

// ─── Live network layer (body read for tally only; never logged / returned as text) ───────────────
async function scanAllClients(apiKey: string, todayYmd: string): Promise<{ ctx: ScanCtx; meta: TransportMeta }> {
  const ctx = freshCtx(todayYmd);
  const meta = freshMeta();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(BASE_URL + CLIENTS_PATH);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(PAGE_SIZE));

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'x-api-key': apiKey, accept: 'application/json' }, // key never logged
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network / DNS / timeout — no HTTP response. Never log the error (it can echo the URL/host).
      if (page === 1) meta.endpointReached = false;
      meta.httpStatusClass = 'network_error';
      return { ctx, meta };
    }

    meta.httpStatusClass = statusClassOf(res.status);
    if (!res.ok) return { ctx, meta }; // non-2xx — stop; coverage incomplete.

    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      bodyText = '';
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      meta.jsonParseable = false;
      return { ctx, meta };
    }
    meta.jsonParseable = true;

    const envelope = detectErrorEnvelope(parsed);
    if (envelope.detected) {
      meta.errorEnvelopeDetected = true;
      meta.embeddedHttpStatusClass = envelope.embeddedStatusClass;
      return { ctx, meta };
    }

    const clients = isPlainObject(parsed) ? parsed['clients'] : undefined;
    const records: unknown[] = Array.isArray(clients) ? clients : [];
    if (meta.recordArrayKey === null && Array.isArray(clients)) meta.recordArrayKey = 'clients';
    tallyRecords(records, ctx);
    meta.pagesFetched += 1;

    const pagination = isPlainObject(parsed) ? parsed['pagination'] : undefined;
    const hasMore = isPlainObject(pagination) && pagination['has_more'] === true;
    if (!hasMore || records.length === 0) break;
    if (page === MAX_PAGES) meta.reachedPageCap = true; // more pages exist but we hit the safety bound.
  }

  return { ctx, meta };
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO key/env) ─────
function runSelfTest(): void {
  const TODAY = '2026-06-15'; // injected — deterministic, independent of the machine clock/timezone.

  // PII / secrets planted on the rows. NONE may appear in output — including EXACT DATES (the planted
  // candidate values themselves are the leak-test payload: counts may emit, the strings never may).
  const PII = [
    'SECRET_FIRST',
    'SECRET_LAST',
    'secret@member.example',
    '70001', // a fake member-ID VALUE
    '4242.42', // a fake dues VALUE
    '2019-03-04', // planted membership_start VALUE — must never echo
    '2018-05-06', // planted nested membership.start_date VALUE — must never echo
    '2021-07-08', // planted created_on VALUE — must never echo
    'SECRET_BLOB_TOKEN', // hidden inside a long free-text candidate-named field
  ];

  // Synthetic /clients page. Counts are chosen so every branch is exercised and conservation is checkable.
  // ACTIVE records: 8;  INACTIVE: 2 (their candidate values must NOT enter active stats);  unknown: 1.
  const records: unknown[] = [
    // 1 — full PII row; strong candidate valid; weak created_on valid; nested strong valid.
    { id: 70001, first_name: 'SECRET_FIRST', last_name: 'SECRET_LAST', email: 'secret@member.example', monthly_dues: 4242.42, client_status: 'Active', membership_start: '2019-03-04', created_on: '2021-07-08', membership: { start_date: '2018-05-06' }, last_attendance: '2026-06-01' },
    // 2-4 — strong candidate: valid (datetime suffix counts via 10-char slice), sentinel, invalid (fold-in #2).
    { client_status: 'Active', membership_start: '2020-11-30T09:00:00Z', created_on: '2020-01-02' },
    { client_status: 'Active', membership_start: '1900-01-01', created_on: '2020-01-03' },
    { client_status: 'Active', membership_start: '2026-02-30', created_on: '2020-01-04' },
    // 5 — strong candidate: FUTURE date (after injected TODAY).
    { client_status: 'Active', membership_start: '2027-01-01', created_on: '2020-01-05' },
    // 6 — strong candidate: empty string (missing); weak valid.
    { client_status: 'Active', membership_start: '', created_on: '2020-01-06' },
    // 7 — strong candidate: null; weak non-date-shaped (free text w/ planted token).
    { client_status: 'Active', membership_start: null, created_on: 'SECRET_BLOB_TOKEN free text not a date' },
    // 8 — strong candidate ABSENT (key missing); join_date present but only here (<5 valid → year suppression).
    { client_status: 'Active', join_date: '2015-09-10', created_on: '2020-01-07' },
    // 9-10 — INACTIVE rows with valid candidate values — must NOT count toward active stats.
    { client_status: 'Inactive', membership_start: '2010-01-15', created_on: '2010-01-15' },
    { client_status: 'Inactive', membership_start: '2011-02-16' },
    // 11 — unknown status (retired vocab) — must land in the unknown bucket, not active.
    { client_status: 'Paused', membership_start: '2012-03-17' },
  ];

  const ctx = freshCtx(TODAY);
  tallyRecords(records, ctx);
  const result = buildResult(ctx, {
    ...freshMeta(),
    endpointReached: true,
    httpStatusClass: '2xx',
    jsonParseable: true,
    recordArrayKey: 'clients',
    pagesFetched: 1,
  });
  const serialized = JSON.stringify(result, null, 2);
  console.log(serialized);

  // (1) LEAK SCAN (fold-in #5e): no planted PII token — and NO exact date AT ALL — may appear in output.
  const leaks = PII.filter((tok) => serialized.includes(tok));
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) leaks.push('(a YYYY-MM-DD date string leaked)');
  if (leaks.length > 0) {
    console.error(`SELFTEST FAIL: output contained disallowed token(s): ${leaks.join(', ')}`);
    process.exit(1);
    return;
  }

  const findStrong = (f: string) => result.strongCandidates.find((c) => c.field === f);
  const findWeak = (f: string) => result.weakProxyCandidates.find((c) => c.field === f);
  const ms = findStrong('membership_start');
  const jd = findStrong('join_date');
  const nested = findStrong('membership.start_date');
  const co = findWeak('created_on');
  const fn = findWeak('first_name');

  const expectations: Array<[string, boolean]> = [
    // Census denominators + walk coverage (fold-in #4 machinery).
    ['statusBuckets == {active 8, inactive 2, unknown 1}', result.statusBucketCounts.active === 8 && result.statusBucketCounts.inactive === 2 && result.statusBucketCounts.unknown === 1],
    ['totalRecordsScanned == 11', result.totalRecordsScanned === 11],
    ['totalFieldsWalked > 0', result.totalFieldsWalked > 0],
    // (fold-in #5a) STRONG candidate with valid / missing / sentinel / invalid / future all counted.
    ['membership_start is a STRONG candidate', ms !== undefined],
    ['membership_start: valid == 2 (incl. datetime-suffix slice)', ms?.validDateCount === 2],
    ['membership_start: sentinel1900 == 1', ms?.sentinel1900Count === 1],
    ['membership_start: invalid == 1 (2026-02-30 via round-trip — fold-in #5c)', ms?.invalidDateCount === 1],
    ['membership_start: future == 1', ms?.futureDateCount === 1],
    ['membership_start: nullOrEmpty == 2 (null + empty string)', ms?.activeNullOrEmptyCount === 2],
    ['membership_start: keyAbsent == 1 (active row 8)', ms?.activeKeyAbsentCount === 1],
    ['membership_start: missing == 3 (absent + null/empty)', ms?.activeMissingCount === 3],
    // INACTIVE/unknown rows carried membership_start values — excluded from active stats by scoping.
    ['membership_start: activePresent == 7 (inactive/unknown rows excluded)', ms?.activePresentCount === 7],
    ['membership_start: presentCount == 10 (all statuses, context)', ms?.presentCount === 10],
    // Conservation (per the exclusive-tier contract).
    ['conservation: present == nullOrEmpty + nonDateShaped + dateShaped', ms !== undefined && ms.activePresentCount === ms.activeNullOrEmptyCount + ms.activeNonDateShapedCount + ms.activeDateShapedCount],
    ['conservation: dateShaped == sentinel + invalid + future + valid', ms !== undefined && ms.activeDateShapedCount === ms.sentinel1900Count + ms.invalidDateCount + ms.futureDateCount + ms.validDateCount],
    ['conservation: present + keyAbsent == activeTotal', ms !== undefined && ms.activePresentCount + ms.activeKeyAbsentCount === result.statusBucketCounts.active],
    // (fold-in #5d) <5-valid candidates → year range SUPPRESSED.
    ['membership_start: years suppressed (2 valid < 5)', ms?.yearRangeSuppressed === true && ms?.minValidYear === null && ms?.maxValidYear === null],
    ['join_date: years suppressed (1 valid < 5)', jd !== undefined && jd.validDateCount === 1 && jd.yearRangeSuppressed === true && jd.minValidYear === null],
    // (fold-in #5b) WEAK/PROXY reported separately from strong — never cross-listed.
    ['created_on is WEAK/PROXY, not strong', co !== undefined && findStrong('created_on') === undefined],
    ['membership_start is strong, not weak', findWeak('membership_start') === undefined],
    // created_on: 7 valid actives (rows 1-6 + 8; row 7 is the free-text) → years EMITTED at >=5 valid.
    ['created_on: valid == 7, years emitted (2020-2021)', co?.validDateCount === 7 && co?.yearRangeSuppressed === false && co?.minValidYear === 2020 && co?.maxValidYear === 2021],
    ['created_on: nonDateShaped == 1 (free text counted, never echoed)', co?.activeNonDateShapedCount === 1],
    // Name-admitted but never date-shaped: reported honestly with zero date-shaped values.
    ['first_name: weak by \\bfirst\\b, zero date-shaped', fn !== undefined && fn.activeDateShapedCount === 0 && fn.validDateCount === 0],
    // Nested walk (membership.start_date) is discovered as strong via its LEAF.
    ['membership.start_date discovered (nested, strong)', nested !== undefined && nested.validDateCount === 1],
    // Non-candidates stay out: recency fields must NOT be classified as join-date candidates.
    ['last_attendance is NOT a candidate', findStrong('last_attendance') === undefined && findWeak('last_attendance') === undefined && candidateBucketOf('last_attendance') === null],
    ['days_since_last_attendance is NOT a candidate (duration deny)', candidateBucketOf('days_since_last_attendance') === null],
    ['days_since_joined is NOT a candidate (duration deny beats joined)', candidateBucketOf('days_since_joined') === null],
    ['date_of_birth / dob are NOT candidates', candidateBucketOf('date_of_birth') === null && candidateBucketOf('dob') === null],
    ['created_by denied (actor …by)', candidateBucketOf('created_by') === null],
    ['restart_count not admitted via start (word boundary)', candidateBucketOf('restart_count') === null],
    // Classification spot checks (normalized-leaf matching incl. camelCase).
    ['MemberSince → strong', candidateBucketOf('MemberSince') === 'strong'],
    ['signup_date → weak_proxy', candidateBucketOf('signup_date') === 'weak_proxy'],
    ['enrollment_date → weak_proxy', candidateBucketOf('enrollment_date') === 'weak_proxy'],
    ['membership.start_date leaf admits, parent does not', candidateBucketOf('membership.assigned_coach') === null],
    // Round-trip validator directly (fold-in #2/#5c).
    ['strictYmdYear: 2026-02-30 → null (rolls to March; rejected)', strictYmdYear('2026-02-30') === null],
    ['strictYmdYear: 2024-02-29 → 2024 (real leap day)', strictYmdYear('2024-02-29') === 2024],
    ['strictYmdYear: 2023-02-29 → null (not a leap year)', strictYmdYear('2023-02-29') === null],
    // Conclusion + self-description.
    ['conclusion == strong_candidate_found', result.conclusion === 'strong_candidate_found'],
    ['decisionRule present (weak-only does not flip live)', result.decisionRule.includes('does NOT flip Churn-by-Tenure live')],
    ['no overflow at this candidate count', result.reportedCandidateOverflowCount === 0],
    ['coverageComplete == true (all OK)', result.coverageComplete === true],
  ];
  const failed = expectations.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    console.error(`SELFTEST FAIL: behavioral expectation(s) not met: ${failed.join(' | ')}`);
    process.exit(1);
    return;
  }

  // (fold-in #4) ZERO-CANDIDATE fixture — a first-class outcome: explicit empty buckets + fields-walked.
  const zeroCtx = freshCtx(TODAY);
  tallyRecords(
    [
      { client_status: 'Active', email: 'secret@member.example', last_attendance: '2026-06-01', is_at_risk: false },
      { client_status: 'Inactive', last_class_sign_in: '2024-01-01' },
    ],
    zeroCtx,
  );
  const zeroResult = buildResult(zeroCtx, { ...freshMeta(), endpointReached: true, httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: 'clients', pagesFetched: 1 });
  const zeroSerialized = JSON.stringify(zeroResult);
  const zeroChecks: Array<[string, boolean]> = [
    ['zero-candidate: conclusion == no_candidates', zeroResult.conclusion === 'no_candidates'],
    ['zero-candidate: buckets explicitly empty', zeroResult.strongCandidates.length === 0 && zeroResult.weakProxyCandidates.length === 0],
    ['zero-candidate: totalFieldsWalked still emitted (> 0)', zeroResult.totalFieldsWalked > 0],
    ['zero-candidate: no date string leaked', !/\d{4}-\d{2}-\d{2}/.test(zeroSerialized)],
  ];
  const zeroFailed = zeroChecks.filter(([, ok]) => !ok).map(([name]) => name);
  if (zeroFailed.length > 0) {
    console.error(`SELFTEST FAIL: zero-candidate outcome checks failed: ${zeroFailed.join(' | ')}`);
    process.exit(1);
    return;
  }

  // Coverage / transport branches — coverageComplete must be FALSE whenever the scan is not whole,
  // and conclusion must then be scan_incomplete (candidate evidence is not trustworthy on a partial).
  const partials: Array<[string, ClientsMembershipStartResult]> = [
    ['reachedPageCap', buildResult(ctx, { ...freshMeta(), jsonParseable: true, pagesFetched: MAX_PAGES, reachedPageCap: true })],
    ['errorEnvelope', buildResult(ctx, { ...freshMeta(), jsonParseable: true, pagesFetched: 1, errorEnvelopeDetected: true, embeddedHttpStatusClass: '4xx' })],
    ['non-2xx', buildResult(ctx, { ...freshMeta(), httpStatusClass: '4xx', jsonParseable: true, pagesFetched: 1 })],
    ['network_error', buildResult(ctx, { ...freshMeta(), endpointReached: false, httpStatusClass: 'network_error', pagesFetched: 0 })],
    ['non-json', buildResult(ctx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: false, pagesFetched: 0 })],
    ['zeroRecordsButKeySeen', buildResult(freshCtx(TODAY), { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: 'clients', pagesFetched: 1 })],
    ['recordArrayKeyNull', buildResult(ctx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: null, pagesFetched: 1 })],
  ];
  const badPartials = partials
    .filter(([, r]) => r.coverageComplete !== false || r.conclusion !== 'scan_incomplete')
    .map(([name]) => name);
  if (badPartials.length > 0) {
    console.error(`SELFTEST FAIL: coverage/conclusion should be incomplete for: ${badPartials.join(', ')}`);
    process.exit(1);
    return;
  }

  // Error-envelope detector — direct check (in-body HTTPCode → class only).
  const env = detectErrorEnvelope({ DeveloperMessage: 'x', ErrorCode: 'y', HTTPCode: 403, UserMessage: 'z' });
  if (!env.detected || env.embeddedStatusClass !== '4xx') {
    console.error('SELFTEST FAIL: error-envelope detector did not classify the synthetic envelope.');
    process.exit(1);
    return;
  }

  console.error(
    'SELFTEST PASS: strong/weak buckets separated, 2026-02-30 invalid by round-trip, year range ' +
      'suppressed under 5 valid, zero-candidate outcome first-class, no planted PII / exact date in ' +
      'output, coverage + envelope branches verified; no network call made, no env read.',
  );
}

async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }

  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error(
      'WODIFY_API_KEY is not set. Provide it via a gitignored env file (never commit or paste it; never ' +
        'source it from Supabase secrets or the edge function), e.g. npx tsx ' +
        '--env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local scripts/wodify/clientsMembershipStartDiscovery.ts. ' +
        'No request was made.',
    );
    process.exit(1);
    return;
  }

  const { ctx, meta } = await scanAllClients(apiKey, gymLocalTodayYmd());
  const result = buildResult(ctx, meta);
  // ONLY safe aggregates are printed — field names, counts, booleans, guarded years; no rows, names,
  // IDs, exact dates, dues, URLs, or key.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('membership-start discovery probe failed before producing a result (no data emitted).');
  process.exit(1);
});
