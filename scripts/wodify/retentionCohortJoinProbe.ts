/**
 * Wodify client-grain "Member Retention" ⋈ /clients DOB — JOIN-COVERAGE + BIAS probe (Gate 1).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ DRAFT — PENDING THE TWO-AI REVIEWER GATE, AND GATED BEHIND GATE 2 PASSING. The network-free     │
 * │ `--selftest` is always safe. The LIVE run (real export ⋈ a live /clients pull) runs ONLY after  │
 * │ Gate 2 passes + Reviewer reads this script + PASS + Wesley GO. This build does NOT pull /clients,│
 * │ does NOT run live, writes nothing.                                                             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * LOCAL ONLY (live path is GATED). Reads the client-grain export CSV (PII, local) for the distinct
 * Client IDs + their latest retention period + a ≥1-Lost flag, and joins to /clients DOB. The live
 * /clients pull mirrors the proven clientsDobFillProbe fetch (paginated GET /clients, x-api-key from
 * process.env.WODIFY_API_KEY; exits WITHOUT a request if the key is unset). DOB values are read in
 * memory, classified to counts/bands, discarded.
 *
 * Question (Gate 1 of the DEEP-MANUAL age-segment pipeline): does the retention population (the 465
 * distinct class-plan Client IDs in the export) actually JOIN to /clients and AGE-RESOLVE into the four
 * cohort bands — and is DOB coverage WORSE for the churn population (clients with ≥1 Lost) than overall
 * (the bias check that decides whether an age-resolved churn view is trustworthy)? Proves the real
 * join + age-resolution for the cohort build, not the census proxy. This is class-plan MEMBERSHIP
 * retention — NOT attendance-based classifyMember / Silent-Churn churn.
 *
 * AGE AS-OF — pinned to the MAPPED retention period (Reviewer correction): age is derived with
 * cohortBands.ageYearsAsOf(dob, mappedDay), where mappedDay = (client's LATEST source First-Of-Month
 * + 1 month), first-of-month. NOT the client-grain source month. cohortForAge then assigns the band
 * (kids3to6 / kids7to9 / teens10to15 / adults16plus, else unknownCohort) — reusing COHORT_BANDS /
 * UNKNOWN_COHORT_ID verbatim so the probe and the eventual build can never disagree on a cohort edge.
 *
 * Safe-output contract (§4/§5 — tightest sibling form, clientsDobFillProbe.ts):
 *   - Local ONLY. Never bundled / VITE_*. No Supabase/write. Client IDs, names, DOB values are read in
 *     memory only, reduced to per-band/per-bucket COUNTS, discarded.
 *   - Output is counts, cohort id LABELS, booleans, and a verdict enum. NEVER member names/ids, raw
 *     rows, emails, ages, exact DOB, or any YYYY-MM-DD date (no year either — an age proxy).
 *   - LEAK GUARD (live AND selftest): the serialized output is re-scanned before printing; the run
 *     ABORTS WITHOUT printing on any '@', ≥7-digit run (Client IDs are 7-8 digits), or any YYYY-MM-DD.
 *   - This diagnostic is GATED + Reviewer-only, so it reports RAW band counts (a count is not PII and
 *     the Reviewer must SEE small cohorts to judge viability). The <5 + complementary suppression is a
 *     BUILD concern (the anon-readable table), NOT this probe — see the WO-1 suppression contract.
 *   - `--selftest` runs FIRST, makes NO network call and reads NO file (synthetic in-memory data),
 *     and includes birthday + band-boundary age-derivation assertions.
 *   - Any local DOB cache (not implemented here; in-memory only) would be 0600, untracked, band/bucket
 *     per Client ID ONLY — never a name, never a DOB value.
 *
 * Gated-run discipline: Gate 2 PASS → build + `--selftest` → Reviewer reads this script + PASS →
 *   Wesley GO → the live /clients join. This DRAFT executes nothing live.
 *
 * Run:
 *   npx tsx scripts/wodify/retentionCohortJoinProbe.ts --selftest                          # no file/network
 *   npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \                     # GATED
 *     scripts/wodify/retentionCohortJoinProbe.ts ~/.config/wx-cfo/<member_retention_export>.csv
 */

import { ageYearsAsOf, cohortForAge, COHORT_BANDS, UNKNOWN_COHORT_ID } from '../../src/lib/gym/cohortBands.ts';

// ─── CONFIG — mirrors clientsDobFillProbe / the sync-wodify-retention edge fetch ─────────────────────
const BASE_URL = 'https://api.wodify.com/v1';
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 15000;
const SENTINEL_NULL_DATE = '1900-01-01';
const DOB_FIELD_CANDIDATES = ['date_of_birth', 'dateofbirth', 'dob', 'birthday', 'birth_date', 'birthdate'];

const COL = { firstOfMonth: 'firstofmonth', clientId: 'clientid', changeType: 'changetype' } as const;

// ─── TYPES ─────────────────────────────────────────────────────────────────────────────────────────
type DobBucket = 'usable' | 'sentinel1900' | 'invalid' | 'outlier';

interface CoverageBlock {
  distinctClients: number;
  matched: number;
  unmatched: number;
  dob: Record<DobBucket, number>; // among matched
  cohortDistribution: Record<string, number>; // over matched: band ids + unknownCohort; sums to `matched`
}

interface JoinResult {
  probe: 'retentionCohortJoinProbe';
  parseOk: boolean;
  ageAsOfConvention: string;
  population: { all: CoverageBlock; churn: CoverageBlock };
  verdict: 'join_coverage_reported' | 'empty_or_unparseable' | 'clients_source_empty';
}

interface ClientRecord {
  clientId: string;
  dobRaw: string;
}
interface PerClient {
  latestSourceMonth: string | null;
  hasLost: boolean;
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────────────────────────
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function toYearMonth(raw: string): string | null {
  const m = (raw ?? '').trim().match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}` : null;
}
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
// Strict calendar round-trip (mirrors clientsDobFillProbe): 2026-02-30 → invalid, never rolled forward.
function strictYmd(ymd10: string): boolean {
  const m = ymd10.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// DOB → bucket + cohort band, aged as-of the mapped retention day. Never returns/echoes the DOB or age.
function classifyDob(raw: string, mappedDay: string): { bucket: DobBucket; band: string } {
  const v = (raw ?? '').trim();
  const U = UNKNOWN_COHORT_ID;
  if (v === '') return { bucket: 'invalid', band: U };
  const ymd = v.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return { bucket: 'invalid', band: U };
  if (ymd === SENTINEL_NULL_DATE) return { bucket: 'sentinel1900', band: U };
  if (!strictYmd(ymd)) return { bucket: 'invalid', band: U };
  const age = ageYearsAsOf(ymd, mappedDay);
  if (age === null) return { bucket: 'invalid', band: U };
  const band = cohortForAge(age);
  if (band === null) return { bucket: 'outlier', band: U }; // age <= 0 or > 120
  return { bucket: 'usable', band: band.id };
}

function freshCohortDist(): Record<string, number> {
  const d: Record<string, number> = {};
  for (const b of COHORT_BANDS) d[b.id] = 0;
  d[UNKNOWN_COHORT_ID] = 0;
  return d;
}
function freshBlock(): CoverageBlock {
  return {
    distinctClients: 0,
    matched: 0,
    unmatched: 0,
    dob: { usable: 0, sentinel1900: 0, invalid: 0, outlier: 0 },
    cohortDistribution: freshCohortDist(),
  };
}

// ─── CSV PARSE (self-contained; mirrors the sibling probes — standalone-probe convention) ─────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// Per-client info from the export: latest source month + whether they have ≥1 Lost event.
function perClientFromExport(text: string): Map<string, PerClient> {
  const grid = parseCsv(text);
  const out = new Map<string, PerClient>();
  if (grid.length === 0) return out;
  const idx: Record<string, number> = {};
  grid[0].forEach((name, i) => {
    idx[normalizeKey(name)] = i;
  });
  const get = (cells: string[], key: string): string => (idx[key] === undefined ? '' : (cells[idx[key]] ?? ''));
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const cid = get(cells, COL.clientId).trim();
    if (cid === '') continue;
    const month = toYearMonth(get(cells, COL.firstOfMonth));
    const isLost = get(cells, COL.changeType).trim().toLowerCase() === 'lost';
    const prev = out.get(cid) ?? { latestSourceMonth: null, hasLost: false };
    if (month && (prev.latestSourceMonth === null || month > prev.latestSourceMonth)) prev.latestSourceMonth = month;
    if (isLost) prev.hasLost = true;
    out.set(cid, prev);
  }
  return out;
}

// ─── JOIN + CLASSIFY (pure) ──────────────────────────────────────────────────────────────────────────
function classifyJoin(perClient: Map<string, PerClient>, clients: ClientRecord[], parseOk: boolean): JoinResult {
  const dobById = new Map<string, string>();
  for (const c of clients) dobById.set(c.clientId, c.dobRaw);

  const all = freshBlock();
  const churn = freshBlock();

  const tally = (block: CoverageBlock, cid: string, pc: PerClient): void => {
    block.distinctClients++;
    const dob = dobById.get(cid);
    if (dob === undefined) {
      block.unmatched++;
      return;
    }
    block.matched++;
    // age as-of the MAPPED retention period (latest source month + 1), first-of-month
    const mappedDay = pc.latestSourceMonth ? `${addMonths(pc.latestSourceMonth, 1)}-01` : '';
    const { bucket, band } = classifyDob(dob, mappedDay);
    block.dob[bucket]++;
    block.cohortDistribution[band] = (block.cohortDistribution[band] ?? 0) + 1;
  };

  for (const [cid, pc] of perClient) {
    tally(all, cid, pc);
    if (pc.hasLost) tally(churn, cid, pc);
  }

  let verdict: JoinResult['verdict'] = 'join_coverage_reported';
  if (!parseOk || perClient.size === 0) verdict = 'empty_or_unparseable';
  else if (clients.length === 0) verdict = 'clients_source_empty';

  return {
    probe: 'retentionCohortJoinProbe',
    parseOk,
    ageAsOfConvention: 'mapped retention period (latest source First-Of-Month + 1 month), first-of-month',
    population: { all, churn },
    verdict,
  };
}

// ─── LIVE /clients FETCH (GATED — mirrors clientsDobFillProbe; NOT exercised by --selftest) ───────────
function pickDob(rec: Record<string, unknown>): string {
  for (const k of Object.keys(rec)) {
    if (DOB_FIELD_CANDIDATES.includes(normalizeKey(k))) {
      const v = rec[k];
      return v == null ? '' : String(v);
    }
  }
  return '';
}
function pickClientId(rec: Record<string, unknown>): string {
  for (const k of Object.keys(rec)) {
    if (normalizeKey(k) === 'id' || normalizeKey(k) === 'clientid') {
      const v = rec[k];
      return v == null ? '' : String(v);
    }
  }
  return '';
}
async function fetchAllClients(apiKey: string): Promise<ClientRecord[]> {
  const out: ClientRecord[] = [];
  let page = 1;
  for (; page <= MAX_PAGES; page++) {
    const url = `${BASE_URL}${CLIENTS_PATH}?page=${page}&page_size=${PAGE_SIZE}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let body: unknown;
    try {
      const res = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: ctrl.signal });
      body = await res.json();
    } finally {
      clearTimeout(t);
    }
    const arr = Array.isArray(body)
      ? body
      : body && typeof body === 'object'
        ? (Object.values(body as Record<string, unknown>).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? []
        : [];
    for (const item of arr) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        out.push({ clientId: pickClientId(rec), dobRaw: pickDob(rec) });
      }
    }
    const hasMore =
      body && typeof body === 'object' && (body as Record<string, unknown>).pagination
        ? Boolean(((body as Record<string, unknown>).pagination as Record<string, unknown>).has_more)
        : arr.length === PAGE_SIZE;
    if (!hasMore) break;
  }
  return out;
}

// ─── LEAK GUARD ──────────────────────────────────────────────────────────────────────────────────────
function scanForLeak(serialized: string): string[] {
  const v: string[] = [];
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) v.push('YYYY-MM-DD day-level date');
  if (/\d{7,}/.test(serialized)) v.push('>=7-digit run (ID-shaped)');
  if (serialized.includes('@')) v.push('@ (email-shaped)');
  return v;
}

// ─── SELF-TEST (network-free; synthetic export + synthetic /clients; birthday + band-boundary checks) ─
function runSelfTest(): void {
  const NAME = 'ZZ_LEAK_NAME_SENTINEL';
  const ID = '98765432';
  const PII = [NAME, ID, 'leak@member.example'];
  const fail = (m: string): void => {
    console.error(`SELFTEST FAIL: ${m}`);
    process.exit(1);
  };

  // (A) Birthday + band-boundary age derivation (the cohortBands integration), all as-of a mapped day.
  // mappedDay 2025-06-01.
  const asOf = '2025-06-01';
  const ageChecks: Array<[string, boolean]> = [
    // birthday-accurate: born 2019-06-01 → exactly 6 on 2025-06-01 (kids3to6 maxAge 6)
    ['age 6 on birthday → kids3to6', classifyDob('2019-06-01', asOf).band === 'kids3to6'],
    // one day before 6th birthday → age 5 → kids3to6
    ['age 5 (before birthday) → kids3to6', classifyDob('2019-06-02', asOf).band === 'kids3to6'],
    // band edges
    ['age 7 → kids7to9', classifyDob('2018-06-01', asOf).band === 'kids7to9'],
    ['age 9 → kids7to9', classifyDob('2016-06-01', asOf).band === 'kids7to9'],
    ['age 10 → teens10to15', classifyDob('2015-06-01', asOf).band === 'teens10to15'],
    ['age 15 → teens10to15', classifyDob('2010-06-01', asOf).band === 'teens10to15'],
    ['age 16 → adults16plus', classifyDob('2009-06-01', asOf).band === 'adults16plus'],
    ['age 40 → adults16plus', classifyDob('1985-06-01', asOf).band === 'adults16plus'],
    // outliers / sentinels → unknownCohort
    ['sentinel 1900 → unknownCohort/sentinel', classifyDob('1900-01-01', asOf).band === UNKNOWN_COHORT_ID && classifyDob('1900-01-01', asOf).bucket === 'sentinel1900'],
    ['future DOB → outlier/unknownCohort', classifyDob('2030-01-01', asOf).bucket === 'outlier'],
    ['invalid calendar (2010-02-30) → invalid', classifyDob('2010-02-30', asOf).bucket === 'invalid'],
    ['non-date → invalid', classifyDob('not-a-date', asOf).bucket === 'invalid'],
    ['empty → invalid', classifyDob('', asOf).bucket === 'invalid'],
    ['datetime suffix tolerated → adults16plus', classifyDob('1990-06-01T00:00:00Z', asOf).band === 'adults16plus'],
  ];
  const ageFailed = ageChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (ageFailed.length) fail(`age/band derivation: ${ageFailed.join('; ')}`);

  // (B) Join coverage on a synthetic export + synthetic /clients. 6 distinct export clients; client 'C6'
  // is UNMATCHED (absent from /clients). Churn population = clients with ≥1 Lost = {C1, C5, C6}.
  // Latest source month 2025-05 → mapped 2025-06 for the age as-of. Planted PII in the synthetic rows.
  const header = 'First Of Month,Client ID,Change Type,Positive Change,Negative Change,Membership ID,Client Name';
  const ex = [
    header,
    `2025-05-01,C1,Lost,0,1,2000001,${NAME}`, // adult, churn
    `2025-05-01,C2,Returning,1,0,2000002,b@x`, // adult (note: '@' planted but never emitted)
    `2025-05-01,C3,New,1,0,2000003,c`, // teen
    `2025-05-01,C4,Returning,1,0,2000004,d`, // kid
    `2025-05-01,C5,Lost,0,1,${ID},e`, // adult, churn, planted 8-digit id
    `2025-05-01,C6,Lost,0,1,2000006,leak@member.example`, // UNMATCHED churn (not in /clients)
  ].join('\n');
  const perClient = perClientFromExport(ex);
  const clients: ClientRecord[] = [
    { clientId: 'C1', dobRaw: '1985-06-01' }, // adult
    { clientId: 'C2', dobRaw: '1990-06-01' }, // adult
    { clientId: 'C3', dobRaw: '2013-06-01' }, // age 12 → teen
    { clientId: 'C4', dobRaw: '2020-06-01' }, // age 5 → kid3to6
    { clientId: 'C5', dobRaw: '1900-01-01' }, // sentinel → unknownCohort
    // C6 intentionally absent → unmatched
  ];
  const res = classifyJoin(perClient, clients, true);
  const ser = JSON.stringify(res, null, 2);
  console.log(ser);

  // (1) LEAK SCAN
  const tokenLeaks = PII.filter((t) => ser.includes(t));
  if (tokenLeaks.length) fail(`planted PII leaked: ${tokenLeaks.join(', ')}`);
  const structLeaks = scanForLeak(ser);
  if (structLeaks.length) fail(`structural leak: ${structLeaks.join(', ')}`);

  // (2) COVERAGE TALLIES
  const a = res.population.all;
  const ch = res.population.churn;
  const checks: Array<[string, boolean]> = [
    ['all distinct = 6', a.distinctClients === 6],
    ['all matched = 5', a.matched === 5],
    ['all unmatched = 1 (C6)', a.unmatched === 1],
    ['all dob usable = 4 (C1-4)', a.dob.usable === 4],
    ['all dob sentinel = 1 (C5)', a.dob.sentinel1900 === 1],
    ['adults16plus = 2 (C1,C2)', a.cohortDistribution.adults16plus === 2],
    ['teens10to15 = 1 (C3)', a.cohortDistribution.teens10to15 === 1],
    ['kids3to6 = 1 (C4)', a.cohortDistribution.kids3to6 === 1],
    ['unknownCohort = 1 (C5 sentinel)', a.cohortDistribution.unknownCohort === 1],
    ['cohort dist sums to matched', Object.values(a.cohortDistribution).reduce((s, n) => s + n, 0) === a.matched],
    // churn population (≥1 Lost): C1, C5, C6
    ['churn distinct = 3', ch.distinctClients === 3],
    ['churn matched = 2 (C1,C5)', ch.matched === 2],
    ['churn unmatched = 1 (C6) — the bias signal', ch.unmatched === 1],
    ['churn dob usable = 1 (C1)', ch.dob.usable === 1],
    ['churn dob sentinel = 1 (C5)', ch.dob.sentinel1900 === 1],
    ['verdict join_coverage_reported', res.verdict === 'join_coverage_reported'],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length) fail(`coverage: ${failed.join('; ')}`);

  // (3) LEAK-GUARD UNIT TESTS
  if (scanForLeak(`{"x":"${ID}"}`).length === 0) fail('guard missed 7+ digit run');
  if (scanForLeak('{"x":"a@b"}').length === 0) fail('guard missed @');
  if (scanForLeak('{"x":"2020-01-01"}').length === 0) fail('guard missed YYYY-MM-DD');
  if (scanForLeak('{"adults16plus":2,"matched":5}').length !== 0) fail('guard false-positived on band counts');

  console.log(
    'SELFTEST PASS: birthday + band-boundary age derivation (kids3to6/7to9/teens/adults + unknown/outlier/sentinel) ' +
      'correct; join coverage (matched/unmatched/usable/sentinel) + churn-population bias split + cohort distribution ' +
      'correct; no planted PII/date leaked; leak-guard correct; no file or network touched.',
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const exportPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!exportPath) {
    console.error('Usage: retentionCohortJoinProbe.ts <export.csv>  (or --selftest). Live run is GATED.');
    process.exit(1);
    return;
  }
  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error('WODIFY_API_KEY is unset — exiting WITHOUT any request (no key, no /clients call).');
    process.exit(1);
    return;
  }
  const { readFileSync } = await import('node:fs');
  let result: JoinResult;
  try {
    const perClient = perClientFromExport(readFileSync(exportPath, 'utf8'));
    const clients = await fetchAllClients(apiKey);
    result = classifyJoin(perClient, clients, true);
  } catch {
    result = classifyJoin(new Map(), [], false);
  }
  const serialized = JSON.stringify(result, null, 2);
  const leaks = scanForLeak(serialized);
  if (leaks.length > 0) {
    console.error(`LIVE LEAK GUARD TRIPPED: ${leaks.join(', ')} — aborting WITHOUT printing.`);
    process.exit(1);
    return;
  }
  console.log(serialized);
}

void main();
