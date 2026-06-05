/**
 * `/clients` RESPONSE-SHAPE DISCOVERY probe.  LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * Purpose (RETENTION_FINISH_PLAN.md §5)
 *   `clientSigninsProbe.ts` (§5 step 2) was BLOCKED at its `/clients` prerequisite: `/clients`
 *   returned transport-2xx, NOT an error envelope, but 0 records / 0 client IDs — so the per-client
 *   sign-ins path was never reached. This script settles WHY, with the minimum Wodify calls:
 *     - is `/clients` genuinely EMPTY, or
 *     - did `clientSigninsProbe` miss the records because they are nested under a key / shape its
 *       extractor (`RECORD_ARRAY_KEYS` / `CLIENT_ID_FIELDS`, exact-case) does not match?
 *   It reproduces `clientSigninsProbe`'s EXACT `/clients` request (same `?page=1&pageSize=100`) so the
 *   shape it reports IS the shape that probe saw, and reports the discovered records-array key + a
 *   likely client-ID / check-in-date / dues / status FIELD NAME, plus whether each WOULD have matched
 *   `clientSigninsProbe`'s config (so we know if #427 needs a small follow-up patch).
 *
 *   It does NOT fix any mapping, re-run the per-client probe, wire live data, iterate clients, or do
 *   §6 work. Structure discovery only: ONE `/clients` call, structural metadata only out.
 *
 * Safety contract (RETENTION_FINISH_PLAN.md §4/§5 — enforced by construction here; same posture as
 * the merged `signinsShapeDiscovery.ts`, whose helpers this reuses)
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, never logged,
 *     never printed, never echoed in errors. If unset, exits WITHOUT making any request.
 *   - Emits ONLY structural metadata: the endpoint PATH (never the query string / substituted URL),
 *     booleans, HTTP status classes, KEY NAMES, array LENGTHS / COUNTS, and per-field TYPE CATEGORIES
 *     (string / number / boolean / object / array / null). NEVER values of any kind — no names, IDs
 *     (even hashed), dates / timestamps, dues, raw rows, raw / echoed API responses, pagination
 *     VALUES, or upstream error bodies (status class only).
 *   - ID-like-key guard: any key NAME that looks like an identifier / value (pure digits, UUID, long
 *     hex, suspiciously long) is redacted and only COUNTED — so even an object keyed by client ID
 *     cannot leak an ID through a "key name", and a value-shaped field name cannot leak.
 *   - Reads ONE sample record's field NAMES + TYPE CATEGORIES only (never its values).
 *   - Detects a Wodify ERROR ENVELOPE at transport-2xx (top-level DeveloperMessage / ErrorCode /
 *     HTTPCode / UserMessage) and reports it as a failure; the in-body HTTPCode is reduced to a status
 *     CLASS only (raw value + message text never read).
 *   - Makes NO per-client / per-ID calls; does NOT iterate clients; does NOT import `silentChurn.ts`
 *     / `classifyMember`.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   Worktree-safe — point --env-file at the primary clone's gitignored env by ABSOLUTE path:
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/clientsShapeDiscovery.ts
 *   Network-free safe-output self-test (makes NO request, needs NO key):
 *     npx tsx scripts/wodify/clientsShapeDiscovery.ts --selftest
 *   See scripts/wodify/README.md. Never inline-paste the key (it lands in shell history).
 *
 * Call budget — ONE `/clients` call only. If the first response is structurally inconclusive, this
 * script STOPS and reports `inconclusive`; it does NOT make further calls (a bare-path or alternate
 * request needs separate approval).
 */

// ─── CONFIG — scoped to the single `/clients` endpoint (none repo-verified) ──────────────────────
const BASE_URL = 'https://api.wodify.com/v1'; // §5 reported base URL; auth via x-api-key header.
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100; // §5: Wodify caps at 100/page. Reproduce clientSigninsProbe's exact request.

// Mirror of `clientSigninsProbe.ts`'s extraction config (exact-case), so we can report whether the
// discovered records-array key / client-ID field WOULD have matched that probe (i.e. whether #427
// needs a small follow-up patch). Kept in sync by hand — these are NOT imported (self-contained §5).
const CLIENT_PROBE_RECORD_ARRAY_KEYS = ['data', 'results', 'result', 'items', 'records', 'value', 'signins', 'SignIns', 'rows'];
const CLIENT_PROBE_CLIENT_ID_FIELDS = ['Id', 'id', 'client_id', 'clientId', 'ClientId', 'clientID', 'member_id', 'memberId', 'MemberId'];

// Field-name guess patterns (operate on SAFE field NAMES only; emit a name, never a value).
const ID_FIELD_PATTERNS = [/^id$/i, /client.?id$/i, /member.?id$/i, /(^|_)id$/i, /guid|uuid/i];
const CHECKIN_FIELD_PATTERNS = [/check.?in/i, /last.?(seen|visit|attendance|checkin|activity)/i, /sign.?in/i, /attendance/i];
const DUES_FIELD_PATTERNS = [/dues/i, /monthly.?(fee|due|rate|amount)/i, /\bfee\b/i, /\brate\b/i, /\bamount\b/i, /\bprice\b/i];
const STATUS_FIELD_PATTERNS = [/status/i, /\bstate\b/i, /active|paused|cancell?ed|membership/i];

// §5 / #423: Wodify error-envelope markers (matched case-insensitively; values are NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

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
const META_CONTAINER_KEYS = new Set(['meta', '_meta', 'paging', 'pagination', 'links', 'page_info', 'pageinfo']);

// ─── Safe output contract ────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';
type TypeCategory = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
type Conclusion =
  | 'empty' // 2xx, parseable, but no record objects anywhere → /clients genuinely has no clients
  | 'shape_mismatch' // records present, but under a key clientSigninsProbe's exact-case config misses
  | 'records_under_known_key' // records present under a key clientSigninsProbe SHOULD have matched
  | 'error_envelope' // transport-2xx body is a Wodify error envelope
  | 'non_2xx' // transport status not 2xx
  | 'non_json' // 2xx but body is not JSON
  | 'inconclusive'; // 2xx JSON but shape not understood (e.g. object, no record arrays)

interface ArrayFound {
  keyPath: string; // dot-joined SAFE key names, or '(root)' for a bare top-level array. Names only.
  length: number; // array length only — never contents.
  elementsAreObjects: boolean;
}

interface ClientsShapeResult {
  probe: 'clientsShapeDiscovery';
  path: string; // PATH only — never a query string / substituted URL.
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  perClientIdLikelyRequired: boolean; // 403 + "Missing Authentication Token" marker (no body shown).
  jsonParseable: boolean | null; // null when not 2xx (no body inspected for shape).
  contentTypeIsJson: boolean | null; // derived boolean from Content-Type; not the header value.
  topLevelType: 'array' | 'object' | 'other' | null;
  topLevelKeyNames: string[]; // SAFE names only (ID-like redacted); empty for arrays.
  topLevelKeyCount: number;
  looksLikeIdKeyedMap: boolean;
  redactedKeyNameCount: number;
  arraysFound: ArrayFound[]; // arrays within depth <= 2 (to locate the records array).
  paginationKeyNamesFound: string[];
  recordArrayKeyGuess: string | null; // best-guess key path holding record objects (SAFE name).
  recordCountInGuessedArray: number; // length only.
  sampleRecordFieldNames: string[]; // SAFE field NAMES from ONE sample record (schema, not values).
  sampleRecordFieldTypes: Record<string, TypeCategory>; // fieldName -> type category (no values).
  redactedSampleFieldNameCount: number;
  clientIdFieldGuess: string | null; // SAFE field NAME guess for the client identifier.
  checkInDateFieldGuess: string | null; // SAFE field NAME guess for last check-in.
  duesFieldGuess: string | null; // SAFE field NAME guess for monthly dues.
  statusFieldGuess: string | null; // SAFE field NAME guess for client status.
  // Whether the discovered shape WOULD have matched clientSigninsProbe (#427) — tells if it needs a patch.
  recordArrayKeyMatchesClientProbeConfig: boolean;
  clientIdFieldMatchesClientProbeConfig: boolean;
  conclusion: Conclusion;
}

// ─── Helpers (pure; none emit, log, or retain values) — reused from `signinsShapeDiscovery.ts` ────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isIdLikeKey(key: string): boolean {
  if (key.length > 40) return true; // suspiciously long — could be a token/value
  if (/^\d{3,}$/.test(key)) return true; // pure digits, 3+ → likely a numeric ID
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(key)) return true; // UUID
  if (/^[0-9a-fA-F]{12,}$/.test(key)) return true; // long hex blob
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(key) && !/[a-z].*[A-Z]|_|-/.test(key)) return true; // base64-ish blob
  return false;
}

function partitionKeys(keys: string[]): { safe: string[]; redacted: number } {
  const safe = new Set<string>();
  let redacted = 0;
  for (const k of keys) {
    if (isIdLikeKey(k)) redacted++;
    else safe.add(k);
  }
  return { safe: [...safe].sort(), redacted };
}

function findArrays(node: unknown, keyPath: string, depth: number, maxDepth: number, out: ArrayFound[]): void {
  if (Array.isArray(node)) {
    const elementsAreObjects = node.length > 0 && node.every((e) => isPlainObject(e));
    out.push({ keyPath: keyPath || '(root)', length: node.length, elementsAreObjects });
    return; // do not descend into array elements — only that an array exists + its length matters.
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

function guessRecordArray(arrays: ArrayFound[]): ArrayFound | null {
  const objectArrays = arrays.filter((a) => a.elementsAreObjects);
  const candidates = objectArrays.length > 0 ? objectArrays : arrays;
  if (candidates.length === 0) return null;
  const preferred = ['(root)', 'data', 'results', 'result', 'items', 'records', 'value', 'clients', 'rows'];
  for (const name of preferred) {
    const hit = candidates.find((a) => a.keyPath.toLowerCase() === name);
    if (hit) return hit;
  }
  return candidates.reduce((best, a) => (a.length > best.length ? a : best), candidates[0]);
}

function resolveArrayAtPath(parsed: unknown, keyPath: string): unknown[] | null {
  if (keyPath === '(root)') return Array.isArray(parsed) ? parsed : null;
  let node: unknown = parsed;
  for (const seg of keyPath.split('.')) {
    if (seg === '<id-like>' || !isPlainObject(node)) return null; // never traverse a redacted segment
    node = node[seg];
  }
  return Array.isArray(node) ? node : null;
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

interface ErrorEnvelopeInfo {
  detected: boolean;
  embeddedStatusClass: HttpStatusClass | null;
}

function detectErrorEnvelope(parsed: unknown): ErrorEnvelopeInfo {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { detected: false, embeddedStatusClass: null };
  }
  const obj = parsed as Record<string, unknown>;
  const actualByLower = new Map<string, string>();
  for (const k of Object.keys(obj)) actualByLower.set(k.toLowerCase(), k);
  const markerHits = ERROR_ENVELOPE_MARKER_KEYS.filter((m) => actualByLower.has(m));
  const httpCodeKey = actualByLower.get('httpcode');
  const detected = httpCodeKey !== undefined || markerHits.length >= 2;
  if (!detected) return { detected: false, embeddedStatusClass: null };

  let embeddedStatusClass: HttpStatusClass | null = null;
  if (httpCodeKey !== undefined) {
    const code = Number(obj[httpCodeKey]); // reduced to a class; the raw value is never emitted
    if (Number.isFinite(code) && code >= 100 && code < 600) embeddedStatusClass = statusClassOf(code);
  }
  return { detected, embeddedStatusClass };
}

/** First SAFE field name matching any pattern, in field order. Returns a NAME (schema), never a value. */
function guessFieldName(fieldNames: string[], patterns: RegExp[]): string | null {
  for (const pat of patterns) {
    const hit = fieldNames.find((n) => pat.test(n));
    if (hit) return hit;
  }
  return null;
}

// ─── Shape derivation (pure; the self-test exercises this with synthetic PII) ────────────────────
interface ShapeInput {
  status: number;
  parsed: unknown; // JSON.parse result, or undefined if non-JSON / parse failed
  contentTypeIsJson: boolean;
  missingIdHint: boolean;
}

function deriveShape(input: ShapeInput): ClientsShapeResult {
  const result: ClientsShapeResult = {
    probe: 'clientsShapeDiscovery',
    path: CLIENTS_PATH,
    endpointReached: true,
    httpStatusClass: statusClassOf(input.status),
    errorEnvelopeDetected: false,
    embeddedHttpStatusClass: null,
    perClientIdLikelyRequired: input.missingIdHint,
    jsonParseable: null,
    contentTypeIsJson: input.contentTypeIsJson,
    topLevelType: null,
    topLevelKeyNames: [],
    topLevelKeyCount: 0,
    looksLikeIdKeyedMap: false,
    redactedKeyNameCount: 0,
    arraysFound: [],
    paginationKeyNamesFound: [],
    recordArrayKeyGuess: null,
    recordCountInGuessedArray: 0,
    sampleRecordFieldNames: [],
    sampleRecordFieldTypes: {},
    redactedSampleFieldNameCount: 0,
    clientIdFieldGuess: null,
    checkInDateFieldGuess: null,
    duesFieldGuess: null,
    statusFieldGuess: null,
    recordArrayKeyMatchesClientProbeConfig: false,
    clientIdFieldMatchesClientProbeConfig: false,
    conclusion: 'inconclusive',
  };

  if (result.httpStatusClass !== '2xx') {
    result.conclusion = 'non_2xx';
    return result;
  }
  if (input.parsed === undefined) {
    result.jsonParseable = false;
    result.topLevelType = 'other';
    result.conclusion = 'non_json';
    return result;
  }
  result.jsonParseable = true;

  const envelope = detectErrorEnvelope(input.parsed);
  // An envelope only "wins" when there is no record array to read (mirror the sibling probes): if the
  // body also carries a real records array, prefer the data. Here, after extracting arrays below, we
  // only flag the envelope when no object-array was found.

  if (Array.isArray(input.parsed)) {
    result.topLevelType = 'array';
  } else if (isPlainObject(input.parsed)) {
    result.topLevelType = 'object';
    const allKeys = Object.keys(input.parsed);
    result.topLevelKeyCount = allKeys.length;
    const { safe, redacted } = partitionKeys(allKeys);
    result.redactedKeyNameCount = redacted;
    result.looksLikeIdKeyedMap = allKeys.length > 30 && redacted >= allKeys.length / 2;
    result.topLevelKeyNames = result.looksLikeIdKeyedMap ? [] : safe;
  } else {
    result.topLevelType = 'other';
  }

  findArrays(input.parsed, '', 0, 2, result.arraysFound);
  result.paginationKeyNamesFound = findPaginationKeyNames(input.parsed);

  const guess = guessRecordArray(result.arraysFound);
  if (guess) {
    result.recordArrayKeyGuess = guess.keyPath;
    result.recordCountInGuessedArray = guess.length;
    const records = resolveArrayAtPath(input.parsed, guess.keyPath);
    if (records && records.length > 0) {
      const sample = records[0]; // ONE sample record only (per the slice's safe-output rules)
      if (isPlainObject(sample)) {
        const { safe, redacted } = partitionKeys(Object.keys(sample));
        result.sampleRecordFieldNames = safe;
        result.redactedSampleFieldNameCount = redacted;
        for (const name of safe) result.sampleRecordFieldTypes[name] = typeCategoryOf(sample[name]);
        result.clientIdFieldGuess = guessFieldName(safe, ID_FIELD_PATTERNS);
        result.checkInDateFieldGuess = guessFieldName(safe, CHECKIN_FIELD_PATTERNS);
        result.duesFieldGuess = guessFieldName(safe, DUES_FIELD_PATTERNS);
        result.statusFieldGuess = guessFieldName(safe, STATUS_FIELD_PATTERNS);
      }
    }
  }

  // Would clientSigninsProbe (#427) have matched this shape? (exact-case, mirroring its extractRecords)
  const keyGuess = result.recordArrayKeyGuess;
  result.recordArrayKeyMatchesClientProbeConfig =
    keyGuess === '(root)' ? true : keyGuess !== null && CLIENT_PROBE_RECORD_ARRAY_KEYS.includes(keyGuess);
  result.clientIdFieldMatchesClientProbeConfig =
    result.clientIdFieldGuess !== null && CLIENT_PROBE_CLIENT_ID_FIELDS.includes(result.clientIdFieldGuess);

  // Conclusion.
  const hasObjectRecords = result.arraysFound.some((a) => a.elementsAreObjects && a.length > 0);
  if (hasObjectRecords && result.recordCountInGuessedArray > 0) {
    result.conclusion = result.recordArrayKeyMatchesClientProbeConfig ? 'records_under_known_key' : 'shape_mismatch';
  } else if (envelope.detected) {
    result.errorEnvelopeDetected = true;
    result.embeddedHttpStatusClass = envelope.embeddedStatusClass;
    result.conclusion = 'error_envelope';
  } else if (result.arraysFound.length === 0 || result.arraysFound.every((a) => a.length === 0)) {
    // 2xx, parseable, but no records anywhere (empty arrays or no arrays + not an envelope) → empty.
    result.conclusion = 'empty';
  } else {
    result.conclusion = 'inconclusive';
  }
  return result;
}

// ─── Live network layer (body read for shape derivation only; never logged / returned as text) ────
async function fetchClients(apiKey: string): Promise<ShapeInput> {
  // Reproduce clientSigninsProbe's exact request. The query carries only structural paging params
  // (no IDs/dates/account values), so the PATH is the only thing emitted; the full URL is never shown.
  const url = new URL(BASE_URL + CLIENTS_PATH);
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
  const missingIdHint = res.status === 403 && /Missing Authentication Token/i.test(bodyText);

  let parsed: unknown;
  if (res.status >= 200 && res.status < 300) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = undefined;
    }
  }
  return { status: res.status, parsed, contentTypeIsJson: contentType.includes('json'), missingIdHint };
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO key) ────────
function runSelfTest(): void {
  const SECRETS = [
    'SECRET_FIRST_NAME',
    'SECRET_LAST_NAME',
    'secret@example.com',
    '99999', // a fake numeric client-ID VALUE
    '4242.42', // a fake dues VALUE
    '2023-07-15', // a fake exact check-in date
    '912', // a fake TotalRecords pagination VALUE — must never leak (only the page array length may)
    '88888888', // an ID-shaped field NAME — must be redacted, never emitted
  ];
  // Synthetic /clients body: PascalCase wrapper `Results` (NOT in clientSigninsProbe's exact-case list),
  // pagination keys, and a record carrying obvious fake PII + an ID-shaped key.
  const synthetic = {
    Results: [
      {
        Id: 99999,
        FirstName: 'SECRET_FIRST_NAME',
        LastName: 'SECRET_LAST_NAME',
        Email: 'secret@example.com',
        client_status: 'Active',
        LastCheckin: '2023-07-15T08:00:00Z',
        MonthlyDues: 4242.42,
        '88888888': 'x',
      },
    ],
    TotalRecords: 912,
    Page: 1,
    PageSize: 100,
  };

  const result = deriveShape({ status: 200, parsed: synthetic, contentTypeIsJson: true, missingIdHint: false });
  const serialized = JSON.stringify(result, null, 2);

  const leaks = SECRETS.filter((tok) => serialized.includes(tok));
  console.log(serialized);
  if (leaks.length > 0) {
    console.error(`SELFTEST FAIL: output contained disallowed token(s): ${leaks.join(', ')}`);
    process.exit(1);
    return;
  }
  const expectations: Array<[string, boolean]> = [
    ['recordArrayKeyGuess==Results', result.recordArrayKeyGuess === 'Results'],
    ['recordCount==1', result.recordCountInGuessedArray === 1],
    ['conclusion==shape_mismatch', result.conclusion === 'shape_mismatch'],
    ['recordArrayKey does NOT match client probe config', result.recordArrayKeyMatchesClientProbeConfig === false],
    ['clientId field guess==Id', result.clientIdFieldGuess === 'Id'],
    ['clientId field DOES match client probe config', result.clientIdFieldMatchesClientProbeConfig === true],
    ['checkInDate guess==LastCheckin', result.checkInDateFieldGuess === 'LastCheckin'],
    ['dues guess==MonthlyDues', result.duesFieldGuess === 'MonthlyDues'],
    ['status guess==client_status', result.statusFieldGuess === 'client_status'],
    ['id-shaped field name redacted', !result.sampleRecordFieldNames.includes('88888888') && result.redactedSampleFieldNameCount === 1],
    ['field types are categories only', result.sampleRecordFieldTypes.Id === 'number' && result.sampleRecordFieldTypes.FirstName === 'string'],
    ['pagination key names found (names only)', result.paginationKeyNamesFound.length > 0],
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
        'scripts/wodify/clientsShapeDiscovery.ts. No request was made.',
    );
    process.exit(1);
    return;
  }

  let input: ShapeInput;
  try {
    input = await fetchClients(apiKey);
  } catch {
    // Network / DNS failure — no HTTP response. Never log the error (it can echo the URL/host).
    const result: ClientsShapeResult = {
      probe: 'clientsShapeDiscovery',
      path: CLIENTS_PATH,
      endpointReached: false,
      httpStatusClass: 'network_error',
      errorEnvelopeDetected: false,
      embeddedHttpStatusClass: null,
      perClientIdLikelyRequired: false,
      jsonParseable: null,
      contentTypeIsJson: null,
      topLevelType: null,
      topLevelKeyNames: [],
      topLevelKeyCount: 0,
      looksLikeIdKeyedMap: false,
      redactedKeyNameCount: 0,
      arraysFound: [],
      paginationKeyNamesFound: [],
      recordArrayKeyGuess: null,
      recordCountInGuessedArray: 0,
      sampleRecordFieldNames: [],
      sampleRecordFieldTypes: {},
      redactedSampleFieldNameCount: 0,
      clientIdFieldGuess: null,
      checkInDateFieldGuess: null,
      duesFieldGuess: null,
      statusFieldGuess: null,
      recordArrayKeyMatchesClientProbeConfig: false,
      clientIdFieldMatchesClientProbeConfig: false,
      conclusion: 'inconclusive',
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = deriveShape(input);
  // ONLY the safe structural aggregate is printed — no rows, values, IDs, URLs, key, or raw responses.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('clients shape-discovery probe failed before producing a result (no data emitted).');
  process.exit(1);
});
