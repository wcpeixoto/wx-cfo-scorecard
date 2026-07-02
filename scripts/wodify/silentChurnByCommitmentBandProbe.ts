/**
 * Silent Churn × COMMITMENT-BAND join — PHASE-0, COUNTS-ONLY feasibility probe.
 *   LOCAL ONLY — NEVER imported by the SPA, never bundled, never run in CI.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS A PROBE, NOT A FEATURE. It touches NO SPA code, NO Supabase / data layer, NO card, NO  │
 * │ schema, NO import path the browser uses. It only reads Wodify (live path) or synthetic in-     │
 * │ memory fixtures (selftest) and prints ONE counts-only JSON summary + a verdict enum.           │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Question (Phase 0): Can a future "Silent Churn by commitment band" card be built from the two
 * Wodify pulls we already have — `/clients` (attendance recency → the locked Silent Churn classifier)
 * and `/memberships` (commitment length via `payment_plan`)? Concretely:
 *   - Do active clients JOIN to a membership row well enough to assign a commitment band?
 *   - Are the per-band denominators clean enough to show RATES, or only raw counts?
 *   - Does the band a member lands in depend on the assignment rule (active-membership-only vs a
 *     most-recent-membership fallback)? If it swings, the card would be unstable.
 * The script REPORTS counts; a HUMAN + the Reviewer make the real call.
 *
 * Reuses the LOCKED classifier read-only (src/lib/gym/silentChurn.ts): `classifyMember` +
 * `resolveSilentChurnThresholdDays`. It does NOT modify silentChurn.ts and does NOT reimplement any
 * Silent Churn date / status / threshold logic — the single source of truth decides who is silent.
 *
 * CALIBRATED to the live `/memberships` shape (#518 field-shape discovery, 2018 rows). The first live
 * run (#517) read VOID — an instrument artifact, not a data gap. Fixes here:
 *   1. UNIT VOCAB: `payment_plan.initial_commitment_time_unit` values are literally "Month(s)" / "Year(s)"
 *      / "Week(s)" (parenthetical plural). The old `unitToMonths` (`/^mo(nth)?s?$/`) could not match them,
 *      so every len>=1 row fell to `unclassified`. `unitToMonths` now strips non-letters before matching.
 *   2. PACKS: non-commitment is detected from the STRUCTURED `membership_type` field (Class Pack /
 *      Appointment Pack) first; the plan-name regex is a fallback only.
 *   3. HOLDS: `/memberships` exposes NO hold field (#518: holdFields == []). Hold detection is dropped;
 *      `holdSignalExposed` is honestly false. (Holds live on the client side / are not on this endpoint.)
 *   4. DUAL ACTIVE SIGNAL (Reviewer-required discovery comparison): only 273/2018 rows are `is_active` —
 *      implausibly low. Active-membership coverage is reported under BOTH the `is_active` signal AND an
 *      expiration-derived "currently in force" signal (`does_membership_expire` / `expiration_date` not
 *      past vs the gym-local asOf), plus their intersection. `is_active` is NOT hardcoded as truth; when
 *      the two signals disagree on the coverage gate the verdict flags it rather than blocking.
 *
 * Denominator doctrine (matches the shipped app — no new base is invented here): ALL FOUR classifier
 * buckets are preserved per active client (healthy / watch / silent / unknown). The attendance-known base
 * (healthy + watch + silent) is the PRIMARY rate denominator; `unknown` — active but no usable attendance
 * signal (parent/guardian, never-attended) — is held OUT of every primary rate denominator and out of the
 * coverage-skew comparison, exactly like the shipped Attendance Health card and the excludeUnknownRecency
 * default-ON toggle. Full-active-base rates are emitted as clearly-separated ADVISORY numbers only, and
 * adopting them for any surface needs explicit Reviewer acceptance.
 *
 * Safety contract (mirrors the tightest sibling probes — clientsMembershipStateDiscovery.ts):
 *   - LOCAL / server-side ONLY. Never a `VITE_*` value; never imported by the SPA.
 *   - Live path reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, logged,
 *     printed, or echoed in errors. If unset / blank, exits WITHOUT any request.
 *   - PII (names, emails, ids, exact dates) is read in memory ONLY to derive aggregates, then discarded.
 *   - Emits COUNTS ONLY — counts, shares (rounded), booleans, fixed band/reason LABELS, and a verdict
 *     enum. NEVER names, client ids, membership ids, emails, exact dates, raw rows, URLs, headers, keys,
 *     or response bodies. No intermediate raw files written.
 *   - LEAK GUARD (live AND selftest): the serialized result is re-scanned before printing and the run
 *     ABORTS WITHOUT printing if it contains an '@', any ISO date, or any 7+ digit run (client ids are
 *     7-8 digits, membership ids 8; no emitted aggregate reaches 7 integer digits). Defense-in-depth
 *     behind the selftest's planted-sentinel assertions.
 *   - `--selftest` runs FIRST, makes NO network call and reads NO env key (synthetic in-memory fixtures).
 *   - Live pulls GET `/clients` + GET `/memberships` (x-api-key header), paginated with a page cap.
 *     No Supabase calls, no CSV input, no per-client/per-id calls, no writes.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it):
 *   Network-free safe-output self-test FIRST (makes NO request, needs NO key):
 *     npx tsx scripts/wodify/silentChurnByCommitmentBandProbe.ts --selftest
 *   Live run (GATED — needs a separate explicit go; NOT this session):
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/silentChurnByCommitmentBandProbe.ts
 *   See scripts/wodify/README.md.
 */

import {
  classifyMember,
  resolveSilentChurnThresholdDays,
  DEFAULT_SILENT_CHURN_THRESHOLD_DAYS,
  type AttendanceBucket,
} from '../../src/lib/gym/silentChurn.ts';
import type { GymMember, GymMemberStatus } from '../../src/lib/gym/memberFixture.ts';

// ─── CONFIG — request shape mirrors the edge fetchers / sibling probes ──────────────────────────────
const BASE_URL = 'https://api.wodify.com/v1';
const CLIENTS_PATH = '/clients';
const MEMBERSHIPS_PATH = '/memberships';
const PAGE_SIZE = 100; // Wodify caps at 100/page.
const MAX_PAGES = 50; // ~5000 records — far above the ~957-client set; reachedPageCap flags a partial scan.
const REQUEST_TIMEOUT_MS = 15000;

// Resilient record-array-key + join-key + field-name candidates (exact-case, first match wins). `/clients`
// is confirmed (#428 → clients / client_status / last_attendance); `/memberships` is not yet profiled, so
// its record key uses a candidate list.
const CLIENTS_RECORD_ARRAY_KEYS = ['clients', 'data', 'results', 'result', 'items', 'records', 'value', 'rows'];
const MEMBERSHIPS_RECORD_ARRAY_KEYS = ['memberships', 'data', 'results', 'result', 'items', 'records', 'value', 'rows'];
const CLIENT_ID_FIELDS = ['id', 'client_id', 'clientId', 'ClientId', 'Id']; // the join TARGET on /clients.
const MEMBERSHIP_CLIENT_ID_FIELDS = ['client_id', 'clientId', 'ClientId', 'client']; // the join KEY on /memberships.
const STATUS_FIELDS = ['client_status', 'clientStatus', 'ClientStatus', 'status'];
const LAST_ATTENDANCE_FIELDS = ['last_attendance', 'lastAttendance', 'LastAttendance', 'last_class_sign_in', 'lastClassSignIn'];
const SENTINEL_DATE = '1900-01-01'; // Wodify surfaces null dates as this — treat as MISSING, never a real value.

// payment_plan is a nested object on a membership row (task: commitment fields live on /memberships.payment_plan).
const PAYMENT_PLAN_FIELDS = ['payment_plan', 'paymentPlan', 'PaymentPlan', 'plan'];
const INITIAL_LEN_FIELDS = ['initial_commitment_length', 'initialCommitmentLength'];
const INITIAL_UNIT_FIELDS = ['initial_commitment_time_unit', 'initialCommitmentTimeUnit'];
const RENEWAL_LEN_FIELDS = ['renewal_commitment_length', 'renewalCommitmentLength'];
const RENEWAL_UNIT_FIELDS = ['renewal_commitment_time_unit', 'renewalCommitmentTimeUnit'];
const PLAN_NAME_FIELDS = ['payment_plan_name', 'paymentPlanName', 'name'];
const AUTO_RENEW_FIELDS = ['is_auto_renew', 'isAutoRenew', 'auto_renew', 'autoRenew'];

// Membership-level context (read in memory ONLY; never emitted). Confirmed against the live shape (#518).
const MEMBERSHIP_NAME_FIELDS = ['name', 'membership', 'membership_name', 'membershipName'];
const MEMBERSHIP_TYPE_FIELDS = ['membership_type', 'membershipType', 'MembershipType', 'type'];
const IS_ACTIVE_FIELDS = ['is_active', 'isActive', 'IsActive', 'active'];
const IS_DELETED_FIELDS = ['is_deleted', 'isDeleted', 'IsDeleted', 'deleted'];
const DOES_EXPIRE_FIELDS = ['does_membership_expire', 'doesMembershipExpire']; // #518: boolean, false×1932 / true×86.
const EXPIRATION_DATE_FIELDS = ['expiration_date', 'expirationDate', 'ExpirationDate', 'original_expiration_date'];
const START_DATE_FIELDS = ['start_date', 'startDate', 'StartDate'];
const END_DATE_FIELDS = ['end_date', 'endDate', 'EndDate', 'expiration_date', 'expirationDate', 'ExpirationDate'];

// Pack / non-commitment detection. PRIMARY: the structured `membership_type` field (#518 vocab: Class Plan
// ×1809 / Class Pack ×113 / Appointment Pack ×96 — the two "Pack" types carry no commitment). FALLBACK: a
// plan/membership-name regex, for robustness if membership_type is ever absent.
const NON_COMMITMENT_TYPE = /\bpack\b|\bpass(es)?\b|punch|class ?card|drop.?in|day ?pass/i;
const NON_COMMITMENT_NAME = /pack|pass|punch|class ?card|drop.?in|day ?pass|camp|clinic|private ?lesson|semiprivate|seminar|open ?mat|trial|intro|guest/i;

// Wodify error-envelope markers (matched case-insensitively; values NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// Count-based readiness thresholds (documented; the human/Reviewer make the real call).
const MIN_ACTIVE_MEMBERSHIP_COVERAGE = 0.8; // active clients that reach an ACTIVE membership row.
const MAX_CONFLICTING_BAND_SHARE = 0.1; // clients whose rows disagree on a commitment band.
const MAX_UNCLASSIFIED_SHARE = 0.15; // clients landing in the 'unclassified' band.
const MAX_BAND_DELTA_SHARE = 0.1; // clients whose band changes active-only ↔ most-recent fallback.
const MAX_COVERAGE_SKEW = 0.2; // |silent coverage − attendance-known non-silent coverage|.
// Per-band rate gate: a band's silent RATE (never its counts — counts always emit) is published only when
// its attendance-known denominator reaches this floor. A Phase-0 readiness gate on rate stability, NOT a
// display-suppression rule (AGENTS.md's no-<5-cell-suppression governs displayed counts, which all emit).
const MIN_BAND_KNOWN_DENOMINATOR = 5;
// A band where unknown-attendance clients are the MAJORITY cannot carry an honest known-base rate — it
// would describe a minority of the band. Counts still emit; the rate is withheld with a count-based reason.
const MAX_BAND_UNKNOWN_SHARE = 0.5;

// The deterministic ordering rule for the most-recent fallback — stated in output metadata (no dates emitted).
const MOST_RECENT_RULE =
  'most_recent_by_start_date_desc; ties broken by end_or_expiration_date_desc then original_row_order; ' +
  'a row is date-eligible only with a parseable, non-1900-sentinel start OR end/expiration date; ' +
  'a client with no date-eligible row is unassignable under the fallback';

// Travels in every result: states the denominator doctrine so the counts cannot be misread. Matches the
// shipped app (Attendance Health / the excludeUnknownRecency default-ON toggle, #507): rates are expressed
// over the attendance-known base by default; unknown is an unresolved data state, not a business category.
const RATE_BASIS_NOTE =
  'Primary rates use the attendance-known base (healthy + watch + silent). Active clients with no usable ' +
  'attendance signal (unknown — e.g. parent/guardian or never-attended accounts) are excluded from every ' +
  'primary rate denominator and from the coverage-skew comparison, matching the shipped Attendance Health ' +
  'known-base doctrine. silentRateFullBaseAdvisory fields are advisory only and require explicit Reviewer ' +
  'acceptance before any surface uses full-base rates.';

// States the dual active-signal comparison so the coverage numbers cannot be misread. #518: only 273/2018
// membership rows are is_active — implausibly low — so active-membership coverage is reported under is_active
// AND an expiration-derived in-force signal AND their intersection. is_active is NOT assumed correct: when the
// two signals disagree on the coverage gate the verdict flags 'active_membership_signal_ambiguous' instead of
// blocking. Band assignment still uses is_active (the clean single-current-membership signal); the in-force
// band tally (bandsActiveOnlyInForce) is provided for comparison only.
const ACTIVE_SIGNAL_NOTE =
  'Active-membership coverage is a DISCOVERY COMPARISON across two signals: is_active (Wodify flag) and ' +
  'in-force (does_membership_expire is false, OR expiration_date is today-or-later vs the gym-local asOf), ' +
  'plus their intersection. is_active is NOT hardcoded as truth. Band assignment uses is_active; ' +
  'bandsActiveOnlyInForce shows the same bands under the in-force lens for comparison.';

// ─── Safe output contract ───────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';

type CommitmentBand =
  | 'month_to_month'
  | 'three_month'
  | 'six_month'
  | 'twelve_month_annual'
  | 'twenty_four_month'
  | 'non_commitment' // packs / passes / camps / private lessons / other non-commitment plans.
  | 'unclassified'; // a plan we could not map to any band above.

// A per-client resolved band under one assignment rule. 'conflicting' = the rule's eligible rows disagree;
// 'unassignable' = the rule found no eligible row for this client.
type ResolvedBand = CommitmentBand | 'conflicting' | 'unassignable';

const COMMITMENT_BANDS: CommitmentBand[] = [
  'month_to_month', 'three_month', 'six_month', 'twelve_month_annual', 'twenty_four_month', 'non_commitment', 'unclassified',
];

type Verdict =
  | 'rate_ready' // join coverage clean, collisions low, assignment stable, unclassified low, coverage even.
  | 'counts_only_possible' // usable for counts, but a denominator caveat blocks honest rates.
  | 'blocked_low_membership_coverage'
  | 'blocked_unresolved_collisions'
  | 'blocked_unstable_assignment';

// Reason tags (count-based) explaining a not-rate-ready verdict. No prose numbers — the counts are in the body.
type ReadinessReason =
  | 'low_active_membership_coverage'
  | 'conflicting_band_collisions'
  | 'high_unclassified_share'
  | 'unstable_active_only_vs_fallback'
  | 'silent_vs_known_nonsilent_coverage_skew' // skew compares silent vs attendance-KNOWN non-silent only.
  | 'no_band_meets_rate_denominator_minimum' // structure clean, but no band clears the per-band rate gate.
  | 'active_membership_signal_ambiguous'; // is_active and in-force disagree on the coverage gate — pick a signal.

// Per-band rate-gating reasons (count-based; the band's counts always emit regardless).
type BandRateReason =
  | 'not_an_assignable_commitment_band' // the conflicting / unassignable pseudo-bands never carry a rate.
  | 'zero_known_denominator'
  | 'known_denominator_below_minimum'
  | 'unknown_share_high_in_band';

// Counts for one resolved band under one assignment rule. Invariant: attendanceKnown + unknownAttendance
// === totalActive (the selftest asserts it for every band under both rules).
interface BandCounts {
  totalActive: number;
  attendanceKnown: number; // healthy + watch + silent — the app's known-base doctrine.
  unknownAttendance: number; // held OUT of the primary rate denominator.
  silentCount: number;
}

// BandCounts + gated rates. silentRateKnownBase is the PRIMARY rate (attendance-known denominator), emitted
// only when the band's denominator is clean; silentRateFullBaseAdvisory (all active clients in the band) is
// ADVISORY ONLY, clearly separated, and needs explicit Reviewer acceptance before any surface uses it.
interface BandDetail extends BandCounts {
  rateReady: boolean;
  rateNotReadyReasons: BandRateReason[];
  silentRateKnownBase: number | null;
  silentRateFullBaseAdvisory: number | null;
}

interface ProbeResult {
  probe: 'silentChurnByCommitmentBandProbe';
  clientsPath: string; // PATH only — never a query string / substituted URL.
  membershipsPath: string;
  thresholdDays: number; // the resolved Silent Churn threshold the classifier was run at.
  asOfIsBounded: boolean; // asOf came from the gym-local clock (live) or the injected selftest date — never emitted.

  // Transport / coverage — coverageComplete is true ONLY for a whole clean scan of BOTH endpoints.
  clientsHttpStatusClass: HttpStatusClass;
  membershipsHttpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  clientsPagesFetched: number;
  membershipsPagesFetched: number;
  reachedPageCap: boolean;
  clientRecordsScanned: number;
  membershipRecordsScanned: number;
  coverageComplete: boolean;

  // Classifier split (active clients only; ALL FOUR locked-classifier buckets preserved). `unknown` =
  // active with no usable attendance signal (parent/guardian, never-attended) — NEVER folded into
  // non-silent, never in a primary rate denominator.
  activeClientsTotal: number;
  healthyTotal: number;
  watchTotal: number;
  silentMembersTotal: number;
  unknownAttendanceTotal: number;
  attendanceKnownTotal: number; // healthy + watch + silent — the primary rate base (Attendance Health doctrine).
  attendanceKnownNonSilentTotal: number; // healthy + watch.
  rateBasisNote: string; // states the denominator doctrine in-band so the numbers cannot be misread.

  // (1)+(2) Active-client → membership coverage. Active-membership coverage is reported under BOTH signals
  // (is_active AND expiration-derived in-force) plus their intersection — a discovery comparison, since only
  // 273/2018 rows are is_active (#518). `is_active` is NOT hardcoded as truth; see activeSignalNote + verdict.
  activeClientsWithAnyMembershipRow: number;
  anyMembershipCoverageShare: number;
  activeSignalNote: string;
  activeClientsWithActiveMembershipRow: number; // signal 1: is_active.
  activeMembershipCoverageShareIsActive: number;
  activeClientsWithInForceMembershipRow: number; // signal 2: expiration-based in force.
  activeMembershipCoverageShareInForce: number;
  activeClientsWithBothSignalsMembershipRow: number; // intersection.
  activeMembershipCoverageShareBothSignals: number;

  // (3) Silent Churn coverage, three-way. The skew compares silent vs attendance-KNOWN non-silent only;
  // unknown-attendance coverage is its own separate pair and never contaminates the comparison.
  silentMembersWithNoActiveMembershipRow: number;
  silentMembersWithActiveMembershipRow: number;
  silentCoverageShare: number;
  knownNonSilentWithActiveMembershipRow: number; // healthy + watch clients with an active membership row.
  knownNonSilentCoverageShare: number;
  coverageSkew: number; // |silentCoverageShare − knownNonSilentCoverageShare|; unknown EXCLUDED from both sides.
  unknownWithActiveMembershipRow: number; // unknown-attendance membership coverage — reported separately.
  unknownCoverageShare: number;

  // (4) Collisions.
  clientsWithMultipleActiveMemberships: number;
  clientsWithNoActiveButHistoricalMemberships: number;
  clientsWithConflictingBands: number;
  conflictingBandShare: number;

  // (5) Assignment-rule delta (active-only vs most-recent fallback).
  mostRecentRule: string; // the deterministic ordering rule — stated, never the dates themselves.
  membersChangingBand: number;
  silentMembersChangingBand: number;
  bandDeltaShare: number;

  // (6) Per-band detail under BOTH rules. totalActive conserves to activeClientsTotal across each map;
  // per band, attendanceKnown + unknownAttendance === totalActive. Primary rates are known-base + gated;
  // full-base rates are advisory-only fields.
  bandsActiveOnly: Record<ResolvedBand, BandDetail>; // active-only rule under is_active (drives rate readiness).
  bandsActiveOnlyInForce: Record<ResolvedBand, BandDetail>; // active-only rule under the in-force signal (comparison).
  bandsMostRecent: Record<ResolvedBand, BandDetail>;
  rateReadyBandCountActiveOnly: number; // real bands whose known-base rate cleared the per-band gate.
  unclassifiedShare: number; // most-recent rule.

  // (7) Holds — #518 discovery: /memberships exposes NO hold field, so this is honestly false. Holds are not
  // on this endpoint (they live on the client side / are not surfaced here); a hold is a STATE, not a band.
  holdSignalExposed: boolean;

  // (8) Rate readiness.
  perBandDenominatorsClean: boolean;
  readinessReasons: ReadinessReason[];

  verdict: Verdict;
}

// ─── Pure helpers (none emit, log, or retain values) ────────────────────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function firstField(obj: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) if (n in obj) return obj[n];
  return undefined;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function asBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /^(true|yes|1|active)$/i.test(v.trim());
  if (typeof v === 'number') return v === 1;
  return false;
}

// Strict calendar round-trip → canonical YMD or null. Sentinel 1900-01-01 is treated as MISSING.
function strictYmd(raw: unknown): string | null {
  const s = asString(raw).trim().slice(0, 10); // tolerate a datetime suffix.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  if (s === SENTINEL_DATE) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Field-agnostic leak scan — ISO date, '@', or a 7+ digit run (member/membership id) must never reach stdout.
function leaks(serialized: string): boolean {
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) return true;
  if (serialized.includes('@')) return true;
  if (/\d{7,}/.test(serialized)) return true;
  return false;
}

function round3(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}
function share(numer: number, denom: number): number {
  return denom > 0 ? round3(numer / denom) : 0;
}

// ─── Commitment-band classification (pure; exercised by the selftest) ───────────────────────────────
// Wodify's live unit vocabulary is "Month(s)" / "Year(s)" / "Week(s)" (parenthetical plural) plus ""/absent
// (#518). Normalize by stripping every non-letter FIRST — "month(s)" → "months" — then match a prefix, so the
// parenthetical form can never silently fall through to unclassified again (the #517 VOID bug).
function unitToMonths(length: number, unit: string): number | null {
  const u = unit.trim().toLowerCase().replace(/[^a-z]/g, ''); // "Month(s)" → "months"; "" stays "".
  if (u.startsWith('month') || u === 'mo' || u === 'mos') return length;
  if (u.startsWith('year') || u === 'yr' || u === 'yrs') return length * 12;
  if (u.startsWith('week') || u.startsWith('day')) return null; // sub-month units are not a commitment band.
  return null; // empty / unknown unit → unresolvable → unclassified (honest; no invented band).
}

function bandFromMonths(months: number): CommitmentBand {
  if (months <= 1) return 'month_to_month';
  if (months === 3) return 'three_month';
  if (months === 6) return 'six_month';
  if (months === 12) return 'twelve_month_annual';
  if (months === 24) return 'twenty_four_month';
  return 'unclassified';
}

interface MembershipRow {
  isActiveFlag: boolean; // signal 1: is_active && !is_deleted (Wodify's active flag).
  inForce: boolean; // signal 2: !is_deleted && (never-expires OR expiration not yet past vs asOf).
  band: CommitmentBand;
  sortDate: string | null; // canonical YMD used for the most-recent ordering (start, else end/expiration).
  index: number; // stable tie-break (original row order).
}

// Derive a commitment band from a membership row. Non-commitment wins first: the STRUCTURED membership_type
// (Class Pack / Appointment Pack, #518) is authoritative; the plan/membership-name regex is a fallback. Then
// the initial commitment length+unit, then renewal.
function bandOf(pp: Record<string, unknown> | null, membershipType: string, membershipName: string, planName: string): CommitmentBand {
  if (NON_COMMITMENT_TYPE.test(membershipType)) return 'non_commitment'; // structured signal — authoritative.
  if (NON_COMMITMENT_NAME.test(`${membershipName} ${planName}`)) return 'non_commitment'; // name fallback.

  const tryLenUnit = (lenNames: string[], unitNames: string[]): CommitmentBand | null => {
    if (!pp) return null;
    const lenRaw = firstField(pp, lenNames);
    const unitRaw = firstField(pp, unitNames);
    if (lenRaw == null) return null;
    const len = typeof lenRaw === 'number' ? lenRaw : Number(asString(lenRaw));
    if (!Number.isFinite(len)) return null;
    if (len === 0) return 'month_to_month'; // a zero-length commitment IS month-to-month.
    const months = unitToMonths(len, asString(unitRaw));
    if (months === null) return null;
    return bandFromMonths(months);
  };

  return tryLenUnit(INITIAL_LEN_FIELDS, INITIAL_UNIT_FIELDS)
    ?? tryLenUnit(RENEWAL_LEN_FIELDS, RENEWAL_UNIT_FIELDS)
    ?? 'unclassified';
}

function extractMembership(rec: unknown, index: number, asOfYmd: string): { clientId: string; row: MembershipRow } | null {
  if (!isPlainObject(rec)) return null;
  const clientId = asString(firstField(rec, MEMBERSHIP_CLIENT_ID_FIELDS)).trim();
  if (clientId === '') return null; // an un-joinable row is not counted against any client.

  const ppRaw = firstField(rec, PAYMENT_PLAN_FIELDS);
  const pp = isPlainObject(ppRaw) ? ppRaw : null;
  const membershipName = asString(firstField(rec, MEMBERSHIP_NAME_FIELDS));
  const membershipType = asString(firstField(rec, MEMBERSHIP_TYPE_FIELDS));
  const planName = asString(pp ? firstField(pp, PLAN_NAME_FIELDS) : firstField(rec, PLAN_NAME_FIELDS));

  const isDeleted = asBool(firstField(rec, IS_DELETED_FIELDS));
  const isActiveFlag = asBool(firstField(rec, IS_ACTIVE_FIELDS)) && !isDeleted;

  const start = strictYmd(firstField(rec, START_DATE_FIELDS));
  const end = strictYmd(firstField(rec, END_DATE_FIELDS));

  // Signal 2 — "currently in force" from the expiration fields (#518). A non-expiring membership
  // (does_membership_expire !== true) has no end to be past → in force; an expiring one is in force only
  // while its expiration date is today-or-later (lexical compare of zero-padded ISO dates vs the gym-local
  // asOf YMD — no Date('YYYY-MM-DD') parse). Deleted rows are never in force.
  const doesExpire = asBool(firstField(rec, DOES_EXPIRE_FIELDS));
  const expirationYmd = strictYmd(firstField(rec, EXPIRATION_DATE_FIELDS));
  const inForce = !isDeleted && (!doesExpire || (expirationYmd !== null && expirationYmd >= asOfYmd));

  return {
    clientId,
    row: {
      isActiveFlag,
      inForce,
      band: bandOf(pp, membershipType, membershipName, planName),
      sortDate: start ?? end,
      index,
    },
  };
}

// Map a live /clients record onto the LOCKED classifier's GymMember shape (in memory only). Only `status`
// and `lastCheckIn` matter to classifyMember; the rest are inert filler it never reads.
function toGymMember(rec: Record<string, unknown>): GymMember {
  const rawStatus = asString(firstField(rec, STATUS_FIELDS)).trim();
  const status: GymMemberStatus = /^active$/i.test(rawStatus) ? 'active' : 'ended';
  const lastYmd = strictYmd(firstField(rec, LAST_ATTENDANCE_FIELDS)); // sentinel/invalid → null → classifier 'unknown'.
  return {
    id: '', // never read by the classifier; not emitted.
    displayName: '',
    status,
    monthlyDues: 0,
    membershipStart: '',
    lastCheckIn: lastYmd ?? '', // '' → parseYmdLocal null → bucket 'unknown' (NOT silent).
  };
}

// ─── Core analysis (pure; both the live path and the selftest call this) ────────────────────────────
interface AnalysisCounts {
  activeClientsTotal: number;
  healthyTotal: number;
  watchTotal: number;
  silentMembersTotal: number;
  unknownAttendanceTotal: number;
  activeClientsWithAnyMembershipRow: number;
  activeClientsWithActiveMembershipRow: number; // signal 1: is_active.
  activeClientsWithInForceMembershipRow: number; // signal 2: expiration-based "in force".
  activeClientsWithBothSignalsMembershipRow: number; // intersection: is_active AND in force.
  silentMembersWithNoActiveMembershipRow: number;
  silentMembersWithActiveMembershipRow: number;
  knownNonSilentWithActiveMembershipRow: number;
  unknownWithActiveMembershipRow: number;
  clientsWithMultipleActiveMemberships: number;
  clientsWithNoActiveButHistoricalMemberships: number;
  clientsWithConflictingBands: number;
  membersChangingBand: number;
  silentMembersChangingBand: number;
  bandStatsActiveOnly: Record<ResolvedBand, BandCounts>; // active-only rule under the is_active signal.
  bandStatsActiveOnlyInForce: Record<ResolvedBand, BandCounts>; // active-only rule under the in-force signal.
  bandStatsMostRecent: Record<ResolvedBand, BandCounts>;
  clientRecordsScanned: number;
  membershipRecordsScanned: number;
}

const ALL_RESOLVED_BANDS: ResolvedBand[] = [...COMMITMENT_BANDS, 'conflicting', 'unassignable'];

function freshBandCounts(): Record<ResolvedBand, BandCounts> {
  const m = {} as Record<ResolvedBand, BandCounts>;
  for (const band of ALL_RESOLVED_BANDS) {
    m[band] = { totalActive: 0, attendanceKnown: 0, unknownAttendance: 0, silentCount: 0 };
  }
  return m;
}

// Resolve a client's band from a set of eligible membership rows: one band → that band; ≥2 distinct → conflicting;
// none → unassignable.
function resolveBand(rows: MembershipRow[]): ResolvedBand {
  if (rows.length === 0) return 'unassignable';
  const distinct = new Set(rows.map((r) => r.band));
  if (distinct.size === 1) return [...distinct][0];
  return 'conflicting';
}

function analyze(
  clientRecords: readonly unknown[],
  membershipRecords: readonly unknown[],
  asOf: Date,
  thresholdRaw: unknown,
): AnalysisCounts {
  const threshold = resolveSilentChurnThresholdDays(thresholdRaw);
  // Gym-local asOf as a canonical YMD for the in-force expiration compare (lexical, no Date parse).
  const asOfYmd = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;

  // Active clients only (the classifier excludes non-active clients). Map clientId → the FULL locked-
  // classifier bucket (healthy | watch | silent | unknown). `unknown` is preserved as its own category —
  // never folded into non-silent, never in the attendance-known base.
  const activeClients = new Map<string, { bucket: AttendanceBucket }>();
  let clientRecordsScanned = 0;
  for (const rec of clientRecords) {
    clientRecordsScanned += 1;
    if (!isPlainObject(rec)) continue;
    const clientId = asString(firstField(rec, CLIENT_ID_FIELDS)).trim();
    if (clientId === '') continue;
    const classification = classifyMember(toGymMember(rec), threshold, asOf);
    if (!classification) continue; // non-active → not a Silent Churn candidate at all.
    activeClients.set(clientId, { bucket: classification.bucket });
  }

  // Memberships grouped by client id (all statuses; band assignment is scoped to active clients below).
  const byClient = new Map<string, MembershipRow[]>();
  let membershipRecordsScanned = 0;
  for (let i = 0; i < membershipRecords.length; i++) {
    membershipRecordsScanned += 1;
    const extracted = extractMembership(membershipRecords[i], i, asOfYmd);
    if (!extracted) continue;
    const list = byClient.get(extracted.clientId) ?? [];
    list.push(extracted.row);
    byClient.set(extracted.clientId, list);
  }

  const counts: AnalysisCounts = {
    activeClientsTotal: 0,
    healthyTotal: 0,
    watchTotal: 0,
    silentMembersTotal: 0,
    unknownAttendanceTotal: 0,
    activeClientsWithAnyMembershipRow: 0,
    activeClientsWithActiveMembershipRow: 0,
    activeClientsWithInForceMembershipRow: 0,
    activeClientsWithBothSignalsMembershipRow: 0,
    silentMembersWithNoActiveMembershipRow: 0,
    silentMembersWithActiveMembershipRow: 0,
    knownNonSilentWithActiveMembershipRow: 0,
    unknownWithActiveMembershipRow: 0,
    clientsWithMultipleActiveMemberships: 0,
    clientsWithNoActiveButHistoricalMemberships: 0,
    clientsWithConflictingBands: 0,
    membersChangingBand: 0,
    silentMembersChangingBand: 0,
    bandStatsActiveOnly: freshBandCounts(),
    bandStatsActiveOnlyInForce: freshBandCounts(),
    bandStatsMostRecent: freshBandCounts(),
    clientRecordsScanned,
    membershipRecordsScanned,
  };

  for (const [clientId, { bucket }] of activeClients) {
    counts.activeClientsTotal += 1;
    const silent = bucket === 'silent';
    const attendanceKnown = bucket !== 'unknown'; // healthy + watch + silent — the known-base doctrine.
    if (bucket === 'healthy') counts.healthyTotal += 1;
    else if (bucket === 'watch') counts.watchTotal += 1;
    else if (bucket === 'silent') counts.silentMembersTotal += 1;
    else counts.unknownAttendanceTotal += 1;

    const rows = byClient.get(clientId) ?? [];
    // Two active-row lenses (Reviewer discovery comparison — is_active is NOT hardcoded as truth).
    const activeRowsIsActive = rows.filter((r) => r.isActiveFlag);
    const inForceRows = rows.filter((r) => r.inForce);
    const hasAny = rows.length > 0;
    const hasActive = activeRowsIsActive.length > 0; // signal 1 — drives band assignment + silent coverage.
    const hasInForce = inForceRows.length > 0; // signal 2 — reported alongside for the coverage comparison.

    if (hasAny) counts.activeClientsWithAnyMembershipRow += 1;
    if (hasActive) counts.activeClientsWithActiveMembershipRow += 1;
    if (hasInForce) counts.activeClientsWithInForceMembershipRow += 1;
    if (rows.some((r) => r.isActiveFlag && r.inForce)) counts.activeClientsWithBothSignalsMembershipRow += 1;

    // (3) Coverage, three-way: silent / attendance-known non-silent / unknown. unknown is tallied on its
    // own and NEVER folded into the non-silent side of the skew comparison. (Uses the is_active signal, in
    // step with the band assignment; the dual-signal comparison sits on the active-membership coverage above.)
    if (silent) {
      if (hasActive) counts.silentMembersWithActiveMembershipRow += 1;
      else counts.silentMembersWithNoActiveMembershipRow += 1;
    } else if (bucket === 'unknown') {
      if (hasActive) counts.unknownWithActiveMembershipRow += 1;
    } else if (hasActive) {
      counts.knownNonSilentWithActiveMembershipRow += 1;
    }

    // (5)+(6) Assignment rules. Active-only uses the is_active rows (the clean "current membership" signal);
    // the fallback uses the most-recent date-eligible row. The in-force band tally is a coverage-comparison view.
    const activeOnlyBand = resolveBand(activeRowsIsActive);
    const inForceBand = resolveBand(inForceRows);
    const eligible = rows.filter((r) => r.sortDate !== null);
    let fallbackBand: ResolvedBand;
    if (eligible.length === 0) {
      fallbackBand = 'unassignable';
    } else {
      eligible.sort((a, b) => {
        if (a.sortDate! !== b.sortDate!) return a.sortDate! < b.sortDate! ? 1 : -1; // start/end desc.
        return a.index < b.index ? 1 : -1; // stable: later original row wins the tie.
      });
      fallbackBand = eligible[0].band;
    }

    // (4) Collisions. A "conflicting band" is scoped to the CURRENTLY-ACTIVE (is_active) rows (the live-
    // blocking case that forces an arbitrary pick now); a purely HISTORICAL band change surfaces as a delta.
    if (activeRowsIsActive.length > 1) counts.clientsWithMultipleActiveMemberships += 1;
    if (!hasActive && hasAny) counts.clientsWithNoActiveButHistoricalMemberships += 1;
    if (activeOnlyBand === 'conflicting') counts.clientsWithConflictingBands += 1;

    const bump = (stats: Record<ResolvedBand, BandCounts>, band: ResolvedBand): void => {
      const s = stats[band];
      s.totalActive += 1;
      if (attendanceKnown) s.attendanceKnown += 1;
      else s.unknownAttendance += 1;
      if (silent) s.silentCount += 1;
    };
    bump(counts.bandStatsActiveOnly, activeOnlyBand);
    bump(counts.bandStatsActiveOnlyInForce, inForceBand);
    bump(counts.bandStatsMostRecent, fallbackBand);
    // Band DELTA = both rules can place the member but disagree (incl. active-only 'conflicting' the fallback
    // resolves to one band). A member unassignable under a rule is a COVERAGE gap, reported above — not a swing.
    const bothPlaced = activeOnlyBand !== 'unassignable' && fallbackBand !== 'unassignable';
    if (bothPlaced && activeOnlyBand !== fallbackBand) {
      counts.membersChangingBand += 1;
      if (silent) counts.silentMembersChangingBand += 1;
    }
  }

  return counts;
}

// ─── Verdict + result assembly (pure) ───────────────────────────────────────────────────────────────
interface TransportMeta {
  clientsHttpStatusClass: HttpStatusClass;
  membershipsHttpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  clientsJsonParseable: boolean | null;
  membershipsJsonParseable: boolean | null;
  clientsRecordKeySeen: boolean;
  membershipsRecordKeySeen: boolean;
  clientsPagesFetched: number;
  membershipsPagesFetched: number;
  reachedPageCap: boolean;
}
function freshMeta(): TransportMeta {
  return {
    clientsHttpStatusClass: '2xx',
    membershipsHttpStatusClass: '2xx',
    errorEnvelopeDetected: false,
    clientsJsonParseable: null,
    membershipsJsonParseable: null,
    clientsRecordKeySeen: false,
    membershipsRecordKeySeen: false,
    clientsPagesFetched: 0,
    membershipsPagesFetched: 0,
    reachedPageCap: false,
  };
}

function buildResult(counts: AnalysisCounts, meta: TransportMeta, threshold: number, asOfIsBounded: boolean): ProbeResult {
  const activeMembershipCoverageShareIsActive = share(counts.activeClientsWithActiveMembershipRow, counts.activeClientsTotal);
  const activeMembershipCoverageShareInForce = share(counts.activeClientsWithInForceMembershipRow, counts.activeClientsTotal);
  const activeMembershipCoverageShareBothSignals = share(counts.activeClientsWithBothSignalsMembershipRow, counts.activeClientsTotal);
  const anyMembershipCoverageShare = share(counts.activeClientsWithAnyMembershipRow, counts.activeClientsTotal);
  const attendanceKnownTotal = counts.healthyTotal + counts.watchTotal + counts.silentMembersTotal;
  const attendanceKnownNonSilentTotal = counts.healthyTotal + counts.watchTotal;
  const silentCoverageShare = share(counts.silentMembersWithActiveMembershipRow, counts.silentMembersTotal);
  const knownNonSilentCoverageShare = share(counts.knownNonSilentWithActiveMembershipRow, attendanceKnownNonSilentTotal);
  const unknownCoverageShare = share(counts.unknownWithActiveMembershipRow, counts.unknownAttendanceTotal);
  // Skew compares silent vs attendance-KNOWN non-silent ONLY (unknown coverage is its own number above),
  // and only when BOTH populations exist; an empty side would read as a false 0.0-vs-1.0 gap.
  const skewComparable = counts.silentMembersTotal > 0 && attendanceKnownNonSilentTotal > 0;
  const coverageSkew = skewComparable ? round3(Math.abs(silentCoverageShare - knownNonSilentCoverageShare)) : 0;

  const joinable = counts.activeClientsWithAnyMembershipRow; // the population any band rule can assign.
  const conflictingBandShare = share(counts.clientsWithConflictingBands, joinable);
  const bandDeltaShare = share(counts.membersChangingBand, joinable);
  const unclassifiedShare = share(counts.bandStatsMostRecent.unclassified.totalActive, joinable);

  // Per-band detail: the PRIMARY rate is over the attendance-known base and gated per band; the full-base
  // rate is a clearly-separated advisory field (never the headline number).
  const toDetail = (c: BandCounts, band: ResolvedBand): BandDetail => {
    const isRealBand = (COMMITMENT_BANDS as ResolvedBand[]).includes(band);
    const reasons: BandRateReason[] = [];
    if (!isRealBand) {
      reasons.push('not_an_assignable_commitment_band');
    } else {
      if (c.attendanceKnown === 0) reasons.push('zero_known_denominator');
      else if (c.attendanceKnown < MIN_BAND_KNOWN_DENOMINATOR) reasons.push('known_denominator_below_minimum');
      if (c.totalActive > 0 && c.unknownAttendance / c.totalActive > MAX_BAND_UNKNOWN_SHARE) reasons.push('unknown_share_high_in_band');
    }
    const rateReady = reasons.length === 0;
    return {
      ...c,
      rateReady,
      rateNotReadyReasons: reasons,
      silentRateKnownBase: rateReady ? share(c.silentCount, c.attendanceKnown) : null,
      silentRateFullBaseAdvisory: isRealBand && c.totalActive > 0 ? share(c.silentCount, c.totalActive) : null,
    };
  };
  const buildBands = (stats: Record<ResolvedBand, BandCounts>): Record<ResolvedBand, BandDetail> => {
    const out = {} as Record<ResolvedBand, BandDetail>;
    for (const band of ALL_RESOLVED_BANDS) out[band] = toDetail(stats[band], band);
    return out;
  };
  const bandsActiveOnly = buildBands(counts.bandStatsActiveOnly);
  const bandsActiveOnlyInForce = buildBands(counts.bandStatsActiveOnlyInForce);
  const bandsMostRecent = buildBands(counts.bandStatsMostRecent);
  // Readiness rollup uses the ACTIVE-ONLY rule (assignment rule 1 — the primary candidate for a card).
  const rateReadyBandCountActiveOnly = ALL_RESOLVED_BANDS.filter((b) => bandsActiveOnly[b].rateReady).length;

  // Dual-signal coverage gate (Reviewer discovery comparison). Block ONLY when BOTH signals fall short; when
  // they disagree (is_active low but in-force fine, or vice versa), flag it — don't block on the unvalidated
  // is_active signal, and don't silently pass on the possibly-over-inclusive in-force one.
  const isActiveCovBelow = activeMembershipCoverageShareIsActive < MIN_ACTIVE_MEMBERSHIP_COVERAGE;
  const inForceCovBelow = activeMembershipCoverageShareInForce < MIN_ACTIVE_MEMBERSHIP_COVERAGE;
  const bothCoverageSignalsBelow = isActiveCovBelow && inForceCovBelow;
  const coverageSignalsDisagree = isActiveCovBelow !== inForceCovBelow;

  const readinessReasons: ReadinessReason[] = [];
  if (bothCoverageSignalsBelow) readinessReasons.push('low_active_membership_coverage');
  else if (coverageSignalsDisagree) readinessReasons.push('active_membership_signal_ambiguous');
  if (conflictingBandShare > MAX_CONFLICTING_BAND_SHARE) readinessReasons.push('conflicting_band_collisions');
  if (unclassifiedShare > MAX_UNCLASSIFIED_SHARE) readinessReasons.push('high_unclassified_share');
  if (bandDeltaShare > MAX_BAND_DELTA_SHARE) readinessReasons.push('unstable_active_only_vs_fallback');
  if (skewComparable && coverageSkew > MAX_COVERAGE_SKEW) readinessReasons.push('silent_vs_known_nonsilent_coverage_skew');
  // Structure clean but not a single band's known base clears the rate gate → counts-only, not rate-ready.
  if (readinessReasons.length === 0 && rateReadyBandCountActiveOnly === 0) readinessReasons.push('no_band_meets_rate_denominator_minimum');

  const coverageComplete =
    meta.clientsHttpStatusClass === '2xx' &&
    meta.membershipsHttpStatusClass === '2xx' &&
    !meta.errorEnvelopeDetected &&
    meta.clientsJsonParseable !== false &&
    meta.membershipsJsonParseable !== false &&
    !meta.reachedPageCap &&
    meta.clientsPagesFetched > 0 &&
    meta.membershipsPagesFetched > 0 &&
    meta.clientsRecordKeySeen &&
    meta.membershipsRecordKeySeen &&
    counts.clientRecordsScanned > 0 &&
    counts.membershipRecordsScanned > 0;

  // Verdict precedence: coverage → collisions → assignment stability → clean. A blocked scan cannot be
  // rate_ready. Coverage blocks ONLY when BOTH active signals fall short (never on is_active alone); a
  // signal disagreement flags 'active_membership_signal_ambiguous' above and lands as counts_only_possible.
  let verdict: Verdict;
  if (!coverageComplete || bothCoverageSignalsBelow) {
    verdict = 'blocked_low_membership_coverage';
  } else if (conflictingBandShare > MAX_CONFLICTING_BAND_SHARE) {
    verdict = 'blocked_unresolved_collisions';
  } else if (bandDeltaShare > MAX_BAND_DELTA_SHARE) {
    verdict = 'blocked_unstable_assignment';
  } else if (readinessReasons.length === 0) {
    verdict = 'rate_ready';
  } else {
    verdict = 'counts_only_possible';
  }
  const perBandDenominatorsClean = verdict === 'rate_ready';

  return {
    probe: 'silentChurnByCommitmentBandProbe',
    clientsPath: CLIENTS_PATH,
    membershipsPath: MEMBERSHIPS_PATH,
    thresholdDays: threshold,
    asOfIsBounded,
    clientsHttpStatusClass: meta.clientsHttpStatusClass,
    membershipsHttpStatusClass: meta.membershipsHttpStatusClass,
    errorEnvelopeDetected: meta.errorEnvelopeDetected,
    clientsPagesFetched: meta.clientsPagesFetched,
    membershipsPagesFetched: meta.membershipsPagesFetched,
    reachedPageCap: meta.reachedPageCap,
    clientRecordsScanned: counts.clientRecordsScanned,
    membershipRecordsScanned: counts.membershipRecordsScanned,
    coverageComplete,
    activeClientsTotal: counts.activeClientsTotal,
    healthyTotal: counts.healthyTotal,
    watchTotal: counts.watchTotal,
    silentMembersTotal: counts.silentMembersTotal,
    unknownAttendanceTotal: counts.unknownAttendanceTotal,
    attendanceKnownTotal,
    attendanceKnownNonSilentTotal,
    rateBasisNote: RATE_BASIS_NOTE,
    activeClientsWithAnyMembershipRow: counts.activeClientsWithAnyMembershipRow,
    anyMembershipCoverageShare,
    activeSignalNote: ACTIVE_SIGNAL_NOTE,
    activeClientsWithActiveMembershipRow: counts.activeClientsWithActiveMembershipRow,
    activeMembershipCoverageShareIsActive,
    activeClientsWithInForceMembershipRow: counts.activeClientsWithInForceMembershipRow,
    activeMembershipCoverageShareInForce,
    activeClientsWithBothSignalsMembershipRow: counts.activeClientsWithBothSignalsMembershipRow,
    activeMembershipCoverageShareBothSignals,
    silentMembersWithNoActiveMembershipRow: counts.silentMembersWithNoActiveMembershipRow,
    silentMembersWithActiveMembershipRow: counts.silentMembersWithActiveMembershipRow,
    silentCoverageShare,
    knownNonSilentWithActiveMembershipRow: counts.knownNonSilentWithActiveMembershipRow,
    knownNonSilentCoverageShare,
    coverageSkew,
    unknownWithActiveMembershipRow: counts.unknownWithActiveMembershipRow,
    unknownCoverageShare,
    clientsWithMultipleActiveMemberships: counts.clientsWithMultipleActiveMemberships,
    clientsWithNoActiveButHistoricalMemberships: counts.clientsWithNoActiveButHistoricalMemberships,
    clientsWithConflictingBands: counts.clientsWithConflictingBands,
    conflictingBandShare,
    mostRecentRule: MOST_RECENT_RULE,
    membersChangingBand: counts.membersChangingBand,
    silentMembersChangingBand: counts.silentMembersChangingBand,
    bandDeltaShare,
    bandsActiveOnly,
    bandsActiveOnlyInForce,
    bandsMostRecent,
    rateReadyBandCountActiveOnly,
    unclassifiedShare,
    holdSignalExposed: false, // #518: /memberships exposes no hold field — honestly false, not a scan miss.
    perBandDenominatorsClean,
    readinessReasons,
    verdict,
  };
}

// ─── Live network layer (body read for aggregation only; never logged / returned as text) ───────────
interface ErrorEnvelopeInfo { detected: boolean; }
function detectErrorEnvelope(parsed: unknown): ErrorEnvelopeInfo {
  if (!isPlainObject(parsed)) return { detected: false };
  const lower = new Set(Object.keys(parsed).map((k) => k.toLowerCase()));
  const hits = ERROR_ENVELOPE_MARKER_KEYS.filter((m) => lower.has(m));
  return { detected: lower.has('httpcode') || hits.length >= 2 };
}

function extractRecordArray(parsed: unknown, keys: string[]): { records: unknown[]; keySeen: boolean } {
  if (!isPlainObject(parsed)) return { records: [], keySeen: false };
  for (const k of keys) {
    if (Array.isArray(parsed[k])) return { records: parsed[k] as unknown[], keySeen: true };
  }
  return { records: [], keySeen: false };
}

// Paginate one endpoint, collecting raw records in memory (transiently). Returns records + a per-endpoint meta slice.
async function fetchAll(
  apiKey: string,
  path: string,
  recordKeys: string[],
): Promise<{
  records: unknown[];
  httpStatusClass: HttpStatusClass;
  jsonParseable: boolean | null;
  recordKeySeen: boolean;
  pagesFetched: number;
  reachedPageCap: boolean;
  errorEnvelopeDetected: boolean;
}> {
  const records: unknown[] = [];
  let httpStatusClass: HttpStatusClass = '2xx';
  let jsonParseable: boolean | null = null;
  let recordKeySeen = false;
  let pagesFetched = 0;
  let reachedPageCap = false;
  let errorEnvelopeDetected = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(BASE_URL + path);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(PAGE_SIZE));

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'x-api-key': apiKey, accept: 'application/json' }, // key never logged.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      httpStatusClass = 'network_error'; // never log the error (it can echo the URL/host).
      return { records, httpStatusClass, jsonParseable, recordKeySeen, pagesFetched, reachedPageCap, errorEnvelopeDetected };
    }

    httpStatusClass = statusClassOf(res.status);
    if (!res.ok) return { records, httpStatusClass, jsonParseable, recordKeySeen, pagesFetched, reachedPageCap, errorEnvelopeDetected };

    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      jsonParseable = false;
      return { records, httpStatusClass, jsonParseable, recordKeySeen, pagesFetched, reachedPageCap, errorEnvelopeDetected };
    }
    jsonParseable = true;

    if (detectErrorEnvelope(parsed).detected) {
      errorEnvelopeDetected = true;
      return { records, httpStatusClass, jsonParseable, recordKeySeen, pagesFetched, reachedPageCap, errorEnvelopeDetected };
    }

    const { records: pageRecords, keySeen } = extractRecordArray(parsed, recordKeys);
    if (keySeen) recordKeySeen = true;
    for (const r of pageRecords) records.push(r);
    pagesFetched += 1;

    const pagination = isPlainObject(parsed) ? parsed['pagination'] : undefined;
    const hasMore = isPlainObject(pagination) && pagination['has_more'] === true;
    if (!hasMore || pageRecords.length === 0) break;
    if (page === MAX_PAGES) reachedPageCap = true;
  }

  return { records, httpStatusClass, jsonParseable, recordKeySeen, pagesFetched, reachedPageCap, errorEnvelopeDetected };
}

// Gym-local run day as a LOCAL-midnight Date (matches the shipped #445 TZ decision). No date string emitted.
function gymLocalAsOf(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d); // new Date(y, m, d) per AGENTS.md — never new Date('YYYY-MM-DD').
}

function emit(result: ProbeResult): void {
  const serialized = JSON.stringify(result, null, 2);
  if (leaks(serialized)) {
    console.error('LEAK GUARD TRIPPED: ISO date / "@" / 7+ digit run in output — aborting WITHOUT printing.');
    process.exit(1);
    return;
  }
  console.log(serialized);
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO env key) ──────
function runSelfTest(): void {
  const TODAY = new Date(2026, 5, 15); // injected — deterministic. June 15, 2026.
  const THRESHOLD = DEFAULT_SILENT_CHURN_THRESHOLD_DAYS; // 21.
  const fail = (msg: string): void => { console.error(`SELFTEST FAIL: ${msg}`); process.exit(1); };

  // Planted synthetic sentinels — NONE may appear anywhere in serialized output.
  const PLANTED = [
    'SECRET_FIRST', 'SECRET_LAST', 'secret@member.example', // names + email
    '9000001', '9000002', '9000003', '9000004', '9000005', '9000006', '9000007', '9000008', // client ids (7 digit)
    '9000009', '9000010', '9000011', '9000012', '9000013', '9000014', '9000099',
    '80000001', '80000002', '80000013', '80000017', // membership ids (8 digit)
    '2026-05-01', '2026-06-14', '2024-01-01', '2026-03-01', '2026-06-05', '2026-06-13', // exact dates
    '2025-01-01', // an expiration_date read for the in-force signal — must never surface
    '1900-01-01', // the Wodify null-date sentinel — read in memory, must never surface
    'sk_live_DEADBEEFCAFE1234', 'Bearer_TOKEN_XYZ', // secret-looking tokens
  ];

  // Build a /clients record with PII on it (only client_status + last_attendance are read by the mapping).
  const client = (id: string, status: string, lastAttendance: string): Record<string, unknown> => ({
    id,
    FirstName: 'SECRET_FIRST',
    LastName: 'SECRET_LAST',
    Email: 'secret@member.example',
    client_status: status,
    last_attendance: lastAttendance,
    api_token: 'sk_live_DEADBEEFCAFE1234',
  });

  // Build a /memberships record matching the live shape (#518): units default to the real "Month(s)" vocab,
  // membership_type drives pack detection, does_membership_expire + expiration_date drive the in-force signal.
  // No hold field exists on /memberships. PII on the row + a token, all of which must be suppressed.
  const membership = (
    membershipId: string,
    clientId: string,
    opts: {
      isActive: boolean;
      isDeleted?: boolean;
      initLen?: number;
      initUnit?: string;
      planName?: string;
      membershipName?: string;
      membershipType?: string;
      start?: string;
      end?: string;
      autoRenew?: boolean;
      doesExpire?: boolean; // default false → non-expiring → in force (for a non-deleted row).
      expiration?: string; // YMD; only consulted when doesExpire is true.
    },
  ): Record<string, unknown> => ({
    id: membershipId,
    client_id: clientId,
    FirstName: 'SECRET_FIRST',
    LastName: 'SECRET_LAST',
    Email: 'secret@member.example',
    auth_header: 'Bearer_TOKEN_XYZ',
    name: opts.membershipName ?? 'BJJ Unlimited',
    membership_type: opts.membershipType ?? 'Class Plan', // #518 vocab; "Class Pack"/"Appointment Pack" = non-commitment.
    is_active: opts.isActive,
    is_deleted: opts.isDeleted ?? false,
    has_been_renewed: false,
    does_membership_expire: opts.doesExpire ?? false,
    start_date: opts.start ?? '2024-01-01',
    end_date: opts.end ?? '',
    expiration_date: opts.expiration ?? opts.end ?? '',
    scheduled_deactivation_date: '',
    payment_plan: {
      payment_plan_name: opts.planName ?? 'Monthly Unlimited',
      initial_commitment_length: opts.initLen,
      initial_commitment_time_unit: opts.initUnit ?? 'Month(s)', // the real parenthetical-plural vocab.
      renewal_commitment_length: opts.initLen,
      renewal_commitment_time_unit: opts.initUnit ?? 'Month(s)',
      is_auto_renew: opts.autoRenew ?? true,
    },
  });

  // ── Clients: silent, non-silent, and a non-active (must be excluded by the classifier). ──
  // 9000001 SILENT (last check-in 45d ago ≥ 21) — 12-month active membership.
  // 9000002 NON-SILENT (1d ago) — month-to-month active membership.
  // 9000003 SILENT — NO active membership but a historical (ended) one exists.
  // 9000004 NON-SILENT — MULTIPLE active memberships (same band → not a conflict).
  // 9000005 NON-SILENT — CONFLICTING bands across active rows (3-month + 6-month).
  // 9000006 NON-SILENT — a PACK (non-commitment) active membership.
  // 9000007 NON-SILENT — active-only=3-month but most-recent(by start)=12-month INACTIVE → band CHANGE.
  // 9000008 NON-SILENT — active membership in a HOLD state, underlying 12-month band kept.
  // 9000009 WATCH (10d) — month-to-month; must sit in the KNOWN base (not healthy, not silent).
  // 9000010/9000011 HEALTHY — month-to-month (pad the m2m band to a rate-ready known denominator).
  // 9000012 SILENT (45d) — month-to-month (the band's silent numerator).
  // 9000013 UNKNOWN via the 1900-01-01 null-date sentinel — active m2m membership; in the band's
  //         unknownAttendance count, OUT of its known base, NOT non-silent.
  // 9000014 UNKNOWN via an EMPTY last_attendance — NO membership rows at all (unknown coverage 1 of 2;
  //         proves the skew comparison excludes unknown, since folding it in would shift the number).
  // 9000099 INACTIVE client — classifier drops it; its membership must not count anywhere.
  const clients: Record<string, unknown>[] = [
    client('9000001', 'Active', '2026-05-01'), // 45d → silent
    client('9000002', 'Active', '2026-06-14'), // 1d → healthy (non-silent)
    client('9000003', 'Active', '2026-05-01'), // silent
    client('9000004', 'Active', '2026-06-14'),
    client('9000005', 'Active', '2026-06-14'),
    client('9000006', 'Active', '2026-06-14'),
    client('9000007', 'Active', '2026-06-14'),
    client('9000008', 'Active', '2026-06-14'),
    client('9000009', 'Active', '2026-06-05'), // 10d → WATCH (>= floor 8, < threshold 21)
    client('9000010', 'Active', '2026-06-14'),
    client('9000011', 'Active', '2026-06-13'),
    client('9000012', 'Active', '2026-05-01'), // 45d → silent
    client('9000013', 'Active', '1900-01-01'), // sentinel null-date → UNKNOWN (never healthy, never silent)
    client('9000014', 'Active', ''), // missing date → UNKNOWN
    client('9000099', 'Inactive', '2026-05-01'), // non-active → excluded from every count
  ];

  // Units use the real "Month(s)" vocab (via the factory default) — so the whole main fixture is an
  // end-to-end proof of the unit fix: if "Month(s)" ever stopped parsing, these bands would collapse.
  const memberships: Record<string, unknown>[] = [
    membership('80000001', '9000001', { isActive: true, initLen: 12 }), // twelve_month_annual
    membership('80000002', '9000002', { isActive: true, initLen: 1 }), // month_to_month
    // historical only: is_active false AND expired (does_membership_expire + past expiration) → NOT in force either.
    membership('80000003', '9000003', { isActive: false, initLen: 12, start: '2024-01-01', end: '2025-01-01', doesExpire: true, expiration: '2025-01-01' }),
    // 9000004 — two ACTIVE 6-month memberships (same band → multiple-active, NOT a band conflict).
    membership('80000004', '9000004', { isActive: true, initLen: 6 }),
    membership('80000005', '9000004', { isActive: true, initLen: 6 }),
    // 9000005 — two ACTIVE memberships with DIFFERENT bands → conflicting bands.
    membership('80000006', '9000005', { isActive: true, initLen: 3 }),
    membership('80000007', '9000005', { isActive: true, initLen: 6 }),
    // 9000006 — a PACK via the STRUCTURED membership_type field → non_commitment despite a 12-month length.
    membership('80000008', '9000006', { isActive: true, membershipType: 'Class Pack', initLen: 12 }),
    // 9000007 — active 3-month (older start) + newer INACTIVE, EXPIRED 12-month → active-only=3-month, fallback=12-month.
    membership('80000009', '9000007', { isActive: true, initLen: 3, start: '2024-01-01' }),
    membership('80000010', '9000007', { isActive: false, initLen: 12, start: '2026-03-01', doesExpire: true, expiration: '2025-01-01' }),
    // 9000008 — plain active 12-month (no hold field exists on /memberships).
    membership('80000011', '9000008', { isActive: true, initLen: 12 }),
    // Membership for the INACTIVE client — must not be counted (client dropped by classifier).
    membership('80000012', '9000099', { isActive: true, initLen: 12 }),
    // The month-to-month cohort (watch + healthy×2 + silent + unknown-sentinel). 9000014 has NO rows.
    membership('80000013', '9000009', { isActive: true, initLen: 1 }),
    membership('80000014', '9000010', { isActive: true, initLen: 1 }),
    membership('80000015', '9000011', { isActive: true, initLen: 1 }),
    membership('80000016', '9000012', { isActive: true, initLen: 1 }),
    membership('80000017', '9000013', { isActive: true, initLen: 1 }),
  ];

  const counts = analyze(clients, memberships, TODAY, THRESHOLD);
  const meta: TransportMeta = {
    ...freshMeta(),
    clientsJsonParseable: true,
    membershipsJsonParseable: true,
    clientsRecordKeySeen: true,
    membershipsRecordKeySeen: true,
    clientsPagesFetched: 1,
    membershipsPagesFetched: 1,
  };
  const result = buildResult(counts, meta, resolveSilentChurnThresholdDays(THRESHOLD), true);
  const serialized = JSON.stringify(result, null, 2);

  const bA = result.bandsActiveOnly;
  const bM = result.bandsMostRecent;
  const sumTotal = (bands: Record<ResolvedBand, BandDetail>): number =>
    ALL_RESOLVED_BANDS.reduce((s, k) => s + bands[k].totalActive, 0);
  const bandsConserve = (bands: Record<ResolvedBand, BandDetail>): boolean =>
    ALL_RESOLVED_BANDS.every((k) => bands[k].attendanceKnown + bands[k].unknownAttendance === bands[k].totalActive);

  const checks: Array<[string, boolean]> = [
    // Classifier split — ALL FOUR buckets preserved; inactive client excluded; unknown NOT non-silent.
    ['activeClientsTotal == 14 (inactive client excluded)', result.activeClientsTotal === 14],
    ['bucket integrity: healthy+watch+silent+unknown == activeTotal', result.healthyTotal + result.watchTotal + result.silentMembersTotal + result.unknownAttendanceTotal === result.activeClientsTotal],
    ['healthyTotal == 8', result.healthyTotal === 8],
    ['watchTotal == 1 (10d absent)', result.watchTotal === 1],
    ['silentMembersTotal == 3', result.silentMembersTotal === 3],
    ['unknownAttendanceTotal == 2 (sentinel-1900 AND empty both land unknown, not silent)', result.unknownAttendanceTotal === 2],
    ['attendanceKnownTotal == 12 (healthy+watch+silent; unknown held OUT)', result.attendanceKnownTotal === 12],
    ['attendanceKnownNonSilentTotal == 9 (healthy+watch; unknown NOT counted non-silent)', result.attendanceKnownNonSilentTotal === 9],
    // Coverage — 9000003 (silent) historical-only; 9000014 (unknown) has no membership rows at all.
    ['activeClientsWithAnyMembershipRow == 13', result.activeClientsWithAnyMembershipRow === 13],
    ['activeClientsWithActiveMembershipRow == 12', result.activeClientsWithActiveMembershipRow === 12],
    ['silentMembersWithNoActiveMembershipRow == 1', result.silentMembersWithNoActiveMembershipRow === 1],
    ['silentMembersWithActiveMembershipRow == 2', result.silentMembersWithActiveMembershipRow === 2],
    ['knownNonSilentWithActiveMembershipRow == 9', result.knownNonSilentWithActiveMembershipRow === 9],
    ['unknown coverage reported separately: 1 of 2 → 0.5', result.unknownWithActiveMembershipRow === 1 && result.unknownCoverageShare === 0.5],
    // Skew excludes unknown from BOTH sides: |2/3 − 9/9| = 0.333 exactly (folding the uncovered unknown
    // into the non-silent side would move it — the exact-value pin proves the exclusion).
    ['coverageSkew == 0.333 (silent vs attendance-KNOWN non-silent only)', result.coverageSkew === 0.333],
    // Collisions.
    ['clientsWithMultipleActiveMemberships == 2 (9000004 + 9000005)', result.clientsWithMultipleActiveMemberships === 2],
    ['clientsWithNoActiveButHistoricalMemberships == 1 (9000003)', result.clientsWithNoActiveButHistoricalMemberships === 1],
    ['clientsWithConflictingBands == 1 (9000005)', result.clientsWithConflictingBands === 1],
    // Assignment delta — 9000007 (three→twelve) + 9000005 (conflicting→six); 9000003 is a COVERAGE gap, not a swing.
    ['membersChangingBand == 2 (9000005 + 9000007)', result.membersChangingBand === 2],
    ['silentMembersChangingBand == 0 (silent 9000001/9000003 do not swing)', result.silentMembersChangingBand === 0],
    // Per-band detail conserves under BOTH rules, at both levels (map total and known+unknown per band).
    ['activeOnly totals sum to 14', sumTotal(bA) === 14],
    ['mostRecent totals sum to 14', sumTotal(bM) === 14],
    ['per-band known+unknown == total, every band, both rules', bandsConserve(bA) && bandsConserve(bM)],
    // month_to_month — the rate-ready band. Denominator is the KNOWN base: watch INCLUDED (else 1/4=0.25),
    // unknown EXCLUDED (else 1/6=0.167). 1 silent over 5 known = 0.2 pins both directions at once.
    ['m2m activeOnly {total 6, known 5, unknown 1, silent 1}', bA.month_to_month.totalActive === 6 && bA.month_to_month.attendanceKnown === 5 && bA.month_to_month.unknownAttendance === 1 && bA.month_to_month.silentCount === 1],
    ['m2m mostRecent {6, 5, 1, 1} (same cohort under the fallback)', bM.month_to_month.totalActive === 6 && bM.month_to_month.attendanceKnown === 5 && bM.month_to_month.unknownAttendance === 1 && bM.month_to_month.silentCount === 1],
    ['m2m rateReady; known-base rate == 0.2 (1/5 — NOT 1/6 full-base, NOT 1/4 sans-watch)', bA.month_to_month.rateReady === true && bA.month_to_month.silentRateKnownBase === 0.2],
    ['m2m full-base rate is a SEPARATE advisory field == 0.167', bA.month_to_month.silentRateFullBaseAdvisory === 0.167],
    // Small bands: counts always emit; the RATE is gated with a count-based reason.
    ['three_month known 1 → rate null + below-minimum reason', bA.three_month.attendanceKnown === 1 && bA.three_month.rateReady === false && bA.three_month.silentRateKnownBase === null && bA.three_month.rateNotReadyReasons.includes('known_denominator_below_minimum')],
    ['twelve activeOnly {2, 2, 0, 1}; primary rate gated, advisory 0.5 still emitted', bA.twelve_month_annual.totalActive === 2 && bA.twelve_month_annual.attendanceKnown === 2 && bA.twelve_month_annual.silentCount === 1 && bA.twelve_month_annual.silentRateKnownBase === null && bA.twelve_month_annual.silentRateFullBaseAdvisory === 0.5],
    ['twelve mostRecent {4, 4, 0, 2} (9000003 + 9000007 fall back in)', bM.twelve_month_annual.totalActive === 4 && bM.twelve_month_annual.attendanceKnown === 4 && bM.twelve_month_annual.silentCount === 2],
    ['six mostRecent == 2 (9000004 + 9000005 tie→later row)', bM.six_month.totalActive === 2],
    ['activeOnly conflicting == 1 (9000005) / three == 1 / six == 1 / pack == 1', bA.conflicting.totalActive === 1 && bA.three_month.totalActive === 1 && bA.six_month.totalActive === 1 && bA.non_commitment.totalActive === 1],
    // Unknown-by-band emitted under BOTH rules; pseudo-bands never carry a rate.
    ['unassignable activeOnly {2, 1, 1, 1} (9000003 silent-historical + 9000014 unknown-no-rows)', bA.unassignable.totalActive === 2 && bA.unassignable.attendanceKnown === 1 && bA.unassignable.unknownAttendance === 1 && bA.unassignable.silentCount === 1],
    ['unassignable mostRecent {1, 0, 1, 0} (only 9000014 has no dated row anywhere)', bM.unassignable.totalActive === 1 && bM.unassignable.unknownAttendance === 1],
    ['pseudo-bands never rate: not_an_assignable_commitment_band + null rates', bA.unassignable.rateNotReadyReasons.includes('not_an_assignable_commitment_band') && bA.unassignable.silentRateKnownBase === null && bA.unassignable.silentRateFullBaseAdvisory === null && bA.conflicting.silentRateKnownBase === null],
    ['unknown-by-band under both rules (m2m 1 + unassignable 1 each)', bA.month_to_month.unknownAttendance === 1 && bM.month_to_month.unknownAttendance === 1 && bA.unassignable.unknownAttendance === 1 && bM.unassignable.unknownAttendance === 1],
    ['rateReadyBandCountActiveOnly == 1 (only m2m clears the gate)', result.rateReadyBandCountActiveOnly === 1],
    // Pack detection via the STRUCTURED membership_type field (9000006 carries no name hint now).
    ['non_commitment came from membership_type (Class Pack), not a name regex', bA.non_commitment.totalActive === 1],
    // Holds — #518: no hold field on /memberships → honestly false (not a scan miss).
    ['holdSignalExposed == false (no hold field on /memberships)', result.holdSignalExposed === false],
    // Dual active-signal coverage: in this fixture the two signals AGREE (the is_active:false rows are also
    // expired), so in-force == is_active == both == 12 and there is NO ambiguity reason.
    ['activeClientsWithInForceMembershipRow == 12', result.activeClientsWithInForceMembershipRow === 12],
    ['activeClientsWithBothSignalsMembershipRow == 12', result.activeClientsWithBothSignalsMembershipRow === 12],
    ['coverage shares equal under both signals (0.857)', result.activeMembershipCoverageShareIsActive === 0.857 && result.activeMembershipCoverageShareInForce === 0.857],
    ['bandsActiveOnlyInForce present + conserves', sumTotal(result.bandsActiveOnlyInForce) === 14 && bandsConserve(result.bandsActiveOnlyInForce)],
    ['no active_membership_signal_ambiguous when signals agree', !result.readinessReasons.includes('active_membership_signal_ambiguous')],
    // Verdict — pinned exactly (fixture: delta 2/13 > 0.1; skew 0.333 > 0.2; collisions 1/13 under 0.1).
    ['verdict == blocked_unstable_assignment', result.verdict === 'blocked_unstable_assignment'],
    ['readinessReasons exactly [instability, known-nonsilent skew]', JSON.stringify(result.readinessReasons) === JSON.stringify(['unstable_active_only_vs_fallback', 'silent_vs_known_nonsilent_coverage_skew'])],
    ['rateBasisNote states the attendance-known doctrine', typeof result.rateBasisNote === 'string' && result.rateBasisNote.includes('attendance-known')],
    ['mostRecentRule stated (no dates)', typeof result.mostRecentRule === 'string' && result.mostRecentRule.length > 0 && !/\d{4}-\d{2}-\d{2}/.test(result.mostRecentRule)],
    ['coverageComplete == true (clean synthetic scan)', result.coverageComplete === true],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length > 0) return fail(`behavioral check(s): ${failed.join(' | ')}`);

  // Band-classifier assertions (pins the pure mapping so a future edit can't silently drift). The unit vocab
  // is the REAL "Month(s)" / "Year(s)" / "Week(s)" form (#518) — the regression this PR fixes.
  const b = (
    initLen: number | undefined,
    unit: string,
    opts: { type?: string; planName?: string; mName?: string } = {},
  ): CommitmentBand =>
    bandOf(
      initLen === undefined ? null : { initial_commitment_length: initLen, initial_commitment_time_unit: unit },
      opts.type ?? 'Class Plan',
      opts.mName ?? 'BJJ',
      opts.planName ?? 'Monthly',
    );
  const bandChecks: Array<[string, boolean]> = [
    // The fix: parenthetical-plural units must resolve (they were the #517 VOID).
    ['1 "Month(s)" → month_to_month', b(1, 'Month(s)') === 'month_to_month'],
    ['3 "Month(s)" → three_month', b(3, 'Month(s)') === 'three_month'],
    ['6 "Month(s)" → six_month', b(6, 'Month(s)') === 'six_month'],
    ['12 "Month(s)" → twelve_month_annual', b(12, 'Month(s)') === 'twelve_month_annual'],
    ['24 "Month(s)" → twenty_four_month', b(24, 'Month(s)') === 'twenty_four_month'],
    ['1 "Year(s)" → twelve_month_annual', b(1, 'Year(s)') === 'twelve_month_annual'],
    ['2 "Year(s)" → twenty_four_month', b(2, 'Year(s)') === 'twenty_four_month'],
    ['8 "Week(s)" → unclassified (sub-month unit, not a band)', b(8, 'Week(s)') === 'unclassified'],
    ['empty unit + len 6 → unclassified (unresolvable, honest)', b(6, '') === 'unclassified'],
    ['0 + empty unit → month_to_month (zero-length short-circuit)', b(0, '') === 'month_to_month'],
    // Bare "Month"/"Year" (no parenthetical) still work — normalization is a superset.
    ['bare "Month" still → months', b(12, 'Month') === 'twelve_month_annual'],
    ['2 "Month(s)" → unclassified (no 2-month band)', b(2, 'Month(s)') === 'unclassified'],
    // Structured pack detection via membership_type (authoritative over any length).
    ['membership_type "Class Pack" → non_commitment (even with 12-mo length)', b(12, 'Month(s)', { type: 'Class Pack' }) === 'non_commitment'],
    ['membership_type "Appointment Pack" → non_commitment', b(undefined, 'Month(s)', { type: 'Appointment Pack' }) === 'non_commitment'],
    ['membership_type "Class Plan" + 12 "Month(s)" → twelve (NOT a pack)', b(12, 'Month(s)', { type: 'Class Plan' }) === 'twelve_month_annual'],
    // Name regex remains a fallback when membership_type is absent.
    ['name-regex fallback: "Drop-in Pack" with no type → non_commitment', b(12, 'Month(s)', { type: '', planName: 'Drop-in Pack', mName: '10 Class Pack' }) === 'non_commitment'],
    ['no plan data → unclassified', b(undefined, 'Month(s)') === 'unclassified'],
  ];
  const bandFailed = bandChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (bandFailed.length > 0) return fail(`band-classifier check(s): ${bandFailed.join(' | ')}`);

  // Direct unit-normalization pins (independent of bandOf), so the "(s)" stripping can't silently regress.
  const unitChecks: Array<[string, boolean]> = [
    ['unitToMonths(12,"Month(s)") == 12', unitToMonths(12, 'Month(s)') === 12],
    ['unitToMonths(1,"Year(s)") == 12', unitToMonths(1, 'Year(s)') === 12],
    ['unitToMonths(8,"Week(s)") == null', unitToMonths(8, 'Week(s)') === null],
    ['unitToMonths(6,"") == null', unitToMonths(6, '') === null],
  ];
  const unitFailed = unitChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (unitFailed.length > 0) return fail(`unit-normalization check(s): ${unitFailed.join(' | ')}`);

  // Verdict-branch coverage — each branch fires on a crafted fixture.
  // (a) rate_ready: one 12-month band with a known base of 6 (>= the gate), full coverage, no swing/skew.
  const rrIds = ['9000001', '9000002', '9000003', '9000004', '9000005', '9000006'];
  const rr = buildResult(
    analyze(
      rrIds.map((cid, i) => client(cid, 'Active', i === rrIds.length - 1 ? '2026-05-01' : '2026-06-14')), // last one silent
      rrIds.map((cid, i) => membership(`8000000${i + 1}`, cid, { isActive: true, initLen: 12, initUnit: 'Month' })),
      TODAY, THRESHOLD,
    ),
    meta, THRESHOLD, true,
  );
  // (b) counts_only: structurally clean, but the single band's known base (1) is below the rate gate.
  const baseClean = analyze(
    [client('9000001', 'Active', '2026-06-14')],
    [membership('80000001', '9000001', { isActive: true, initLen: 12, initUnit: 'Month' })],
    TODAY, THRESHOLD,
  );
  const countsOnly = buildResult(baseClean, meta, THRESHOLD, true);
  // (c) blocked coverage: the client's only row is BOTH not-is_active AND expired → low under BOTH signals.
  const lowCov = analyze(
    [client('9000001', 'Active', '2026-06-14')],
    [membership('80000001', '9000001', { isActive: false, initLen: 12, start: '2024-01-01', end: '2025-01-01', doesExpire: true, expiration: '2025-01-01' })],
    TODAY, THRESHOLD,
  );
  // (f) DUAL SIGNAL — the two active signals diverge per row (Reviewer-required):
  //   9000001: is_active FALSE but non-expiring → in force, NOT is_active.
  //   9000002: is_active TRUE but expired → is_active, NOT in force.
  const dual = buildResult(
    analyze(
      [client('9000001', 'Active', '2026-06-14'), client('9000002', 'Active', '2026-06-14')],
      [
        membership('80000001', '9000001', { isActive: false, initLen: 12, doesExpire: false }),
        membership('80000002', '9000002', { isActive: true, initLen: 12, doesExpire: true, expiration: '2025-01-01' }),
      ],
      TODAY, THRESHOLD,
    ),
    meta, THRESHOLD, true,
  );
  // (g) SIGNAL DISAGREEMENT at the gate — all rows in force, none is_active → is_active coverage 0 (<gate),
  // in-force coverage 1.0 (>=gate). Must flag 'active_membership_signal_ambiguous', NOT block on is_active.
  const disagreeIds = ['9000001', '9000002', '9000003', '9000004', '9000005'];
  const disagree = buildResult(
    analyze(
      disagreeIds.map((cid) => client(cid, 'Active', '2026-06-14')),
      disagreeIds.map((cid, i) => membership(`8000000${i + 1}`, cid, { isActive: false, initLen: 12, doesExpire: false })),
      TODAY, THRESHOLD,
    ),
    meta, THRESHOLD, true,
  );
  // (d) blocked collisions: half the joinable clients carry conflicting ACTIVE bands (checked before
  // instability, which this fixture also trips — precedence is part of the pin).
  const collis = buildResult(
    analyze(
      [client('9000001', 'Active', '2026-06-14'), client('9000002', 'Active', '2026-06-14')],
      [
        membership('80000001', '9000001', { isActive: true, initLen: 12, initUnit: 'Month' }),
        membership('80000002', '9000002', { isActive: true, initLen: 3, initUnit: 'Month' }),
        membership('80000003', '9000002', { isActive: true, initLen: 6, initUnit: 'Month' }),
      ],
      TODAY, THRESHOLD,
    ),
    meta, THRESHOLD, true,
  );
  // (e) unknown-majority band: 3 of 4 in the band are unknown-attendance → counts emit, rate withheld.
  const um = buildResult(
    analyze(
      [client('9000001', 'Active', '2026-06-14'), client('9000002', 'Active', ''), client('9000003', 'Active', ''), client('9000004', 'Active', '')],
      ['9000001', '9000002', '9000003', '9000004'].map((cid, i) => membership(`8000000${i + 1}`, cid, { isActive: true, initLen: 12, initUnit: 'Month' })),
      TODAY, THRESHOLD,
    ),
    meta, THRESHOLD, true,
  );
  const branchChecks: Array<[string, boolean]> = [
    ['rate_ready: 6-client single band clears every gate', rr.verdict === 'rate_ready' && rr.bandsActiveOnly.twelve_month_annual.rateReady === true && rr.bandsActiveOnly.twelve_month_annual.silentRateKnownBase === 0.167 && rr.perBandDenominatorsClean === true],
    ['counts_only: clean structure, no band clears the rate gate', countsOnly.verdict === 'counts_only_possible' && countsOnly.readinessReasons.includes('no_band_meets_rate_denominator_minimum')],
    ['no active membership → blocked_low_membership_coverage', buildResult(lowCov, meta, THRESHOLD, true).verdict === 'blocked_low_membership_coverage'],
    ['conflicting active bands → blocked_unresolved_collisions (precedence over instability)', collis.verdict === 'blocked_unresolved_collisions'],
    ['unknown-majority band: counts emit, rate withheld with reason', um.bandsActiveOnly.twelve_month_annual.totalActive === 4 && um.bandsActiveOnly.twelve_month_annual.unknownAttendance === 3 && um.bandsActiveOnly.twelve_month_annual.silentRateKnownBase === null && um.bandsActiveOnly.twelve_month_annual.rateNotReadyReasons.includes('unknown_share_high_in_band')],
    ['non-2xx clients → coverageComplete false', buildResult(baseClean, { ...meta, clientsHttpStatusClass: '5xx' }, THRESHOLD, true).coverageComplete === false],
    ['error envelope → coverageComplete false', buildResult(baseClean, { ...meta, errorEnvelopeDetected: true }, THRESHOLD, true).coverageComplete === false],
    ['reachedPageCap → coverageComplete false', buildResult(baseClean, { ...meta, reachedPageCap: true }, THRESHOLD, true).coverageComplete === false],
    ['memberships key unseen → coverageComplete false', buildResult(baseClean, { ...meta, membershipsRecordKeySeen: false }, THRESHOLD, true).coverageComplete === false],
    ['blocked scan cannot be rate_ready', buildResult(baseClean, { ...meta, membershipsHttpStatusClass: '4xx' }, THRESHOLD, true).verdict !== 'rate_ready'],
    // (f) dual signal — in-force counts the is_active:false-but-unexpired row; is_active counts the
    // is_active:true-but-expired row; the intersection counts neither.
    ['dual: is_active coverage counts only the active-but-expired client (1)', dual.activeClientsWithActiveMembershipRow === 1],
    ['dual: in-force coverage counts only the inactive-but-unexpired client (1)', dual.activeClientsWithInForceMembershipRow === 1],
    ['dual: intersection counts neither (0)', dual.activeClientsWithBothSignalsMembershipRow === 0],
    // (g) signal disagreement → flag, do NOT block on the unvalidated is_active signal.
    ['disagree: is_active coverage 0.0, in-force 1.0', disagree.activeMembershipCoverageShareIsActive === 0 && disagree.activeMembershipCoverageShareInForce === 1],
    ['disagree: verdict counts_only_possible (not blocked_low_membership_coverage)', disagree.verdict === 'counts_only_possible'],
    ['disagree: reason active_membership_signal_ambiguous present', disagree.readinessReasons.includes('active_membership_signal_ambiguous')],
  ];
  const branchFailed = branchChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (branchFailed.length > 0) return fail(`verdict-branch check(s): ${branchFailed.join(' | ')}`);

  // LEAK SCAN — no planted sentinel may appear in the serialized main result; the field-agnostic guard backs it.
  const planted = PLANTED.filter((tok) => serialized.includes(tok));
  if (planted.length > 0) return fail(`output leaked planted token(s): ${[...new Set(planted)].join(', ')}`);
  if (leaks(serialized)) return fail("output tripped the field-agnostic leak guard (ISO date / '@' / 7+ digit run)");
  // Gap proof — the fixtures DID carry the sentinels (so the clean scan above is a real suppression, not empty input).
  const rawFixtures = JSON.stringify({ clients, memberships });
  const notInFixtures = PLANTED.filter((tok) => !rawFixtures.includes(tok));
  if (notInFixtures.length > 0) return fail(`selftest fixtures missing planted token(s) — leak scan is vacuous: ${notInFixtures.join(', ')}`);

  console.log(serialized);
  console.log(
    'SELFTEST PASS: unit vocab "Month(s)"/"Year(s)"/"Week(s)"/empty maps correctly (the #517 VOID fix — the ' +
      'whole main fixture is an end-to-end proof); packs detected via the structured membership_type field ' +
      '(name regex as fallback); NO hold field on /memberships → holdSignalExposed honestly false; DUAL ' +
      'active-signal coverage reported under is_active AND expiration-derived in-force AND their intersection, ' +
      'with a not-yet-expired-but-inactive row counted in force and vice versa, and a signal disagreement ' +
      'flagged (not blocked) rather than trusting is_active; all four classifier buckets + known-base rate ' +
      'gating + collisions + assignment delta + verdict branches still correct; no planted PII/date/id/token ' +
      'leaked; no file or network touched.',
  );
}

// ─── Entry ──────────────────────────────────────────────────────────────────────────────────────────
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
        '--env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local ' +
        'scripts/wodify/silentChurnByCommitmentBandProbe.ts. No request was made.',
    );
    process.exit(1);
    return;
  }

  const asOf = gymLocalAsOf();
  const threshold = resolveSilentChurnThresholdDays(DEFAULT_SILENT_CHURN_THRESHOLD_DAYS);

  const clientsPull = await fetchAll(apiKey, CLIENTS_PATH, CLIENTS_RECORD_ARRAY_KEYS);
  const membershipsPull = await fetchAll(apiKey, MEMBERSHIPS_PATH, MEMBERSHIPS_RECORD_ARRAY_KEYS);

  const counts = analyze(clientsPull.records, membershipsPull.records, asOf, threshold);
  const meta: TransportMeta = {
    clientsHttpStatusClass: clientsPull.httpStatusClass,
    membershipsHttpStatusClass: membershipsPull.httpStatusClass,
    errorEnvelopeDetected: clientsPull.errorEnvelopeDetected || membershipsPull.errorEnvelopeDetected,
    clientsJsonParseable: clientsPull.jsonParseable,
    membershipsJsonParseable: membershipsPull.jsonParseable,
    clientsRecordKeySeen: clientsPull.recordKeySeen,
    membershipsRecordKeySeen: membershipsPull.recordKeySeen,
    clientsPagesFetched: clientsPull.pagesFetched,
    membershipsPagesFetched: membershipsPull.pagesFetched,
    reachedPageCap: clientsPull.reachedPageCap || membershipsPull.reachedPageCap,
  };

  // ONLY the safe counts-only aggregate is printed — no rows, names, ids, dates, dues, URLs, key, or raw bodies.
  emit(buildResult(counts, meta, threshold, true));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('silent-churn-by-commitment-band probe failed before producing a result (no data emitted).');
  process.exit(1);
});
