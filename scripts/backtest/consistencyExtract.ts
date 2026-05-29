/**
 * consistencyExtract.ts — emit raw trailing-6 monthly sequences for
 * Sustainability/Consistency calibration.
 *
 * Emits ONLY the raw monthly numbers (month, netCashFlow, revenue) per
 * window. No ratios, no derived stats. The derived metrics are computed
 * by a separate script after hand-labels are committed — that ordering
 * is the discipline that prevents fitting labels to numbers.
 *
 * Windows:
 *   - 15 backtest as-of dates (2025-01-01 .. 2026-03-01)
 *   - 1 prod-render anchor (2026-05-01) so the live "must be Choppy"
 *     window matches the actual rendered data
 *
 * For each as-of, the trailing-6 is computeMonthlyRollups(txns where
 * txn.date < asOf, 'operating').slice(-6). Same six rows feed both
 * numerator (range of netCashFlow) and denominator (sum of revenue)
 * downstream — same-window guarantee is structural.
 *
 * Run: npx tsx scripts/backtest/consistencyExtract.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { computeMonthlyRollups } from '../../src/lib/kpis/compute';
import type { Txn } from '../../src/lib/data/contract';
import { loadFixture } from './loadFixture';

const AS_OF_DATES: string[] = [
  '2025-01-01',
  '2025-02-01',
  '2025-03-01',
  '2025-04-01',
  '2025-05-01',
  '2025-06-01',
  '2025-07-01',
  '2025-08-01',
  '2025-09-01',
  '2025-10-01',
  '2025-11-01',
  '2025-12-01',
  '2026-01-01',
  '2026-02-01',
  '2026-03-01',
  '2026-05-01', // prod render window (today is 2026-05-29; current calendar month excluded)
];

const WINDOW_MONTHS = 6;
const OUT_PATH = resolve('backtest-results/calibration/consistency-windows-raw.json');

interface MonthRow {
  month: string;
  netCashFlow: number;
  revenue: number;
}

interface Window {
  asOf: string;
  isProdAnchor: boolean;
  windowLabel: string; // 'Jul 2024 – Dec 2024'
  months: MonthRow[];
  monthCount: number;  // <6 means insufficient data
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  const idx = Number.parseInt(month, 10) - 1;
  if (idx < 0 || idx > 11) return key;
  return `${SHORT_MONTHS[idx]} ${year}`;
}

function extractWindow(asOf: string, txns: Txn[], isProdAnchor: boolean): Window {
  const priorTxns = txns.filter((t) => t.date < asOf);
  const rollups = computeMonthlyRollups(priorTxns, 'operating');
  const window = rollups.slice(-WINDOW_MONTHS);

  const months: MonthRow[] = window.map((r) => ({
    month: r.month,
    netCashFlow: r.netCashFlow,
    revenue: r.revenue,
  }));

  const windowLabel =
    months.length > 0
      ? `${formatMonthLabel(months[0].month)} – ${formatMonthLabel(months[months.length - 1].month)}`
      : '';

  return {
    asOf,
    isProdAnchor,
    windowLabel,
    months,
    monthCount: months.length,
  };
}

function main(): void {
  const txns = loadFixture();
  console.log(`Loaded ${txns.length} transactions`);

  const windows: Window[] = AS_OF_DATES.map((asOf) =>
    extractWindow(asOf, txns, asOf === '2026-05-01')
  );

  const insufficient = windows.filter((w) => w.monthCount < WINDOW_MONTHS);
  if (insufficient.length > 0) {
    console.warn(
      `WARNING: ${insufficient.length} window(s) have fewer than ${WINDOW_MONTHS} months:`
    );
    for (const w of insufficient) {
      console.warn(`  ${w.asOf}: ${w.monthCount} months (${w.windowLabel})`);
    }
  }

  const out = {
    generatedFromFixture: true,
    windowMonths: WINDOW_MONTHS,
    asOfDateCount: AS_OF_DATES.length,
    windows,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${windows.length} windows to ${OUT_PATH}`);

  // Quick console summary — month + netCashFlow + revenue, no derived metrics
  console.log('');
  for (const w of windows) {
    const tag = w.isProdAnchor ? ' [PROD]' : '';
    console.log(`\n=== ${w.asOf}${tag}  ${w.windowLabel} ===`);
    for (const m of w.months) {
      const nc = m.netCashFlow.toFixed(0).padStart(8);
      const rv = m.revenue.toFixed(0).padStart(8);
      console.log(`  ${m.month}   net=${nc}   rev=${rv}`);
    }
  }
}

main();
