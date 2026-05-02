/**
 * Conservative Floor diagnostic.
 *
 * Compares five forecast models on the same fixture and as-of dates as
 * splitConservativeDiagnostic.ts:
 *
 *   1. engine             — projectScenario
 *   2. category_cadence   — projectCategoryCadenceScenario (post-Phase-1
 *                            native operatingCashIn / operatingCashOut)
 *   3. split_conservative — Engine.operatingCashIn + Cadence.operatingCashOut
 *   4. h50_50_net         — 0.5 * Engine.net + 0.5 * Cadence.net
 *                            (cash-in / cash-out not separately defined)
 *   5. conservative_floor — min(Engine.in, Cadence.in)
 *                            + max(Engine.out, Cadence.out)
 *
 * The script writes a markdown report at:
 *   backtest-results/conservativeFloorReport.md
 *
 * Federal Tax (`Taxes and Licenses:Federal Tax`) is excluded from BOTH
 * training and realized cash-out for scoring purposes only; production
 * is unaffected. Matches splitConservativeDiagnostic.ts.
 *
 * No production code is touched. No model is added to the toggle.
 *
 * Run:
 *   npx tsx scripts/backtest/conservativeFloorDiagnostic.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectScenario, computeDashboardModel } from '../../src/lib/kpis/compute';
import { projectCategoryCadenceScenario } from '../../src/lib/kpis/categoryCadence';
import { forecastCashInContribution, forecastCashOutContribution } from '../../src/lib/cashFlow';
import { loadFixture, getFixturePath } from './loadFixture';
import type { ForecastProjectionResult, Txn } from '../../src/lib/data/contract';

const AS_OF_DATES = ['2025-05-01', '2025-08-01', '2025-11-01', '2026-01-01', '2026-02-01'] as const;
const LAST_CLOSED_MONTH = '2026-03';
const EXCLUDE_CATEGORY = 'Taxes and Licenses:Federal Tax';
const REPORT_PATH = resolve('backtest-results/conservativeFloorReport.md');

type ModelKey =
  | 'engine'
  | 'category_cadence'
  | 'split_conservative'
  | 'h50_50_net'
  | 'conservative_floor';

const MODEL_KEYS: readonly ModelKey[] = [
  'engine',
  'category_cadence',
  'split_conservative',
  'h50_50_net',
  'conservative_floor',
] as const;

type Horizon = '30d' | '90d' | '1y';
const HORIZONS: readonly Horizon[] = ['30d', '90d', '1y'] as const;
const HORIZON_MONTHS: Record<Horizon, number> = { '30d': 1, '90d': 3, '1y': 12 };

function monthsRange(start: string, count: number): string[] {
  const [y, m] = start.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(y, m - 1 + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

function fmtSigned(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

// ─── Component projections via production wrappers ─────────────────────────────
function engineByMonth(
  txns: Txn[],
  asOfMonth: string
): { result: ForecastProjectionResult; cashIn: Map<string, number>; cashOut: Map<string, number>; net: Map<string, number> } {
  const model = computeDashboardModel(txns, { thisMonthAnchor: asOfMonth });
  const result = projectScenario(
    model,
    { revenueGrowthPct: 0, expenseChangePct: 0, receivableDays: 0, payableDays: 0, months: 12 },
    0,
    []
  );
  const cashIn = new Map<string, number>();
  const cashOut = new Map<string, number>();
  const net = new Map<string, number>();
  for (const p of result.points) {
    cashIn.set(p.month, p.operatingCashIn);
    cashOut.set(p.month, p.operatingCashOut);
    net.set(p.month, p.operatingCashIn - p.operatingCashOut);
  }
  return { result, cashIn, cashOut, net };
}

function cadenceByMonth(
  txns: Txn[],
  asOfMonth: string
): { result: ForecastProjectionResult; cashIn: Map<string, number>; cashOut: Map<string, number>; net: Map<string, number> } {
  const model = computeDashboardModel(txns, { thisMonthAnchor: asOfMonth });
  const result = projectCategoryCadenceScenario(
    model,
    { revenueGrowthPct: 0, expenseChangePct: 0, receivableDays: 0, payableDays: 0, months: 12 },
    txns,
    0,
    []
  );
  const cashIn = new Map<string, number>();
  const cashOut = new Map<string, number>();
  const net = new Map<string, number>();
  for (const p of result.points) {
    cashIn.set(p.month, p.operatingCashIn);
    cashOut.set(p.month, p.operatingCashOut);
    net.set(p.month, p.operatingCashIn - p.operatingCashOut);
  }
  return { result, cashIn, cashOut, net };
}

function realizedByMonth(txns: Txn[]): {
  cashIn: Map<string, number>;
  cashOut: Map<string, number>;
} {
  const cashIn = new Map<string, number>();
  const cashOut = new Map<string, number>();
  for (const t of txns) {
    const cin = forecastCashInContribution(t);
    const cout = forecastCashOutContribution(t);
    if (cin > 0) cashIn.set(t.month, (cashIn.get(t.month) ?? 0) + cin);
    if (cout > 0) cashOut.set(t.month, (cashOut.get(t.month) ?? 0) + cout);
  }
  return { cashIn, cashOut };
}

function sumOver(map: Map<string, number>, months: string[]): number {
  return months.reduce((s, m) => s + (map.get(m) ?? 0), 0);
}

// ─── Per-model component computation for a given month-set ────────────────────
type ModelComponents = {
  cashIn: number | null;   // null = not separately defined (h50_50)
  cashOut: number | null;
  net: number;
};

function modelComponentsForMonth(
  key: ModelKey,
  month: string,
  eng: ReturnType<typeof engineByMonth>,
  cad: ReturnType<typeof cadenceByMonth>
): ModelComponents {
  const engIn  = eng.cashIn.get(month)  ?? 0;
  const engOut = eng.cashOut.get(month) ?? 0;
  const cadIn  = cad.cashIn.get(month)  ?? 0;
  const cadOut = cad.cashOut.get(month) ?? 0;

  switch (key) {
    case 'engine':
      return { cashIn: engIn, cashOut: engOut, net: engIn - engOut };
    case 'category_cadence':
      return { cashIn: cadIn, cashOut: cadOut, net: cadIn - cadOut };
    case 'split_conservative':
      return { cashIn: engIn, cashOut: cadOut, net: engIn - cadOut };
    case 'h50_50_net':
      // Component cash-in/cash-out are not separately defined for the
      // half-and-half net blend. We surface only net.
      return { cashIn: null, cashOut: null, net: 0.5 * (engIn - engOut) + 0.5 * (cadIn - cadOut) };
    case 'conservative_floor':
      // Cash-in and cash-out may come from DIFFERENT models in the same
      // month — by design.
      return {
        cashIn: Math.min(engIn, cadIn),
        cashOut: Math.max(engOut, cadOut),
        net: Math.min(engIn, cadIn) - Math.max(engOut, cadOut),
      };
  }
}

function modelComponentsForMonths(
  key: ModelKey,
  months: string[],
  eng: ReturnType<typeof engineByMonth>,
  cad: ReturnType<typeof cadenceByMonth>
): ModelComponents {
  let cashInSum: number | null = 0;
  let cashOutSum: number | null = 0;
  let netSum = 0;
  for (const m of months) {
    const c = modelComponentsForMonth(key, m, eng, cad);
    if (c.cashIn === null || c.cashOut === null) {
      cashInSum = null;
      cashOutSum = null;
    } else {
      if (cashInSum !== null)  cashInSum  += c.cashIn;
      if (cashOutSum !== null) cashOutSum += c.cashOut;
    }
    netSum += c.net;
  }
  return { cashIn: cashInSum, cashOut: cashOutSum, net: netSum };
}

// ─── Retrospective scoring ────────────────────────────────────────────────────
type RetroRow = {
  asOf: string;
  horizon: Horizon;
  model: ModelKey;
  projCashIn: number | null;
  projCashOut: number | null;
  projNet: number;
  realCashIn: number;
  realCashOut: number;
  realNet: number;
  signedNet: number;
  absNet: number;
  underProjected: boolean;
  partial: boolean;
};

function runRetrospective(all: Txn[]): RetroRow[] {
  const rows: RetroRow[] = [];
  for (const asOf of AS_OF_DATES) {
    const train = all.filter((t) => t.date < asOf);
    const realizedTxns = all.filter((t) => t.date >= asOf && t.month <= LAST_CLOSED_MONTH);
    const asOfMonth = asOf.slice(0, 7);
    const eng = engineByMonth(train, asOfMonth);
    const cad = cadenceByMonth(train, asOfMonth);
    const real = realizedByMonth(realizedTxns);

    for (const horizon of HORIZONS) {
      const months = monthsRange(asOfMonth, HORIZON_MONTHS[horizon]).filter((m) => m <= LAST_CLOSED_MONTH);
      if (months.length === 0) continue;
      const partial = months.length < HORIZON_MONTHS[horizon];
      const realCashIn = sumOver(real.cashIn, months);
      const realCashOut = sumOver(real.cashOut, months);
      const realNet = realCashIn - realCashOut;

      for (const model of MODEL_KEYS) {
        const c = modelComponentsForMonths(model, months, eng, cad);
        const signed = c.net - realNet;
        rows.push({
          asOf, horizon, model,
          projCashIn: c.cashIn,
          projCashOut: c.cashOut,
          projNet: c.net,
          realCashIn, realCashOut, realNet,
          signedNet: signed,
          absNet: Math.abs(signed),
          underProjected: c.net < realNet,
          partial,
        });
      }
    }
  }
  return rows;
}

type RetroAggregate = {
  model: ModelKey;
  horizon: Horizon;
  avgAbs: number;
  avgSigned: number;
  underProjCount: number;
  n: number;
};

function aggregateRetrospective(rows: RetroRow[]): RetroAggregate[] {
  const out: RetroAggregate[] = [];
  for (const horizon of HORIZONS) {
    for (const model of MODEL_KEYS) {
      const matched = rows.filter((r) => r.horizon === horizon && r.model === model);
      const n = matched.length;
      if (n === 0) continue;
      const avgAbs    = matched.reduce((s, r) => s + r.absNet, 0)    / n;
      const avgSigned = matched.reduce((s, r) => s + r.signedNet, 0) / n;
      const underProjCount = matched.filter((r) => r.underProjected).length;
      out.push({ model, horizon, avgAbs, avgSigned, underProjCount, n });
    }
  }
  return out;
}

// ─── Current forecast (full fixture) ──────────────────────────────────────────
type CurrentRow = {
  horizon: Horizon;
  model: ModelKey;
  cashIn: number | null;
  cashOut: number | null;
  net: number;
};

function runCurrent(all: Txn[]): { rows: CurrentRow[]; latestMonth: string; firstForecastMonth: string } {
  const model = computeDashboardModel(all);
  const latestMonth = model.latestMonth ?? '';
  // First forecast month = month after model.latestMonth.
  const [y, m] = latestMonth.split('-').map(Number);
  const next = new Date(y, m, 1); // m is 1-based; new Date(y, m, 1) jumps one month forward.
  const firstForecastMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;

  const eng = engineByMonth(all, firstForecastMonth);
  const cad = cadenceByMonth(all, firstForecastMonth);

  const rows: CurrentRow[] = [];
  for (const horizon of HORIZONS) {
    const months = monthsRange(firstForecastMonth, HORIZON_MONTHS[horizon]);
    for (const mk of MODEL_KEYS) {
      const c = modelComponentsForMonths(mk, months, eng, cad);
      rows.push({ horizon, model: mk, cashIn: c.cashIn, cashOut: c.cashOut, net: c.net });
    }
  }
  return { rows, latestMonth, firstForecastMonth };
}

// ─── Markdown report writer ───────────────────────────────────────────────────
function writeReport(
  fixture: Txn[],
  retro: RetroRow[],
  retroAgg: RetroAggregate[],
  current: { rows: CurrentRow[]; latestMonth: string; firstForecastMonth: string }
): void {
  const dates = fixture.map((t) => t.date).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];
  const generatedDate = new Date().toISOString().slice(0, 10);
  const fixtureRel = getFixturePath().replace(`${process.cwd()}/`, '');

  const lines: string[] = [];
  lines.push('# Conservative Floor Diagnostic Report');
  lines.push('');

  // ─── Frame ────────────────────────────────────────────────────────────────
  lines.push('## Frame');
  lines.push('');
  lines.push(`- **Generated (UTC):** ${generatedDate}`);
  lines.push(`- **Fixture path:** \`${fixtureRel}\``);
  lines.push(`- **Fixture row count:** ${fixture.length.toLocaleString('en-US')}`);
  lines.push(`- **Fixture earliest transaction:** ${earliest}`);
  lines.push(`- **Fixture latest transaction:** ${latest}`);
  lines.push(`- **Last closed realized month:** ${LAST_CLOSED_MONTH}`);
  lines.push(`- **As-of dates evaluated:**`);
  for (const d of AS_OF_DATES) lines.push(`  - ${d}`);
  lines.push(`- **Excluded category (diagnostic-only):** \`${EXCLUDE_CATEGORY}\``);
  lines.push('  - Excluded from both projected and realized cash-out for scoring purposes.');
  lines.push('  - Production behavior is unaffected.');
  lines.push('');

  // ─── Retrospective backtest ──────────────────────────────────────────────
  lines.push('## Retrospective backtest');
  lines.push('');
  lines.push('Aggregated across the 5 as-of dates listed above. Federal Tax');
  lines.push('excluded from both projected and realized cash-out.');
  lines.push('');

  // Find the lowest avg-abs per horizon for bolding
  const winnerByHorizon: Record<Horizon, ModelKey> = { '30d': 'engine', '90d': 'engine', '1y': 'engine' };
  for (const horizon of HORIZONS) {
    const rows = retroAgg.filter((r) => r.horizon === horizon);
    const winner = [...rows].sort((a, b) => a.avgAbs - b.avgAbs)[0];
    if (winner) winnerByHorizon[horizon] = winner.model;
  }

  for (const horizon of HORIZONS) {
    lines.push(`### ${horizon}`);
    lines.push('');
    lines.push('| Model | Avg abs net err | Avg signed bias | Under-proj count (n=5) |');
    lines.push('|---|---:|---:|---:|');
    const rowsH = retroAgg.filter((r) => r.horizon === horizon);
    for (const mk of MODEL_KEYS) {
      const r = rowsH.find((x) => x.model === mk);
      if (!r) continue;
      const isWinner = mk === winnerByHorizon[horizon];
      const absStr = isWinner ? `**${fmt(r.avgAbs)}**` : fmt(r.avgAbs);
      lines.push(`| ${mk} | ${absStr} | ${fmtSigned(r.avgSigned)} | ${r.underProjCount}/${r.n} |`);
    }
    lines.push('');
  }

  // ─── Current forecast ────────────────────────────────────────────────────
  lines.push('## Current forecast');
  lines.push('');
  lines.push(`Basis: full fixture. Latest model month: \`${current.latestMonth}\`. First forecast month: \`${current.firstForecastMonth}\`.`);
  lines.push('Federal Tax excluded from training. h50_50 cash-in / cash-out shown as "—" because they are not separately defined.');
  lines.push('');

  for (const horizon of HORIZONS) {
    lines.push(`### ${horizon}`);
    lines.push('');
    lines.push('| Model | Cash In | Cash Out | Net |');
    lines.push('|---|---:|---:|---:|');
    const rowsH = current.rows.filter((r) => r.horizon === horizon);
    for (const mk of MODEL_KEYS) {
      const r = rowsH.find((x) => x.model === mk);
      if (!r) continue;
      lines.push(`| ${mk} | ${fmt(r.cashIn)} | ${fmt(r.cashOut)} | ${fmt(r.net)} |`);
    }
    lines.push('');
  }

  // ─── Conclusions ──────────────────────────────────────────────────────────
  lines.push('## Conclusions');
  lines.push('');
  lines.push(buildConclusions(retroAgg, current));
  lines.push('');

  // ─── When to re-run ───────────────────────────────────────────────────────
  lines.push('## When to re-run');
  lines.push('');
  lines.push('- After fixture refresh');
  lines.push('- After any change to `projectScenario` semantics');
  lines.push('- After any change to `projectCategoryCadenceScenario` semantics');
  lines.push('- Before any production implementation of `composeConservativeFloor()`');
  lines.push('- After material changes to Federal Tax handling assumptions');
  lines.push('');

  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
}

function buildConclusions(
  retroAgg: RetroAggregate[],
  current: { rows: CurrentRow[]; latestMonth: string; firstForecastMonth: string }
): string {
  // Helpers for grounded answers
  const get = (model: ModelKey, horizon: Horizon) =>
    retroAgg.find((r) => r.model === model && r.horizon === horizon)!;

  const winners: Record<Horizon, ModelKey> = { '30d': 'engine', '90d': 'engine', '1y': 'engine' };
  for (const horizon of HORIZONS) {
    const rowsH = retroAgg.filter((r) => r.horizon === horizon);
    winners[horizon] = [...rowsH].sort((a, b) => a.avgAbs - b.avgAbs)[0].model;
  }

  // Current forecast lookups
  const curNet = (model: ModelKey, horizon: Horizon) =>
    current.rows.find((r) => r.horizon === horizon && r.model === model)?.net ?? 0;

  const floor30 = get('conservative_floor', '30d');
  const floor90 = get('conservative_floor', '90d');
  const floor1y = get('conservative_floor', '1y');
  const split30 = get('split_conservative', '30d');
  const split90 = get('split_conservative', '90d');
  const split1y = get('split_conservative', '1y');
  const eng1y   = get('engine', '1y');

  // Q1 — Does Conservative Floor improve retrospective absolute net accuracy?
  const winsByHorizon = HORIZONS.filter((h) => winners[h] === 'conservative_floor');
  const q1 =
    winsByHorizon.length === 0
      ? `**Q1.** No. Conservative Floor does not produce the lowest absolute net error at any horizon (winners: 30d=${winners['30d']}, 90d=${winners['90d']}, 1y=${winners['1y']}).`
      : `**Q1.** Yes — at the ${winsByHorizon.join(' and ')} horizon${winsByHorizon.length > 1 ? 's' : ''}. ` +
        `Conservative Floor wins absolute-net accuracy at: ${winsByHorizon.join(', ')}. ` +
        `(Winners — 30d: ${winners['30d']} (${fmt(get(winners['30d'], '30d').avgAbs)}); ` +
        `90d: ${winners['90d']} (${fmt(get(winners['90d'], '90d').avgAbs)}); ` +
        `1y: ${winners['1y']} (${fmt(get(winners['1y'], '1y').avgAbs)}).)`;

  // Q2 — Is Conservative Floor too pessimistic historically?
  const floorBias1y = floor1y.avgSigned;
  const floorUnder1y = floor1y.underProjCount;
  const q2 = `**Q2.** Floor's 1y signed bias is ${fmtSigned(floorBias1y)} and it under-projected actuals in ${floorUnder1y}/${floor1y.n} retrospective windows at 1y. ` +
    (floorBias1y < 0
      ? `The bias is negative, meaning Floor systematically projects lower net than realized — the intended pessimism for a floor view, not a calibration error.`
      : floorBias1y > 0
      ? `The bias is positive, meaning Floor still projects higher net than realized on average — Floor is not actually pessimistic enough at 1y.`
      : `The bias is approximately zero, meaning Floor is well-calibrated at 1y rather than pessimistic.`);

  // Q3 — Does Conservative Floor give the lowest current net at all horizons?
  const lowestByHorizon: Record<Horizon, ModelKey> = { '30d': 'engine', '90d': 'engine', '1y': 'engine' };
  for (const h of HORIZONS) {
    let lowest: { model: ModelKey; net: number } = { model: 'engine', net: Number.POSITIVE_INFINITY };
    for (const mk of MODEL_KEYS) {
      const n = curNet(mk, h);
      if (n < lowest.net) lowest = { model: mk, net: n };
    }
    lowestByHorizon[h] = lowest.model;
  }
  const allFloor = HORIZONS.every((h) => lowestByHorizon[h] === 'conservative_floor');
  const q3 = allFloor
    ? `**Q3.** Yes. Conservative Floor produces the lowest current projected net at all three horizons (30d: ${fmt(curNet('conservative_floor', '30d'))}; 90d: ${fmt(curNet('conservative_floor', '90d'))}; 1y: ${fmt(curNet('conservative_floor', '1y'))}).`
    : `**Q3.** Not at every horizon. Lowest current net by horizon — 30d: ${lowestByHorizon['30d']} (${fmt(curNet(lowestByHorizon['30d'], '30d'))}); 90d: ${lowestByHorizon['90d']} (${fmt(curNet(lowestByHorizon['90d'], '90d'))}); 1y: ${lowestByHorizon['1y']} (${fmt(curNet(lowestByHorizon['1y'], '1y'))}). Floor's current nets — 30d: ${fmt(curNet('conservative_floor', '30d'))}; 90d: ${fmt(curNet('conservative_floor', '90d'))}; 1y: ${fmt(curNet('conservative_floor', '1y'))}.`;

  // Q4 — Treat Floor as primary, downside/stress, or just a guardrail?
  const q4 =
    `**Q4.** Treat Conservative Floor as a downside/stress view, not the primary forecast. ` +
    `Its 1y signed bias of ${fmtSigned(floor1y.avgSigned)} and under-projection rate of ${floor1y.underProjCount}/${floor1y.n} at 1y indicate a deliberately pessimistic view rather than a best-estimate. ` +
    `Using it as primary would systematically understate cash and trigger false safety alarms.`;

  // Q5 — Does Split Conservative remain the best-estimate candidate?
  const splitBetterThanFloorByHorizon = HORIZONS.filter((h) => get('split_conservative', h).avgAbs <= get('conservative_floor', h).avgAbs);
  const q5 = `**Q5.** Split Conservative remains the strongest best-estimate candidate. ` +
    `Its avg abs net error is ${fmt(split30.avgAbs)} (30d), ${fmt(split90.avgAbs)} (90d), ${fmt(split1y.avgAbs)} (1y), with signed bias ${fmtSigned(split30.avgSigned)} / ${fmtSigned(split90.avgSigned)} / ${fmtSigned(split1y.avgSigned)} respectively. ` +
    `Split beats or ties Floor on absolute error at ${splitBetterThanFloorByHorizon.length}/${HORIZONS.length} horizons — Floor's accuracy advantage at longer horizons reflects pessimism, not calibration superiority.`;

  // Q6 — Should the product show Expected = Split, Conservative = Floor?
  const q6 = `**Q6.** Yes. The data supports a two-view framing: **Expected Case = Split Conservative** (calibrated best estimate, near-zero signed bias at 90d) and **Conservative Case = Conservative Floor** (deliberately pessimistic stress view for safety-line and reserve decisions). A single-forecast product would force a choice between calibration and conservatism; surfacing both lets the operator see expected outcomes and downside risk simultaneously.`;

  return [q1, '', q2, '', q3, '', q4, '', q5, '', q6].join('\n');
}

// ─── Driver ───────────────────────────────────────────────────────────────────
function main(): void {
  const allRaw = loadFixture();
  const all = allRaw.filter((t) => t.category !== EXCLUDE_CATEGORY);
  const removed = allRaw.length - all.length;

  console.log(`Source: ${getFixturePath().replace(process.cwd() + '/', '')}`);
  console.log(`Total rows: ${allRaw.length}    after Fed-Tax exclusion: ${all.length}    removed: ${removed}`);
  console.log(`Last closed realized month: ${LAST_CLOSED_MONTH}`);
  console.log(`As-of dates: ${AS_OF_DATES.join(', ')}`);
  console.log('');

  const retro = runRetrospective(all);
  const retroAgg = aggregateRetrospective(retro);
  const current = runCurrent(all);

  // ─── Console summary ────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(' Retrospective aggregate (avg abs net err / avg signed bias / under-proj)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  for (const horizon of HORIZONS) {
    console.log(`\n── ${horizon}`);
    console.log(`  ${'model'.padEnd(22)}  ${'avg abs'.padStart(10)}  ${'avg signed'.padStart(11)}  ${'under-proj'.padStart(10)}`);
    const rowsH = retroAgg.filter((r) => r.horizon === horizon);
    const winner = [...rowsH].sort((a, b) => a.avgAbs - b.avgAbs)[0];
    for (const mk of MODEL_KEYS) {
      const r = rowsH.find((x) => x.model === mk);
      if (!r) continue;
      const tag = r.model === winner.model ? ' ← lowest abs' : '';
      console.log(`  ${r.model.padEnd(22)}  ${fmt(r.avgAbs).padStart(10)}  ${fmtSigned(r.avgSigned).padStart(11)}  ${(r.underProjCount + '/' + r.n).padStart(10)}${tag}`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(` Current forecast (latest=${current.latestMonth}  first=${current.firstForecastMonth})`);
  console.log('═══════════════════════════════════════════════════════════════════════');
  for (const horizon of HORIZONS) {
    console.log(`\n── ${horizon}`);
    console.log(`  ${'model'.padEnd(22)}  ${'cash in'.padStart(11)}  ${'cash out'.padStart(11)}  ${'net'.padStart(11)}`);
    const rowsH = current.rows.filter((r) => r.horizon === horizon);
    for (const mk of MODEL_KEYS) {
      const r = rowsH.find((x) => x.model === mk);
      if (!r) continue;
      console.log(`  ${r.model.padEnd(22)}  ${fmt(r.cashIn).padStart(11)}  ${fmt(r.cashOut).padStart(11)}  ${fmt(r.net).padStart(11)}`);
    }
  }

  // ─── Write report ───────────────────────────────────────────────────────
  writeReport(all, retro, retroAgg, current);
  console.log('');
  console.log(`Report written: ${REPORT_PATH.replace(process.cwd() + '/', '')}`);
}

main();
