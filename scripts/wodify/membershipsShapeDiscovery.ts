/**
 * Wodify `/v1/memberships` FIELD-SHAPE DISCOVERY probe. LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ DISCOVERY, NOT A FEATURE. Enumerates the live `/memberships` field SHAPE so the #517 commitment │
 * │ -band probe can be fixed against the REAL payload. Touches no SPA / Supabase / card / schema.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Why (the #517 first live run was VOID — an instrument artifact, not a data finding):
 *   unclassifiedShare 0.68, ALL >=3-month commitment bands exactly 0, zero holds, 33% of active clients
 *   with no membership row. `month_to_month` populated only via the `len === 0` short-circuit, so
 *   `payment_plan` + `initial_commitment_length` resolve but `initial_commitment_time_unit` (its NAME or
 *   value vocabulary) does not — and the Wodify CSV export expressed commitment as `Commitment Total` /
 *   `Payment Plan Type` (NOT length+unit), so the API may use a different STRUCTURE entirely. This probe
 *   answers three questions from the live payload so the fix isn't another guess:
 *     1. COMMITMENT structure — the nested plan object's name + field names, plus the value VOCABULARY of
 *        the term/length/unit and plan-type fields — enough to tell whether commitment is length+unit, a
 *        single commitment_total integer (in months), or a plan-type string.
 *     2. STATUS / active / deleted / HOLD field names + their enum value vocabulary.
 *     3. The client-JOIN key field name on a membership row (to explain the 33% no-row).
 *
 * Construction + leak-safety MIRROR `scripts/wodify/clientsMembershipStateDiscovery.ts` (its proven
 * machinery is reused verbatim where identical): field NAME with an ID-like-key guard, type categories,
 * present/null/non-null counts, distinct-value cardinality, `looksEnumLike`, nested-object recursion under
 * the same guards, and distinct VALUES emitted ONLY for low-cardinality enum-like fields whose NAME is
 * allowlisted — with ID/date/PII-shaped values redacted, count-1 quasi-identifiers collapsed, and the same
 * field-agnostic leak guard (no '@', no ISO date, no 7+ digit run; aborts the print on any leak).
 *
 * TWO DELIBERATE, NARROW EXTENSIONS vs the reference (called out for the Reviewer gate; both are closed by
 * construction and proven suppressed-vs-emitted in --selftest):
 *   (A) NUMERIC commitment-length vocabulary. The reference holds ALL numbers count-only. Here a field
 *       whose leaf NAME is a commitment DURATION-QUANTITY (length/duration/term/months/weeks/days/cycle/
 *       interval/period) in a commit/contract/renew/plan CONTEXT, with NO money word (total/amount/price/
 *       cost/value/fee/dues/rate/…), whose distinct values are ALL integers in [0, 366] and low-cardinality,
 *       emits those small integers. This surfaces "is it {1,3,6,12,24} months?" while pricing stays
 *       protected: `commitment_total` (money word) and `monthly_dues` are count-only by NAME; ids/dates/
 *       decimals are out of range or non-integer; the 7+-digit leak guard backs it. Small commitment
 *       integers (0–366) are not identifying.
 *   (B) CATALOG name/title/label vocabulary. Product/plan names ("BJJ Unlimited", "12-Month Commitment")
 *       are the gym's public catalog, not PII, and are the core deliverable. A `name`/`title`/`label` leaf
 *       emits ONLY when the leaf OR its immediate PARENT segment carries catalog context (plan/payment/
 *       membership/product/package/program/subscription/…) AND the leaf carries NO person context
 *       (client/member/customer/user/person/first/last/contact/guardian/parent/emergency/holder/payer/…).
 *       So `payment_plan.name` emits; `client_name` / `member_name` / `first_name` / nested person names do
 *       NOT. This is the ONLY relaxation of the reference's strict leaf-only rule, scoped to catalog labels,
 *       and person names are ALSO caught by the cardinality gate (high-card across the member set) + the
 *       count-1 backstop.
 *
 * Safety contract (identical posture to the reference):
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`, never CI.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, logged, printed, or
 *     echoed in errors. If unset/empty, exits WITHOUT a request (never sources it from Supabase / the edge).
 *   - Paginated GET `/memberships` (x-api-key header, page cap). No per-id calls, no writes, no Supabase,
 *     no CSV. Body is read in memory to derive aggregates, then discarded; never logged or returned as text.
 *   - Emits ONLY field NAMES, type categories, counts / cardinality / booleans, bounded enum + small-int
 *     VOCAB, and derived hints. NEVER a client name / id / email / phone / exact date / dues / raw row /
 *     echoed body / request URL / header / key. No intermediate raw files written.
 *   - `--selftest` runs FIRST, makes NO network call and reads NO env key (synthetic in-memory fixtures with
 *     planted PII/id/date/token sentinels proven suppressed).
 *
 * Candidate field-NAME lists below are SEEDS for classification only (from the CSV export header + the #517
 * directive's assumed names — no authoritative Wodify API doc was available). Discovery enumerates EVERY
 * field regardless; the seeds only sort discovered fields into focused commitment/status/hold/join buckets.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it):
 *   Network-free safe-output self-test FIRST (makes NO request, needs NO key):
 *     npx tsx scripts/wodify/membershipsShapeDiscovery.ts --selftest
 *   Live run (GATED — needs a separate explicit go; NOT this session):
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/membershipsShapeDiscovery.ts
 *   See scripts/wodify/README.md.
 */

// ─── CONFIG — request shape mirrors the reference probe / the shipped #517 pull ─────────────────────
const BASE_URL = 'https://api.wodify.com/v1';
const MEMBERSHIPS_PATH = '/memberships';
const PAGE_SIZE = 100; // Wodify caps at 100/page.
const MAX_PAGES = 50; // safety bound; reachedPageCap flags a partial scan.
const REQUEST_TIMEOUT_MS = 15000;
// `/memberships` record-array key is unprofiled — detect among candidates (first Array match wins); a bare
// root array is supported too. #517 proved the endpoint paginates via `pagination.has_more`.
const RECORD_ARRAY_KEY_CANDIDATES = ['memberships', 'data', 'results', 'result', 'items', 'records', 'value', 'rows'];

// Enum gate — distinct values emit ONLY when a field is low-cardinality AND every value passes the per-value
// safety test. Real PII is high-cardinality across the membership set, so this excludes it structurally.
const MAX_ENUM_DISTINCT = 15;
const CARDINALITY_TRACK_CAP = MAX_ENUM_DISTINCT + 1; // 16 — bounds in-memory transient values to <=16/field.
const MAX_ENUM_VALUE_LEN = 60; // plan labels can be long ("12-Month Unlimited BJJ Membership").
const MAX_NEST_DEPTH = 3; // recurse into nested objects (membership -> payment_plan -> field).
const MAX_DURATION_VALUE = 366; // extension (A): commitment-length integers 0..366 emit; excludes years/ids/dues.

const EMAIL_LIKE = /@/;
const REDACTED_VALUE_LABEL = '(redacted_count_only)'; // values shape-suppressed (high-card/mixed/PII-shaped).
const NAME_WITHHELD_LABEL = '(count_only_name_not_admitted_vet_then_rerun)'; // shape-emittable but NAME not admitted.
const UNIQUE_VALUE_SUPPRESSED_LABEL = '(unique_value_suppressed)'; // count-1 quasi-identifier collapse target.
const EMPTY_STRING_LABEL = '(empty_string)';

// §5 / #423: Wodify error-envelope markers (matched case-insensitively; values NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// ─── Value-emission NAME gate (closed BY CONSTRUCTION — the output JSON is chat-logged at emission) ──
// General allowlist over the NORMALIZED LEAF (camelCase split; `_`/`.`/digits -> spaces). Membership +
// commitment vocabulary. `\bname\b`/`title`/`label` are handled by the catalog-name branch, NOT here, so a
// bare person `name` cannot slip in via the general list.
const MEMBERSHIP_NAME_ALLOWLIST =
  /status|state|membership|freeze|frozen|paus|cancel|suspen|expir|inactive|enroll|commit|term|renew|contract|obligation|delet|archiv|deactiv|\bplan\b|\btier\b|\btype\b|\bunit\b|\bcycle\b|\binterval\b|\bperiod\b|frequenc|billing|schedule|program|category|\bactive\b|\bstanding\b|\bhold\b|\bend(ed|ing|s)?\b/i;
// Hard free-text suffixes — NEVER value-admitted (genuinely free text; an enum is not named like this).
const HARD_FREE_TEXT_NAME_PATTERN = /(^|[\s._])(note|notes|comment|comments|memo|memos|desc|description|descriptions)$/i;
// Reason-family — admitted ONLY with a strong lifecycle stem (freeze_reason yes; bare reason no).
const REASON_NAME_PATTERN = /(^|[\s._])reasons?$/i;
const STRONG_LIFECYCLE_STEMS = /freeze|frozen|\bhold\b|paus|cancel|suspen|expir|\bend(ed|ing|s)?\b|terminat/i;
// Actor `…by` (cancelled_by / sold_by / created_by) holds a person NAME — never value-admitted.
const ACTOR_BY_NAME_PATTERN = /(^|\s)by$/i;
// Role/relationship nouns that hold person NAMES — a lifecycle stem must not admit them.
const ROLE_NOUN_NAME_PATTERN =
  /(^|\s)(coach|trainer|instructor|agent|rep|representative|approver|manager|owner|advisor|consultant|staff|employee|sales|contact|guardian|parent|emergency|holder|payer)$/i;

// Catalog-name branch (extension B): a name/title/label leaf emits ONLY under catalog context and with NO
// person context. This is the ONE place a PARENT segment can grant admission — scoped to catalog labels.
const NAME_TITLE_LABEL = /\b(name|title|label)\b/i;
const CATALOG_CONTEXT = /\b(plan|payment|membership|product|package|program|subscription|offering|service|tier|contract)\b/i;
const PERSON_CONTEXT =
  /\b(client|member|customer|user|person|first|last|middle|full|given|sur|maiden|nick|display|contact|guardian|parent|emergency|payer|holder|primary|billing|owner|spouse|kid|child)\b/i;

// Numeric commitment-length vocabulary (extension A): duration QUANTITY, in a commit/contract/renew context,
// with NO money word. `initial_commitment_length` yes; `commitment_total` / `monthly_dues` no.
const DURATION_QTY_NAME = /\b(length|duration|term|months?|weeks?|days?|cycles?|intervals?|periods?)\b/i;
const COMMIT_CONTEXT_NAME = /commit|contract|renew|obligation|term|length|duration|\bplan\b/i;
const MONEY_NAME =
  /total|amount|price|cost|value|fee|dues|rate|balance|paid|charge|dollar|\bsum\b|revenue|deposit|owed|invoice|payment(?!.*plan)/i;

// Field-ROLE classification patterns (operate on the SAFE full field path; emit NAMES only, never values).
const COMMITMENT_FIELD_PATTERN = /commit|term|length|duration|renew|contract|obligation|\bplan\b|\btier\b|\bcycle\b|\binterval\b|\bperiod\b|frequenc|billing|schedule/i;
const STATUS_FIELD_PATTERN = /status|state|\bactive\b|inactive|\bdeleted?\b|expir|cancel|terminat|enroll|standing/i;
const HOLD_FIELD_PATTERN = /\bhold\b|freeze|frozen|paus|suspend|vacation|leave|defer|absence/i;
const JOIN_FIELD_PATTERN = /^(client|member|customer|user|person)[\s_]?(id|guid|uuid|key|ref|number|no)$|^client$/i;

// Travels in every result as defense-in-depth (NOT the control — the structural guards above are).
const VALUE_EMISSION_CAVEAT =
  'Value emission is closed BY CONSTRUCTION: string values[] emit only for fields whose NORMALIZED LEAF is on ' +
  'the membership/commitment allowlist (…by actor fields, role/relationship nouns, and note/comment/memo/desc ' +
  'names never emit); name/title/label leaves emit only under catalog context with no person context; numeric ' +
  'values emit only for commitment DURATION-QUANTITY fields (no money word) with all values integers in ' +
  '[0,366]; count-1 values collapse to (unique_value_suppressed). Pricing (commitment_total / monthly_dues), ' +
  'ids, exact dates, and person names are excluded by name + shape + cardinality. Defense-in-depth, NOT the ' +
  'control. A human should still confirm emitted values before any downstream use.';

// ─── Safe output contract ────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';
type TypeCategory = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
type FieldRole = 'commitment' | 'status' | 'hold' | 'join';
type CommitmentStructureHint =
  | 'length_plus_unit' // a length/term quantity field AND a separate unit field.
  | 'single_total_or_count' // a single commitment length/total field, no companion unit.
  | 'plan_type_string_only' // only a plan-type/plan-name string carries the commitment signal.
  | 'ambiguous' // multiple partial signals; a human must read the evidence fields.
  | 'not_found'; // no commitment-looking field discovered (likely a deeper shape mismatch).

// One distinct value + its occurrence count (NOT a cross-tab — there is no membership-level binary baseline).
interface ValueCount {
  value: string; // a SAFE enum label / small integer / '(…)' label — never a high-cardinality / PII-shaped string.
  count: number;
}

// One discovered field's shape evidence. `values` is non-null ONLY when the field passed the shape gate AND
// the name gate (string allowlist / catalog-name branch / numeric-duration branch).
interface FieldShape {
  field: string; // SAFE dot-path name (ID-like segments redacted); never a value.
  types: TypeCategory[]; // observed type categories (sorted), including 'null' if any null seen.
  presentCount: number; // records in which the key was present.
  nonNullCount: number;
  nullCount: number; // present but null/undefined.
  distinctCardinality: number; // exact when not capped; the cap value when capped (a floor).
  cardinalityCapped: boolean; // true ⇒ >= CARDINALITY_TRACK_CAP distinct values (definitely not enum-like).
  looksEnumLike: boolean; // low-cardinality + every value a safe short non-PII string.
  booleanField: boolean; // every non-null value is a boolean (emitted as true/false counts — PII-free).
  numericDurationVocab: boolean; // extension (A): a commitment-length integer field whose small ints emit.
  nameAdmitted: boolean; // field NAME is admitted for value emission.
  roles: FieldRole[]; // commitment / status / hold / join — focuses the human's attention.
  values: ValueCount[] | null; // distinct values + counts — ONLY when shape-emittable AND name-admitted.
  redactedValueLabel: string | null; // set (and values null) when value emission is suppressed; says why.
}

interface MembershipsShapeResult {
  probe: 'membershipsShapeDiscovery';
  path: string; // PATH only — never a query string / substituted URL.
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  jsonParseable: boolean | null;
  recordArrayKey: string | null; // which container key held the record array ('(root)' for a bare array).
  pagesFetched: number;
  reachedPageCap: boolean;
  coverageComplete: boolean; // true ONLY for a whole clean scan — discovery is exhaustive.
  totalRecordsScanned: number;

  fieldCount: number; // distinct SAFE field paths discovered.
  redactedFieldNameCount: number; // distinct ID-like field NAMES suppressed (counted, never emitted).
  fields: FieldShape[]; // every discovered field (sorted by path).

  // Focused answers to the three discovery questions (NAMES only; the fields[] carry the vocab + counts).
  commitmentFields: string[]; // fields whose NAME looks commitment/term/length/plan-bearing.
  statusFields: string[];
  holdFields: string[];
  joinKeyFields: string[]; // client-join key candidates on a membership row (values never emitted).
  commitmentStructure: {
    hasLengthOrTermField: boolean;
    hasUnitField: boolean;
    hasTotalField: boolean; // a commitment_total-style field (often MONEY — its values stay count-only).
    hasPlanTypeField: boolean;
    hasPlanNameField: boolean;
    hint: CommitmentStructureHint;
  };
  valueEmissionCaveat: string;
  recommendation: string; // machine-friendly tag (the human/Reviewer make the real call).
}

// ─── Pure helpers (verbatim from clientsMembershipStateDiscovery.ts — none emit, log, or retain values) ─
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
// ID-like KEY guard (field NAMES) — a value-shaped key can never leak as a "name".
function isIdLikeKey(key: string): boolean {
  if (key.length > 40) return true;
  if (/^\d{3,}$/.test(key)) return true;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(key)) return true;
  if (/^[0-9a-fA-F]{12,}$/.test(key)) return true;
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(key) && !/[a-z].*[A-Z]|_|-/.test(key)) return true;
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
  return 'string';
}
// Per-VALUE safety for string emission — a value is emittable ONLY if it cannot plausibly be PII.
function looksIdLikeValue(s: string): boolean {
  if (/^\d{3,}$/.test(s)) return true;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) return true;
  if (/^[0-9a-fA-F]{12,}$/.test(s)) return true;
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(s) && !/[a-z].*[A-Z]|_|-/.test(s)) return true;
  return false;
}
function looksDateLike(s: string): boolean {
  return (
    /\d{4}-\d{2}-\d{2}/.test(s) ||
    /^\d{4}-\d{2}$/.test(s) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(s) ||
    /\d{1,2}:\d{2}/.test(s)
  );
}
function looksNumericOrCurrency(s: string): boolean {
  return /^[$€£]?\s?-?\d[\d,]*(\.\d+)?%?$/.test(s.trim());
}
function isSafeEnumValue(s: string): boolean {
  if (s.length > MAX_ENUM_VALUE_LEN) return false;
  if (EMAIL_LIKE.test(s)) return false;
  if (looksIdLikeValue(s)) return false;
  if (looksDateLike(s)) return false;
  if (looksNumericOrCurrency(s)) return false;
  return true;
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
    const code = Number(parsed[httpCodeKey]);
    if (Number.isFinite(code) && code >= 100 && code < 600) embeddedStatusClass = statusClassOf(code);
  }
  return { detected, embeddedStatusClass };
}
// Normalize a field path/leaf: split camelCase, and treat `_` `.` and digits as separators so `\b`-anchored
// stems match on_hold / OnHold / hold_status alike.
function normalizeForHint(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[._\d]+/g, ' ');
}

// Field-agnostic leak scan — ISO date, '@', or a 7+ digit run must never reach stdout.
function leaks(serialized: string): boolean {
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) return true;
  if (serialized.includes('@')) return true;
  if (/\d{7,}/.test(serialized)) return true;
  return false;
}

// ─── Name gates ─────────────────────────────────────────────────────────────────────────────────────
// Catalog-name branch (extension B): null ⇒ "not a name/title/label field, defer to the general allowlist";
// true/false ⇒ decided here. The ONLY place a PARENT segment can grant admission — scoped to catalog labels,
// and blocked whenever the leaf carries person context.
function catalogNameDecision(fieldPath: string): boolean | null {
  const segs = fieldPath.split('.');
  const leaf = normalizeForHint(segs[segs.length - 1]);
  const parent = segs.length >= 2 ? normalizeForHint(segs[segs.length - 2]) : '';
  if (!NAME_TITLE_LABEL.test(leaf)) return null; // not a name/title/label field
  if (PERSON_CONTEXT.test(leaf)) return false; // client_name / member_name / first_name / contact_name …
  return CATALOG_CONTEXT.test(leaf) || CATALOG_CONTEXT.test(parent); // payment_plan.name / plan_name …
}

// Is STRING/boolean value emission admitted for this field NAME? Decided on the NORMALIZED LEAF (leaf-only,
// except the catalog-name branch which may consult the parent). Denies first, then catalog-name, then the
// general allowlist. Fail closed.
function isValueNameAdmitted(fieldPath: string): boolean {
  const leaf = fieldPath.split('.').pop() ?? fieldPath;
  const n = normalizeForHint(leaf).trim();
  if (ACTOR_BY_NAME_PATTERN.test(n)) return false;
  if (ROLE_NOUN_NAME_PATTERN.test(n)) return false;
  if (HARD_FREE_TEXT_NAME_PATTERN.test(n)) return false;
  if (REASON_NAME_PATTERN.test(n)) return STRONG_LIFECYCLE_STEMS.test(n);
  const cat = catalogNameDecision(fieldPath);
  if (cat !== null) return cat;
  return MEMBERSHIP_NAME_ALLOWLIST.test(n);
}

// Is NUMERIC small-integer vocabulary admitted for this field NAME? (extension A) — a commitment DURATION
// QUANTITY in a commit/contract/renew context, with NO money word. Leaf-only.
function isDurationQtyNameAdmitted(fieldPath: string): boolean {
  const leaf = fieldPath.split('.').pop() ?? fieldPath;
  const n = normalizeForHint(leaf).trim();
  if (MONEY_NAME.test(n)) return false;
  return DURATION_QTY_NAME.test(n) && COMMIT_CONTEXT_NAME.test(n);
}

function rolesOf(fieldPath: string): FieldRole[] {
  const n = normalizeForHint(fieldPath);
  const roles: FieldRole[] = [];
  // Join is decided on the LEAF (a whole `client_id`-style key), not a substring of a longer path.
  const leaf = fieldPath.split('.').pop() ?? fieldPath;
  if (JOIN_FIELD_PATTERN.test(leaf)) roles.push('join');
  if (HOLD_FIELD_PATTERN.test(n)) roles.push('hold');
  if (STATUS_FIELD_PATTERN.test(n)) roles.push('status');
  if (COMMITMENT_FIELD_PATTERN.test(n)) roles.push('commitment');
  return roles;
}

// ─── Field accumulation (pure; the self-test exercises this exact path with synthetic PII) ─────────
interface FieldAcc {
  types: Set<TypeCategory>;
  presentCount: number;
  nonNullCount: number;
  nullCount: number;
  distinct: Map<string, number>; // canonical value string -> count; capped at CARDINALITY_TRACK_CAP
  cardinalityCapped: boolean;
  sawString: boolean;
  sawBoolean: boolean;
  sawNumber: boolean;
  sawOtherType: boolean; // object/array value seen → blocks value emission (count-only)
  anyUnsafeStringValue: boolean; // a string value failed isSafeEnumValue → blocks string emission
  numericAllSmallInt: boolean; // every numeric value is an integer in [0, MAX_DURATION_VALUE]
}
function freshFieldAcc(): FieldAcc {
  return {
    types: new Set(),
    presentCount: 0,
    nonNullCount: 0,
    nullCount: 0,
    distinct: new Map(),
    cardinalityCapped: false,
    sawString: false,
    sawBoolean: false,
    sawNumber: false,
    sawOtherType: false,
    anyUnsafeStringValue: false,
    numericAllSmallInt: true,
  };
}
interface ScanCtx {
  fields: Map<string, FieldAcc>;
  redactedFieldNames: Set<string>; // distinct ID-like field NAMES (in memory only; only the COUNT is emitted)
  totalRecordsScanned: number;
}
function freshCtx(): ScanCtx {
  return { fields: new Map(), redactedFieldNames: new Set(), totalRecordsScanned: 0 };
}
function trackDistinct(fa: FieldAcc, canonical: string): void {
  const existing = fa.distinct.get(canonical);
  if (existing !== undefined) { fa.distinct.set(canonical, existing + 1); return; }
  if (fa.distinct.size >= CARDINALITY_TRACK_CAP) { fa.cardinalityCapped = true; return; }
  fa.distinct.set(canonical, 1);
}
function accumulateValue(fa: FieldAcc, v: unknown): void {
  if (v === null || v === undefined) {
    fa.nullCount += 1;
    fa.types.add('null');
    return;
  }
  fa.nonNullCount += 1;
  const cat = typeCategoryOf(v);
  fa.types.add(cat);
  if (cat === 'object' || cat === 'array') { fa.sawOtherType = true; return; } // recursed separately; never emits
  if (cat === 'number') {
    fa.sawNumber = true;
    const num = v as number;
    if (!(Number.isInteger(num) && num >= 0 && num <= MAX_DURATION_VALUE)) fa.numericAllSmallInt = false;
    trackDistinct(fa, `n:${String(num)}`);
    return;
  }
  if (cat === 'boolean') {
    fa.sawBoolean = true;
    trackDistinct(fa, (v as boolean) ? 'true' : 'false');
    return;
  }
  // string
  fa.sawString = true;
  const s = v as string;
  if (!isSafeEnumValue(s)) fa.anyUnsafeStringValue = true;
  trackDistinct(fa, `s:${s}`); // raw string held (capped); emitted only if the field passes every gate
}
// Walk a record's fields, recursing into nested plain objects up to MAX_NEST_DEPTH.
function walkRecord(obj: Record<string, unknown>, prefix: string, level: number, ctx: ScanCtx): void {
  for (const [k, v] of Object.entries(obj)) {
    if (isIdLikeKey(k)) { ctx.redactedFieldNames.add(prefix ? `${prefix}.${k}` : k); continue; }
    const path = prefix ? `${prefix}.${k}` : k;
    let fa = ctx.fields.get(path);
    if (!fa) { fa = freshFieldAcc(); ctx.fields.set(path, fa); }
    fa.presentCount += 1;
    accumulateValue(fa, v);
    if (isPlainObject(v) && level < MAX_NEST_DEPTH) walkRecord(v, path, level + 1, ctx);
  }
}
function tallyRecords(records: readonly unknown[], ctx: ScanCtx): void {
  for (const rec of records) {
    ctx.totalRecordsScanned += 1;
    if (isPlainObject(rec)) walkRecord(rec, '', 0, ctx);
  }
}

// ─── Build the safe result from accumulated field stats (pure) ─────────────────────────────────────
function displayCanonical(canonical: string): string {
  if (canonical === 'true' || canonical === 'false') return canonical;
  if (canonical.startsWith('n:')) return canonical.slice(2); // small integer — emitted only for admitted fields
  if (canonical.startsWith('s:')) {
    const raw = canonical.slice(2);
    return raw === '' ? EMPTY_STRING_LABEL : raw;
  }
  return canonical;
}
function buildFieldShape(field: string, fa: FieldAcc): FieldShape {
  const types = [...fa.types].sort();
  const distinctCardinality = fa.cardinalityCapped ? CARDINALITY_TRACK_CAP : fa.distinct.size;
  const booleanField = fa.sawBoolean && !fa.sawString && !fa.sawNumber && !fa.sawOtherType;
  const looksEnumLike =
    !fa.cardinalityCapped &&
    fa.distinct.size <= MAX_ENUM_DISTINCT &&
    fa.sawString &&
    !fa.sawNumber &&
    !fa.sawBoolean &&
    !fa.sawOtherType &&
    !fa.anyUnsafeStringValue;
  const numericDurationVocab =
    !fa.cardinalityCapped &&
    fa.distinct.size <= MAX_ENUM_DISTINCT &&
    fa.sawNumber &&
    !fa.sawString &&
    !fa.sawBoolean &&
    !fa.sawOtherType &&
    fa.numericAllSmallInt &&
    isDurationQtyNameAdmitted(field);

  const stringOrBoolAdmitted = (looksEnumLike || booleanField) && isValueNameAdmitted(field);
  const emitValues = stringOrBoolAdmitted || numericDurationVocab;
  const shapeEmittable = looksEnumLike || booleanField;
  const nameAdmitted = isValueNameAdmitted(field);

  let values: ValueCount[] | null = null;
  let redactedValueLabel: string | null = null;
  if (emitValues) {
    const rows: ValueCount[] = [];
    let suppressed = 0; // count-1 quasi-identifiers collapse here
    let anySuppressed = false;
    for (const [canonical, count] of fa.distinct) {
      if (count === 1) { suppressed += 1; anySuppressed = true; continue; }
      rows.push({ value: displayCanonical(canonical), count });
    }
    if (anySuppressed) rows.push({ value: UNIQUE_VALUE_SUPPRESSED_LABEL, count: suppressed });
    rows.sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    values = rows;
  } else if (shapeEmittable && !nameAdmitted) {
    redactedValueLabel = NAME_WITHHELD_LABEL; // shape-emittable but NAME not admitted → vet-then-rerun
  } else {
    redactedValueLabel = REDACTED_VALUE_LABEL; // high-card / numeric-non-duration / object / unsafe value
  }

  return {
    field,
    types,
    presentCount: fa.presentCount,
    nonNullCount: fa.nonNullCount,
    nullCount: fa.nullCount,
    distinctCardinality,
    cardinalityCapped: fa.cardinalityCapped,
    looksEnumLike,
    booleanField,
    numericDurationVocab,
    nameAdmitted,
    roles: rolesOf(field),
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

// Derive the commitment-structure hint from discovered field NAMES (advisory; the human reads the evidence).
function deriveCommitmentStructure(fields: FieldShape[]): MembershipsShapeResult['commitmentStructure'] {
  const leaf = (f: FieldShape): string => normalizeForHint(f.field.split('.').pop() ?? f.field);
  const hasLengthOrTermField = fields.some((f) => {
    const n = leaf(f);
    return DURATION_QTY_NAME.test(n) && COMMIT_CONTEXT_NAME.test(n) && !MONEY_NAME.test(n);
  });
  const hasUnitField = fields.some((f) => {
    const n = leaf(f);
    return /\bunit\b/.test(n) && (COMMIT_CONTEXT_NAME.test(n) || /time|term/.test(n));
  });
  const hasTotalField = fields.some((f) => {
    const n = leaf(f);
    return /\btotal\b/.test(n) && COMMIT_CONTEXT_NAME.test(n);
  });
  const hasPlanTypeField = fields.some((f) => {
    const n = leaf(f);
    return /\btype\b/.test(n) && /plan|payment|membership|commit/.test(n);
  });
  const hasPlanNameField = fields.some((f) => catalogNameDecision(f.field) === true);

  let hint: CommitmentStructureHint;
  if (hasLengthOrTermField && hasUnitField) hint = 'length_plus_unit';
  else if (hasLengthOrTermField || hasTotalField) hint = 'single_total_or_count';
  else if (hasPlanTypeField || hasPlanNameField) hint = 'plan_type_string_only';
  else if (hasUnitField) hint = 'ambiguous';
  else hint = 'not_found';

  return { hasLengthOrTermField, hasUnitField, hasTotalField, hasPlanTypeField, hasPlanNameField, hint };
}

function buildResult(ctx: ScanCtx, meta: TransportMeta): MembershipsShapeResult {
  const fields = [...ctx.fields.entries()]
    .map(([field, fa]) => buildFieldShape(field, fa))
    .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));

  const byRole = (role: FieldRole): string[] => fields.filter((f) => f.roles.includes(role)).map((f) => f.field);
  const commitmentFields = byRole('commitment');
  const statusFields = byRole('status');
  const holdFields = byRole('hold');
  const joinKeyFields = byRole('join');
  const commitmentStructure = deriveCommitmentStructure(fields);

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
  else if (joinKeyFields.length === 0) recommendation = 'no_join_key_field_found_investigate';
  else if (commitmentStructure.hint === 'not_found') recommendation = 'no_commitment_field_found_investigate';
  else recommendation = 'shape_discovered_patch_517_field_names_then_rerun';

  return {
    probe: 'membershipsShapeDiscovery',
    path: MEMBERSHIPS_PATH,
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
    fieldCount: fields.length,
    redactedFieldNameCount: ctx.redactedFieldNames.size,
    fields,
    commitmentFields,
    statusFields,
    holdFields,
    joinKeyFields,
    commitmentStructure,
    valueEmissionCaveat: VALUE_EMISSION_CAVEAT,
    recommendation,
  };
}

// ─── Live network layer (body read for shape derivation only; never logged / returned as text) ────
function extractRecordArray(parsed: unknown): { records: unknown[]; key: string | null } {
  if (Array.isArray(parsed)) return { records: parsed, key: '(root)' };
  if (!isPlainObject(parsed)) return { records: [], key: null };
  for (const k of RECORD_ARRAY_KEY_CANDIDATES) {
    if (Array.isArray(parsed[k])) return { records: parsed[k] as unknown[], key: k };
  }
  return { records: [], key: null };
}

async function scanAllMemberships(apiKey: string): Promise<{ ctx: ScanCtx; meta: TransportMeta }> {
  const ctx = freshCtx();
  const meta = freshMeta();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(BASE_URL + MEMBERSHIPS_PATH);
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
      meta.httpStatusClass = 'network_error'; // never log the error (it can echo the URL/host)
      return { ctx, meta };
    }

    meta.httpStatusClass = statusClassOf(res.status);
    if (!res.ok) return { ctx, meta }; // non-2xx — stop; coverage incomplete

    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
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

    const { records, key } = extractRecordArray(parsed);
    if (meta.recordArrayKey === null && key !== null) meta.recordArrayKey = key;
    tallyRecords(records, ctx);
    meta.pagesFetched += 1;

    const pagination = isPlainObject(parsed) ? parsed['pagination'] : undefined;
    const hasMore = isPlainObject(pagination) && pagination['has_more'] === true;
    if (!hasMore || records.length === 0) break;
    if (page === MAX_PAGES) meta.reachedPageCap = true; // more pages exist but we hit the safety bound
  }

  return { ctx, meta };
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO key) ─────────
function runSelfTest(): void {
  const fail = (msg: string): void => { console.error(`SELFTEST FAIL: ${msg}`); process.exit(1); };

  // Planted PII / secrets — NONE may appear anywhere in output.
  const planted: string[] = [
    'secret@member.example', '2026-05-01', '2026-01-15', // email + exact dates
    'sk_live_DEADBEEFCAFE1234', 'Bearer_TOKEN_XYZ', // secret-looking tokens
    'Aniyah', 'Bowen', 'Dario', 'Elowen', // coach person names (role-noun / actor fields)
    'Marisol', 'Quentin', // created_by actor names
    'UNIQUE_PERSON_ZZ', // a count-1 person value inside an ADMITTED field → count-1 backstop
    'Priya Patel', 'Yusuf Adeyemi', // member/guardian person names (person-context name fields)
  ];

  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const rows: unknown[] = [];
  // 20 memberships: a nested payment_plan carrying commitment fields (length+unit + money total + plan
  // type + catalog name), plus row-level status/active/deleted/hold + a client-join key + PII.
  const PLAN_NAMES = ['Monthly Unlimited', '12-Month BJJ', '6-Month BJJ', 'Drop-in Pack'];
  const PLAN_TYPES = ['Recurring', 'Prepaid', 'Pack'];
  const STATUSES = ['Active', 'Cancelled', 'Frozen'];
  for (let i = 0; i < 20; i++) {
    const clientId = 9000001 + i; // 7-digit client id VALUE — never emitted (numeric out of range + 7+ guard)
    const membershipId = 80000001 + i; // 8-digit membership id VALUE
    const bucket = i % 4;
    const lengthMonths = [0, 12, 6, 0][bucket]; // small commitment integers → numeric-duration vocab
    const commitmentTotalDollars = [0, 2148, 1074, 400][bucket]; // MONEY (dollars) → must stay count-only
    const planName = PLAN_NAMES[bucket];
    const planType = PLAN_TYPES[i % 3];
    const status = STATUSES[i % 3];
    const startDate = `2026-${pad((i % 12) + 1)}-15`; // exact date VALUE — high-card + date guard
    const memberName = i % 2 === 0 ? 'Priya Patel' : 'Yusuf Adeyemi'; // person name on a person-context field
    planted.push(String(clientId), String(membershipId));
    rows.push({
      Id: membershipId, // ID-shaped-looking NAME? no — 'Id' is a fine key; its VALUE is numeric → count-only
      client_id: clientId, // JOIN key — flagged by name; VALUE (id) never emitted
      member_name: memberName, // PERSON name (person context) → withheld even though low-ish card
      client_email: 'secret@member.example', // email → shape gate rejects
      api_token: 'sk_live_DEADBEEFCAFE1234', // token → high-card / unsafe
      auth_header: 'Bearer_TOKEN_XYZ',
      membership_status: status, // enum → emits {Active, Cancelled, Frozen}
      is_active: status === 'Active', // boolean → emits true/false
      is_deleted: false, // boolean → emits
      is_on_hold: status === 'Frozen', // HOLD boolean → flagged hold + emits
      start_date: startDate, // date → count-only (date guard)
      monthly_dues: 149 + (i % 3) * 30, // MONEY (149/179/209) → count-only (name not duration-admitted)
      assigned_coach: ['Aniyah', 'Bowen', 'Dario', 'Elowen'][i % 4], // role-noun leaf → withheld
      created_by: i % 2 === 0 ? 'Marisol' : 'Quentin', // actor `…by` → withheld
      signup_note: `SECRET_NOTE_${i}_home_addr`, // free-text NAME → withheld
      payment_plan: {
        name: planName, // catalog name under a catalog PARENT → emits (extension B)
        payment_plan_type: planType, // enum → emits {Recurring, Prepaid, Pack}
        initial_commitment_length: lengthMonths, // duration QUANTITY integer → numeric vocab emits (extension A)
        initial_commitment_time_unit: 'Month', // unit STRING → emits {Month}
        renewal_commitment_length: lengthMonths,
        renewal_commitment_time_unit: 'Month',
        commitment_total: commitmentTotalDollars, // MONEY total → count-only (money name), pricing protected
        is_auto_renew: bucket !== 3, // boolean → emits
        // a count-1 person value inside an ADMITTED field (payment_plan_type) → count-1 backstop suppresses it
        plan_owner_type: i === 0 ? 'UNIQUE_PERSON_ZZ' : 'Standard',
      },
      '90008888': 'x', // an ID-shaped FIELD NAME → redacted, never emitted
    });
  }

  const ctx = freshCtx();
  tallyRecords(rows, ctx);
  const result = buildResult(ctx, { ...freshMeta(), jsonParseable: true, recordArrayKey: 'memberships', pagesFetched: 1 });
  const serialized = JSON.stringify(result, null, 2);
  console.log(serialized);

  const field = (name: string): FieldShape | undefined => result.fields.find((f) => f.field === name);
  const vals = (f: FieldShape | undefined): string[] => (f?.values ?? []).map((v) => v.value);

  const planName = field('payment_plan.name');
  const planType = field('payment_plan.payment_plan_type');
  const unit = field('payment_plan.initial_commitment_time_unit');
  const length = field('payment_plan.initial_commitment_length');
  const total = field('payment_plan.commitment_total');
  const autoRenew = field('payment_plan.is_auto_renew');
  const planOwnerType = field('payment_plan.plan_owner_type');
  const status = field('membership_status');
  const isActive = field('is_active');
  const isDeleted = field('is_deleted');
  const isOnHold = field('is_on_hold');
  const clientIdF = field('client_id');
  const memberName = field('member_name');
  const email = field('client_email');
  const dues = field('monthly_dues');
  const coach = field('assigned_coach');
  const createdBy = field('created_by');
  const note = field('signup_note');
  const startDateF = field('start_date');

  const checks: Array<[string, boolean]> = [
    // (Extension B) catalog plan NAME emits via the parent-context branch.
    ['payment_plan.name emits catalog labels', !!planName && planName.values !== null && vals(planName).includes('Monthly Unlimited') && vals(planName).includes('12-Month BJJ')],
    ['payment_plan.name flagged as a plan-name field', result.commitmentStructure.hasPlanNameField === true],
    // Plan TYPE + UNIT string enums emit.
    ['payment_plan_type emits {Recurring,Prepaid,Pack}', !!planType && ['Recurring', 'Prepaid', 'Pack'].every((v) => vals(planType).includes(v))],
    ['initial_commitment_time_unit emits {Month}', !!unit && vals(unit).includes('Month') && unit.values?.length === 1],
    // (Extension A) numeric commitment-length vocabulary emits small ints; money total does NOT.
    ['initial_commitment_length emits small ints {0,6,12}', !!length && length.numericDurationVocab === true && length.values !== null && ['0', '6', '12'].every((v) => vals(length).includes(v))],
    ['commitment_total is MONEY → count-only (pricing protected)', !!total && total.values === null && total.numericDurationVocab === false && total.types.includes('number')],
    ['monthly_dues is MONEY → count-only', !!dues && dues.values === null && dues.numericDurationVocab === false],
    // Booleans emit; hold flagged.
    ['is_active boolean emits true/false', !!isActive && isActive.booleanField === true && isActive.values !== null],
    ['is_deleted boolean emits', !!isDeleted && isDeleted.booleanField === true && isDeleted.values !== null],
    ['is_on_hold boolean emits + flagged hold', !!isOnHold && isOnHold.values !== null && isOnHold.roles.includes('hold')],
    ['payment_plan.is_auto_renew boolean emits', !!autoRenew && autoRenew.booleanField === true && autoRenew.values !== null],
    // Status enum emits + flagged status.
    ['membership_status emits {Active,Cancelled,Frozen} + flagged status', !!status && ['Active', 'Cancelled', 'Frozen'].every((v) => vals(status).includes(v)) && status.roles.includes('status')],
    // Join key: field NAME surfaced, values NEVER emitted.
    ['client_id flagged join key, values null (ids never emitted)', !!clientIdF && clientIdF.roles.includes('join') && clientIdF.values === null],
    ['joinKeyFields lists client_id', result.joinKeyFields.includes('client_id')],
    // Person / PII fields withheld.
    ['member_name withheld (person context)', !!memberName && memberName.values === null && memberName.nameAdmitted === false],
    ['client_email withheld', !!email && email.values === null],
    ['start_date withheld (date guard)', !!startDateF && startDateF.values === null],
    ['assigned_coach withheld (role noun)', !!coach && coach.values === null && coach.nameAdmitted === false],
    ['created_by withheld (actor `…by`)', !!createdBy && createdBy.values === null && createdBy.nameAdmitted === false],
    ['signup_note withheld (free text)', !!note && note.values === null && note.nameAdmitted === false],
    // Count-1 backstop: a unique person value inside an ADMITTED field collapses, never emits.
    ['plan_owner_type: UNIQUE value collapsed, Standard emits', !!planOwnerType && vals(planOwnerType).includes('Standard') && !vals(planOwnerType).includes('UNIQUE_PERSON_ZZ') && vals(planOwnerType).includes(UNIQUE_VALUE_SUPPRESSED_LABEL)],
    // Focused role lists + structure hint.
    ['commitmentFields non-empty (length/unit/total/type/plan)', result.commitmentFields.length >= 4],
    ['statusFields includes membership_status + is_active + is_deleted', ['membership_status', 'is_active', 'is_deleted'].every((n) => result.statusFields.includes(n))],
    ['holdFields includes is_on_hold', result.holdFields.includes('is_on_hold')],
    ['commitmentStructure.hint == length_plus_unit', result.commitmentStructure.hint === 'length_plus_unit'],
    ['hasLengthOrTermField && hasUnitField && hasTotalField', result.commitmentStructure.hasLengthOrTermField && result.commitmentStructure.hasUnitField && result.commitmentStructure.hasTotalField],
    // ID-shaped field NAME redacted; types are categories only.
    ['id-shaped field name redacted', result.redactedFieldNameCount >= 1 && !result.fields.some((f) => f.field.includes('90008888'))],
    ['coverageComplete true (clean synthetic scan)', result.coverageComplete === true],
    ['recommendation == patch 517 field names', result.recommendation === 'shape_discovered_patch_517_field_names_then_rerun'],
    ['valueEmissionCaveat present', typeof result.valueEmissionCaveat === 'string' && result.valueEmissionCaveat.length > 0],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length > 0) return fail(`behavioral check(s): ${failed.join(' | ')}`);

  // Name-gate pins — asserted directly so a future edit can't silently reopen a hole (or re-suppress a
  // legitimate commitment/status field).
  const mustAdmit = [
    'membership_status', 'status', 'membership_state', 'is_active', 'is_deleted', 'is_on_hold',
    'payment_plan_type', 'plan_type', 'initial_commitment_time_unit', 'renewal_commitment_time_unit',
    'plan', 'tier', 'payment_plan.name', 'plan_name', 'membership.name',
  ];
  const mustWithhold = [
    'member_name', 'client_name', 'first_name', 'last_name', 'display_name', 'contact_name', 'guardian_name',
    'emergency_contact', 'assigned_coach', 'primary_coach', 'created_by', 'cancelled_by', 'sold_by',
    'signup_note', 'plan_comment', 'hold_memo', 'membership.client_name',
  ];
  const numMustAdmit = ['initial_commitment_length', 'renewal_commitment_length', 'commitment_term_months', 'commitment_duration_days'];
  const numMustWithhold = ['commitment_total', 'autorenew_commitment_total', 'monthly_dues', 'price', 'amount_paid', 'account_balance', 'membership_id', 'client_id'];
  const wrongAdmit = mustWithhold.filter((n) => isValueNameAdmitted(n));
  const wrongWithhold = mustAdmit.filter((n) => !isValueNameAdmitted(n));
  const wrongNumAdmit = numMustWithhold.filter((n) => isDurationQtyNameAdmitted(n));
  const wrongNumWithhold = numMustAdmit.filter((n) => !isDurationQtyNameAdmitted(n));
  if (wrongAdmit.length || wrongWithhold.length || wrongNumAdmit.length || wrongNumWithhold.length) {
    return fail(
      `name gate — wrongly admitted string: [${wrongAdmit.join(', ')}]; wrongly withheld string: [${wrongWithhold.join(', ')}]; ` +
        `wrongly admitted numeric: [${wrongNumAdmit.join(', ')}]; wrongly withheld numeric: [${wrongNumWithhold.join(', ')}]`,
    );
  }

  // LEAK SCAN — no planted PII / date / id / token may appear in the serialized result.
  const leakedTokens = planted.filter((tok) => serialized.includes(tok));
  if (leakedTokens.length > 0) return fail(`output leaked planted token(s): ${[...new Set(leakedTokens)].join(', ')}`);
  if (/@member\.example|Bearer_|sk_live_/.test(serialized)) return fail('an email/token-like substring survived in output.');
  if (leaks(serialized)) return fail("output tripped the field-agnostic leak guard (ISO date / '@' / 7+ digit run).");
  // Gap proof — the fixtures DID carry the sentinels (so suppression is real, not vacuous).
  const rawFixtures = JSON.stringify(rows);
  const notInFixtures = ['secret@member.example', '9000001', '80000001', '2026-01-15', 'Aniyah', 'Marisol', 'Priya Patel', 'UNIQUE_PERSON_ZZ'].filter((t) => !rawFixtures.includes(t));
  if (notInFixtures.length > 0) return fail(`selftest fixtures missing planted token(s) — leak scan is vacuous: ${notInFixtures.join(', ')}`);

  // Coverage / transport branches — coverageComplete must be FALSE whenever the scan is not whole.
  const emptyCtx = freshCtx();
  const partials: Array<[string, MembershipsShapeResult]> = [
    ['reachedPageCap', buildResult(ctx, { ...freshMeta(), jsonParseable: true, recordArrayKey: 'memberships', pagesFetched: MAX_PAGES, reachedPageCap: true })],
    ['errorEnvelope', buildResult(ctx, { ...freshMeta(), jsonParseable: true, recordArrayKey: 'memberships', pagesFetched: 1, errorEnvelopeDetected: true, embeddedHttpStatusClass: '4xx' })],
    ['non-2xx', buildResult(ctx, { ...freshMeta(), httpStatusClass: '4xx', jsonParseable: true, pagesFetched: 1 })],
    ['network_error', buildResult(emptyCtx, { ...freshMeta(), endpointReached: false, httpStatusClass: 'network_error', pagesFetched: 0 })],
    ['non-json', buildResult(emptyCtx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: false, pagesFetched: 0 })],
    ['recordArrayKeyNull', buildResult(ctx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: null, pagesFetched: 1 })],
    ['zeroRecordsButKeySeen', buildResult(emptyCtx, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: 'memberships', pagesFetched: 1 })],
  ];
  const badPartials = partials.filter(([, r]) => r.coverageComplete !== false).map(([n]) => n);
  if (badPartials.length > 0) return fail(`coverageComplete should be false for: ${badPartials.join(', ')}`);

  // Error-envelope detector — direct check (in-body HTTPCode → class only).
  const env = detectErrorEnvelope({ DeveloperMessage: 'x', ErrorCode: 'y', HTTPCode: 403, UserMessage: 'z' });
  if (!env.detected || env.embeddedStatusClass !== '4xx') return fail('error-envelope detector did not classify the synthetic envelope.');

  console.log(
    'SELFTEST PASS: catalog plan-name (parent-context branch) + plan-type/unit/status enums + commitment-length ' +
      'small-int vocab all emit; MONEY (commitment_total / monthly_dues), ids, dates, person names, coach/actor/' +
      'free-text fields, and a count-1 person value in an admitted field all suppressed; join key surfaced by ' +
      'NAME with values withheld; structure hint = length_plus_unit; name gates pinned; coverage + envelope ' +
      'branches verified; no planted PII/date/id/token leaked; no file or network touched.',
  );
}

// ─── Entry ──────────────────────────────────────────────────────────────────────────────────────────
function emit(result: MembershipsShapeResult): void {
  const serialized = JSON.stringify(result, null, 2);
  if (leaks(serialized)) {
    console.error('LEAK GUARD TRIPPED: ISO date / "@" / 7+ digit run in output — aborting WITHOUT printing.');
    process.exit(1);
    return;
  }
  console.log(serialized);
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
        '--env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local scripts/wodify/membershipsShapeDiscovery.ts. ' +
        'No request was made.',
    );
    process.exit(1);
    return;
  }

  const { ctx, meta } = await scanAllMemberships(apiKey);
  // ONLY the safe field-shape aggregate is printed — no rows, names, ids, dates, dues, URLs, key, or raw bodies.
  emit(buildResult(ctx, meta));
}

main().catch(() => {
  console.error('memberships field-shape discovery probe failed before producing a result (no data emitted).');
  process.exit(1);
});
