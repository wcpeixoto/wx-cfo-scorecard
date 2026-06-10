/**
 * Wodify `/clients` MEMBERSHIP-STATE field-discovery probe.  LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * Purpose (RETENTION_FINISH_PLAN.md §6 — the Member Movement 3-way census question)
 *   The live `clientStatusVocab.ts` probe found `client_status` is BINARY — Active 410 / Inactive 547.
 *   WX DOES run paused / frozen / on-hold memberships, so `client_status` alone CANNOT honestly drive a
 *   3-way (active / paused / ended) Member Movement census: mapping Inactive → ended would MERGE paused
 *   members with cancelled members and OVERSTATE churn. Before any taxonomy / edge / schema change, we
 *   must know whether the `/clients` payload carries ANY other field that subdivides the 547 "Inactive"
 *   into a paused-like group (frozen / on-hold / suspended) and an ended-like group (cancelled / expired
 *   / terminated). This probe enumerates EVERY `/clients` field's SHAPE and, for low-cardinality
 *   (enum-like) candidates whose NAME is membership-state-admitted only, emits its distinct values + a
 *   counts-only cross-tab split by `client_status`, so a HUMAN + Reviewer can decide whether a safe
 *   separation field exists.
 *
 *   It does NOT deploy, re-arm, invoke, persist, touch Supabase / the edge fn, change `normalizeStatus`,
 *   alter any schema, or wire any UI. Field-shape discovery only.
 *
 * Leak-safety contract (DISCOVERY over UNKNOWN fields — STRICTER than the vocab probe; same construction
 * posture as `clientsShapeDiscovery.ts`, whose helpers this reuses; this file imports NO app code)
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, logged, printed, or
 *     echoed in errors. If unset/empty, exits WITHOUT a request — and NEVER sources the key from Supabase
 *     secrets or the edge function (those are the server-side path, not this local probe).
 *   - Emits ONLY field-shape EVIDENCE: field NAME (ID-like-key-guarded), TYPE CATEGORIES, present /
 *     null / non-null COUNTS, distinct-value CARDINALITY (a count), and `looksEnumLike`. Inspects nested
 *     objects with the SAME guards (so a `membership: {...}` object's sub-fields are discovered too).
 *   - SHAPE GATE for any value emission: a field's distinct VALUES may be emitted ONLY when enum-like —
 *     distinct count <= MAX_ENUM_DISTINCT (15) AND every non-null value is a SHORT (<= MAX_ENUM_VALUE_LEN
 *     char) string that is non-email (no `@`), non-ID-looking, non-date-looking, and non-numeric/currency-
 *     looking. (Boolean fields are emitted as true/false/null counts: a boolean is PII-free by construction
 *     and a hold/freeze flag is a prime separation candidate.) Everything else — high-cardinality, numeric,
 *     object, array, or any value that fails the per-value test — is COUNT-ONLY with a fixed redacted label.
 *   - CLOSED BY CONSTRUCTION (NOT by disclosure — the output JSON is chat-logged AT EMISSION, so an
 *     in-output caveat is NOT a sufficient control). Three structural guards sit ON TOP of the shape gate
 *     so a value that is shape-safe but semantically PII cannot be emitted:
 *       (1) NAME ALLOWLIST on the NORMALIZED LEAF — values are emitted ONLY if the field's LEAF segment
 *           (camelCase split, `_`/`.`/digits → spaces) matches a membership-state allowlist with SHORT
 *           stems \b-anchored (end/hold/plan/tier/state/standing/active) and long stems unanchored
 *           (status/membership/freeze/frozen/paus/cancel/suspen/expir/inactive/enroll). Leaf-only ⇒ a
 *           state-named parent cannot admit an arbitrary child (membership.assigned_coach is blocked while
 *           membership.state admits); anchoring ⇒ gender/household/threshold/explanation/frontier/calendar/
 *           vendor/interactive/estate cannot admit via substrings; a leaf ending in `…by` (cancelled_by,
 *           frozen_by, recommended_by) or in a person-role NOUN (cancellation_agent, freeze_approver,
 *           hold_manager) carries actor/staff NAMES and is never admitted, lifecycle stem or not. A
 *           shape-emittable field whose name
 *           is NOT admitted is held COUNT-ONLY and surfaced in `vetThenRerunCandidates` so discovery is not
 *           lost — a human vets the name, then re-runs to inspect it.
 *       (2) COUNT-1 BACKSTOP — a value held by EXACTLY ONE member is a quasi-identifier regardless of field;
 *           it is never emitted, but collapsed into one `(unique_value_suppressed)` count-only row (cross-tab
 *           totals still reconcile).
 *       (3) FREE-TEXT NAME SUPPRESSION — …note/comment/memo/desc leaves are NEVER value-admitted (StatusNote,
 *           PlanComment, HoldMemo, status_note); the …reason family emits ONLY with a STRONG lifecycle stem
 *           (freeze_reason / hold_reason / cancellation_reason / end_reason yes; a bare `reason` no).
 *     A `valueEmissionCaveat` still ships in the output as defense-in-depth, but it is NO LONGER the
 *     control — the three guards above are. Because real PII fields (name/email/phone/exact date/dues/id)
 *     are also HIGH-cardinality across ~957 members, the shape gate already excludes them; these guards
 *     close the low-cardinality semantic gap structurally.
 *   - The ONLY raw upstream strings that can ever reach output are the distinct values of a NAME-ADMITTED,
 *     shape-passing, count>=2 field (short, low-cardinality, non-PII-shaped enum labels — e.g. `Active`,
 *     `Frozen`, `Cancelled`). NEVER names, IDs, emails, phones, dates, dues, raw rows, raw / echoed
 *     response bodies, request URLs / query strings, headers, or keys. No intermediate raw files written.
 *   - The `client_status` value is read in memory to bucket each member Active / Inactive / Other for the
 *     cross-tabs; the FIELD itself also emits its own cross-tab like any admitted enum — its values are the
 *     known-safe binary labels (`Active`/`Inactive`) already established by the merged vocab probe.
 *   - Detects a Wodify ERROR ENVELOPE at transport-2xx (top-level DeveloperMessage / ErrorCode /
 *     HTTPCode / UserMessage) and reports it as a failure; the in-body HTTPCode is reduced to a status
 *     CLASS only (raw value + message text never read).
 *   - Paginates the FULL client set (mirrors the edge `fetchAllClients` / `clientStatusVocab.ts`: loop
 *     while `pagination.has_more`, `MAX_PAGES` safety bound) so a paused value that is a minority of the
 *     547 Inactive is NOT missed. `coverageComplete` is true ONLY for a full clean scan
 *     (recordArrayKey !== null, totalRecordsScanned > 0) — same hardening as the vocab probe.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   Network-free safe-output self-test FIRST (makes NO request, needs NO key):
 *     npx tsx scripts/wodify/clientsMembershipStateDiscovery.ts --selftest
 *   Live run — worktree-safe: point --env-file at the primary clone's gitignored env by ABSOLUTE path:
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/clientsMembershipStateDiscovery.ts
 *   See scripts/wodify/README.md. Never inline-paste the key (it lands in shell history). The LIVE run is
 *   GATED: it needs a separate explicit Wesley go (Phase 1 is author + self-test only).
 *
 * Call budget — GET `/clients` pages only (the same request the edge makes), no per-client calls, no
 * writes, no Supabase calls. Mirrors the edge so the observed shape == what the edge would aggregate.
 */

// ─── CONFIG — mirrors supabase/functions/sync-wodify-retention + clientStatusVocab.ts request shape ───
const BASE_URL = 'https://api.wodify.com/v1'; // §5 reported base URL; auth via x-api-key header.
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100; // Wodify caps at 100/page (edge PAGE_SIZE).
const MAX_PAGES = 50; // edge MAX_PAGES — ~5000 clients, far above the ~957-client set; reachedPageCap flags partial.
const REQUEST_TIMEOUT_MS = 15000; // edge WODIFY_TIMEOUT_MS.
const RECORD_ARRAY_KEY = 'clients'; // confirmed by clientStatusVocab.ts / the edge fetchAllClients.
const STATUS_FIELD = 'client_status'; // the binary field we cross-tab against (bucketing in memory; the field
//                                       also emits its own cross-tab as an admitted enum — known Active/Inactive).

// Enum gate — distinct values are emitted ONLY when a field is enum-like AND every value passes the
// per-value safety test. Real PII is high-cardinality across ~957 members, so this excludes it structurally.
const MAX_ENUM_DISTINCT = 15;
const CARDINALITY_TRACK_CAP = MAX_ENUM_DISTINCT + 1; // 16 — once a field reaches this many distinct values it
//                                                      is definitely NOT enum-like; we stop tracking new ones
//                                                      (bounds in-memory PII to <=16 transient values/field).
const MAX_ENUM_VALUE_LEN = 40;
const MAX_NEST_DEPTH = 2; // recurse into nested objects up to this many levels (membership.status, membership.x.y).

const EMAIL_LIKE = /@/;
const REDACTED_VALUE_LABEL = '(redacted_count_only)'; // shown when a field's values are shape-suppressed.
const NAME_WITHHELD_LABEL = '(count_only_name_not_admitted_vet_then_rerun)'; // shape-emittable but NAME not admitted.
const UNIQUE_VALUE_SUPPRESSED_LABEL = '(unique_value_suppressed)'; // count-1 quasi-identifier collapse target.
const NULL_VALUE_LABEL = '(null)'; // present-but-null bucket in a cross-tab.
const EMPTY_STRING_LABEL = '(empty_string)'; // display for a genuine '' enum value (counted, no PII).

// Value-emission NAME gate (MUST close the leak BY CONSTRUCTION — the output JSON is chat-logged at
// emission, so an in-output caveat is not a control). All patterns below are evaluated against the
// NORMALIZED LEAF segment of the field path (see isValueNameAdmitted): leaf-only so a state-named PARENT
// cannot admit an arbitrary child (membership.assigned_coach), normalized (camelCase split, `_`/`.`/digits
// → spaces) so boundaries work on on_hold / OnHold / StatusNote alike. A low-cardinality, safe-shaped
// field whose name is NOT admitted is held COUNT-ONLY and surfaced as a vet-then-rerun candidate.
//
// Allowlist over the normalized leaf. SHORT stems are \b-anchored (end/hold/plan/tier/state/standing/
// active) so gender / household / threshold / explanation / frontier / calendar / vendor / interactive /
// estate cannot admit via substrings; LONG stems stay unanchored (no plausible false containers).
// CRITICAL: anchored stems only work because the input is NORMALIZED — `_` is a word char, so \bhold\b on
// a raw path would wrongly reject on_hold / hold_status.
const STATE_NAME_ALLOWLIST =
  /status|membership|freeze|frozen|paus|cancel|suspen|expir|inactive|enroll|\bstate\b|\bstanding\b|\bactive\b|\bhold\b|\bplan\b|\btier\b|\bend(ed|ing|s)?\b/i;
// Hard free-text suffixes — NEVER value-admitted, even with a lifecycle stem (HoldMemo / PlanComment /
// StatusNote / status_note are genuinely free text; an enum would not be named like this).
const HARD_FREE_TEXT_NAME_PATTERN = /(^|[\s._])(note|notes|comment|comments|memo|memos|desc|description|descriptions)$/i;
// Reason-family suffixes — admitted ONLY with a strong lifecycle stem (gym software ships these as enum
// picklists: freeze_reason / hold_reason / cancellation_reason / end_reason). A bare `reason` stays blocked.
const REASON_NAME_PATTERN = /(^|[\s._])reasons?$/i;
// `suspen`/`expir` cover the noun forms too (suspension / expiry / expiration).
const STRONG_LIFECYCLE_STEMS = /freeze|frozen|\bhold\b|paus|cancel|suspen|expir|\bend(ed|ing|s)?\b|terminat/i;
// Actor-name deny: a leaf ending in ` by` (cancelled_by / frozen_by / sold_by / recommended_by) holds the
// NAME of the staff/member who did the action — those emit person names at count>=2. Never value-admitted.
const ACTOR_BY_NAME_PATTERN = /(^|\s)by$/i;
// Role-noun deny (round 3): a leaf ENDING in a person-role noun (cancellation_agent / freeze_approver /
// hold_manager) names WHO handled the lifecycle event, not the state — its lifecycle stem must not admit
// it (<=15 staff names would emit at count>=2). Tested on the same normalized leaf as the `…by` deny.
const ROLE_NOUN_NAME_PATTERN = /(^|\s)(coach|trainer|instructor|agent|rep|representative|approver|manager|owner|advisor|consultant|staff|employee|sales)$/i;

// Travels in every result as DEFENSE-IN-DEPTH (no longer the control — the three structural guards above are).
const VALUE_EMISSION_CAVEAT =
  'Value emission is closed BY CONSTRUCTION: values[] are emitted only for fields whose NORMALIZED LEAF name ' +
  'is on the membership-state allowlist (boundary-anchored short stems; parent names cannot admit children; ' +
  '…by actor fields, role-noun leaves (coach/agent/approver/manager/…), and note/comment/memo/desc names ' +
  'never emit), with count-1 values collapsed to ' +
  '(unique_value_suppressed). This caveat is defense-in-depth, NOT the control. Before deploying any field, a ' +
  'human should still confirm its emitted values carry no person name / free-text / identifying value, and ' +
  'review vetThenRerunCandidates for state-bearing fields that were name-withheld.';

// §5 / #423: Wodify error-envelope markers (matched case-insensitively; values are NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// Field-NAME patterns that flag a field as a membership-state candidate (operate on SAFE field paths only;
// emit a name, never a value). Used only to focus the human's attention + surface count-only candidates.
const STATE_CANDIDATE_NAME_PATTERNS = [
  /member.?ship/i, /status/i, /\bstate\b/i, /\bhold\b/i, /freeze|frozen/i, /paus/i, /suspend/i,
  /cancel/i, /\bend(ed|ing|s)?\b/i, /expir/i, /terminat/i, /reason/i, /active|inactive/i,
  /churn|dropout|drop.?off|left|quit/i, /\bplan\b/i, /\btier\b/i, /enroll/i, /standing/i,
];

// ─── Safe output contract ────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';
type TypeCategory = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
type StatusBucket = 'active' | 'inactive' | 'other';
type SemanticHint = 'active_like' | 'paused_like' | 'ended_like' | 'unknown';
type SeparationConfidence = 'strict' | 'advisory' | 'none';

// Counts-only cross-tab cell: how a single field value distributes across the client_status buckets.
interface ValueCrossTab {
  value: string; // a SAFE enum label, or a fixed '(…)' label — never a high-cardinality / PII-shaped string.
  total: number;
  active: number;
  inactive: number;
  other: number;
  semanticHint: SemanticHint; // ADVISORY heuristic for the human; NOT an authoritative classification.
}

// One discovered field's shape evidence. `values` is non-null ONLY when the field passed the gate AND the name allowlist.
interface FieldShape {
  field: string; // SAFE dot-path name (ID-like segments redacted); never a value.
  types: TypeCategory[]; // observed type categories (sorted), including 'null' if any null seen.
  presentCount: number; // records in which the key was present.
  nonNullCount: number;
  nullCount: number; // present but null/undefined.
  presenceByBucket: { active: number; inactive: number; other: number }; // present-count split by status bucket.
  distinctCardinality: number; // exact when not capped; the cap value when capped (a floor).
  cardinalityCapped: boolean; // true ⇒ at least CARDINALITY_TRACK_CAP distinct values (definitely not enum-like).
  looksEnumLike: boolean; // strict string gate: low-cardinality + every value a safe short non-PII string.
  booleanField: boolean; // every non-null value is a boolean (emitted as true/false counts — PII-free).
  nameAdmitted: boolean; // field NAME is on the membership-state value-emission allowlist.
  looksLikeStateCandidate: boolean; // field NAME suggests membership state (broader than the allowlist).
  nameHint: SemanticHint; // paused/ended/active hint derived from the field NAME (drives boolean + presence separation).
  shapeEmittableNameWithheld: boolean; // enum/boolean shape, but values WITHHELD because the name isn't admitted.
  values: ValueCrossTab[] | null; // distinct values + cross-tab — ONLY when shape-emittable AND name-admitted.
  redactedValueLabel: string | null; // set (and values null) when value emission is suppressed; says why.
}

// The decisive artifact: a field that splits the Inactive population into >= 2 value groups (value-based).
interface InactiveSplit {
  field: string;
  groups: Array<{ value: string; inactiveCount: number; semanticHint: SemanticHint }>; // inactive-only, desc.
  pausedLikeInactive: number; // Σ inactiveCount where hint == paused_like (heuristic).
  endedLikeInactive: number; // Σ inactiveCount where hint == ended_like (heuristic).
  unknownInactive: number; // Σ inactiveCount where hint is unknown/active_like (the human must interpret).
}

// A field present on a PROPER non-empty subset of Inactive → presence subdivides the bucket (presence/absence).
interface PresenceSeparator {
  field: string;
  nameHint: SemanticHint; // paused_like / ended_like (only these are surfaced — they name the present subgroup).
  presentInactive: number;
  absentInactive: number;
  presentActive: number;
  presentOther: number;
}

// A hold/freeze/cancel-NAMED boolean flag whose truthy side falls in Inactive — paused/ended derived from NAME.
interface BooleanSeparationSignal {
  field: string;
  nameHint: SemanticHint;
  trueInactive: number;
  falseInactive: number;
}

interface ClientsMembershipStateResult {
  probe: 'clientsMembershipStateDiscovery';
  path: string; // PATH only — never a query string / substituted URL.
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  jsonParseable: boolean | null;
  recordArrayKey: string | null;
  pagesFetched: number;
  reachedPageCap: boolean;
  coverageComplete: boolean; // true ⇒ the WHOLE client set was scanned cleanly — discovery is exhaustive.
  totalRecordsScanned: number;

  statusBucketCounts: { active: number; inactive: number; other: number }; // census denominator (~410 / 547 / 0).
  fieldCount: number; // distinct SAFE field paths discovered.
  redactedFieldNameCount: number; // distinct ID-like field NAMES suppressed (counted, never emitted).
  fields: FieldShape[]; // every discovered field (sorted by path).

  // Decisive answer to "can paused be separated from ended?":
  emittableStateCandidates: string[]; // enum/boolean fields that emit values AND look like state OR subdivide Inactive.
  countOnlyStateCandidates: string[]; // state-NAMED fields the SHAPE gate suppressed (numeric/array/high-card) — follow-up.
  vetThenRerunCandidates: string[]; // shape-emittable fields whose values were WITHHELD by the name gate — vet the name, re-run.
  fieldsSubdividingInactive: InactiveSplit[]; // fields that split Inactive into >= 2 value groups.
  presenceSeparators: PresenceSeparator[]; // fields present on a proper subset of Inactive (presence subdivides it).
  booleanSeparationSignals: BooleanSeparationSignal[]; // hold/freeze/cancel-named booleans whose truthy side is Inactive.
  separationConfidence: SeparationConfidence; // strict (one field shows paused AND ended) | advisory (a named subgroup) | none.
  canSeparatePausedFromEnded: boolean; // separationConfidence !== 'none' (HEURISTIC; the human/Reviewer make the real call).
  recommendation: string; // machine-friendly verdict tag (the human/Reviewer make the real call).
  valueEmissionCaveat: string; // defense-in-depth reminder — emission is closed by construction, not by this caveat.
}

// ─── Pure helpers (none emit, log, or retain values) — ID-like / type / envelope reused from base probe ─
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ID-like KEY guard (field NAMES) — identical to clientsShapeDiscovery.ts so a value-shaped key cannot leak.
function isIdLikeKey(key: string): boolean {
  if (key.length > 40) return true; // suspiciously long — could be a token/value
  if (/^\d{3,}$/.test(key)) return true; // pure digits, 3+ → likely a numeric ID
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(key)) return true; // UUID
  if (/^[0-9a-fA-F]{12,}$/.test(key)) return true; // long hex blob
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(key) && !/[a-z].*[A-Z]|_|-/.test(key)) return true; // base64-ish blob
  return false;
}

function typeCategoryOf(v: unknown): TypeCategory {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return 'string'; // undefined/function/symbol/bigint folded to a benign label; values never emitted
}

// Per-VALUE safety for emission (only ever applied to strings). Stricter than the vocab probe: a value is
// emittable ONLY if it cannot plausibly be PII — short, no `@`, and not ID/date/number/currency-shaped.
function looksIdLikeValue(s: string): boolean {
  if (/^\d{3,}$/.test(s)) return true; // pure digits, 3+
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) return true; // UUID
  if (/^[0-9a-fA-F]{12,}$/.test(s)) return true; // long hex blob
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(s) && !/[a-z].*[A-Z]|_|-/.test(s)) return true; // base64-ish blob
  return false;
}
function looksDateLike(s: string): boolean {
  return (
    /\d{4}-\d{2}-\d{2}/.test(s) || // ISO date / datetime
    /^\d{4}-\d{2}$/.test(s) || // year-month
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(s) || // US date
    /\d{1,2}:\d{2}/.test(s) // time
  );
}
function looksNumericOrCurrency(s: string): boolean {
  return /^[$€£]?\s?-?\d[\d,]*(\.\d+)?%?$/.test(s.trim()); // 4242.42, $1,200, 12%, -5
}
function isSafeEnumValue(s: string): boolean {
  if (s.length > MAX_ENUM_VALUE_LEN) return false;
  if (EMAIL_LIKE.test(s)) return false;
  if (looksIdLikeValue(s)) return false;
  if (looksDateLike(s)) return false;
  if (looksNumericOrCurrency(s)) return false;
  return true; // an empty string is PII-free and passes (displayed as '(empty_string)').
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

function looksLikeStateCandidate(fieldPath: string): boolean {
  return STATE_CANDIDATE_NAME_PATTERNS.some((p) => p.test(fieldPath));
}

// Is value emission admitted for this field NAME? Decided on the NORMALIZED LEAF segment only:
//   - leaf-only ⇒ a state-named PARENT cannot admit an arbitrary child (membership.assigned_coach blocked
//     while membership.state still admits via its own leaf);
//   - normalized ⇒ camelCase and `_`/`.` boundaries are uniform, so \b-anchored stems behave identically
//     for on_hold / OnHold / hold_status, and StatusNote cannot dodge free-text suppression.
// Order matters: denies first (actor `…by`, role-noun leaf, hard free-text), then the reason-family
// carve-out, then the allowlist. Fail closed: anything unmatched is count-only (vet-then-rerun), never emitted.
function isValueNameAdmitted(fieldPath: string): boolean {
  const leaf = fieldPath.split('.').pop() ?? fieldPath;
  const n = normalizeForHint(leaf).trim();
  if (ACTOR_BY_NAME_PATTERN.test(n)) return false; // cancelled_by / frozen_by — actor NAMES, never values
  if (ROLE_NOUN_NAME_PATTERN.test(n)) return false; // cancellation_agent / freeze_approver — role nouns hold staff NAMES
  if (HARD_FREE_TEXT_NAME_PATTERN.test(n)) return false; // note/comment/memo/desc — free text, never values
  if (REASON_NAME_PATTERN.test(n)) return STRONG_LIFECYCLE_STEMS.test(n); // freeze_reason yes, bare reason no
  return STATE_NAME_ALLOWLIST.test(n);
}

// Normalize a field path / value for keyword hinting: split camelCase, and treat `_` `.` and digits as
// word separators so `\b`-anchored stems (e.g. `\bhold\b`) match `on_hold` / `OnHold` / `hold_status`.
function normalizeForHint(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[._\d]+/g, ' ');
}

// ADVISORY ONLY — a soft hint from a VALUE string so the human can scan; not an authoritative classification.
function semanticHintOf(display: string): SemanticHint {
  const s = normalizeForHint(display);
  if (/inactive/.test(s)) return 'unknown'; // the undifferentiated parent bucket — not paused/ended on its own
  if (/cancel|expir|terminat|ended|\bend\b|dropped|closed|quit|churn|deceased|delet|former/.test(s)) return 'ended_like';
  if (/frozen|freeze|\bhold\b|paus|suspend|leave|absence|deferred|vacation/.test(s)) return 'paused_like';
  if (/active|current|enrolled|member|good.?standing/.test(s)) return 'active_like';
  return 'unknown';
}

// ADVISORY ONLY — a soft hint from a field NAME. Drives the boolean + presence separators, where the VALUE
// ('true'/'false', or a constant present-only-on-a-subgroup label) carries no paused/ended signal itself.
function nameHintOf(fieldPath: string): SemanticHint {
  const s = normalizeForHint(fieldPath);
  if (/cancel|expir|terminat|\bend(ed|ing|s)?\b|churn|dropped|closed|quit|former/.test(s)) return 'ended_like';
  if (/freeze|frozen|\bhold\b|paus|suspend|leave|absence|defer|vacation/.test(s)) return 'paused_like';
  if (/inactive/.test(s)) return 'unknown';
  if (/active|enroll|current|standing/.test(s)) return 'active_like';
  return 'unknown';
}

// Hint for one emitted value row: a boolean's truthy side takes the field-NAME hint; a string takes its own.
function valueRowHint(field: string, canonical: string, displayValue: string): SemanticHint {
  if (canonical === 'true') return nameHintOf(field); // truthy side of a boolean → field-NAME hint
  if (canonical === 'false') return 'unknown'; // "not paused/ended" is not itself paused/ended
  return semanticHintOf(displayValue); // string value drives its own hint
}

// ─── Field accumulation (pure; the self-test exercises this exact path with synthetic PII) ─────────
interface ValueBuckets { active: number; inactive: number; other: number; }
function freshBuckets(): ValueBuckets { return { active: 0, inactive: 0, other: 0 }; }
function incr(b: ValueBuckets, bucket: StatusBucket): void { b[bucket] += 1; }

interface FieldAcc {
  types: Set<TypeCategory>;
  presentCount: number;
  presentBuckets: ValueBuckets; // present-count split by status bucket (drives the presence/absence separator)
  nonNullCount: number;
  nullCount: number;
  nullBuckets: ValueBuckets; // present-but-null split by status (e.g. freeze_reason null for actives)
  distinct: Map<string, ValueBuckets>; // canonical value string -> buckets; capped at CARDINALITY_TRACK_CAP
  cardinalityCapped: boolean;
  sawString: boolean;
  sawBoolean: boolean;
  sawOtherType: boolean; // number/object/array value seen → blocks value emission (count-only)
  anyUnsafeStringValue: boolean; // a string value failed isSafeEnumValue → blocks value emission
}
function freshFieldAcc(): FieldAcc {
  return {
    types: new Set(),
    presentCount: 0,
    presentBuckets: freshBuckets(),
    nonNullCount: 0,
    nullCount: 0,
    nullBuckets: freshBuckets(),
    distinct: new Map(),
    cardinalityCapped: false,
    sawString: false,
    sawBoolean: false,
    sawOtherType: false,
    anyUnsafeStringValue: false,
  };
}

interface ScanCtx {
  fields: Map<string, FieldAcc>;
  redactedFieldNames: Set<string>; // distinct ID-like field NAMES (in memory only; only the COUNT is emitted)
  statusBucketCounts: { active: number; inactive: number; other: number };
  totalRecordsScanned: number;
}
function freshCtx(): ScanCtx {
  return {
    fields: new Map(),
    redactedFieldNames: new Set(),
    statusBucketCounts: { active: 0, inactive: 0, other: 0 },
    totalRecordsScanned: 0,
  };
}

function statusBucketOf(rec: Record<string, unknown>): StatusBucket {
  const raw = rec[STATUS_FIELD];
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (v === 'active') return 'active';
    if (v === 'inactive') return 'inactive';
  }
  return 'other'; // any surprise value is visible as 'other' rather than silently folded into active/inactive
}

// Track a distinct canonical value for cardinality + cross-tab. Holds at most CARDINALITY_TRACK_CAP raw
// values in memory per field (transient, never written to disk, emitted ONLY if the field passes every gate).
function trackDistinct(fa: FieldAcc, canonical: string, bucket: StatusBucket): void {
  const existing = fa.distinct.get(canonical);
  if (existing) { incr(existing, bucket); return; }
  if (fa.distinct.size >= CARDINALITY_TRACK_CAP) { fa.cardinalityCapped = true; return; } // stop adding new distinct
  const b = freshBuckets();
  incr(b, bucket);
  fa.distinct.set(canonical, b);
}

function accumulateValue(fa: FieldAcc, v: unknown, bucket: StatusBucket): void {
  if (v === null || v === undefined) {
    fa.nullCount += 1;
    fa.types.add('null');
    incr(fa.nullBuckets, bucket);
    return;
  }
  fa.nonNullCount += 1;
  const cat = typeCategoryOf(v);
  fa.types.add(cat);
  if (cat === 'object' || cat === 'array') {
    fa.sawOtherType = true; // nested objects are recursed separately; arrays/objects never emit values
    return;
  }
  if (cat === 'number') {
    fa.sawOtherType = true; // numbers are COUNT-ONLY (could be dues/id/date-as-epoch/tier) — never emitted
    trackDistinct(fa, `n:${String(v)}`, bucket); // for cardinality only
    return;
  }
  if (cat === 'boolean') {
    fa.sawBoolean = true; // booleans are PII-free → emittable as true/false counts (if name-admitted)
    trackDistinct(fa, (v as boolean) ? 'true' : 'false', bucket);
    return;
  }
  // string
  fa.sawString = true;
  const s = v as string;
  if (!isSafeEnumValue(s)) fa.anyUnsafeStringValue = true;
  trackDistinct(fa, `s:${s}`, bucket); // raw string held in memory (capped); emitted only if the field passes every gate
}

// Walk a record's fields, recursing into nested plain objects (membership object) up to MAX_NEST_DEPTH.
function walkRecord(obj: Record<string, unknown>, prefix: string, level: number, bucket: StatusBucket, ctx: ScanCtx): void {
  for (const [k, v] of Object.entries(obj)) {
    if (isIdLikeKey(k)) { ctx.redactedFieldNames.add(prefix ? `${prefix}.${k}` : k); continue; } // never track an id-like-named field
    const path = prefix ? `${prefix}.${k}` : k;
    let fa = ctx.fields.get(path);
    if (!fa) { fa = freshFieldAcc(); ctx.fields.set(path, fa); }
    fa.presentCount += 1;
    incr(fa.presentBuckets, bucket);
    accumulateValue(fa, v, bucket);
    if (isPlainObject(v) && level < MAX_NEST_DEPTH) walkRecord(v, path, level + 1, bucket, ctx);
  }
}

function tallyRecords(records: readonly unknown[], ctx: ScanCtx): void {
  for (const rec of records) {
    const obj = isPlainObject(rec) ? rec : null;
    const bucket = obj ? statusBucketOf(obj) : 'other';
    ctx.statusBucketCounts[bucket] += 1;
    ctx.totalRecordsScanned += 1;
    if (obj) walkRecord(obj, '', 0, bucket, ctx);
  }
}

// ─── Build the safe result from accumulated field stats (pure) ─────────────────────────────────────
function displayCanonical(canonical: string): string {
  // canonical keys are tagged: 's:<string>' | 'n:<number>' | 'true' | 'false'.
  if (canonical === 'true' || canonical === 'false') return canonical;
  if (canonical.startsWith('s:')) {
    const raw = canonical.slice(2);
    return raw === '' ? EMPTY_STRING_LABEL : raw;
  }
  return canonical; // numbers never reach display (their fields are count-only), but stay safe if they did
}

function buildFieldShape(field: string, fa: FieldAcc): FieldShape {
  const types = [...fa.types].sort();
  const distinctCardinality = fa.cardinalityCapped ? CARDINALITY_TRACK_CAP : fa.distinct.size;
  const booleanField = fa.sawBoolean && !fa.sawString && !fa.sawOtherType;
  const looksEnumLike =
    !fa.cardinalityCapped &&
    fa.distinct.size <= MAX_ENUM_DISTINCT &&
    fa.sawString &&
    !fa.sawOtherType &&
    !fa.sawBoolean &&
    !fa.anyUnsafeStringValue;
  const shapeEmittable = looksEnumLike || booleanField;

  // MUST-FIX 1 (name allowlist) + MUST-FIX 2 (free-text suppression): values may be emitted only if the
  // field NAME is membership-state-admitted. A shape-emittable but un-admitted field is held count-only.
  const nameAdmitted = isValueNameAdmitted(field);
  const emitValues = shapeEmittable && nameAdmitted;
  const shapeEmittableNameWithheld = shapeEmittable && !nameAdmitted;

  let values: ValueCrossTab[] | null = null;
  let redactedValueLabel: string | null = null;
  if (emitValues) {
    const rows: ValueCrossTab[] = [];
    const suppressed = freshBuckets(); // MUST-FIX 2: count-1 quasi-identifiers collapse here
    let anySuppressed = false;
    for (const [canonical, b] of fa.distinct) {
      const total = b.active + b.inactive + b.other;
      if (total === 1) { // a value held by EXACTLY ONE member is a quasi-identifier regardless of field — never emit it
        suppressed.active += b.active;
        suppressed.inactive += b.inactive;
        suppressed.other += b.other;
        anySuppressed = true;
        continue;
      }
      const value = displayCanonical(canonical);
      rows.push({ value, total, active: b.active, inactive: b.inactive, other: b.other, semanticHint: valueRowHint(field, canonical, value) });
    }
    if (fa.nullCount > 0) {
      const nb = fa.nullBuckets;
      const total = nb.active + nb.inactive + nb.other;
      if (total === 1) {
        suppressed.active += nb.active;
        suppressed.inactive += nb.inactive;
        suppressed.other += nb.other;
        anySuppressed = true;
      } else {
        rows.push({ value: NULL_VALUE_LABEL, total, active: nb.active, inactive: nb.inactive, other: nb.other, semanticHint: 'unknown' });
      }
    }
    if (anySuppressed) {
      rows.push({
        value: UNIQUE_VALUE_SUPPRESSED_LABEL,
        total: suppressed.active + suppressed.inactive + suppressed.other,
        active: suppressed.active,
        inactive: suppressed.inactive,
        other: suppressed.other,
        semanticHint: 'unknown',
      });
    }
    rows.sort((x, y) => y.total - x.total || (x.value < y.value ? -1 : x.value > y.value ? 1 : 0));
    values = rows;
  } else if (shapeEmittableNameWithheld) {
    redactedValueLabel = NAME_WITHHELD_LABEL; // shape-emittable but NAME not state-admitted → vet-then-rerun
  } else {
    redactedValueLabel = REDACTED_VALUE_LABEL; // shape-suppressed (high-card / numeric / object / unsafe value)
  }

  return {
    field,
    types,
    presentCount: fa.presentCount,
    nonNullCount: fa.nonNullCount,
    nullCount: fa.nullCount,
    presenceByBucket: { active: fa.presentBuckets.active, inactive: fa.presentBuckets.inactive, other: fa.presentBuckets.other },
    distinctCardinality,
    cardinalityCapped: fa.cardinalityCapped,
    looksEnumLike,
    booleanField,
    nameAdmitted,
    looksLikeStateCandidate: looksLikeStateCandidate(field),
    nameHint: nameHintOf(field),
    shapeEmittableNameWithheld,
    values,
    redactedValueLabel,
  };
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

function buildResult(ctx: ScanCtx, meta: TransportMeta): ClientsMembershipStateResult {
  const fields = [...ctx.fields.entries()]
    .map(([field, fa]) => buildFieldShape(field, fa))
    .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));

  // (A) VALUE split: which fields split the Inactive population into >= 2 value groups?
  const fieldsSubdividingInactive: InactiveSplit[] = [];
  for (const f of fields) {
    if (!f.values) continue; // only fields whose values passed every gate can be analysed
    const inactiveGroups = f.values
      .filter((v) => v.inactive > 0)
      .map((v) => ({ value: v.value, inactiveCount: v.inactive, semanticHint: v.semanticHint }))
      .sort((a, b) => b.inactiveCount - a.inactiveCount);
    if (inactiveGroups.length < 2) continue;
    let pausedLikeInactive = 0;
    let endedLikeInactive = 0;
    let unknownInactive = 0;
    for (const g of inactiveGroups) {
      if (g.semanticHint === 'paused_like') pausedLikeInactive += g.inactiveCount;
      else if (g.semanticHint === 'ended_like') endedLikeInactive += g.inactiveCount;
      else unknownInactive += g.inactiveCount;
    }
    fieldsSubdividingInactive.push({ field: f.field, groups: inactiveGroups, pausedLikeInactive, endedLikeInactive, unknownInactive });
  }

  // (B) PRESENCE/ABSENCE split (SHOULD-FIX): a field present on a PROPER non-empty subset of Inactive, with
  // a paused/ended NAME, names a subgroup of Inactive — don't let omitted-vs-explicit-null read as "no split".
  const totalInactive = ctx.statusBucketCounts.inactive;
  const presenceSeparators: PresenceSeparator[] = fields
    .filter((f) => {
      const pIn = f.presenceByBucket.inactive;
      return totalInactive > 0 && pIn > 0 && pIn < totalInactive && (f.nameHint === 'paused_like' || f.nameHint === 'ended_like');
    })
    .map((f) => ({
      field: f.field,
      nameHint: f.nameHint,
      presentInactive: f.presenceByBucket.inactive,
      absentInactive: totalInactive - f.presenceByBucket.inactive,
      presentActive: f.presenceByBucket.active,
      presentOther: f.presenceByBucket.other,
    }));

  // (C) BOOLEAN-name split (SHOULD-FIX): a hold/freeze/cancel-named boolean whose truthy side falls in Inactive.
  // semanticHintOf runs on 'true'/'false' and can never flip the verdict — derive paused/ended from the NAME.
  const booleanSeparationSignals: BooleanSeparationSignal[] = fields
    .filter((f) => f.booleanField && f.values !== null && (f.nameHint === 'paused_like' || f.nameHint === 'ended_like'))
    .map((f) => {
      const t = f.values!.find((v) => v.value === 'true');
      const fl = f.values!.find((v) => v.value === 'false');
      return { field: f.field, nameHint: f.nameHint, trueInactive: t?.inactive ?? 0, falseInactive: fl?.inactive ?? 0 };
    })
    // Only a TRUTHY presence among Inactive names a subgroup; an all-false hold flag carries zero
    // separation information and must not flip the headline to advisory.
    .filter((s) => s.trueInactive > 0);

  // Verdict. STRICT = one field shows BOTH a paused-like and an ended-like value group among Inactive.
  // ADVISORY = a named paused/ended subgroup of Inactive exists (value, presence, or boolean) but not both-in-one.
  const strictSeparation = fieldsSubdividingInactive.some((s) => s.pausedLikeInactive > 0 && s.endedLikeInactive > 0);
  const advisorySignals =
    presenceSeparators.length > 0 ||
    booleanSeparationSignals.length > 0 ||
    fieldsSubdividingInactive.some((s) => s.pausedLikeInactive > 0 || s.endedLikeInactive > 0);
  const separationConfidence: SeparationConfidence = strictSeparation ? 'strict' : advisorySignals ? 'advisory' : 'none';
  const canSeparatePausedFromEnded = separationConfidence !== 'none';

  const splitFieldNames = new Set(fieldsSubdividingInactive.map((s) => s.field));
  const emittableStateCandidates = fields
    .filter((f) => f.values !== null && (f.looksLikeStateCandidate || splitFieldNames.has(f.field)))
    .map((f) => f.field);
  const countOnlyStateCandidates = fields
    .filter((f) => f.values === null && f.looksLikeStateCandidate && !f.shapeEmittableNameWithheld)
    .map((f) => f.field);
  const vetThenRerunCandidates = fields.filter((f) => f.shapeEmittableNameWithheld).map((f) => f.field);

  const coverageComplete =
    meta.endpointReached &&
    meta.httpStatusClass === '2xx' &&
    !meta.errorEnvelopeDetected &&
    meta.jsonParseable !== false &&
    !meta.reachedPageCap &&
    meta.pagesFetched > 0 &&
    meta.recordArrayKey !== null &&
    ctx.totalRecordsScanned > 0;

  let recommendation: string;
  if (!coverageComplete) recommendation = 'coverage_incomplete_rerun_or_investigate';
  else if (separationConfidence === 'strict') recommendation = 'separation_candidate_found_review';
  else if (separationConfidence === 'advisory') recommendation = 'separation_advisory_review';
  else if (vetThenRerunCandidates.length > 0) recommendation = 'no_admitted_separator_vet_then_rerun_candidates';
  else recommendation = 'no_separation_field_rescope_or_other_endpoint';

  return {
    probe: 'clientsMembershipStateDiscovery',
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
    statusBucketCounts: ctx.statusBucketCounts,
    fieldCount: fields.length,
    redactedFieldNameCount: ctx.redactedFieldNames.size,
    fields,
    emittableStateCandidates,
    countOnlyStateCandidates,
    vetThenRerunCandidates,
    fieldsSubdividingInactive,
    presenceSeparators,
    booleanSeparationSignals,
    separationConfidence,
    canSeparatePausedFromEnded,
    recommendation,
    valueEmissionCaveat: VALUE_EMISSION_CAVEAT,
  };
}

// ─── Live network layer (body read for shape derivation only; never logged / returned as text) ────
async function scanAllClients(apiKey: string): Promise<{ ctx: ScanCtx; meta: TransportMeta }> {
  const ctx = freshCtx();
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

    const clients = isPlainObject(parsed) ? parsed[RECORD_ARRAY_KEY] : undefined;
    const records: unknown[] = Array.isArray(clients) ? clients : [];
    if (meta.recordArrayKey === null && Array.isArray(clients)) meta.recordArrayKey = RECORD_ARRAY_KEY;
    tallyRecords(records, ctx);
    meta.pagesFetched += 1;

    const pagination = isPlainObject(parsed) ? parsed['pagination'] : undefined;
    const hasMore = isPlainObject(pagination) && pagination['has_more'] === true;
    if (!hasMore || records.length === 0) break;
    if (page === MAX_PAGES) meta.reachedPageCap = true; // more pages exist but we hit the safety bound.
  }

  return { ctx, meta };
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO key) ─────────
function runSelfTest(): void {
  const ACTIVE_N = 8;
  const FROZEN_N = 4;
  const CANCELLED_N = 5;
  const EXPIRED_N = 3; // total 20 rows; Inactive = 12 (Frozen 4 + Cancelled 5 + Expired 3)

  // PII / secrets planted on each row AND a high-cardinality note. NONE may appear anywhere in output.
  // Includes person-NAMES on non-admitted fields + a count-1 free-text value — both must be blocked BY
  // CONSTRUCTION (name allowlist + count-1 backstop), not by their being in this leak list.
  const planted: string[] = [
    'friend@example.com', '2020-01', '2020-02', '2020-03',
    'Aniyah', 'Bowen', 'Dario', 'Elowen', // coach NAMES on non-admitted fields → name-withheld
    'OnlineAd', 'PromoFlyer', // free-text-named (signup_comment) safe values → free-text-withheld
    'UNIQUE_PERSONAL_X', // count-1 value inside an ADMITTED field → count-1 backstop must suppress it
    'Marisol', 'Quentin', // person names on recommended_by → blocked by the `…by` actor deny
    'FollowUp', 'NoShow', // short free-text on PascalCase StatusNote → blocked by hard free-text on the normalized leaf
    'Yusuf', 'Priya', // staff names on cancellation_agent (lifecycle stem + role noun) → role-noun deny
    'Tobias', 'Ingrid', // staff names on nested membership.freeze_approver → role-noun deny on the leaf
  ];
  const rows: unknown[] = [];
  let i = 0;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const pushRow = (clientStatus: string, state: string, onHold: boolean, referral: string, tier: number, extra: Record<string, unknown>): void => {
    const id = 900001 + i; // numeric id VALUE — must never leak (it's a number → count-only)
    const first = `SECRET_FIRST_${i}`;
    const last = `SECRET_LAST_${i}`;
    const email = `secret_${i}@member.example`;
    const dues = 1000 + i + 0.42; // numeric dues VALUE — count-only
    const lastAtt = `2019-${pad((i % 12) + 1)}-${pad((i % 27) + 1)}`; // exact date VALUE — high-card + date guard
    const note = `SECRET_NOTE_${i}_home_address_detail`; // unique per row — high-cardinality → count-only
    const joinMonth = `2020-${pad((i % 3) + 1)}`; // low-card (3) but date-shaped → suppressed by per-value date guard
    planted.push(first, last, email, String(id), String(dues), lastAtt, note);
    rows.push({
      Id: id,
      FirstName: first,
      LastName: last,
      Email: email,
      client_status: clientStatus,
      membership_state: state,
      on_hold: onHold,
      referral_source: referral,
      tier, // numeric → count-only even at low cardinality
      join_month: joinMonth,
      last_attendance: lastAtt,
      monthly_dues: dues,
      note,
      assigned_coach: i % 2 === 0 ? 'Aniyah' : 'Bowen', // person name, low-card, NAME not admitted → withheld
      primary_coach: i % 2 === 0 ? 'Dario' : 'Elowen', // person name, low-card, NAME not admitted → withheld
      signup_comment: i % 2 === 0 ? 'OnlineAd' : 'PromoFlyer', // free-text NAME (no strong stem) → withheld
      gender: i % 2 === 0 ? 'M' : 'F', // low-card safe-shaped demographic — 'g-end-er' must NOT admit via \bend\b
      recommended_by: i % 2 === 0 ? 'Marisol' : 'Quentin', // actor `…by` field carrying person names → denied
      cancellation_agent: i % 2 === 0 ? 'Yusuf' : 'Priya', // lifecycle stem + role noun, staff names → role-noun deny
      StatusNote: i % 2 === 0 ? 'FollowUp' : 'NoShow', // PascalCase free-text — normalized leaf must catch 'note'
      // nested coach + approver under a state-named parent: the leaf gate must block them even though 'membership' is admitted
      membership: { state, plan_name: state === 'Active' ? 'Unlimited' : 'Paused Plan', assigned_coach: i % 2 === 0 ? 'Aniyah' : 'Bowen', freeze_approver: i % 2 === 0 ? 'Tobias' : 'Ingrid' },
      '90008888': 'x', // an ID-shaped FIELD NAME — must be redacted, never emitted
      ...extra,
    });
    i++;
  };
  for (let n = 0; n < ACTIVE_N; n++) pushRow('Active', 'Active', false, 'walk_in', 1, {});
  // freeze_reason present ONLY on frozen rows → exercises the PRESENCE separator (paused-like name).
  for (let n = 0; n < FROZEN_N; n++) pushRow('Inactive', 'Frozen', true, 'word_of_mouth', 2, { freeze_reason: 'StaffHold' });
  // cancellation_reason present ONLY on cancelled rows; 4×'Moved' (emits) + 1× count-1 (suppressed).
  for (let n = 0; n < CANCELLED_N; n++) pushRow('Inactive', 'Cancelled', false, 'friend@example.com', 3, { cancellation_reason: n === CANCELLED_N - 1 ? 'UNIQUE_PERSONAL_X' : 'Moved' });
  for (let n = 0; n < EXPIRED_N; n++) pushRow('Inactive', 'Expired', false, 'walk_in', 3, {});

  const ctx = freshCtx();
  tallyRecords(rows, ctx);
  const result = buildResult(ctx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: RECORD_ARRAY_KEY, pagesFetched: 1 });
  const serialized = JSON.stringify(result, null, 2);
  console.log(serialized);

  // (1) NO planted PII token may appear anywhere in output.
  const leaks = planted.filter((tok) => serialized.includes(tok));
  if (leaks.length > 0) {
    console.error(`SELFTEST FAIL: output contained disallowed token(s): ${[...new Set(leaks)].join(', ')}`);
    process.exit(1);
    return;
  }
  // Defense-in-depth: no email-like substring at all should survive in any emitted value.
  if (/@member\.example|friend@example/.test(serialized)) {
    console.error('SELFTEST FAIL: an email-like token survived in output.');
    process.exit(1);
    return;
  }

  const field = (name: string): FieldShape | undefined => result.fields.find((f) => f.field === name);
  const xtab = (f: FieldShape | undefined, value: string): ValueCrossTab | undefined => f?.values?.find((v) => v.value === value);

  const ms = field('membership_state');
  const oh = field('on_hold');
  const nestedState = field('membership.state');
  const planName = field('membership.plan_name');
  const referral = field('referral_source');
  const tier = field('tier');
  const note = field('note');
  const joinMonth = field('join_month');
  const lastAtt = field('last_attendance');
  const firstName = field('FirstName');
  const membership = field('membership');
  const assignedCoach = field('assigned_coach');
  const primaryCoach = field('primary_coach');
  const signupComment = field('signup_comment');
  const nestedCoach = field('membership.assigned_coach');
  const gender = field('gender');
  const recommendedBy = field('recommended_by');
  const statusNote = field('StatusNote');
  const cancellationAgent = field('cancellation_agent');
  const freezeApprover = field('membership.freeze_approver');
  const freezeReason = field('freeze_reason');
  const cancellationReason = field('cancellation_reason');
  const split = result.fieldsSubdividingInactive.find((s) => s.field === 'membership_state');
  const presenceFreeze = result.presenceSeparators.find((p) => p.field === 'freeze_reason');
  const presenceCancel = result.presenceSeparators.find((p) => p.field === 'cancellation_reason');
  const boolSignal = result.booleanSeparationSignals.find((s) => s.field === 'on_hold');

  const expectations: Array<[string, boolean]> = [
    // Census denominator + scan totals.
    ['statusBucketCounts == {active:8, inactive:12, other:0}', result.statusBucketCounts.active === 8 && result.statusBucketCounts.inactive === 12 && result.statusBucketCounts.other === 0],
    ['totalRecordsScanned == 20', result.totalRecordsScanned === 20],
    ['coverageComplete == true (all OK)', result.coverageComplete === true],

    // The string state enum surfaces with a correct client_status cross-tab.
    ['membership_state looksEnumLike + name-admitted + emits', !!ms && ms.looksEnumLike === true && ms.nameAdmitted === true && ms.values !== null],
    ['membership_state cardinality == 4', !!ms && ms.distinctCardinality === 4 && ms.cardinalityCapped === false],
    ['membership_state Active → active 8 / inactive 0', xtab(ms, 'Active')?.active === 8 && xtab(ms, 'Active')?.inactive === 0],
    ['membership_state Frozen → inactive 4 (paused_like)', xtab(ms, 'Frozen')?.inactive === 4 && xtab(ms, 'Frozen')?.semanticHint === 'paused_like'],
    ['membership_state Cancelled → inactive 5 (ended_like)', xtab(ms, 'Cancelled')?.inactive === 5 && xtab(ms, 'Cancelled')?.semanticHint === 'ended_like'],
    ['membership_state Expired → inactive 3 (ended_like)', xtab(ms, 'Expired')?.inactive === 3 && xtab(ms, 'Expired')?.semanticHint === 'ended_like'],
    ['membership_state emits exactly 4 value rows', ms?.values?.length === 4],

    // The boolean hold flag surfaces as true/false counts (PII-free), split by status.
    ['on_hold is a boolean field with values', !!oh && oh.booleanField === true && oh.values !== null],
    ['on_hold true → inactive 4', xtab(oh, 'true')?.inactive === 4 && xtab(oh, 'true')?.active === 0],
    ['on_hold false → active 8 / inactive 8', xtab(oh, 'false')?.active === 8 && xtab(oh, 'false')?.inactive === 8],
    ['on_hold emits exactly 2 value rows', oh?.values?.length === 2],

    // Nested membership object is inspected with the same guards.
    ['membership.state nested enum surfaces', !!nestedState && nestedState.looksEnumLike === true && nestedState.values !== null],
    ['membership.state Frozen → inactive 4', xtab(nestedState, 'Frozen')?.inactive === 4],
    ['membership.plan_name enum surfaces', !!planName && planName.values !== null && planName.distinctCardinality === 2],
    ['membership itself is type object (count-only)', !!membership && membership.types.includes('object') && membership.values === null],

    // The SHAPE gate suppresses PII-shaped fields → COUNT-ONLY.
    ['note count-only (cardinality capped)', !!note && note.cardinalityCapped === true && note.values === null && note.redactedValueLabel === REDACTED_VALUE_LABEL],
    ['referral_source count-only (one value is email-like)', !!referral && referral.values === null && referral.looksEnumLike === false],
    ['tier count-only (numeric, even at low cardinality)', !!tier && tier.values === null && tier.looksEnumLike === false && tier.types.includes('number')],
    ['join_month count-only (date-shaped, low cardinality)', !!joinMonth && joinMonth.values === null && joinMonth.looksEnumLike === false && joinMonth.distinctCardinality === 3 && joinMonth.cardinalityCapped === false],
    ['last_attendance count-only (date / high cardinality)', !!lastAtt && lastAtt.values === null],
    ['FirstName count-only (high-cardinality string)', !!firstName && firstName.values === null && firstName.types.includes('string')],

    // MUST-FIX 1 — NAME ALLOWLIST blocks person-name fields BY CONSTRUCTION (shape-emittable, but withheld).
    ['assigned_coach shape-emittable but values WITHHELD (name not admitted)', !!assignedCoach && (assignedCoach.looksEnumLike || assignedCoach.booleanField) && assignedCoach.nameAdmitted === false && assignedCoach.values === null && assignedCoach.shapeEmittableNameWithheld === true && assignedCoach.redactedValueLabel === NAME_WITHHELD_LABEL],
    ['primary_coach values WITHHELD (name not admitted)', !!primaryCoach && primaryCoach.values === null && primaryCoach.shapeEmittableNameWithheld === true],
    ['coach fields surfaced as vet-then-rerun candidates', result.vetThenRerunCandidates.includes('assigned_coach') && result.vetThenRerunCandidates.includes('primary_coach')],
    ['coach names absent from output', !/Aniyah|Bowen|Dario|Elowen/.test(serialized)],

    // MUST-FIX 2 — bare free-text NAME suppressed even though low-card + safe-shaped.
    ['signup_comment withheld (free-text name, no strong stem)', !!signupComment && signupComment.values === null && signupComment.nameAdmitted === false && signupComment.shapeEmittableNameWithheld === true],
    ['signup_comment values absent from output', !/OnlineAd|PromoFlyer/.test(serialized)],

    // ROUND 2 (A) — anchored short stems on the normalized leaf: substring lookalikes must NOT admit.
    ['gender withheld (g-end-er must not admit via \\bend\\b)', !!gender && gender.nameAdmitted === false && gender.values === null && gender.shapeEmittableNameWithheld === true],
    ['recommended_by withheld (actor `…by` deny)', !!recommendedBy && recommendedBy.nameAdmitted === false && recommendedBy.values === null && recommendedBy.shapeEmittableNameWithheld === true],
    ['recommended_by person names absent from output', !/Marisol|Quentin/.test(serialized)],

    // ROUND 2 (B) — nesting cascade closed: a state-named PARENT cannot admit an arbitrary child leaf.
    ['membership.assigned_coach withheld (leaf gate, not parent)', !!nestedCoach && nestedCoach.nameAdmitted === false && nestedCoach.values === null && nestedCoach.shapeEmittableNameWithheld === true],
    ['membership.assigned_coach in vetThenRerunCandidates', result.vetThenRerunCandidates.includes('membership.assigned_coach')],

    // ROUND 2 (C) — camelCase free-text caught on the normalized leaf.
    ['StatusNote withheld (PascalCase free-text)', !!statusNote && statusNote.nameAdmitted === false && statusNote.values === null && statusNote.shapeEmittableNameWithheld === true],
    ['StatusNote values absent from output', !/FollowUp|NoShow/.test(serialized)],
    ['round-2 withheld fields all in vetThenRerunCandidates', ['gender', 'recommended_by', 'StatusNote'].every((n) => result.vetThenRerunCandidates.includes(n))],

    // ROUND 3 — role-noun deny: a lifecycle stem must NOT admit a leaf ending in a person-role noun.
    ['cancellation_agent withheld (role noun beats cancel stem)', !!cancellationAgent && cancellationAgent.nameAdmitted === false && cancellationAgent.values === null && cancellationAgent.shapeEmittableNameWithheld === true],
    ['membership.freeze_approver withheld (role noun beats freeze stem, leaf-gated)', !!freezeApprover && freezeApprover.nameAdmitted === false && freezeApprover.values === null && freezeApprover.shapeEmittableNameWithheld === true],
    ['role-noun fields surfaced as vet-then-rerun candidates', ['cancellation_agent', 'membership.freeze_approver'].every((n) => result.vetThenRerunCandidates.includes(n))],
    ['role-noun staff names absent from output', !/Yusuf|Priya|Tobias|Ingrid/.test(serialized)],
    ['role-noun deny leaves the required EMIT list unchanged', ['hold_reason', 'end_reason', 'cancellation_reason', 'freeze_reason', 'on_hold', 'membership.state'].every((n) => isValueNameAdmitted(n))],

    // MUST-FIX 1 carve-out — free-text fields WITH a strong lifecycle stem STAY admitted and emit.
    ['freeze_reason admitted + emits (strong stem freeze)', !!freezeReason && freezeReason.nameAdmitted === true && freezeReason.values !== null],
    ['cancellation_reason admitted + emits (strong stem cancel)', !!cancellationReason && cancellationReason.nameAdmitted === true && cancellationReason.values !== null],

    // MUST-FIX 2 — count-1 value collapsed to (unique_value_suppressed), never emitted; count>=2 still emits.
    ['count-1 value never emitted', !/UNIQUE_PERSONAL_X/.test(serialized)],
    ['count-1 value collapsed to (unique_value_suppressed)', !!cancellationReason && (cancellationReason.values ?? []).some((v) => v.value === UNIQUE_VALUE_SUPPRESSED_LABEL && v.total === 1)],
    ['count>=2 value still emits (Moved × 4)', (cancellationReason?.values ?? []).some((v) => v.value === 'Moved' && v.total === 4)],

    // SHOULD-FIX — presence/absence separator: a field present only on a subset of Inactive.
    ['freeze_reason flagged as presence separator (paused-like; present only on frozen)', !!presenceFreeze && presenceFreeze.nameHint === 'paused_like' && presenceFreeze.presentInactive === 4 && presenceFreeze.absentInactive === 8 && presenceFreeze.presentActive === 0],
    ['cancellation_reason flagged as presence separator (ended-like)', !!presenceCancel && presenceCancel.nameHint === 'ended_like' && presenceCancel.presentInactive === 5],

    // SHOULD-FIX — boolean hold flag reviewable via a NAME-derived signal (semanticHintOf on true/false can't).
    ['on_hold surfaced as a boolean separation signal (paused-like name)', !!boolSignal && boolSignal.nameHint === 'paused_like' && boolSignal.trueInactive === 4],

    // ID-shaped field NAME redacted (counted, never emitted).
    ['id-shaped field name redacted', result.redactedFieldNameCount >= 1 && !result.fields.some((f) => f.field.includes('90008888'))],
    ['field types are categories only', !!ms && ms.types.every((t) => ['string', 'number', 'boolean', 'null', 'array', 'object'].includes(t))],

    // The decisive verdict (value-based strict separation from membership_state remains).
    ['membership_state subdivides Inactive (3 groups)', !!split && split.groups.length === 3],
    ['split: pausedLike 4 / endedLike 8', !!split && split.pausedLikeInactive === 4 && split.endedLikeInactive === 8],
    ['separationConfidence == strict', result.separationConfidence === 'strict'],
    ['canSeparatePausedFromEnded == true', result.canSeparatePausedFromEnded === true],
    ['recommendation == separation_candidate_found_review', result.recommendation === 'separation_candidate_found_review'],
    ['membership_state listed as emittable state candidate', result.emittableStateCandidates.includes('membership_state')],
    ['valueEmissionCaveat present in output', typeof result.valueEmissionCaveat === 'string' && result.valueEmissionCaveat.length > 0],
  ];
  const failed = expectations.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    console.error(`SELFTEST FAIL: behavioral expectation(s) not met: ${failed.join(' | ')}`);
    process.exit(1);
    return;
  }

  // (gate pins) The Reviewer-verified emit/block lists, asserted against isValueNameAdmitted directly so a
  // future gate edit cannot silently reopen a hole (or re-suppress a legitimate state field).
  const mustAdmit = [
    'membership_status', 'membership_state', 'client_status', 'on_hold', 'OnHold', 'hold_status',
    'freeze_reason', 'cancellation_reason', 'hold_reason', 'end_reason', 'plan', 'tier', 'standing',
    'membership.state',
  ];
  const mustWithhold = [
    'gender', 'recommended_by', 'referred_by_friend', 'household', 'threshold', 'explanation', 'frontier',
    'calendar', 'vendor', 'interactive', 'estate', 'membership.assigned_coach', 'membership.referral_source',
    'membership.emergency_contact', 'StatusNote', 'PlanComment', 'HoldMemo', 'cancelled_by', 'frozen_by',
    'cancellation_agent', 'freeze_approver', 'hold_manager',
  ];
  const wrongAdmit = mustWithhold.filter((n) => isValueNameAdmitted(n));
  const wrongWithhold = mustAdmit.filter((n) => !isValueNameAdmitted(n));
  if (wrongAdmit.length > 0 || wrongWithhold.length > 0) {
    console.error(
      `SELFTEST FAIL: name gate — wrongly admitted: [${wrongAdmit.join(', ')}]; wrongly withheld: [${wrongWithhold.join(', ')}]`,
    );
    process.exit(1);
    return;
  }

  // (2) Coverage / transport branches — coverageComplete must be FALSE whenever the scan is not whole,
  //     including the two shape-regression guards (renamed records key, empty record set).
  const emptyCtx = freshCtx();
  const partials: Array<[string, ClientsMembershipStateResult]> = [
    ['reachedPageCap', buildResult(ctx, { ...freshMeta(), jsonParseable: true, recordArrayKey: RECORD_ARRAY_KEY, pagesFetched: MAX_PAGES, reachedPageCap: true })],
    ['errorEnvelope', buildResult(ctx, { ...freshMeta(), jsonParseable: true, recordArrayKey: RECORD_ARRAY_KEY, pagesFetched: 1, errorEnvelopeDetected: true, embeddedHttpStatusClass: '4xx' })],
    ['non-2xx', buildResult(ctx, { ...freshMeta(), httpStatusClass: '4xx', jsonParseable: true, pagesFetched: 1 })],
    ['network_error', buildResult(emptyCtx, { ...freshMeta(), endpointReached: false, httpStatusClass: 'network_error', pagesFetched: 0 })],
    ['non-json', buildResult(emptyCtx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: false, pagesFetched: 0 })],
    ['zeroRecordsButKeySeen', buildResult(emptyCtx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: RECORD_ARRAY_KEY, pagesFetched: 1 })],
    ['recordArrayKeyNull', buildResult(ctx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: null, pagesFetched: 1 })],
  ];
  const badPartials = partials.filter(([, r]) => r.coverageComplete !== false).map(([name]) => name);
  if (badPartials.length > 0) {
    console.error(`SELFTEST FAIL: coverageComplete should be false for: ${badPartials.join(', ')}`);
    process.exit(1);
    return;
  }

  // (2b) Advisory-path isolation — pin the presence and boolean disjuncts INDEPENDENTLY. The main fixture
  //      verdict is 'strict', so without these, deleting either disjunct would still pass the self-test.
  // PRESENCE-only: freeze_reason exists ONLY on 2 of 5 Inactive (one value, count 2 — no value split
  // anywhere, no booleans) → advisory must come from presenceSeparators alone.
  const presCtx = freshCtx();
  tallyRecords(
    [
      { client_status: 'Active' }, { client_status: 'Active' }, { client_status: 'Active' },
      { client_status: 'Inactive', freeze_reason: 'StaffHold' }, { client_status: 'Inactive', freeze_reason: 'StaffHold' },
      { client_status: 'Inactive' }, { client_status: 'Inactive' }, { client_status: 'Inactive' },
    ],
    presCtx,
  );
  const presResult = buildResult(presCtx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: RECORD_ARRAY_KEY, pagesFetched: 1 });
  // BOOLEAN-only: on_hold true on ALL Inactive / false on ALL Active — the value cross-tab then has ONE
  // inactive group (no value split), so advisory must come from booleanSeparationSignals alone. The
  // all-false is_suspended flag must NOT signal (zero separation information).
  const boolCtx = freshCtx();
  tallyRecords(
    [
      { client_status: 'Active', on_hold: false, is_suspended: false }, { client_status: 'Active', on_hold: false, is_suspended: false },
      { client_status: 'Inactive', on_hold: true, is_suspended: false }, { client_status: 'Inactive', on_hold: true, is_suspended: false }, { client_status: 'Inactive', on_hold: true, is_suspended: false },
    ],
    boolCtx,
  );
  const boolResult = buildResult(boolCtx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: RECORD_ARRAY_KEY, pagesFetched: 1 });
  const advisoryExpectations: Array<[string, boolean]> = [
    ['presence-only: no value split', presResult.fieldsSubdividingInactive.length === 0],
    ['presence-only: freeze_reason fires (2 of 5 inactive, paused-like)', presResult.presenceSeparators.some((p) => p.field === 'freeze_reason' && p.nameHint === 'paused_like' && p.presentInactive === 2 && p.absentInactive === 3 && p.presentActive === 0)],
    ['presence-only: separationConfidence == advisory', presResult.separationConfidence === 'advisory' && presResult.canSeparatePausedFromEnded === true],
    ['presence-only: recommendation == separation_advisory_review', presResult.recommendation === 'separation_advisory_review'],
    ['boolean-only: no value split', boolResult.fieldsSubdividingInactive.length === 0],
    ['boolean-only: no presence separator', boolResult.presenceSeparators.length === 0],
    ['boolean-only: on_hold signals (trueInactive 3)', boolResult.booleanSeparationSignals.some((s) => s.field === 'on_hold' && s.nameHint === 'paused_like' && s.trueInactive === 3)],
    ['boolean-only: all-false is_suspended does NOT signal', !boolResult.booleanSeparationSignals.some((s) => s.field === 'is_suspended')],
    ['boolean-only: separationConfidence == advisory', boolResult.separationConfidence === 'advisory' && boolResult.canSeparatePausedFromEnded === true],
    ['boolean-only: recommendation == separation_advisory_review', boolResult.recommendation === 'separation_advisory_review'],
  ];
  const advisoryFailed = advisoryExpectations.filter(([, ok]) => !ok).map(([name]) => name);
  if (advisoryFailed.length > 0) {
    console.error(`SELFTEST FAIL: advisory-path expectation(s) not met: ${advisoryFailed.join(' | ')}`);
    process.exit(1);
    return;
  }

  // (3) Error-envelope detector — direct check (in-body HTTPCode → class only).
  const env = detectErrorEnvelope({ DeveloperMessage: 'x', ErrorCode: 'y', HTTPCode: 403, UserMessage: 'z' });
  if (!env.detected || env.embeddedStatusClass !== '4xx') {
    console.error('SELFTEST FAIL: error-envelope detector did not classify the synthetic envelope.');
    process.exit(1);
    return;
  }

  console.error(
    'SELFTEST PASS: name gate decides on the NORMALIZED LEAF (substring lookalikes, nested-parent cascade, ' +
      'camelCase free-text, actor `…by` fields, and role-noun leaves (cancellation_agent / freeze_approver) ' +
      'all blocked; reason-family + anchored state stems still admit; ' +
      'full emit/block lists pinned); count-1 values collapsed; presence + boolean advisory paths independently ' +
      'verified (all-false flags signal nothing); state enum + nested object + cross-tabs correct; no planted PII ' +
      'token in output; coverage + envelope branches verified; no network call made.',
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
        '--env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local scripts/wodify/clientsMembershipStateDiscovery.ts. ' +
        'No request was made.',
    );
    process.exit(1);
    return;
  }

  const { ctx, meta } = await scanAllClients(apiKey);
  const result = buildResult(ctx, meta);
  // ONLY the safe field-shape aggregate is printed — no rows, names, IDs, dates, dues, URLs, key, or raw bodies.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('clients membership-state discovery probe failed before producing a result (no data emitted).');
  process.exit(1);
});
