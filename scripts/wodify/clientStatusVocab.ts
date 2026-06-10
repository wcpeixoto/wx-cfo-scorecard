/**
 * Wodify `client_status` VOCABULARY probe.   LOCAL ONLY — NEVER RUN IN CI OR THE SPA.
 *
 * Purpose (RETENTION_FINISH_PLAN.md §6 — the pre-redeploy / pre-re-pull taxonomy gate)
 *   Before the next §6 sequence (schema ALTER → name-scoped edge redeploy → re-arm → re-pull), we
 *   must know the REAL distinct `client_status` values Wodify returns and how the current fail-closed
 *   `normalizeStatus` (the #451 mapping the redeploy will ship) maps each one — so no status is
 *   silently mis-mapped in EITHER direction:
 *     - ENDED direction: a genuinely-ended status that does NOT normalize to `ended` inflates
 *       `unknownStatus` and makes the new Member Movement census (paused/ended) misleading.
 *     - ACTIVE direction (HIGHER STAKES): an active-like status (e.g. `Active - Comp`) that does NOT
 *       normalize to `active` UNDER-counts active members — and Attendance Health + Silent Churn are
 *       ALREADY LIVE off that count, so a miss corrupts numbers already on the page, not just MM.
 *   The probe enumerates the vocabulary and the predicted mapping; the HUMAN + Reviewer decide whether
 *   it is safe. If any real status would mislead, the §6 runbook STOPS and ships the smallest taxonomy
 *   PR first. This probe does NOT deploy, re-arm, invoke, persist, or touch Supabase / the edge fn.
 *
 * TWO DELIBERATE DEPARTURES from the sibling probes (called out for the Reviewer — both required so the
 * probe is a FAITHFUL PREDICTOR of the redeployed edge, and both safe):
 *   1. It IMPORTS the real `normalizeStatus` from `src/lib/gym/wodifyRetentionAggregate.ts` rather than
 *      reimplementing a mapping. The sibling probes deliberately avoid importing app code; this one
 *      MUST import the exact function the edge runs, so `normalizedTo` predicts the edge byte-for-byte.
 *      (That module's only transitive import is the locked `./silentChurn.ts`, whose only import is a
 *      TYPE-only `./memberFixture` — erased at runtime — so the import is pure and side-effect-free.)
 *   2. It EMITS raw `client_status` STRINGS verbatim as `value`. The sibling probes bucket status into
 *      an allowlist of category names and NEVER emit a raw value; this probe must show the literal
 *      vocabulary, which is the entire point of the gate. This is safe because `client_status` is a
 *      membership-CATEGORY enum label (e.g. `Active`, `Paused`, `Ended`), not member PII — it
 *      identifies no individual. Every OTHER upstream value stays unemitted, exactly like the siblings.
 *
 * Safety contract (RETENTION_FINISH_PLAN.md §4/§5 — same posture as the merged sibling probes, with the
 * one scoped status-string exception above)
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`. Never hardcoded, logged, printed,
 *     or echoed in errors. If unset/empty, exits WITHOUT making any request — and NEVER sources the key
 *     from Supabase secrets or the edge function (those are the server-side path, not this local probe).
 *   - Reads each row's `client_status` field IN MEMORY only. Output is ONLY `{ value, count,
 *     normalizedTo }` records (the vocabulary) plus safe transport/coverage metadata (counts, booleans,
 *     HTTP status classes) and pure rollups DERIVED from the vocabulary. The ONLY raw upstream data in
 *     output is the distinct `client_status` strings + their aggregate counts. NEVER names, member IDs,
 *     raw rows, exact dates, dues, request headers/URLs, keys, or raw/echoed response bodies.
 *   - Defense in depth on the one emitted upstream string: a `client_status` value that is NOT a normal
 *     short enum — over `MAX_STATUS_LEN` chars, or containing `@` (email-like) — is REDACTED to a fixed
 *     label and only counted, so a pathological free-text/PII value can never leak. Its `normalizedTo`
 *     is still the TRUE `normalizeStatus` result (redaction hides the display string, never the mapping).
 *   - Detects a Wodify ERROR ENVELOPE at transport-2xx (top-level DeveloperMessage / ErrorCode /
 *     HTTPCode / UserMessage) and reports it as a failure; the in-body HTTPCode is reduced to a status
 *     CLASS only (raw value + message text never read).
 *   - Paginates the FULL client set (mirrors the edge `fetchAllClients`: loop while `pagination.has_more`,
 *     `MAX_PAGES` safety bound) so a rare status on a later page is NOT missed. `coverageComplete`
 *     surfaces whether the whole vocabulary was scanned; a partial scan is never mistaken for complete.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it).
 *   Network-free safe-output self-test FIRST (makes NO request, needs NO key):
 *     npx tsx scripts/wodify/clientStatusVocab.ts --selftest
 *   Live run — worktree-safe: point --env-file at the primary clone's gitignored env by ABSOLUTE path:
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/clientStatusVocab.ts
 *   See scripts/wodify/README.md. Never inline-paste the key (it lands in shell history). The LIVE run
 *   is gated: it needs a separate explicit Wesley go (Phase 1 is author + self-test only).
 *
 * Call budget — GET `/clients` pages only (the same request the edge makes), no per-client calls, no
 * writes, no Supabase calls. Mirrors the edge so the observed vocabulary == what the edge will aggregate.
 */

import { normalizeStatus } from '../../src/lib/gym/wodifyRetentionAggregate.ts';

// ─── CONFIG — mirrors supabase/functions/sync-wodify-retention/index.ts so the probe predicts the edge ─
const BASE_URL = 'https://api.wodify.com/v1'; // §5 reported base URL; auth via x-api-key header.
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100; // Wodify caps at 100/page (edge PAGE_SIZE).
const MAX_PAGES = 50; // edge MAX_PAGES — ~5000 clients, far above the ~956-client set, so this is full
//                       coverage, not an early cap; reachedPageCap flags the (here unreachable) partial.
const REQUEST_TIMEOUT_MS = 15000; // edge WODIFY_TIMEOUT_MS.

// Defense-in-depth bounds for the one emitted upstream string (a normal enum is short + has no `@`).
const MAX_STATUS_LEN = 80;
const EMAIL_LIKE = /@/;
const MISSING_LABEL = '(absent_or_non_string)'; // client_status missing / null / non-string.
const REDACTED_LABEL = '(redacted_nonconforming_status)'; // oversized or email-like — never the raw value.

// §5 / #423: Wodify error-envelope markers (matched case-insensitively; values are NEVER emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// ─── Safe output contract ────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';
type NormalizedTo = 'active' | 'paused' | 'ended' | 'unknown';

// One vocabulary entry — THE primary artifact. `value` is the verbatim `client_status` string (or a
// fixed synthetic/redacted label); `normalizedTo` is exactly what the edge's `normalizeStatus` returns
// (null mapped to 'unknown'). Keyed internally by (value, normalizedTo) so a redacted bucket that
// genuinely maps to two classes is reported truthfully, never collapsed.
interface StatusVocabEntry {
  value: string;
  count: number;
  normalizedTo: NormalizedTo;
}

interface NormalizedRollup {
  distinctValues: number;
  members: number;
}

interface ClientStatusVocabResult {
  probe: 'clientStatusVocab';
  path: string; // PATH only — never a query string / substituted URL.
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass; // '2xx' when every fetched page was OK; else the failing class.
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  jsonParseable: boolean | null;
  recordArrayKey: string | null; // 'clients' — confirms the edge's records-array key/shape.
  pagesFetched: number;
  reachedPageCap: boolean; // stopped at MAX_PAGES with has_more still true (snapshot/vocabulary partial).
  coverageComplete: boolean; // true ⇒ the WHOLE client set was scanned — vocabulary is exhaustive.
  totalRecordsScanned: number; // members tallied across all fetched pages.

  // The vocabulary (sorted by count desc, then value asc). Each entry: { value, count, normalizedTo }.
  vocabulary: StatusVocabEntry[];

  // Pure rollups DERIVED from `vocabulary` (no new upstream data) — serve the two-direction acceptance.
  byNormalized: { active: NormalizedRollup; paused: NormalizedRollup; ended: NormalizedRollup; unknown: NormalizedRollup };
  // The review spotlight: every value that maps to `unknown`. A human scans these for anything that is
  // really active-like (active direction) or ended/paused-like (movement direction) → STOP + taxonomy PR.
  unknownStatusValues: StatusVocabEntry[];
}

// ─── Pure helpers (none emit, log, or retain values) ───────────────────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Map a raw `client_status` to its safe DISPLAY string. A normal short, non-email enum passes through
// verbatim (the point of the probe); anything pathological is redacted to a fixed label (counted, never
// shown). Non-string / missing → a fixed label. The redaction affects only the display string, never the
// `normalizedTo` (which is always computed from the REAL raw value).
function displayValue(rawStatus: unknown): string {
  if (typeof rawStatus !== 'string') return MISSING_LABEL;
  if (rawStatus.length > MAX_STATUS_LEN || EMAIL_LIKE.test(rawStatus)) return REDACTED_LABEL;
  return rawStatus;
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

// ─── Tally (pure; the self-test exercises this exact path with synthetic PII) ──────────────────────
// Accumulator keyed by `${displayValue} ${normalizedTo}` so each (value, mapping) pair is one entry.
type Accumulator = Map<string, StatusVocabEntry>;

function tallyStatus(acc: Accumulator, rawStatus: unknown): void {
  const normalizedTo: NormalizedTo = normalizeStatus(rawStatus) ?? 'unknown'; // the edge's exact mapping
  const value = displayValue(rawStatus);
  const key = `${value} ${normalizedTo}`;
  const existing = acc.get(key);
  if (existing) existing.count += 1;
  else acc.set(key, { value, count: 1, normalizedTo });
}

function tallyRecords(records: readonly unknown[], acc: Accumulator): void {
  for (const rec of records) {
    // A non-object row has no readable status — mirror the edge (normalizeStatus(undefined) → unknown).
    tallyStatus(acc, isPlainObject(rec) ? rec['client_status'] : undefined);
  }
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

function buildResult(acc: Accumulator, meta: TransportMeta): ClientStatusVocabResult {
  const vocabulary = [...acc.values()].sort(
    (a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
  );
  const totalRecordsScanned = vocabulary.reduce((sum, e) => sum + e.count, 0);
  const byNormalized = {
    active: { distinctValues: 0, members: 0 },
    paused: { distinctValues: 0, members: 0 },
    ended: { distinctValues: 0, members: 0 },
    unknown: { distinctValues: 0, members: 0 },
  };
  for (const e of vocabulary) {
    byNormalized[e.normalizedTo].distinctValues += 1;
    byNormalized[e.normalizedTo].members += e.count;
  }
  const unknownStatusValues = vocabulary.filter((e) => e.normalizedTo === 'unknown');
  const coverageComplete =
    meta.endpointReached &&
    meta.httpStatusClass === '2xx' &&
    !meta.errorEnvelopeDetected &&
    meta.jsonParseable !== false &&
    !meta.reachedPageCap &&
    meta.pagesFetched > 0 &&
    meta.recordArrayKey !== null && // shape was positively identified (records didn't move under a renamed key)
    totalRecordsScanned > 0; // at least one member actually tallied (not an empty `clients` array)

  return {
    probe: 'clientStatusVocab',
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
    vocabulary,
    byNormalized,
    unknownStatusValues,
  };
}

// ─── Live network layer (body read for tally only; never logged / returned as text) ───────────────
async function scanAllStatuses(apiKey: string): Promise<{ acc: Accumulator; meta: TransportMeta }> {
  const acc: Accumulator = new Map();
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
      return { acc, meta };
    }

    meta.httpStatusClass = statusClassOf(res.status);
    if (!res.ok) return { acc, meta }; // non-2xx — stop; coverage incomplete.

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
      return { acc, meta };
    }
    meta.jsonParseable = true;

    const envelope = detectErrorEnvelope(parsed);
    if (envelope.detected) {
      meta.errorEnvelopeDetected = true;
      meta.embeddedHttpStatusClass = envelope.embeddedStatusClass;
      return { acc, meta };
    }

    const clients = isPlainObject(parsed) ? parsed['clients'] : undefined;
    const records: unknown[] = Array.isArray(clients) ? clients : [];
    if (meta.recordArrayKey === null && Array.isArray(clients)) meta.recordArrayKey = 'clients';
    tallyRecords(records, acc);
    meta.pagesFetched += 1;

    const pagination = isPlainObject(parsed) ? parsed['pagination'] : undefined;
    const hasMore = isPlainObject(pagination) && pagination['has_more'] === true;
    if (!hasMore || records.length === 0) break;
    if (page === MAX_PAGES) meta.reachedPageCap = true; // more pages exist but we hit the safety bound.
  }

  return { acc, meta };
}

// ─── Network-free self-test (REQUIRED before any live run; makes NO request, needs NO key) ─────────
function runSelfTest(): void {
  // PII / secrets planted on the rows AND inside pathological status values. NONE may appear in output.
  const PII = [
    'SECRET_FIRST',
    'SECRET_LAST',
    'secret@member.example',
    '70001', // a fake member-ID VALUE
    '4242.42', // a fake dues VALUE
    '2021-03-09', // a fake exact date VALUE
    'OVERSIZED_PII_BLOB', // hidden inside an oversized status — must be redacted, never shown
    'evil@phish.example', // an email-like status — must be redacted, never shown
  ];
  // Synthetic /clients page. The probe reads ONLY `client_status`; the other PII fields exist precisely
  // to prove they are never read into output. Counts are chosen so every branch is exercised:
  const oversizedStatus = 'OVERSIZED_PII_BLOB_' + 'x'.repeat(100); // > MAX_STATUS_LEN → redacted
  const records: unknown[] = [
    { id: 70001, first_name: 'SECRET_FIRST', last_name: 'SECRET_LAST', email: 'secret@member.example', monthly_dues: 4242.42, last_attendance: '2021-03-09', client_status: 'Active' },
    { client_status: 'Active' },
    { client_status: 'Active' },
    { client_status: 'active' }, // distinct raw value vs 'Active' — both normalize to active
    { client_status: 'Paused' },
    { client_status: 'Paused' },
    { client_status: 'Frozen' },
    { client_status: 'On Hold' },
    { client_status: 'Ended' },
    { client_status: 'Ended' },
    { client_status: 'Cancelled' },
    { client_status: 'Active - Comp' }, // ACTIVE-direction trap — must surface as unknown
    { client_status: 'Suspended' }, // MOVEMENT-direction trap — looks paused/ended-ish, maps unknown
    { client_status: 'Suspended' },
    { client_status: 'Trial' },
    { client_status: '' }, // empty string → unknown
    { client_status: null }, // → MISSING_LABEL / unknown
    { client_status: 12345 }, // non-string → MISSING_LABEL / unknown
    { client_status: oversizedStatus }, // → REDACTED_LABEL / unknown
    { client_status: 'evil@phish.example' }, // email-like → REDACTED_LABEL / unknown
  ];

  const acc: Accumulator = new Map();
  tallyRecords(records, acc);
  const result = buildResult(acc, { ...freshMeta(), endpointReached: true, httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: 'clients', pagesFetched: 1 });
  const serialized = JSON.stringify(result, null, 2);

  // (1) NO planted PII token may appear anywhere in the output (raw rows are never emitted; pathological
  //     status values are redacted).
  const leaks = PII.filter((tok) => serialized.includes(tok));
  console.log(serialized);
  if (leaks.length > 0) {
    console.error(`SELFTEST FAIL: output contained disallowed token(s): ${leaks.join(', ')}`);
    process.exit(1);
    return;
  }

  // (2) The allowed status STRINGS ARE present (by design — proves the vocabulary is actually emitted).
  const mustAppear = ['Active', 'Paused', 'Ended', 'Active - Comp', 'Suspended'];
  const missing = mustAppear.filter((s) => !serialized.includes(s));
  if (missing.length > 0) {
    console.error(`SELFTEST FAIL: expected status string(s) absent from output: ${missing.join(', ')}`);
    process.exit(1);
    return;
  }

  // (3) Every vocabulary entry has EXACTLY the keys { value, count, normalizedTo } — nothing extra.
  const shapeOk = result.vocabulary.every((e) => {
    const keys = Object.keys(e).sort();
    return keys.length === 3 && keys[0] === 'count' && keys[1] === 'normalizedTo' && keys[2] === 'value';
  });

  const find = (value: string, normalizedTo: NormalizedTo): StatusVocabEntry | undefined =>
    result.vocabulary.find((e) => e.value === value && e.normalizedTo === normalizedTo);

  // (4) `normalizeStatus` is the IMPORTED function, not a reimplementation: cross-check each entry's
  //     `normalizedTo` against a direct call to the imported symbol on a verbatim (non-redacted) value.
  const importConsistent = result.vocabulary
    .filter((e) => e.value !== MISSING_LABEL && e.value !== REDACTED_LABEL)
    .every((e) => e.normalizedTo === (normalizeStatus(e.value) ?? 'unknown'));

  const expectations: Array<[string, boolean]> = [
    ['vocabulary shape == {value,count,normalizedTo}', shapeOk],
    ['normalizedTo matches imported normalizeStatus', importConsistent],
    ['entries == 13', result.vocabulary.length === 13],
    ['totalRecordsScanned == 20', result.totalRecordsScanned === 20],
    ['Active → active × 3', find('Active', 'active')?.count === 3],
    ['active → active × 1 (distinct raw value)', find('active', 'active')?.count === 1],
    ['Paused → paused × 2', find('Paused', 'paused')?.count === 2],
    ['Frozen → paused', find('Frozen', 'paused')?.count === 1],
    ['On Hold → paused', find('On Hold', 'paused')?.count === 1],
    ['Ended → ended × 2', find('Ended', 'ended')?.count === 2],
    ['Cancelled → ended', find('Cancelled', 'ended')?.count === 1],
    ['Active - Comp → unknown (ACTIVE-direction trap)', find('Active - Comp', 'unknown')?.count === 1],
    ['Suspended → unknown × 2 (MOVEMENT-direction trap)', find('Suspended', 'unknown')?.count === 2],
    ['Trial → unknown', find('Trial', 'unknown')?.count === 1],
    ['empty string → unknown', find('', 'unknown')?.count === 1],
    ['absent/non-string → unknown × 2', find(MISSING_LABEL, 'unknown')?.count === 2],
    ['oversized + email-like → redacted/unknown × 2', find(REDACTED_LABEL, 'unknown')?.count === 2],
    ['byNormalized.active == {2, 4}', result.byNormalized.active.distinctValues === 2 && result.byNormalized.active.members === 4],
    ['byNormalized.paused == {3, 4}', result.byNormalized.paused.distinctValues === 3 && result.byNormalized.paused.members === 4],
    ['byNormalized.ended == {2, 3}', result.byNormalized.ended.distinctValues === 2 && result.byNormalized.ended.members === 3],
    ['byNormalized.unknown == {6, 9}', result.byNormalized.unknown.distinctValues === 6 && result.byNormalized.unknown.members === 9],
    ['conservation: Σ counts == totalRecordsScanned', result.vocabulary.reduce((s, e) => s + e.count, 0) === result.totalRecordsScanned],
    ['unknownStatusValues count == 6', result.unknownStatusValues.length === 6],
    ['coverageComplete == true (all OK)', result.coverageComplete === true],
  ];
  const failed = expectations.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    console.error(`SELFTEST FAIL: behavioral expectation(s) not met: ${failed.join(' | ')}`);
    process.exit(1);
    return;
  }

  // (5) Coverage / transport branches — coverageComplete must be FALSE whenever the scan is not whole.
  const partials: Array<[string, ClientStatusVocabResult]> = [
    ['reachedPageCap', buildResult(acc, { ...freshMeta(), jsonParseable: true, pagesFetched: MAX_PAGES, reachedPageCap: true })],
    ['errorEnvelope', buildResult(acc, { ...freshMeta(), jsonParseable: true, pagesFetched: 1, errorEnvelopeDetected: true, embeddedHttpStatusClass: '4xx' })],
    ['non-2xx', buildResult(acc, { ...freshMeta(), httpStatusClass: '4xx', jsonParseable: true, pagesFetched: 1 })],
    ['network_error', buildResult(acc, { ...freshMeta(), endpointReached: false, httpStatusClass: 'network_error', pagesFetched: 0 })],
    ['non-json', buildResult(acc, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: false, pagesFetched: 0 })],
    // A clean, well-formed 2xx page is still NOT exhaustive coverage if the records-array shape is wrong —
    // an empty set or a renamed records key must never be read as "the whole vocabulary was scanned".
    // (a) key seen ('clients') but the page carried zero members → isolates the `totalRecordsScanned > 0` guard.
    ['zeroRecordsButKeySeen', buildResult(new Map<string, StatusVocabEntry>(), { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: 'clients', pagesFetched: 1 })],
    // (b) records present but the array key was never positively identified (shape regression / renamed key);
    //     uses the populated 20-record acc so the ONLY failing condition is recordArrayKey === null → isolates
    //     the `recordArrayKey !== null` guard and proves it is independently load-bearing.
    ['recordArrayKeyNull', buildResult(acc, { ...freshMeta(), httpStatusClass: '2xx', jsonParseable: true, recordArrayKey: null, pagesFetched: 1 })],
  ];
  const badPartials = partials.filter(([, r]) => r.coverageComplete !== false).map(([name]) => name);
  if (badPartials.length > 0) {
    console.error(`SELFTEST FAIL: coverageComplete should be false for: ${badPartials.join(', ')}`);
    process.exit(1);
    return;
  }

  // (6) Error-envelope detector — direct check (in-body HTTPCode → class only).
  const env = detectErrorEnvelope({ DeveloperMessage: 'x', ErrorCode: 'y', HTTPCode: 403, UserMessage: 'z' });
  if (!env.detected || env.embeddedStatusClass !== '4xx') {
    console.error('SELFTEST FAIL: error-envelope detector did not classify the synthetic envelope.');
    process.exit(1);
    return;
  }

  console.error('SELFTEST PASS: vocabulary emitted, no planted PII token in output, mapping == imported normalizeStatus, coverage + envelope branches verified; no network call made.');
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
        '--env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local scripts/wodify/clientStatusVocab.ts. ' +
        'No request was made.',
    );
    process.exit(1);
    return;
  }

  const { acc, meta } = await scanAllStatuses(apiKey);
  const result = buildResult(acc, meta);
  // ONLY the safe vocabulary + counts/metadata are printed — no rows, names, IDs, dates, dues, URLs, or key.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('client_status vocabulary probe failed before producing a result (no data emitted).');
  process.exit(1);
});
