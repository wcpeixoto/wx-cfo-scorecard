/**
 * consistencyExtractFull.ts — extended trailing-6 sweep for Sustainability/
 * Consistency calibration.
 *
 * Generates as-of dates programmatically:
 *   - Monthly first-of-month from 2022-06-01 to 2026-03-01 inclusive (46 dates)
 *     — earliest valid trailing-6 given fixture data starts 2021-12.
 *   - 2026-05-01 prod anchor (1 date)
 *   - Total: 47 windows.
 *
 * Generation is mechanical; date list is not curated. Run the whole range or
 * none of it — see the calibration discipline in consistency-labels.md.
 *
 * Run: npx tsx scripts/backtest/consistencyExtractFull.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { computeMonthlyRollups } from '../../src/lib/kpis/compute';
import type { Txn } from '../../src/lib/data/contract';
import { loadFixture } from './loadFixture';

const WINDOW_MONTHS = 6;
const START_AS_OF = '2022-06-01'; // earliest with 6 prior complete months in fixture
const END_REGULAR_AS_OF = '2026-03-01'; // last in-harness backtest date
const PROD_ANCHOR_AS_OF = '2026-05-01'; // today's live render window (May 2026)
const OUT_PATH = resolve('backtest-results/calibration/consistency-windows-raw-full.json');

interface MonthRow {
  month: string;
  netCashFlow: number;
  revenue: number;
}

interface Window {
  asOf: string;
  isProdAnchor: boolean;
  windowLabel: string;
  months: MonthRow[];
  monthCount: number;
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

function generateMonthlyAsOfs(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  let [y, m] = startDate.split('-').slice(0, 2).map(Number);
  const [endY, endM] = endDate.split('-').slice(0, 2).map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    result.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return result;
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

  const regularAsOfs = generateMonthlyAsOfs(START_AS_OF, END_REGULAR_AS_OF);
  const asOfs = [...regularAsOfs, PROD_ANCHOR_AS_OF];

  const windows: Window[] = asOfs.map((asOf) =>
    extractWindow(asOf, txns, asOf === PROD_ANCHOR_AS_OF)
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
    asOfDateCount: asOfs.length,
    boundaryStart: START_AS_OF,
    boundaryEndRegular: END_REGULAR_AS_OF,
    prodAnchor: PROD_ANCHOR_AS_OF,
    windows,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${windows.length} windows (${asOfs.length} as-of dates) to ${OUT_PATH}`);
}

main();
