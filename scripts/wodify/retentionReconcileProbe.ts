/**
 * Wodify client-grain "Member Retention" — SEMANTIC + CONSERVATION reconciliation probe (Gate 2).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ DRAFT — PENDING THE TWO-AI REVIEWER GATE. The network-free `--selftest` is always safe and is  │
 * │ the documented pre-gate step. The LIVE reconcile (real export + the member_retention_rates     │
 * │ fixture) runs ONLY after Reviewer script PASS + Wesley GO. This build does NOT read the DB,     │
 * │ does NOT run live, writes nothing.                                                             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * LOCAL ONLY — reads two LOCAL files at runtime: the client-grain export CSV (PII) and a NON-PII
 * fixture of the 13 member_retention_rates rows (one-time anon read → local JSON, a GATED step; never
 * read by this build). NO network, NO key, NO Supabase, NO SPA import, NO write.
 *
 * Question (Gate 2 of the DEEP-MANUAL age-segment pipeline): do the client-grain New/Returning/Lost
 * rows, under the proven month mapping, reconcile EXACTLY to the already-imported gym-wide
 * member_retention_rates (#495)? Proving this pins the flow semantics + the count basis + the month
 * offset BEFORE any age-band build. This is CLASS-PLAN MEMBERSHIP retention — explicitly NOT the
 * attendance-based classifyMember / Silent-Churn churn (separate metric, separate table, separate path).
 *
 * LOAD-BEARING MONTH ALIGNMENT (Reviewer correction): the client-grain "First Of Month" is offset
 *   −1 month from the aggregate retention period. aggregate.period_month = First-Of-Month + 1 month.
 *   Worked example: source 2025-05 {New 103, Returning 115, Lost 1} → aggregate 2025-06 {new 103,
 *   lost 1, returning 115, prior 116, current 218}. The export has 13 COMPLETE source months
 *   (2025-05 … 2026-05) → aggregate periods 2025-06 … 2026-06; the trailing source 2026-06 is an
 *   INCOMPLETE pending intake (it maps to 2026-07, which has no closed reference row) and is excluded.
 *   The probe does NOT assume +1 — it tests {0, +1, −1} and proves the UNIQUE offset that ties ALL
 *   closed periods.
 *
 * Reconciliation per mapped period (ROWS basis, per the directive):
 *   new = #New rows · lost = #Lost rows · returning = #Returning rows ·
 *   prior = returning + lost · current = returning + new · retention = returning / prior.
 *   EXACT count match required for closed NON-seed months — NO ±tolerance; any delta is a finding.
 *   The count basis (rows vs Σ-magnitude) is PROVEN, not assumed: the probe also computes the
 *   Σ|negativeChange| magnitude and reports whether it too ties, plus the count of negativeChange>1
 *   rows — so "a Lost row = exactly one member" is validated by the reconciliation, not presumed.
 *   The first mapped period (member_retention_rates.is_seed_boundary) is reconciled KNOWINGLY and
 *   reported separately — a delta there may be seed-onboarding semantics, not drift, and never
 *   false-FAILs the run on its own.
 *
 * Safe-output contract (§4/§5 — tightest sibling form, clientsDobFillProbe.ts):
 *   - Local ONLY. Never bundled / VITE_*. No network/key/Supabase/write. Client IDs + names are read
 *     in memory only, reduced to per-(month × changeType) COUNTS, discarded.
 *   - Output is counts, category LABELS, "YYYY-MM" months, value-shape strings, deltas (small ints),
 *     booleans, and a verdict enum. NEVER member names/ids, raw rows, emails, or a YYYY-MM-DD date.
 *   - LEAK GUARD (live AND selftest): the serialized output is re-scanned before printing; the run
 *     ABORTS WITHOUT printing on any '@', ≥7-digit run (Client/Membership IDs are 7-8 digits; no
 *     legitimate aggregate for a ~1k-member gym reaches 7 integer digits), or any YYYY-MM-DD date.
 *   - `--selftest` runs FIRST, makes NO network call and reads NO file (synthetic in-memory data).
 *
 * Gated-run discipline: build + `--selftest` → Reviewer reads this script + PASS → Wesley GO →
 *   (the one-time anon fixture read, then) the live reconcile. This DRAFT executes nothing live.
 *
 * Run:
 *   npx tsx scripts/wodify/retentionReconcileProbe.ts --selftest                      # no file, no network
 *   npx tsx scripts/wodify/retentionReconcileProbe.ts <export.csv> <retention_rates_fixture.json>  # GATED
 */

import { readFileSync } from 'node:fs';

const CANDIDATE_OFFSETS = [0, 1, -1] as const;

// Known client-grain columns → normalized key (lowercase, alphanumerics only).
const COL = {
  firstOfMonth: 'firstofmonth',
  clientId: 'clientid',
  changeType: 'changetype',
  positiveChange: 'positivechange',
  negativeChange: 'negativechange',
} as const;

// ─── TYPES ─────────────────────────────────────────────────────────────────────────────────────────
interface RetentionRatesRow {
  period_month: string; // 'YYYY-MM'
  current_members: number;
  prior_members: number;
  lost_members: number;
  new_members: number;
  returning_members: number;
  retention_rate: number;
  is_seed_boundary: boolean;
}

interface ClientGrainRow {
  sourceMonth: string | null; // 'YYYY-MM'
  changeType: string;
  positiveChangeRaw: string;
  negativeChangeRaw: string;
}

interface PeriodDeltas {
  new: number;
  lost: number;
  returning: number;
  prior: number;
  current: number;
  retentionAbs: number; // |derived − fixture|, reported to 4 dp
}

interface ClosedPeriodReport {
  sourceMonth: string;
  mappedPeriod: string;
  isSeedBoundary: boolean;
  deltas: PeriodDeltas;
  exact: boolean;
}

interface ReconcileResult {
  probe: 'retentionReconcileProbe';
  parseOk: boolean;
  sourceRows: number;
  distinctSourceMonths: number;
  sourceMonthSpan: { min: string | null; max: string | null };
  crossTab: Array<{ changeType: string; positiveChange: string; negativeChange: string; count: number }>;
  negativeChangeGt1Count: number;
  countBasis: {
    lostRowsTie: boolean;
    lostMagnitudeTie: boolean;
    newRowsTie: boolean;
    returningRowsTie: boolean;
    // PROVEN basis for member_retention_rates.lost_members across closed non-seed periods:
    // 'rows' (a Lost ROW = one member, even when negativeChange>1), 'magnitude' (Σ|negativeChange|),
    // 'both' (indistinguishable — every magnitude was 1), or 'neither' (no clean tie).
    lostCountBasis: 'rows' | 'magnitude' | 'both' | 'neither';
  };
  offsetTest: Array<{ offset: number; closedPeriodsReconciled: number; closedPeriodsTotal: number }>;
  uniqueOffset: number | null;
  closedPeriods: ClosedPeriodReport[];
  seedBoundaryPeriod: (ClosedPeriodReport & { note: string }) | null;
  excludedPeriods: Array<{ sourceMonth: string; mappedPeriod: string; reason: string }>;
  verdict:
    | 'reconciles_exact'
    | 'reconcile_failed'
    | 'offset_ambiguous'
    | 'fixture_missing'
    | 'empty_or_unparseable';
  verdictProvisional: boolean; // true when a seed-boundary delta was observed (human judgment needed)
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
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function roundN(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ─── CSV PARSE (self-contained; mirrors memberRetentionClientGrainProbe.ts — standalone-probe convention) ─
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
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

function parseClientGrain(text: string): ClientGrainRow[] {
  const grid = parseCsv(text);
  if (grid.length === 0) return [];
  const idx: Record<string, number> = {};
  grid[0].forEach((name, i) => {
    idx[normalizeKey(name)] = i;
  });
  const get = (cells: string[], key: string): string => (idx[key] === undefined ? '' : (cells[idx[key]] ?? ''));
  const out: ClientGrainRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    out.push({
      sourceMonth: toYearMonth(get(cells, COL.firstOfMonth)),
      changeType: get(cells, COL.changeType).trim(),
      positiveChangeRaw: get(cells, COL.positiveChange).trim(),
      negativeChangeRaw: get(cells, COL.negativeChange).trim(),
    });
  }
  return out;
}

// ─── AGGREGATION + RECONCILIATION (pure) ─────────────────────────────────────────────────────────────
interface SourceMonthAgg {
  newRows: number;
  returningRows: number;
  lostRows: number;
  lostMagnitude: number; // Σ |negativeChange| over Lost rows
}

function aggregateBySourceMonth(rows: ClientGrainRow[]): Map<string, SourceMonthAgg> {
  const m = new Map<string, SourceMonthAgg>();
  for (const r of rows) {
    if (!r.sourceMonth) continue;
    const a = m.get(r.sourceMonth) ?? { newRows: 0, returningRows: 0, lostRows: 0, lostMagnitude: 0 };
    const ct = r.changeType.toLowerCase();
    if (ct === 'new') a.newRows++;
    else if (ct === 'returning') a.returningRows++;
    else if (ct === 'lost') {
      a.lostRows++;
      const neg = Math.abs(Number(r.negativeChangeRaw));
      a.lostMagnitude += Number.isFinite(neg) ? neg : 0;
    }
    m.set(r.sourceMonth, a);
  }
  return m;
}

function deltasFor(agg: SourceMonthAgg, fx: RetentionRatesRow): PeriodDeltas {
  const newV = agg.newRows;
  const lostV = agg.lostRows;
  const retV = agg.returningRows;
  const prior = retV + lostV;
  const current = retV + newV;
  const retention = prior > 0 ? retV / prior : 0;
  return {
    new: newV - fx.new_members,
    lost: lostV - fx.lost_members,
    returning: retV - fx.returning_members,
    prior: prior - fx.prior_members,
    current: current - fx.current_members,
    retentionAbs: roundN(Math.abs(retention - fx.retention_rate)),
  };
}

function isExact(d: PeriodDeltas): boolean {
  // Counts must be EXACT — no tolerance (the real conservation check, per the directive). The stored
  // retention_rate is a 2-DECIMAL display value (e.g. 0.99), and rate = returning/prior is fully
  // determined by the counts, so the rate is checked at its stored precision (|Δ| ≤ 0.005, half a unit
  // at 2dp) NOT to 1e-6 — a precision match, never a count tolerance. The rate term is only reached
  // once the counts already tie, so it can never mask a count discrepancy (those fail the === 0 checks).
  return d.new === 0 && d.lost === 0 && d.returning === 0 && d.prior === 0 && d.current === 0 && d.retentionAbs <= 0.005;
}

// Count closed (mapped-in-fixture), NON-seed periods that reconcile exactly for a given offset.
function reconcileCountForOffset(
  bySource: Map<string, SourceMonthAgg>,
  fixtureByPeriod: Map<string, RetentionRatesRow>,
  offset: number,
): { reconciled: number; total: number } {
  let reconciled = 0;
  let total = 0;
  for (const [sourceMonth, agg] of bySource) {
    const mapped = addMonths(sourceMonth, offset);
    const fx = fixtureByPeriod.get(mapped);
    if (!fx || fx.is_seed_boundary) continue; // only closed, non-seed periods judge the offset
    total++;
    if (isExact(deltasFor(agg, fx))) reconciled++;
  }
  return { reconciled, total };
}

function classify(rows: ClientGrainRow[], fixture: RetentionRatesRow[], parseOk: boolean): ReconcileResult {
  const sourceMonthsSet = new Set<string>();
  for (const r of rows) if (r.sourceMonth) sourceMonthsSet.add(r.sourceMonth);
  const sortedMonths = [...sourceMonthsSet].sort();

  // cross-tab
  const ctMap = new Map<string, number>();
  let negGt1 = 0;
  for (const r of rows) {
    const key = `${r.changeType || '(blank)'} ${r.positiveChangeRaw || '(blank)'} ${r.negativeChangeRaw || '(blank)'}`;
    ctMap.set(key, (ctMap.get(key) ?? 0) + 1);
    const neg = Math.abs(Number(r.negativeChangeRaw));
    if (Number.isFinite(neg) && neg > 1) negGt1++;
  }
  const crossTab = [...ctMap.entries()]
    .map(([k, count]) => {
      const [changeType, positiveChange, negativeChange] = k.split(' ');
      return { changeType, positiveChange, negativeChange, count };
    })
    .sort((a, b) => b.count - a.count || a.changeType.localeCompare(b.changeType));

  const bySource = aggregateBySourceMonth(rows);
  const fixtureByPeriod = new Map<string, RetentionRatesRow>();
  for (const f of fixture) fixtureByPeriod.set(f.period_month, f);

  const baseResult = (
    verdict: ReconcileResult['verdict'],
  ): ReconcileResult => ({
    probe: 'retentionReconcileProbe',
    parseOk,
    sourceRows: rows.length,
    distinctSourceMonths: sourceMonthsSet.size,
    sourceMonthSpan: { min: sortedMonths[0] ?? null, max: sortedMonths[sortedMonths.length - 1] ?? null },
    crossTab,
    negativeChangeGt1Count: negGt1,
    countBasis: {
      lostRowsTie: false,
      lostMagnitudeTie: false,
      newRowsTie: false,
      returningRowsTie: false,
      lostCountBasis: 'neither',
    },
    offsetTest: [],
    uniqueOffset: null,
    closedPeriods: [],
    seedBoundaryPeriod: null,
    excludedPeriods: [],
    verdict,
    verdictProvisional: false,
  });

  if (!parseOk || rows.length === 0) return baseResult('empty_or_unparseable');
  if (fixture.length === 0) return baseResult('fixture_missing');

  // offset test — which offsets reconcile all closed non-seed periods
  const offsetTest = CANDIDATE_OFFSETS.map((offset) => {
    const { reconciled, total } = reconcileCountForOffset(bySource, fixtureByPeriod, offset);
    return { offset, closedPeriodsReconciled: reconciled, closedPeriodsTotal: total };
  });
  const fullyReconciling = offsetTest.filter((o) => o.closedPeriodsTotal > 0 && o.closedPeriodsReconciled === o.closedPeriodsTotal);
  const uniqueOffset = fullyReconciling.length === 1 ? fullyReconciling[0].offset : null;

  const result = baseResult('reconcile_failed');
  result.offsetTest = offsetTest;
  result.uniqueOffset = uniqueOffset;

  if (uniqueOffset === null) {
    result.verdict = fullyReconciling.length > 1 ? 'offset_ambiguous' : 'reconcile_failed';
    return result;
  }

  // full reconciliation under the unique offset
  const closed: ClosedPeriodReport[] = [];
  const excluded: ReconcileResult['excludedPeriods'] = [];
  let seed: (ClosedPeriodReport & { note: string }) | null = null;
  // basis accumulators
  let lostRowsTie = true;
  let lostMagTie = true;
  let newRowsTie = true;
  let retRowsTie = true;
  let judgedAny = false;

  for (const sourceMonth of sortedMonths) {
    const agg = bySource.get(sourceMonth)!;
    const mapped = addMonths(sourceMonth, uniqueOffset);
    const fx = fixtureByPeriod.get(mapped);
    if (!fx) {
      // no closed reference row → incomplete/trailing intake; structurally confirmed when ret+lost are empty
      const structurallyIncomplete = agg.returningRows === 0 && agg.lostRows === 0;
      excluded.push({
        sourceMonth,
        mappedPeriod: mapped,
        reason: structurallyIncomplete ? 'no_fixture_row + structurally_incomplete (Returning=0,Lost=0)' : 'no_fixture_row',
      });
      continue;
    }
    const d = deltasFor(agg, fx);
    const exact = isExact(d);
    const rep: ClosedPeriodReport = { sourceMonth, mappedPeriod: mapped, isSeedBoundary: fx.is_seed_boundary, deltas: d, exact };
    if (fx.is_seed_boundary) {
      seed = {
        ...rep,
        note: exact
          ? 'seed-boundary period reconciles exactly (counts tie despite trend-exclusion)'
          : 'seed-boundary delta — likely onboarding semantics, NOT drift; reconcile knowingly (human judgment)',
      };
      continue; // seed period does not gate the verdict
    }
    closed.push(rep);
    judgedAny = true;
    // basis checks (non-seed closed periods)
    if (agg.lostRows !== fx.lost_members) lostRowsTie = false;
    if (agg.lostMagnitude !== fx.lost_members) lostMagTie = false;
    if (agg.newRows !== fx.new_members) newRowsTie = false;
    if (agg.returningRows !== fx.returning_members) retRowsTie = false;
  }

  result.closedPeriods = closed;
  result.seedBoundaryPeriod = seed;
  result.excludedPeriods = excluded;
  result.countBasis = {
    lostRowsTie,
    lostMagnitudeTie: lostMagTie,
    newRowsTie,
    returningRowsTie: retRowsTie,
    lostCountBasis: lostRowsTie && lostMagTie ? 'both' : lostRowsTie ? 'rows' : lostMagTie ? 'magnitude' : 'neither',
  };
  const allClosedExact = judgedAny && closed.every((p) => p.exact);
  result.verdict = allClosedExact ? 'reconciles_exact' : 'reconcile_failed';
  result.verdictProvisional = seed !== null && !seed.exact;
  return result;
}

// ─── LEAK GUARD ──────────────────────────────────────────────────────────────────────────────────────
function scanForLeak(serialized: string): string[] {
  const v: string[] = [];
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) v.push('YYYY-MM-DD day-level date');
  if (/\d{7,}/.test(serialized)) v.push('>=7-digit run (ID-shaped)');
  if (serialized.includes('@')) v.push('@ (email-shaped)');
  return v;
}

// ─── SELF-TEST (network-free; synthetic export + synthetic fixture; planted PII) ──────────────────────
function runSelfTest(): void {
  const NAME = 'ZZ_LEAK_NAME_SENTINEL';
  const ID = '98765432'; // 8-digit fake Client ID
  const PII = [NAME, ID, 'leak@member.example'];
  const fail = (m: string): void => {
    console.error(`SELFTEST FAIL: ${m}`);
    process.exit(1);
  };

  // Synthetic client-grain export. Source months 2025-05, 2025-06, 2025-07 are COMPLETE;
  // 2025-08 is an INCOMPLETE trailing intake (only New, no Returning/Lost). All Lost rows carry
  // negativeChange=1 EXCEPT one planted negativeChange=2 in the incomplete month (to exercise >1
  // detection without breaking a closed reconciliation). Planted PII in extra columns.
  const header = 'First Of Month,Client ID,Change Type,Positive Change,Negative Change,Membership ID,Client Name';
  const lines = [header];
  const emit = (month: string, type: string, pos: string, neg: string, cid = '1001', nm = 'A'): void => {
    lines.push(`${month}-01,${cid},${type},${pos},${neg},2000001,${nm}`);
  };
  // 2025-05 → mapped 2025-06 (seed boundary): New 3, Returning 5, Lost 1 ⇒ prior 6, current 8, ret 5/6
  for (let i = 0; i < 3; i++) emit('2025-05', 'New', '1', '0');
  for (let i = 0; i < 5; i++) emit('2025-05', 'Returning', '1', '0');
  emit('2025-05', 'Lost', '0', '1');
  // 2025-06 → mapped 2025-07 (CLOSED): New 2, Returning 7, Lost 2 ROWS but Σ|neg|=3 (one neg=2). The
  // fixture's lost_members=2 (ROW count) ⇒ proves member_retention_rates counts a Lost ROW as one
  // member even when negativeChange>1 (lostRows tie, lostMagnitude does NOT → basis='rows'). Planted PII here.
  emit('2025-06', 'New', '1', '0', ID, NAME);
  emit('2025-06', 'New', '1', '0');
  for (let i = 0; i < 7; i++) emit('2025-06', 'Returning', '1', '0');
  emit('2025-06', 'Lost', '0', '1');
  emit('2025-06', 'Lost', '0', '2', '1002', 'leak@member.example'); // neg=2 → lostRows=2, lostMagnitude=3
  // 2025-07 → mapped 2025-08 (CLOSED): New 4, Returning 6, Lost 1 ⇒ prior 7, current 10, ret 6/7
  for (let i = 0; i < 4; i++) emit('2025-07', 'New', '1', '0');
  for (let i = 0; i < 6; i++) emit('2025-07', 'Returning', '1', '0');
  emit('2025-07', 'Lost', '0', '1');
  // 2025-08 → mapped 2025-09: INCOMPLETE trailing intake — New only, no Returning/Lost (mirrors the real
  // client-grain 2026-06). Maps to 2025-09, which has NO fixture row ⇒ detected as incomplete + excluded.
  for (let i = 0; i < 2; i++) emit('2025-08', 'New', '1', '0');
  const csv = lines.join('\n');

  // Synthetic member_retention_rates fixture — mapped periods (source +1). 2025-06 is seed boundary.
  const fixture: RetentionRatesRow[] = [
    { period_month: '2025-06', current_members: 8, prior_members: 6, lost_members: 1, new_members: 3, returning_members: 5, retention_rate: 5 / 6, is_seed_boundary: true },
    { period_month: '2025-07', current_members: 9, prior_members: 9, lost_members: 2, new_members: 2, returning_members: 7, retention_rate: 0.78, is_seed_boundary: false }, // 2dp-rounded (true 7/9=0.7778) — guards the precision-aware rate check
    { period_month: '2025-08', current_members: 10, prior_members: 7, lost_members: 1, new_members: 4, returning_members: 6, retention_rate: 6 / 7, is_seed_boundary: false },
  ];

  const rows = parseClientGrain(csv);
  const res = classify(rows, fixture, true);
  const ser = JSON.stringify(res, null, 2);
  console.log(ser);

  // (1) LEAK SCAN
  const tokenLeaks = PII.filter((t) => ser.includes(t));
  if (tokenLeaks.length) fail(`planted PII leaked: ${tokenLeaks.join(', ')}`);
  const structLeaks = scanForLeak(ser);
  if (structLeaks.length) fail(`structural leak: ${structLeaks.join(', ')}`);

  // (2) BEHAVIORAL CHECKS
  const offset = (o: number) => res.offsetTest.find((x) => x.offset === o)!;
  const checks: Array<[string, boolean]> = [
    ['verdict reconciles_exact', res.verdict === 'reconciles_exact'],
    ['unique offset = +1', res.uniqueOffset === 1],
    ['offset +1 reconciles all closed', offset(1).closedPeriodsReconciled === offset(1).closedPeriodsTotal && offset(1).closedPeriodsTotal === 2],
    ['offset 0 does NOT fully reconcile', offset(0).closedPeriodsReconciled < offset(0).closedPeriodsTotal || offset(0).closedPeriodsTotal === 0],
    ['offset -1 does NOT fully reconcile', offset(-1).closedPeriodsReconciled < offset(-1).closedPeriodsTotal || offset(-1).closedPeriodsTotal === 0],
    ['2 closed non-seed periods judged', res.closedPeriods.length === 2],
    ['all closed periods exact', res.closedPeriods.every((p) => p.exact)],
    // 2025-07 fixture rate is 2dp-rounded (0.78 vs true 0.7778): counts tie exactly AND the rate gap is
    // > 1e-6 but ≤ 0.005 ⇒ proves the precision-aware rate check passes where the old 1e-6 bound would FAIL.
    ['2dp-rounded rate does not false-fail', (() => { const p = res.closedPeriods.find((x) => x.mappedPeriod === '2025-07'); return !!p && p.exact === true && p.deltas.retentionAbs > 1e-6 && p.deltas.retentionAbs <= 0.005; })()],
    ['seed-boundary captured (2025-06)', res.seedBoundaryPeriod?.mappedPeriod === '2025-06'],
    ['seed-boundary reconciles exact', res.seedBoundaryPeriod?.exact === true],
    ['incomplete 2025-08→2025-09 excluded (structurally incomplete)', res.excludedPeriods.some((e) => e.mappedPeriod === '2025-09' && e.reason.includes('structurally_incomplete'))],
    ['negativeChange>1 detected (=1 planted)', res.negativeChangeGt1Count === 1],
    ['lost rows tie', res.countBasis.lostRowsTie === true],
    ['lost MAGNITUDE does NOT tie (neg=2 in a closed month)', res.countBasis.lostMagnitudeTie === false],
    ['new rows tie', res.countBasis.newRowsTie === true],
    ['returning rows tie', res.countBasis.returningRowsTie === true],
    // The closed-month neg=2 row makes rows tie while magnitude doesn't ⇒ proven basis = ROWS
    // (a Lost row = exactly one member, the member-count basis matching member_retention_rates.lost_members).
    ['lost count basis PROVEN = rows', res.countBasis.lostCountBasis === 'rows'],
    ['crossTab has New/Returning/Lost', new Set(res.crossTab.map((c) => c.changeType)).size === 3],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length) fail(`behavioral: ${failed.join('; ')}`);

  // (3) FAIL-DETECTION: corrupt one closed fixture count ⇒ verdict must flip to reconcile_failed.
  const corrupt = fixture.map((f) => (f.period_month === '2025-07' ? { ...f, lost_members: 99 } : f));
  const resBad = classify(rows, corrupt, true);
  if (resBad.verdict === 'reconciles_exact') fail('corrupted fixture still passed (fail-detection broken)');

  // (4) OFFSET-UNIQUENESS: a fixture shifted so BOTH +1 and 0 tie would be ambiguous — assert single offset here.
  if (res.uniqueOffset !== 1) fail('offset not uniquely +1');

  // (5) LEAK-GUARD UNIT TESTS
  if (scanForLeak(`{"x":"${ID}"}`).length === 0) fail('guard missed 7+ digit run');
  if (scanForLeak('{"x":"a@b"}').length === 0) fail('guard missed @');
  if (scanForLeak('{"x":"2020-01-01"}').length === 0) fail('guard missed YYYY-MM-DD');
  if (scanForLeak('{"min":"2025-06","n":2000,"d":-3}').length !== 0) fail('guard false-positived on YYYY-MM + small ints');

  console.log(
    'SELFTEST PASS: no planted PII/date leaked; cross-tab + negativeChange>1 detection, UNIQUE +1 offset ' +
      '(0/−1 rejected), exact closed reconciliation, seed-boundary captured-not-failed, incomplete-trailing exclusion, ' +
      'fail-detection, and leak-guard all correct; no file or network touched.',
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────────────────
function main(): void {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const [exportPath, fixturePath] = args;
  if (!exportPath || !fixturePath) {
    console.error('Usage: retentionReconcileProbe.ts <export.csv> <retention_rates_fixture.json>  (or --selftest)');
    process.exit(1);
    return;
  }
  let result: ReconcileResult;
  try {
    const rows = parseClientGrain(readFileSync(exportPath, 'utf8'));
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as RetentionRatesRow[];
    result = classify(rows, fixture, true);
  } catch {
    result = classify([], [], false);
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

main();
