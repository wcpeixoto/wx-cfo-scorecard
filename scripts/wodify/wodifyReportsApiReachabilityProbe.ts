/**
 * Wodify developer-API REACHABILITY probe — does the /v1 API expose Progressions (belt levels,
 * Reports 68/69) and the client-grain "Member Retention" dataset? Decides Architecture A (server-side
 * PULL, mirrors sync-wodify-retention) vs Architecture B (owner CSV UPLOAD) for the Churn-by-Belt importer.
 *   LOCAL ONLY — NEVER imported by the SPA, never bundled, never run in CI.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ READ-ONLY. GETs a set of CANDIDATE paths (page=1, pageSize=1 — minimal), records ONLY the HTTP  │
 * │ status class + a few booleans + a record COUNT per path, and prints one counts/enums-only JSON. │
 * │ It makes NO writes, touches NO Supabase, and reads NO CSV. It exists solely to answer "is this   │
 * │ dataset on the API at all?" before anyone builds the browser-PII upload path.                    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Safe-output contract (mirrors the live-API probes — silentChurnByCommitmentBandProbe.ts / the /clients
 * probes): the rotated key is read ONLY from process.env.WODIFY_API_KEY (never hardcoded, logged, printed,
 * or echoed in errors); unset ⇒ exits WITHOUT any request. Any response body is read in memory ONLY to
 * classify it, then discarded — the probe emits ONLY: fixed path LABELS, HTTP status CLASSES (enum),
 * booleans, and non-identity COUNTS. NEVER names, ids, emails, exact dates, raw rows, URLs, headers, keys,
 * or bodies. A field-agnostic LEAK GUARD re-scans the serialized output and ABORTS WITHOUT printing on any
 * '@', ISO date, or 7+ digit run. `--selftest` runs FIRST, makes NO network call, and reads NO env key.
 *
 * CONTROLS make the result interpretable: a KNOWN-GOOD path (/clients) proves the key + transport work, so a
 * blanket 4xx on the candidates means "endpoint absent", not "key broken"; a KNOWN-ABSENT nonsense path shows
 * what a true miss looks like on this API.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it):
 *   npx tsx scripts/wodify/wodifyReportsApiReachabilityProbe.ts --selftest                 # no network / no key
 *   npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *     scripts/wodify/wodifyReportsApiReachabilityProbe.ts                                   # LIVE (gated)
 */

const BASE_URL = 'https://api.wodify.com/v1';
const PAGE_SIZE = 1; // minimal — reachability needs shape, not data. Fewer PII bytes transit memory.
const REQUEST_TIMEOUT_MS = 15000;

// Candidate paths grouped by the dataset they'd serve. Exact-case guesses at the developer-API surface for
// belt Progressions and the client-grain Member Retention report. The prior is "no" (these are admin custom
// reports); this probe tests it rather than assuming.
type Group = 'control_good' | 'control_absent' | 'progressions' | 'member_retention' | 'reports_generic';
const CANDIDATES: { path: string; group: Group }[] = [
  { path: '/clients', group: 'control_good' }, // known-good: proves key + transport
  { path: '/zzz_nonexistent_probe_path', group: 'control_absent' }, // known-absent: shows a true miss
  // Progressions / belt levels (Reports 68 Current + 69 Previous)
  { path: '/progressions', group: 'progressions' },
  { path: '/progression', group: 'progressions' },
  { path: '/belts', group: 'progressions' },
  { path: '/levels', group: 'progressions' },
  { path: '/skills', group: 'progressions' },
  { path: '/clientprogressions', group: 'progressions' },
  { path: '/client_progressions', group: 'progressions' },
  { path: '/clients/progressions', group: 'progressions' },
  { path: '/memberships/progressions', group: 'progressions' },
  // client-grain Member Retention (Change Type New/Returning/Lost per client per month)
  { path: '/retention', group: 'member_retention' },
  { path: '/memberretention', group: 'member_retention' },
  { path: '/member_retention', group: 'member_retention' },
  { path: '/memberships/retention', group: 'member_retention' },
  { path: '/clients/retention', group: 'member_retention' },
  // generic report-runner surfaces (would let us pull any ReportId)
  { path: '/reports', group: 'reports_generic' },
  { path: '/report', group: 'reports_generic' },
  { path: '/reports/68', group: 'reports_generic' },
  { path: '/reports/69', group: 'reports_generic' },
];

// Resilient record-array-key candidates (structural only — key NAMES are safe to emit; values never are).
const RECORD_ARRAY_KEYS = ['clients', 'memberships', 'data', 'results', 'result', 'items', 'records', 'value', 'rows'];
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

type HttpStatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'network_error';

interface PathResult {
  path: string;
  group: Group;
  httpStatusClass: HttpStatusClass;
  jsonParseable: boolean | null;
  errorEnvelopeDetected: boolean;
  recordArrayKeySeen: boolean;
  recordCount: number; // length of the first record array found (0 if none); NEVER contents.
  reachable: boolean; // 2xx && parseable JSON && !errorEnvelope
}

type Verdict =
  | 'architecture_a_candidate' // BOTH progressions AND member-retention reachable → API-pull worth designing
  | 'architecture_a_partial' // one of the two reachable → partial; deeper look
  | 'architecture_a_dead' // neither reachable → Architecture B (owner upload) stands
  | 'probe_inconclusive_transport'; // the known-good control failed → key/transport suspect, 4xx untrustworthy

interface ProbeResult {
  probe: 'wodifyReportsApiReachabilityProbe';
  baseHost: string; // host only, never a full URL with a query string
  pathsTested: number;
  results: PathResult[];
  controlGoodReachable: boolean;
  controlAbsentStatusClass: HttpStatusClass | null;
  anyProgressionsReachable: boolean;
  anyMemberRetentionReachable: boolean;
  anyReportsGenericReachable: boolean;
  verdict: Verdict;
}

// ─── Pure helpers (none emit, log, or retain values) ────────────────────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 500) return '5xx';
  return '4xx';
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function detectErrorEnvelope(parsed: unknown): boolean {
  if (!isPlainObject(parsed)) return false;
  const lower = new Set(Object.keys(parsed).map((k) => k.toLowerCase()));
  const hits = ERROR_ENVELOPE_MARKER_KEYS.filter((m) => lower.has(m));
  return lower.has('httpcode') || hits.length >= 2;
}
// Returns [seen, count] for the first record array found. Count is a length (safe); contents are never read.
function recordArrayInfo(parsed: unknown): [boolean, number] {
  if (!isPlainObject(parsed)) return [false, 0];
  for (const k of RECORD_ARRAY_KEYS) {
    if (Array.isArray(parsed[k])) return [true, (parsed[k] as unknown[]).length];
  }
  return [false, 0];
}
// Field-agnostic leak scan — an ISO date, '@', or a 7+ digit run (member/id) must never reach stdout.
function leaks(serialized: string): boolean {
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) return true;
  if (serialized.includes('@')) return true;
  if (/\d{7,}/.test(serialized)) return true;
  return false;
}

// ─── Classification (pure; exercised by the selftest without a network call) ────────────────────────
function classify(
  path: string,
  group: Group,
  raw: { statusClass: HttpStatusClass; jsonParseable: boolean | null; parsed: unknown },
): PathResult {
  const errorEnvelopeDetected = raw.jsonParseable === true ? detectErrorEnvelope(raw.parsed) : false;
  const [recordArrayKeySeen, recordCount] = raw.jsonParseable === true ? recordArrayInfo(raw.parsed) : [false, 0];
  const reachable = raw.statusClass === '2xx' && raw.jsonParseable === true && !errorEnvelopeDetected;
  return { path, group, httpStatusClass: raw.statusClass, jsonParseable: raw.jsonParseable, errorEnvelopeDetected, recordArrayKeySeen, recordCount, reachable };
}

function buildResult(results: PathResult[]): ProbeResult {
  const byGroup = (g: Group): PathResult[] => results.filter((r) => r.group === g);
  const controlGood = byGroup('control_good')[0];
  const controlAbsent = byGroup('control_absent')[0];
  const anyProgressionsReachable = byGroup('progressions').some((r) => r.reachable);
  const anyMemberRetentionReachable = byGroup('member_retention').some((r) => r.reachable);
  const anyReportsGenericReachable = byGroup('reports_generic').some((r) => r.reachable);
  const controlGoodReachable = !!controlGood?.reachable;

  let verdict: Verdict;
  if (!controlGoodReachable) {
    verdict = 'probe_inconclusive_transport';
  } else if ((anyProgressionsReachable || anyReportsGenericReachable) && anyMemberRetentionReachable) {
    verdict = 'architecture_a_candidate';
  } else if (anyProgressionsReachable || anyMemberRetentionReachable || anyReportsGenericReachable) {
    verdict = 'architecture_a_partial';
  } else {
    verdict = 'architecture_a_dead';
  }

  return {
    probe: 'wodifyReportsApiReachabilityProbe',
    baseHost: new URL(BASE_URL).host, // host only
    pathsTested: results.length,
    results,
    controlGoodReachable,
    controlAbsentStatusClass: controlAbsent?.httpStatusClass ?? null,
    anyProgressionsReachable,
    anyMemberRetentionReachable,
    anyReportsGenericReachable,
    verdict,
  };
}

// ─── Live network layer (body read for classification only; never logged / returned as text) ────────
async function probePath(apiKey: string, path: string, group: Group): Promise<PathResult> {
  const url = new URL(BASE_URL + path);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', String(PAGE_SIZE));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'x-api-key': apiKey, accept: 'application/json' }, // key never logged
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return classify(path, group, { statusClass: 'network_error', jsonParseable: null, parsed: null });
  }
  const statusClass = statusClassOf(res.status);
  let parsed: unknown = null;
  let jsonParseable: boolean | null = null;
  try {
    parsed = JSON.parse(await res.text());
    jsonParseable = true;
  } catch {
    jsonParseable = false;
  }
  return classify(path, group, { statusClass, jsonParseable, parsed });
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
  const fail = (m: string): void => { console.error(`SELFTEST FAIL: ${m}`); process.exit(1); };

  // Planted sentinels — none may appear in serialized output.
  const PLANTED = ['secret@member.example', '9000001', '2026-06-15', 'SECRET_NAME'];
  // A "good" body carrying PII (must be suppressed — only its COUNT/shape may surface).
  const goodBody = { clients: [{ id: '9000001', name: 'SECRET_NAME', email: 'secret@member.example', last_attendance: '2026-06-15' }], pagination: { has_more: false } };
  const errorBody = { httpCode: 404, errorCode: 'X', developerMessage: 'nope', userMessage: 'nope' };

  const synthetic: PathResult[] = [
    classify('/clients', 'control_good', { statusClass: '2xx', jsonParseable: true, parsed: goodBody }),
    classify('/zzz_nonexistent_probe_path', 'control_absent', { statusClass: '4xx', jsonParseable: true, parsed: errorBody }),
    classify('/progressions', 'progressions', { statusClass: '4xx', jsonParseable: true, parsed: errorBody }),
    classify('/retention', 'member_retention', { statusClass: 'network_error', jsonParseable: null, parsed: null }),
  ];
  const result = buildResult(synthetic);
  const serialized = JSON.stringify(result, null, 2);

  const checks: Array<[string, boolean]> = [
    ['control_good reachable (2xx + JSON + no envelope)', result.controlGoodReachable === true],
    ['good path recordCount == 1 (length only, not contents)', synthetic[0].recordCount === 1 && synthetic[0].recordArrayKeySeen === true],
    ['control_absent classed 4xx + errorEnvelope, NOT reachable', synthetic[1].httpStatusClass === '4xx' && synthetic[1].errorEnvelopeDetected === true && synthetic[1].reachable === false],
    ['progressions 4xx-envelope → not reachable', synthetic[2].reachable === false],
    ['member_retention network_error → not reachable, count 0', synthetic[3].reachable === false && synthetic[3].recordCount === 0],
    ['no progressions/member-retention reachable → verdict architecture_a_dead', result.verdict === 'architecture_a_dead'],
    ['controlAbsentStatusClass surfaced (4xx)', result.controlAbsentStatusClass === '4xx'],
    ['emits host only, no full URL', result.baseHost === 'api.wodify.com' && !serialized.includes('/v1')],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length > 0) return fail(`assertions: ${failed.join(' | ')}`);

  // Verdict-branch coverage.
  const reach = (path: string, group: Group): PathResult => classify(path, group, { statusClass: '2xx', jsonParseable: true, parsed: { data: [] } });
  const good = classify('/clients', 'control_good', { statusClass: '2xx', jsonParseable: true, parsed: goodBody });
  const vCandidate = buildResult([good, reach('/progressions', 'progressions'), reach('/retention', 'member_retention')]).verdict;
  const vPartial = buildResult([good, reach('/progressions', 'progressions')]).verdict;
  const vTransport = buildResult([classify('/clients', 'control_good', { statusClass: '5xx', jsonParseable: null, parsed: null })]).verdict;
  const branchChecks: Array<[string, boolean]> = [
    ['both reachable → architecture_a_candidate', vCandidate === 'architecture_a_candidate'],
    ['one reachable → architecture_a_partial', vPartial === 'architecture_a_partial'],
    ['control_good fails → probe_inconclusive_transport', vTransport === 'probe_inconclusive_transport'],
  ];
  const branchFailed = branchChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (branchFailed.length > 0) return fail(`verdict-branch: ${branchFailed.join(' | ')}`);

  // LEAK — no planted PII survives; the field-agnostic guard backs it; and the fixtures DID carry the tokens.
  const planted = PLANTED.filter((t) => serialized.includes(t));
  if (planted.length > 0) return fail(`output leaked planted token(s): ${[...new Set(planted)].join(', ')}`);
  if (leaks(serialized)) return fail("output tripped the field-agnostic leak guard");
  const rawFixtures = JSON.stringify({ goodBody, errorBody });
  const notIn = PLANTED.filter((t) => !rawFixtures.includes(t));
  if (notIn.length > 0) return fail(`fixtures missing planted token(s) — leak scan vacuous: ${notIn.join(', ')}`);

  console.log(serialized);
  console.log('SELFTEST PASS: status-class + JSON + error-envelope + record-count classification; verdict branches (candidate/partial/dead/inconclusive); host-only emit; planted PII/date/id suppressed; no network or key touched.');
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
      'WODIFY_API_KEY is not set. Provide it via a gitignored env file (never commit or paste it), e.g. npx ' +
        'tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local ' +
        'scripts/wodify/wodifyReportsApiReachabilityProbe.ts. No request was made.',
    );
    process.exit(1);
    return;
  }
  // Sequential GETs (bounded, page=1/pageSize=1). Read-only; no writes anywhere.
  const results: PathResult[] = [];
  for (const c of CANDIDATES) results.push(await probePath(apiKey, c.path, c.group));
  emit(buildResult(results));
}

main().catch(() => {
  console.error('wodify reports API reachability probe failed before producing a result (no data emitted).');
  process.exit(1);
});
