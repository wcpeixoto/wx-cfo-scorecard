/**
 * Wodify `/clients` DATE-OF-BIRTH + MEMBER_SINCE FILL-RATE-BY-STATUS probe.
 * LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * Purpose (RETENTION_FINISH_PLAN.md §9 Read 1 + Read 2 — Cohort Retention Card "must-confirm #1")
 *   The cohort card derives four age cohorts from member age. Two source questions, one sweep:
 *     1. DOB FILL RATE, BROKEN OUT BY status bucket (active / inactive / unknown) — the cohort source
 *        pivot. A prior value-blind shape-discovery proved `date_of_birth` is PRESENT on the wire row;
 *        presence is not fill. The sibling membership-start probe is ACTIVE-scoped only, and Read 2
 *        (lapsed-per-cohort) depends on DOB being populated for INACTIVE members specifically.
 *     2. MEMBER_SINCE FILL RATE, same per-status split — under the client_status Read-2 basis, lapsed =
 *        the inactive /clients population split by cohort, but it needs a guard so never-membered
 *        profiles (guardian/staff/leads) are not counted as lapsed. `member_since` is the only /clients
 *        proxy for "was ever a member"; its INACTIVE fill decides whether that basis is cleanly
 *        buildable. `bothUsableByStatus` reports records with BOTH a usable DOB AND a usable
 *        member_since per status — the exact buildable-lapsed population.
 *     3. MEMBERSHIP-FIELD SCAN — which membership/status/history-named fields the row carries (names
 *        only), bearing on whether an Inactive member is confirmable as a former member WITHOUT the
 *        All-Memberships feed.
 *
 * Decision rule (the human/Reviewer make the real call):
 *   - DOB present AND well-populated for BOTH active and inactive ⇒ a server-side age-band × recency ×
 *     status aggregate off the existing `/clients` pull is viable (Read 1 + Read 2 source). Gated build.
 *   - DOB absent or sparse (esp. for inactive) ⇒ the source path changes: a demographics re-export
 *     carrying `Client ID` to join, or an Attendance pull. This probe REPORTS which; it does not build.
 *   - A partial/failed scan (coverageComplete=false) is NOT trustworthy fill evidence.
 *
 * Safety contract (same §4/§5 posture as the merged sibling probes — counts + field NAMES only):
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, logged, printed,
 *     or echoed in errors. If unset/empty, exits WITHOUT making any request. `--selftest` returns
 *     BEFORE any env read (no key needed, no key touched).
 *   - Reads `date_of_birth` / `member_since` / `client_status` values IN MEMORY only, classifies into
 *     counts, discards. Output is field NAMES (ID-like segments redacted), counts, rates, booleans, and
 *     HTTP status classes. NEVER member names, IDs, raw rows, exact dates / DOB / member_since values
 *     (no `YYYY-MM-DD` string ever appears in output — selftest-enforced AND live-guard-enforced),
 *     ages, request headers/URLs, keys, or response bodies.
 *   - NO year is emitted (strictly tighter than the sibling's guarded min/max-year): a year is an age
 *     proxy, so only validity COUNTS cross the boundary, never any year.
 *   - LIVE LEAK GUARD: the live path re-runs the field-agnostic ISO-date scan on its own serialized
 *     output and aborts WITHOUT printing if any `YYYY-MM-DD` appears (defense-in-depth behind selftest).
 *   - Strict CALENDAR ROUND-TRIP for invalid dates (parse → rebuild via Date.UTC → identical Y-M-D):
 *     2026-02-30 counts INVALID, not rolled into March (selftest-pinned).
 *   - 1900-01-01 sentinel counted separately, never "a real old date" → never a usable value.
 *   - ACTIVE/INACTIVE scoping imports the real `normalizeStatus` from
 *     `src/lib/gym/wodifyRetentionAggregate.ts` so the buckets are byte-identical to what the edge
 *     aggregates (present-but-unrecognized status → unknown, never silently active).
 *   - Detects a Wodify ERROR ENVELOPE at transport-2xx (DeveloperMessage / ErrorCode / HTTPCode /
 *     UserMessage); the in-body HTTPCode is reduced to a status CLASS only.
 *   - Paginates the FULL client set (mirrors the edge `fetchAllClients`: loop while
 *     `pagination.has_more`, MAX_PAGES safety bound); `coverageComplete` requires the WHOLE set was
 *     scanned cleanly AND > 0 records of the right shape (so a 0-record / wrong-shape 2xx reads
 *     scan_incomplete, never a false "complete").
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   Network-free self-test FIRST (makes NO request, needs NO key, reads NO env):
 *     npx tsx scripts/wodify/clientsDobFillProbe.ts --selftest
 *   Live run — worktree-safe: point --env-file at the primary clone's gitignored env by ABSOLUTE path:
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/clientsDobFillProbe.ts
 *   The LIVE run is GATED (sibling precedent, clientsMembershipStartDiscovery.ts): build + extended
 *   selftest → Reviewer PASS → explicit Wesley GO. This probe does NOT deploy, re-arm, invoke,
 *   persist, or touch Supabase / the edge fn.
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
const SENTINEL_NULL_DATE = '1900-01-01'; // Wodify's null sentinel (§5/§8) — counted separately, never a real value.

// §5 / #423: Wodify error-envelope markers (matched case-insensitively; values are NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// DOB field-NAME candidates (leaf, case-insensitive). date_of_birth is the proven wire name; the others
// are scanned defensively so a renamed field is not missed. Names only ever influence which key is read.
const DOB_FIELD_CANDIDATES = ['date_of_birth', 'dateofbirth', 'dob', 'birthday', 'birth_date', 'birthdate'];

// member_since field-NAME candidates (leaf, case-insensitive). member_since is the proven wire name.
const MEMBER_SINCE_FIELD_CANDIDATES = ['member_since', 'membersince'];

// Membership/status/history field-NAME pattern (leaf, normalized). Reports which membership-ish fields
// the row carries — bearing on whether an Inactive client is a confirmable former member without the
// All-Memberships feed. Names only emitted (ID-like redacted), never values.
const MEMBERSHIP_NAME_PATTERN =
  /\bmember\b|\bmembership\b|\bstatus\b|\bactive\b|\binactive\b|\bdeactiv|\bcancel|\bexpir|\blapse|\bterminat|\benrol|\brenew|\bhold\b|\bpaused?\b|\bsuspend|\bsince\b|\bstart\b/i;

// ─── Safe output contract ────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';
type StatusBucket = 'active' | 'inactive' | 'unknown';
type DateCategory = 'keyAbsent' | 'nullOrEmpty' | 'nonDateShaped' | 'sentinel1900' | 'invalidCalendar' | 'future' | 'valid';
type Conclusion =
  | 'dob_present_active_and_inactive' // DOB carried usable values in BOTH active and inactive — Read 1 + Read 2 source viable (quality review next).
  | 'dob_present_active_only' // DOB usable for active but sparse/absent for inactive — Read 2 source NOT settled by /clients.
  | 'dob_absent_or_unusable' // no usable DOB anywhere — age must come from a demographics re-export (with Client ID) or Attendance pull.
  | 'scan_incomplete'; // transport/coverage failure (or 0-record / wrong-shape 2xx) — fill counts are NOT trustworthy.

// One status bucket's date-field population quality. Counts are EXCLUSIVE:
//   total = keyAbsent + nullOrEmpty + nonDateShaped + dateShaped
//   dateShaped = sentinel1900 + invalidCalendar + future + valid
//   valid = usable value (a real past-or-today calendar date, non-sentinel). fillRatePct = valid / total.
//   NOTE (DOB): age-outlier routing (§2: age 0 / >80 → Unknown) is a DOWNSTREAM build step, not here.
interface DateFieldStats {
  total: number;
  keyAbsent: number; // record lacked every candidate key for this field.
  nullOrEmpty: number; // key present but null / '' / whitespace-only.
  nonDateShaped: number; // present, non-null, but not a YYYY-MM-DD-prefixed string.
  sentinel1900: number; // exact 1900-01-01 — Wodify's null sentinel, never a real value.
  invalidCalendar: number; // date-shaped but fails strict round-trip (e.g. 2026-02-30).
  future: number; // valid calendar date strictly after the run day — impossible for DOB / a join date.
  valid: number; // usable value (past-or-today).
  fillRatePct: number; // 100 * valid / total, 1 decimal.
}

interface PerStatus<T> {
  active: T;
  inactive: T;
  unknown: T;
}

interface ClientsDobFillResult {
  probe: 'clientsDobFillProbe';
  path: string; // PATH only — never a query string / substituted URL.
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  jsonParseable: boolean | null;
  recordArrayKey: string | null;
  pagesFetched: number;
  reachedPageCap: boolean;
  coverageComplete: boolean; // true ⇒ the WHOLE client set was scanned cleanly AND >0 records of the right shape.
  totalRecordsScanned: number;
  statusBucketCounts: { active: number; inactive: number; unknown: number };
  dobFieldNamesObserved: string[]; // which DOB-candidate NAMES actually appeared on rows (sorted).
  memberSinceFieldNamesObserved: string[]; // which member_since-candidate NAMES actually appeared (sorted).
  dobByStatus: PerStatus<DateFieldStats>;
  memberSinceByStatus: PerStatus<DateFieldStats>;
  bothUsableByStatus: { active: number; inactive: number; unknown: number }; // records with BOTH a usable DOB AND usable member_since — the exact buildable-lapsed population (inactive is the operative one).
  membershipFieldNamesFound: string[]; // safe leaf NAMES matching the membership pattern (ID-like redacted, sorted).
  redactedFieldNameCount: number; // distinct ID-like field NAMES suppressed (counted, never emitted).
  conclusion: Conclusion;
}

// ─── Pure helpers (none emit, log, or retain values) — copied verbatim from the sibling probes ───────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Normalize a field segment for stem matching: split camelCase; `_` `.` and digits → spaces.
function normalizeForName(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[._\d]+/g, ' ');
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

// Strict calendar round-trip: parse the 10-char YMD, rebuild via Date.UTC, require IDENTICAL components.
// Returns the canonical YMD string for comparison ONLY (never emitted), or null if not a valid calendar date.
function strictYmd(ymd10: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd10);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Gym-local run day (YYYY-MM-DD). en-CA yields ISO order; TZ matches the shipped #445 decision.
// classification takes `todayYmd` as a PARAMETER so the selftest is deterministic.
function gymLocalTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GYM_TZ }).format(new Date());
}

// ─── Accumulator ────────────────────────────────────────────────────────────────────────────────
interface ScanCtx {
  todayYmd: string;
  dob: PerStatus<DateFieldStats>;
  memberSince: PerStatus<DateFieldStats>;
  bothUsable: { active: number; inactive: number; unknown: number };
  dobFieldNamesObserved: Set<string>;
  memberSinceFieldNamesObserved: Set<string>;
  membershipFieldNames: Set<string>;
  redactedFieldNames: Set<string>;
}

function freshBucket(): DateFieldStats {
  return {
    total: 0,
    keyAbsent: 0,
    nullOrEmpty: 0,
    nonDateShaped: 0,
    sentinel1900: 0,
    invalidCalendar: 0,
    future: 0,
    valid: 0,
    fillRatePct: 0,
  };
}

function freshPerStatus(): PerStatus<DateFieldStats> {
  return { active: freshBucket(), inactive: freshBucket(), unknown: freshBucket() };
}

function freshCtx(todayYmd: string): ScanCtx {
  return {
    todayYmd,
    dob: freshPerStatus(),
    memberSince: freshPerStatus(),
    bothUsable: { active: 0, inactive: 0, unknown: 0 },
    dobFieldNamesObserved: new Set(),
    memberSinceFieldNamesObserved: new Set(),
    membershipFieldNames: new Set(),
    redactedFieldNames: new Set(),
  };
}

// Pick the first present candidate value on a record, recording the matched NAME. Returns the raw value
// (read in memory only) plus the matched key name, or { present: false }.
function pickField(rec: Record<string, unknown>, candidates: string[]): { present: boolean; value?: unknown; name?: string } {
  const byLower = new Map<string, string>();
  for (const k of Object.keys(rec)) byLower.set(k.toLowerCase(), k);
  for (const cand of candidates) {
    const actual = byLower.get(cand);
    if (actual !== undefined) return { present: true, value: rec[actual], name: actual };
  }
  return { present: false };
}

// Classify one picked value into a date category. Reads the value in memory; returns a category only.
function classifyDateValue(picked: { present: boolean; value?: unknown }, todayYmd: string): DateCategory {
  if (!picked.present) return 'keyAbsent';
  const v = picked.value;
  if (v === null || v === undefined) return 'nullOrEmpty';
  if (typeof v !== 'string') return 'nonDateShaped'; // number/boolean/object/array — count-only
  const s = v.trim();
  if (s === '') return 'nullOrEmpty';
  const ymd10 = s.slice(0, 10); // tolerate a datetime suffix (YYYY-MM-DDThh:mm:ss)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd10)) return 'nonDateShaped';
  if (ymd10 === SENTINEL_NULL_DATE) return 'sentinel1900';
  const canonical = strictYmd(ymd10);
  if (canonical === null) return 'invalidCalendar';
  if (canonical > todayYmd) return 'future'; // lexical compare valid for zero-padded ISO dates
  return 'valid';
}

function applyCategory(bucket: DateFieldStats, cat: DateCategory): void {
  bucket.total += 1;
  switch (cat) {
    case 'keyAbsent': bucket.keyAbsent += 1; break;
    case 'nullOrEmpty': bucket.nullOrEmpty += 1; break;
    case 'nonDateShaped': bucket.nonDateShaped += 1; break;
    case 'sentinel1900': bucket.sentinel1900 += 1; break;
    case 'invalidCalendar': bucket.invalidCalendar += 1; break;
    case 'future': bucket.future += 1; break;
    case 'valid': bucket.valid += 1; break;
  }
}

// Record the matched field NAME (ID-like redacted to a count) for verifiability.
function recordObservedName(picked: { present: boolean; name?: string }, observed: Set<string>, redacted: Set<string>): void {
  if (picked.present && picked.name) {
    if (isIdLikeKey(picked.name)) redacted.add(picked.name);
    else observed.add(picked.name);
  }
}

function tallyRecords(records: unknown[], ctx: ScanCtx): void {
  for (const rec of records) {
    if (!isPlainObject(rec)) continue;

    // Status bucket — byte-identical to the edge via the real normalizeStatus.
    const norm = normalizeStatus(rec['client_status']);
    const bucketName: StatusBucket = norm === 'active' ? 'active' : norm === 'inactive' ? 'inactive' : 'unknown';

    // DOB.
    const dobPicked = pickField(rec, DOB_FIELD_CANDIDATES);
    recordObservedName(dobPicked, ctx.dobFieldNamesObserved, ctx.redactedFieldNames);
    const dobCat = classifyDateValue(dobPicked, ctx.todayYmd);
    applyCategory(ctx.dob[bucketName], dobCat);

    // member_since.
    const msPicked = pickField(rec, MEMBER_SINCE_FIELD_CANDIDATES);
    recordObservedName(msPicked, ctx.memberSinceFieldNamesObserved, ctx.redactedFieldNames);
    const msCat = classifyDateValue(msPicked, ctx.todayYmd);
    applyCategory(ctx.memberSince[bucketName], msCat);

    // Both-usable (the exact buildable-lapsed population).
    if (dobCat === 'valid' && msCat === 'valid') ctx.bothUsable[bucketName] += 1;

    // Membership-field NAME scan (names only, leaf-normalized match; ID-like redacted).
    for (const k of Object.keys(rec)) {
      const leaf = k.split('.').pop() ?? k;
      if (MEMBERSHIP_NAME_PATTERN.test(normalizeForName(leaf))) {
        if (isIdLikeKey(k)) ctx.redactedFieldNames.add(k);
        else ctx.membershipFieldNames.add(k);
      }
    }
  }
}

function finishBucket(b: DateFieldStats): DateFieldStats {
  b.fillRatePct = b.total > 0 ? Math.round((1000 * b.valid) / b.total) / 10 : 0;
  return b;
}

function finishPerStatus(p: PerStatus<DateFieldStats>): PerStatus<DateFieldStats> {
  finishBucket(p.active);
  finishBucket(p.inactive);
  finishBucket(p.unknown);
  return p;
}

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

function buildResult(ctx: ScanCtx, meta: TransportMeta): ClientsDobFillResult {
  const dob = finishPerStatus(ctx.dob);
  const memberSince = finishPerStatus(ctx.memberSince);
  const totalRecordsScanned = dob.active.total + dob.inactive.total + dob.unknown.total;

  // coverageComplete REQUIRES > 0 records of the right shape — a 2xx whose body isn't {clients:[…]}
  // (records 0, recordArrayKey null) must read scan_incomplete, never a false "complete" (gate SHOULD-FIX).
  const coverageComplete =
    meta.endpointReached &&
    meta.httpStatusClass === '2xx' &&
    !meta.errorEnvelopeDetected &&
    meta.jsonParseable === true &&
    !meta.reachedPageCap &&
    meta.pagesFetched > 0 &&
    totalRecordsScanned > 0 &&
    meta.recordArrayKey === 'clients';

  let conclusion: Conclusion;
  if (!coverageComplete) {
    conclusion = 'scan_incomplete';
  } else if (dob.active.valid > 0 && dob.inactive.valid > 0) {
    conclusion = 'dob_present_active_and_inactive';
  } else if (dob.active.valid > 0) {
    conclusion = 'dob_present_active_only';
  } else {
    conclusion = 'dob_absent_or_unusable';
  }

  return {
    probe: 'clientsDobFillProbe',
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
    totalRecordsScanned,
    statusBucketCounts: { active: dob.active.total, inactive: dob.inactive.total, unknown: dob.unknown.total },
    dobFieldNamesObserved: [...ctx.dobFieldNamesObserved].sort(),
    memberSinceFieldNamesObserved: [...ctx.memberSinceFieldNamesObserved].sort(),
    dobByStatus: dob,
    memberSinceByStatus: memberSince,
    bothUsableByStatus: { ...ctx.bothUsable },
    membershipFieldNamesFound: [...ctx.membershipFieldNames].sort(),
    redactedFieldNameCount: ctx.redactedFieldNames.size,
    conclusion,
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

// Field-agnostic ISO-date leak scan — used by BOTH the selftest and the live guard.
function containsIsoDate(serialized: string): boolean {
  return /\d{4}-\d{2}-\d{2}/.test(serialized);
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO key/env) ─────
function runSelfTest(): void {
  const TODAY = '2026-06-15'; // injected — deterministic, independent of the machine clock/timezone.

  // PII / secrets planted on the rows. NONE may appear in output — including EXACT DATES (the planted
  // DOB and member_since values are the leak-test payload: counts may emit, the strings never may).
  const PII = [
    'SECRET_FIRST',
    'SECRET_LAST',
    'secret@member.example',
    '70001', // a fake member-ID VALUE
    '1985-03-04', // active DOB VALUE
    '1990-07-08', // inactive DOB VALUE
    '2010-02-30', // invalid-calendar DOB VALUE
    '2030-01-01', // future DOB VALUE
    '2019-01-01', // active member_since VALUE
    '2015-06-01', // inactive member_since VALUE
    '2031-01-01', // future member_since VALUE
    '2012-03-03', // unknown-bucket member_since VALUE
  ];

  // Synthetic /clients page. Counts chosen so every branch + every status bucket is exercised for BOTH
  // date fields. ACTIVE: 6;  INACTIVE: 4;  unknown: 2.
  const records: unknown[] = [
    // ACTIVE
    { id: 70001, first_name: 'SECRET_FIRST', last_name: 'SECRET_LAST', email: 'secret@member.example', client_status: 'Active', date_of_birth: '1985-03-04', member_since: '2019-01-01' }, // dob valid, ms valid → both
    { client_status: 'Active', date_of_birth: '1992-12-31T00:00:00Z', client_status_id: 1 }, // dob valid (datetime suffix), ms absent
    { client_status: 'Active', date_of_birth: '1900-01-01', member_since: '1900-01-01' }, // dob sentinel, ms sentinel
    { client_status: 'Active', date_of_birth: '2010-02-30', member_since: '2020-05-05' }, // dob invalid, ms valid
    { client_status: 'Active', date_of_birth: '', member_since: '' }, // dob null/empty, ms null/empty
    { client_status: 'Active' }, // dob absent, ms absent
    // INACTIVE
    { client_status: 'Inactive', date_of_birth: '1990-07-08', member_since: '2015-06-01' }, // dob valid, ms valid → both
    { client_status: 'Inactive', date_of_birth: '1978-05-05' }, // dob valid, ms absent
    { client_status: 'Inactive', date_of_birth: null, member_since: null }, // dob null, ms null
    { client_status: 'Inactive', date_of_birth: '2030-01-01', member_since: '2031-01-01' }, // dob future, ms future
    // UNKNOWN status (retired vocab / blank)
    { client_status: 'Paused', date_of_birth: '1980-08-08', member_since: '2012-03-03' }, // dob valid, ms valid → both
    { client_status: '', date_of_birth: 12345, member_since: 67890 }, // dob non-date-shaped, ms non-date-shaped
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

  // (1) LEAK SCAN: no planted PII token — and NO exact date AT ALL — may appear in output.
  const leaks = PII.filter((tok) => serialized.includes(tok));
  if (containsIsoDate(serialized)) leaks.push('(a YYYY-MM-DD date string leaked)');
  if (leaks.length > 0) {
    console.error(`SELFTEST FAIL: output contained disallowed token(s): ${leaks.join(', ')}`);
    process.exit(1);
    return;
  }

  // (2) BEHAVIORAL CHECKS: conservation + expected per-status tallies for BOTH date fields.
  const conserve = (b: DateFieldStats): boolean =>
    b.total === b.keyAbsent + b.nullOrEmpty + b.nonDateShaped + b.sentinel1900 + b.invalidCalendar + b.future + b.valid;
  const d = result.dobByStatus;
  const m = result.memberSinceByStatus;
  const checks: Array<[string, boolean]> = [
    // status bucket sizes
    ['active total = 6', d.active.total === 6],
    ['inactive total = 4', d.inactive.total === 4],
    ['unknown total = 2', d.unknown.total === 2],
    // DOB tallies
    ['dob active valid = 2', d.active.valid === 2],
    ['dob active sentinel = 1', d.active.sentinel1900 === 1],
    ['dob active invalidCalendar = 1', d.active.invalidCalendar === 1],
    ['dob active nullOrEmpty = 1', d.active.nullOrEmpty === 1],
    ['dob active keyAbsent = 1', d.active.keyAbsent === 1],
    ['dob inactive valid = 2', d.inactive.valid === 2],
    ['dob inactive future = 1', d.inactive.future === 1],
    ['dob inactive nullOrEmpty = 1', d.inactive.nullOrEmpty === 1],
    ['dob unknown valid = 1', d.unknown.valid === 1],
    ['dob unknown nonDateShaped = 1', d.unknown.nonDateShaped === 1],
    ['dob active fillRate = 33.3', d.active.fillRatePct === 33.3],
    // member_since tallies
    ['ms active valid = 2', m.active.valid === 2],
    ['ms active sentinel = 1', m.active.sentinel1900 === 1],
    ['ms active nullOrEmpty = 1', m.active.nullOrEmpty === 1],
    ['ms active keyAbsent = 2', m.active.keyAbsent === 2],
    ['ms inactive valid = 1', m.inactive.valid === 1],
    ['ms inactive keyAbsent = 1', m.inactive.keyAbsent === 1],
    ['ms inactive nullOrEmpty = 1', m.inactive.nullOrEmpty === 1],
    ['ms inactive future = 1', m.inactive.future === 1],
    ['ms unknown valid = 1', m.unknown.valid === 1],
    ['ms unknown nonDateShaped = 1', m.unknown.nonDateShaped === 1],
    ['ms inactive fillRate = 25', m.inactive.fillRatePct === 25],
    // both-usable (buildable-lapsed) — one per bucket by construction of the fixture
    ['bothUsable active = 1', result.bothUsableByStatus.active === 1],
    ['bothUsable inactive = 1', result.bothUsableByStatus.inactive === 1],
    ['bothUsable unknown = 1', result.bothUsableByStatus.unknown === 1],
    // conservation (all 6 buckets)
    ['dob active conservation', conserve(d.active)],
    ['dob inactive conservation', conserve(d.inactive)],
    ['dob unknown conservation', conserve(d.unknown)],
    ['ms active conservation', conserve(m.active)],
    ['ms inactive conservation', conserve(m.inactive)],
    ['ms unknown conservation', conserve(m.unknown)],
    // names + conclusion
    ['dob field name observed = date_of_birth', result.dobFieldNamesObserved.join(',') === 'date_of_birth'],
    ['ms field name observed = member_since', result.memberSinceFieldNamesObserved.join(',') === 'member_since'],
    ['membership fields incl client_status + member_since', result.membershipFieldNamesFound.includes('client_status') && result.membershipFieldNamesFound.includes('member_since')],
    ['conclusion = active_and_inactive', result.conclusion === 'dob_present_active_and_inactive'],
    ['coverageComplete true', result.coverageComplete === true],
  ];

  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    console.error(`SELFTEST FAIL: behavioral check(s) failed: ${failed.join('; ')}`);
    process.exit(1);
    return;
  }

  // (3) COVERAGE-GUARD CHECK: a 2xx with the WRONG body shape (no clients array, 0 records) must read
  // scan_incomplete, never a false "complete" (the gate SHOULD-FIX).
  const emptyCtx = freshCtx(TODAY);
  const emptyResult = buildResult(emptyCtx, {
    ...freshMeta(),
    endpointReached: true,
    httpStatusClass: '2xx',
    jsonParseable: true,
    recordArrayKey: null, // wrong shape — never saw a clients array
    pagesFetched: 1,
  });
  if (emptyResult.coverageComplete !== false || emptyResult.conclusion !== 'scan_incomplete') {
    console.error('SELFTEST FAIL: 0-record / wrong-shape 2xx was not classified scan_incomplete.');
    process.exit(1);
    return;
  }

  console.log('SELFTEST PASS: no planted PII/date leaked; conservation + per-status tallies (DOB + member_since) + both-usable + coverage-guard correct; no network call made.');
}

async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error('WODIFY_API_KEY is unset — exiting WITHOUT any request (no key, no call).');
    process.exit(1);
    return;
  }
  const { ctx, meta } = await scanAllClients(apiKey, gymLocalTodayYmd());
  const result = buildResult(ctx, meta);
  const serialized = JSON.stringify(result, null, 2);

  // LIVE LEAK GUARD (defense-in-depth behind the selftest): if any ISO date slipped into the output,
  // abort WITHOUT printing it — never let a date string reach stdout on the live path.
  if (containsIsoDate(serialized)) {
    console.error('LIVE LEAK GUARD TRIPPED: an ISO date appeared in serialized output — aborting WITHOUT printing.');
    process.exit(1);
    return;
  }
  console.log(serialized);
}

void main();
