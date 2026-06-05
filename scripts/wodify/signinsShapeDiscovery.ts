/**
 * Class / Client Sign-ins — RESPONSE-SHAPE DISCOVERY probe.  LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * Purpose
 *   The dated-check-in probe (`classSigninProbe.ts`) returned a 2xx but inspected 0 records on
 *   2026-06-04, so its field MAPPING is unproven (RETENTION_FINISH_PLAN.md §5). This script's only
 *   job is to discover WHY — by reporting the response STRUCTURE (key names, array lengths,
 *   pagination key names, per-client-ID-required signal) for a small allowlist of Class / Client
 *   Sign-ins endpoint candidates. It does NOT fix the mapping, wire live data, or do §6 work.
 *
 *   This is structure discovery, not data collection: one page per candidate, structural metadata
 *   only out.
 *
 * Safety contract (RETENTION_FINISH_PLAN.md §4/§5 — enforced by construction here)
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, never logged,
 *     never printed, never echoed in errors. If unset, exits WITHOUT making any request.
 *   - Emits ONLY structural metadata: endpoint PATHS (no query strings), booleans, HTTP status
 *     classes, KEY NAMES, and array LENGTHS / COUNTS. NEVER values of any kind — no names, IDs
 *     (even hashed), dates/timestamps, dues, raw rows, raw/echoed API responses, or upstream error
 *     bodies (status class only).
 *   - ID-like-key guard: any key NAME that looks like an identifier/value (pure digits, UUID, long
 *     hex, or suspiciously long) is redacted and only COUNTED — so even an object keyed by client
 *     ID cannot leak an ID through a "key name". High-cardinality ID-keyed maps are reported as a
 *     count + boolean, never as a key list.
 *   - Response bodies are read into memory ONLY to derive the structure above, then discarded. The
 *     body is never logged, returned, or printed.
 *   - Does NOT import `silentChurn.ts` / `classifyMember`. Standalone by design (§5 rule).
 *   - No per-client / per-ID calls. If a candidate signals a required ID path param (a 403
 *     "Missing Authentication Token"), that is REPORTED as a boolean and the probe stops there —
 *     it does NOT iterate clients (that needs separate approval).
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   Option 1 (worktree-safe — point --env-file at the primary clone's gitignored env by abs path):
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/signinsShapeDiscovery.ts
 *   See scripts/wodify/README.md for details. Never inline-paste the key (it lands in shell history).
 *
 * Draft status — NOTHING in CONFIG is repo-verified (RETENTION_FINISH_PLAN.md §5: "leads to
 * re-confirm"). The candidate PATHS, pagination MECHANISM, and FIELD NAMES are all guesses; this
 * script exists to replace those guesses with observed structure.
 */

// ─── CONFIG — small allowlist, scoped ONLY to Class / Client Sign-ins (none repo-verified) ───────
const BASE_URL = 'https://api.wodify.com/v1'; // §5 reported base URL; auth via x-api-key header.

// List-style sign-ins candidates ONLY — no per-client/per-ID paths, no unrelated resources. The
// first entry reproduces the original probe's path (the one that returned 2xx + 0 records) so its
// real shape is revealed. The rest are naming variants in case that 2xx was an empty/wrapper page.
const ENDPOINT_CANDIDATES: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'clients-signins (original probe path)', path: '/clients/signins' },
  { label: 'clients-sign-ins (hyphen variant)', path: '/clients/sign-ins' },
  { label: 'signins (bare)', path: '/signins' },
  { label: 'sign-ins (bare hyphen)', path: '/sign-ins' },
  { label: 'classes-signins (class variant)', path: '/classes/signins' },
];

const PAGE_SIZE = 100; // §5: Wodify caps at 100/page regardless of requested size. One page only here.

// Pagination key NAMES to detect by presence (names only ever emitted, never their values).
const PAGINATION_KEY_NAMES = new Set(
  [
    'page', 'pageNumber', 'page_number', 'pageSize', 'page_size', 'perPage', 'per_page', 'limit',
    'offset', 'skip', 'take', 'total', 'totalCount', 'total_count', 'totalRecords', 'total_records',
    'totalPages', 'total_pages', 'pageCount', 'page_count', 'count', 'hasMore', 'has_more',
    'hasNext', 'has_next', 'next', 'nextPage', 'next_page', 'nextCursor', 'next_cursor', 'cursor',
    'links', 'paging', 'pagination', 'meta', '_meta',
  ].map((k) => k.toLowerCase()),
);

// Container keys often wrapping pagination metadata — searched one level deep for pagination names.
const META_CONTAINER_KEYS = new Set(['meta', '_meta', 'paging', 'pagination', 'links', 'page_info', 'pageinfo']);

// ─── Safe output contract ────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';

interface ArrayFound {
  keyPath: string; // dot-joined SAFE key names, or '(root)' for a bare top-level array. Names only.
  length: number; // array length only — never contents.
  elementsAreObjects: boolean;
}

interface CandidateResult {
  label: string;
  path: string; // PATH only — never a query string (no account-specific values).
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  jsonParseable: boolean | null; // null when not 2xx (no body inspected for shape).
  contentTypeIsJson: boolean | null; // derived boolean from the response Content-Type; not the header.
  topLevelType: 'array' | 'object' | 'other' | null;
  topLevelKeyNames: string[]; // SAFE names only (ID-like redacted out); empty for arrays.
  topLevelKeyCount: number; // total top-level keys (incl. any redacted), count only.
  looksLikeIdKeyedMap: boolean; // object whose keys look like IDs → names withheld, count only.
  redactedKeyNameCount: number; // how many key names were withheld by the ID-like guard.
  arraysFound: ArrayFound[]; // arrays located within depth <= 2 (to find the records array).
  recordArrayKeyGuess: string | null; // best guess key path holding record objects.
  recordCountInGuessedArray: number; // length of that array only.
  recordFieldNames: string[]; // SAFE field-NAME union of record objects (schema, not values).
  paginationKeyNamesFound: string[]; // pagination-related key NAMES present (depth <= 2).
  perClientIdLikelyRequired: boolean; // 403 + "Missing Authentication Token" marker (no body shown).
}

// ─── Helpers (pure; none emit, log, or retain values) ───────────────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

/**
 * ID-like-key guard. Returns true when a KEY NAME looks like an identifier or value rather than a
 * schema field name — so it must never be emitted. Protects against objects keyed by client/member
 * ID (where "keys" would be IDs) and against any value-shaped key.
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Locate arrays within depth <= maxDepth. keyPath is built from SAFE key names only. */
function findArrays(node: unknown, keyPath: string, depth: number, maxDepth: number, out: ArrayFound[]): void {
  if (Array.isArray(node)) {
    const elementsAreObjects = node.length > 0 && node.every((e) => isPlainObject(e));
    out.push({ keyPath: keyPath || '(root)', length: node.length, elementsAreObjects });
    return; // do not descend into array elements — we only need that an array exists + its length.
  }
  if (isPlainObject(node) && depth < maxDepth) {
    for (const [k, v] of Object.entries(node)) {
      if (Array.isArray(v) || isPlainObject(v)) {
        const safeSeg = isIdLikeKey(k) ? '<id-like>' : k;
        findArrays(v, keyPath ? `${keyPath}.${safeSeg}` : safeSeg, depth + 1, maxDepth, out);
      }
    }
  }
}

/** Collect pagination-related key NAMES present at top level or inside a meta-ish container. */
function findPaginationKeyNames(parsed: unknown): string[] {
  const found = new Set<string>();
  if (!isPlainObject(parsed)) return [];
  for (const [k, v] of Object.entries(parsed)) {
    if (PAGINATION_KEY_NAMES.has(k.toLowerCase()) && !isIdLikeKey(k)) found.add(k);
    if (META_CONTAINER_KEYS.has(k.toLowerCase()) && isPlainObject(v)) {
      for (const nk of Object.keys(v)) {
        if (PAGINATION_KEY_NAMES.has(nk.toLowerCase()) && !isIdLikeKey(nk)) found.add(`${k}.${nk}`);
      }
    }
  }
  return [...found].sort();
}

/** Best-guess the records array: prefer common record keys, else the longest object-element array. */
function guessRecordArray(arrays: ArrayFound[]): ArrayFound | null {
  const objectArrays = arrays.filter((a) => a.elementsAreObjects);
  const candidates = objectArrays.length > 0 ? objectArrays : arrays;
  if (candidates.length === 0) return null;
  const preferred = ['(root)', 'data', 'results', 'result', 'items', 'records', 'value', 'signins', 'rows'];
  for (const name of preferred) {
    const hit = candidates.find((a) => a.keyPath.toLowerCase() === name);
    if (hit) return hit;
  }
  return candidates.reduce((best, a) => (a.length > best.length ? a : best), candidates[0]);
}

/** Resolve a dot-path of SAFE key names back to the live array (to read element field names). */
function resolveArrayAtPath(parsed: unknown, keyPath: string): unknown[] | null {
  if (keyPath === '(root)') return Array.isArray(parsed) ? parsed : null;
  let node: unknown = parsed;
  for (const seg of keyPath.split('.')) {
    if (seg === '<id-like>' || !isPlainObject(node)) return null; // never traverse a redacted segment
    node = node[seg];
  }
  return Array.isArray(node) ? node : null;
}

/** Union of SAFE field NAMES across record objects (schema only — values are never read). */
function collectRecordFieldNames(records: unknown[]): { names: string[]; redacted: number } {
  const keys: string[] = [];
  for (const rec of records) {
    if (isPlainObject(rec)) keys.push(...Object.keys(rec));
  }
  return ((p) => ({ names: p.safe, redacted: p.redacted }))(partitionKeys(keys));
}

interface RawPage {
  status: number;
  bodyText: string;
  contentTypeIsJson: boolean;
}

/** Fetch one page. Body is read for shape derivation only and NEVER logged, returned upward as text
 *  only to the structure derivation in the caller, then discarded — never printed. */
async function fetchPage(apiKey: string, path: string): Promise<RawPage> {
  // Query carries only structural paging params (no IDs/dates/account values), so the PATH is the
  // only thing ever emitted; the full URL (with query) is never printed.
  const url = new URL(BASE_URL + path);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', String(PAGE_SIZE));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'x-api-key': apiKey, accept: 'application/json' }, // key never logged
  });

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '';
  }
  return { status: res.status, bodyText, contentTypeIsJson: contentType.includes('json') };
}

async function probeCandidate(apiKey: string, label: string, path: string): Promise<CandidateResult> {
  const base: CandidateResult = {
    label,
    path,
    endpointReached: false,
    httpStatusClass: 'network_error',
    jsonParseable: null,
    contentTypeIsJson: null,
    topLevelType: null,
    topLevelKeyNames: [],
    topLevelKeyCount: 0,
    looksLikeIdKeyedMap: false,
    redactedKeyNameCount: 0,
    arraysFound: [],
    recordArrayKeyGuess: null,
    recordCountInGuessedArray: 0,
    recordFieldNames: [],
    paginationKeyNamesFound: [],
    perClientIdLikelyRequired: false,
  };

  let page: RawPage;
  try {
    page = await fetchPage(apiKey, path);
  } catch {
    // Network / DNS failure — no HTTP response. Never log the error (it can echo the URL/host).
    return base;
  }

  base.endpointReached = true;
  base.httpStatusClass = statusClassOf(page.status);
  base.contentTypeIsJson = page.contentTypeIsJson;

  // §5: a 403 "Missing Authentication Token" can mean an absent required ID path param, NOT a real
  // auth failure. Detect the marker locally WITHOUT logging the body.
  if (page.status === 403 && /Missing Authentication Token/i.test(page.bodyText)) {
    base.perClientIdLikelyRequired = true;
  }

  if (base.httpStatusClass !== '2xx') return base; // non-2xx: status class only, no shape inspected.

  let parsed: unknown;
  try {
    parsed = JSON.parse(page.bodyText);
    base.jsonParseable = true;
  } catch {
    base.jsonParseable = false;
    base.topLevelType = 'other'; // 2xx but not JSON (e.g. an HTML page) — strong "wrong path" signal.
    return base;
  }

  if (Array.isArray(parsed)) {
    base.topLevelType = 'array';
  } else if (isPlainObject(parsed)) {
    base.topLevelType = 'object';
    const allKeys = Object.keys(parsed);
    base.topLevelKeyCount = allKeys.length;
    const { safe, redacted } = partitionKeys(allKeys);
    base.redactedKeyNameCount = redacted;
    // Heuristic: many keys, mostly ID-like → an object keyed by identifier. Withhold the key list.
    base.looksLikeIdKeyedMap = allKeys.length > 30 && redacted >= allKeys.length / 2;
    base.topLevelKeyNames = base.looksLikeIdKeyedMap ? [] : safe;
  } else {
    base.topLevelType = 'other';
  }

  findArrays(parsed, '', 0, 2, base.arraysFound);
  base.paginationKeyNamesFound = findPaginationKeyNames(parsed);

  const guess = guessRecordArray(base.arraysFound);
  if (guess) {
    base.recordArrayKeyGuess = guess.keyPath;
    base.recordCountInGuessedArray = guess.length;
    const records = resolveArrayAtPath(parsed, guess.keyPath);
    if (records) {
      const { names, redacted } = collectRecordFieldNames(records);
      base.recordFieldNames = names;
      base.redactedKeyNameCount += redacted;
    }
  }

  return base;
}

async function main(): Promise<void> {
  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    // Fail safe — never make a call without a key, and never reveal anything.
    console.error(
      'WODIFY_API_KEY is not set. Provide it via a gitignored env file (never commit or paste it), ' +
        'e.g. npx tsx --env-file=/abs/path/.env.local scripts/wodify/signinsShapeDiscovery.ts. ' +
        'No request was made.',
    );
    process.exit(1);
    return;
  }

  const candidates: CandidateResult[] = [];
  for (const { label, path } of ENDPOINT_CANDIDATES) {
    // Sequential (not parallel) to stay gentle on the API and keep behaviour deterministic.
    candidates.push(await probeCandidate(apiKey, label, path));
  }

  // Roll up a safe summary to answer the §5 discovery questions at a glance (counts/booleans only).
  const any2xx = candidates.some((c) => c.httpStatusClass === '2xx');
  const anyWithRecords = candidates.some((c) => c.recordCountInGuessedArray > 0);
  const anyPerClientIdRequired = candidates.some((c) => c.perClientIdLikelyRequired);

  const result = {
    probe: 'signinsShapeDiscovery',
    candidatesTested: candidates.length,
    summary: {
      anyEndpointReturned2xx: any2xx,
      anyEndpointYieldedRecords: anyWithRecords,
      anyEndpointSignalsPerClientIdRequired: anyPerClientIdRequired,
    },
    candidates,
  };

  // ONLY the safe aggregate is printed — no rows, no values, no IDs, no key, no raw responses.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('Shape-discovery probe failed before producing a result (no data emitted).');
  process.exit(1);
});
