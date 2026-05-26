/**
 * One-shot diagnostic: monthly-net-cash 6-month linear slope at successive
 * as-of dates. Read-only — does not modify any locked file. Used for the
 * Cash Trend compact-trendline Phase 1 threshold decision.
 *
 * Run: npx tsx scripts/backtest/slopeBacktest.ts
 */

import { loadFixture } from './loadFixture';
import { computeMonthlyRollups } from '../../src/lib/kpis/compute';
import { computeCashTrendForDate } from '../../src/lib/kpis/cashTrend';

function leastSquaresSlope(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function monthsUntilZero(slope: number, intercept: number, lastIdx: number): number | null {
  if (slope >= 0) return null;
  const valueAtLast = slope * lastIdx + intercept;
  if (valueAtLast <= 0) return 0;
  const monthsForward = -valueAtLast / slope;
  return monthsForward;
}

function fmtCurrency(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
function padL(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

// Pick the last calendar day of the month for a YYYY-MM key (= as-of inside
// that month). Picking day 28 keeps the "complete months" filter in
// computeCashTrendForDate stable across month lengths.
function asOfFromMonthKey(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 28));
}

function run(): void {
  const txns = loadFixture();
  const rollups = computeMonthlyRollups(txns, 'operating');
  if (rollups.length < 7) {
    console.error('Not enough rollups for a 6-month backtest.');
    process.exit(1);
  }

  // Iterate over 12 successive as-of dates ending at the latest complete
  // month in the fixture. Each as-of = mid-month so the prior month is the
  // newest complete month included in the 6-month window.
  const sorted = rollups.slice().sort((a, b) => a.month.localeCompare(b.month));
  const lastMonthKey = sorted[sorted.length - 1].month;
  // As-of = month AFTER lastMonthKey, so lastMonthKey is the most recent
  // complete month included. We then walk 12 months back.
  const [ly, lm] = lastMonthKey.split('-').map(Number);
  const asOfMonths: string[] = [];
  for (let back = 11; back >= 0; back--) {
    const targetMonthIdx = (lm + 1) - back;
    const date = new Date(Date.UTC(ly, targetMonthIdx - 1, 28));
    const k = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    asOfMonths.push(k);
  }

  type Row = {
    asOf: string;
    months: string;
    cumNet: number;
    slope: number;
    pctOfAvg: number;
    monthsToZeroByLine: number | null;
  };

  const rows: Row[] = [];
  for (const asOfKey of asOfMonths) {
    const asOf = asOfFromMonthKey(asOfKey);
    const result = computeCashTrendForDate(rollups, asOf);
    if (result.noData || result.monthlyBars.length < 6) continue;
    const series = result.monthlyBars.map((b) => b.netCash);
    const { slope, intercept } = leastSquaresSlope(series);
    const avg = series.reduce((a, b) => a + b, 0) / series.length;
    const pctOfAvg = avg !== 0 ? slope / Math.abs(avg) : NaN;
    const lastIdx = series.length - 1;
    const monthsToZero = monthsUntilZero(slope, intercept, lastIdx);
    rows.push({
      asOf: asOfKey,
      months: `${result.monthlyBars[0].label} – ${result.monthlyBars[result.monthlyBars.length - 1].label}`,
      cumNet: result.t6mNetCash,
      slope,
      pctOfAvg,
      monthsToZeroByLine: monthsToZero,
    });
  }

  if (rows.length === 0) {
    console.error('No valid as-of windows produced.');
    process.exit(1);
  }

  // Print per-as-of table.
  const HDR = [
    pad('as-of', 9),
    pad('window', 22),
    padL('cumNet', 10),
    padL('slope/mo', 11),
    padL('slope/|avg|', 12),
    padL('months→0', 10),
  ].join(' ');
  console.log('\n6-month linear slope by as-of (operating cash, monthly net)');
  console.log('='.repeat(HDR.length));
  console.log(HDR);
  console.log('-'.repeat(HDR.length));
  for (const r of rows) {
    console.log([
      pad(r.asOf, 9),
      pad(r.months, 22),
      padL(fmtCurrency(r.cumNet), 10),
      padL(fmtCurrency(r.slope) + '/mo', 11),
      padL(Number.isFinite(r.pctOfAvg) ? `${(r.pctOfAvg * 100).toFixed(1)}%` : 'n/a', 12),
      padL(r.monthsToZeroByLine === null ? '—' : r.monthsToZeroByLine.toFixed(1), 10),
    ].join(' '));
  }

  // Slope distribution.
  const slopes = rows.map((r) => r.slope).sort((a, b) => a - b);
  const min = slopes[0];
  const max = slopes[slopes.length - 1];
  const median = slopes[Math.floor(slopes.length / 2)];
  const mean = slopes.reduce((a, b) => a + b, 0) / slopes.length;

  console.log('\nSlope distribution ($/month, signed)');
  console.log('-'.repeat(40));
  console.log(`min:    ${fmtCurrency(min)}/mo`);
  console.log(`median: ${fmtCurrency(median)}/mo`);
  console.log(`mean:   ${fmtCurrency(mean)}/mo`);
  console.log(`max:    ${fmtCurrency(max)}/mo`);

  // Slope-as-pct-of-avg distribution (alternative rule).
  const pcts = rows
    .map((r) => r.pctOfAvg)
    .filter((p) => Number.isFinite(p))
    .sort((a, b) => a - b);
  if (pcts.length > 0) {
    const pmin = pcts[0];
    const pmax = pcts[pcts.length - 1];
    const pmed = pcts[Math.floor(pcts.length / 2)];
    console.log('\nSlope ÷ |avg(series)| distribution');
    console.log('-'.repeat(40));
    console.log(`min:    ${(pmin * 100).toFixed(1)}%`);
    console.log(`median: ${(pmed * 100).toFixed(1)}%`);
    console.log(`max:    ${(pmax * 100).toFixed(1)}%`);
  }

  // Months-to-zero distribution (alternative rule).
  const horizons = rows
    .map((r) => r.monthsToZeroByLine)
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);
  console.log('\nProjected months→0 (only when slope < 0)');
  console.log('-'.repeat(40));
  if (horizons.length === 0) {
    console.log('No negative-slope windows in backtest.');
  } else {
    console.log(`count negative-slope windows: ${horizons.length}/${rows.length}`);
    console.log(`min:    ${horizons[0].toFixed(1)} mo`);
    console.log(`median: ${horizons[Math.floor(horizons.length / 2)].toFixed(1)} mo`);
    console.log(`max:    ${horizons[horizons.length - 1].toFixed(1)} mo`);
  }

  // Flicker check: how many adjacent pairs cross a fixed slope threshold?
  function flickerCount(thresholdSlope: number): number {
    let c = 0;
    for (let i = 1; i < rows.length; i++) {
      const prevRed = rows[i - 1].slope <= thresholdSlope;
      const currRed = rows[i].slope <= thresholdSlope;
      if (prevRed !== currRed) c++;
    }
    return c;
  }
  function flickerCountPct(thresholdPct: number): number {
    let c = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1].pctOfAvg;
      const b = rows[i].pctOfAvg;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const prevRed = a <= thresholdPct;
      const currRed = b <= thresholdPct;
      if (prevRed !== currRed) c++;
    }
    return c;
  }
  function flickerCountHorizon(maxMonths: number): number {
    let c = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      const prevRed = a.monthsToZeroByLine !== null && a.monthsToZeroByLine <= maxMonths;
      const currRed = b.monthsToZeroByLine !== null && b.monthsToZeroByLine <= maxMonths;
      if (prevRed !== currRed) c++;
    }
    return c;
  }

  console.log('\nFlicker count across adjacent as-of pairs');
  console.log('(lower = more stable; max possible = rows-1 = ' + (rows.length - 1) + ')');
  console.log('-'.repeat(40));
  const fixedSlopes = [-100, -250, -500, -1000, -2000, -3000, -5000];
  for (const t of fixedSlopes) {
    console.log(`slope ≤ ${fmtCurrency(t)}/mo : ${flickerCount(t)} flips`);
  }
  const pctThresholds = [-0.10, -0.20, -0.30, -0.50, -1.00, -2.00];
  for (const t of pctThresholds) {
    console.log(`slope/|avg| ≤ ${(t * 100).toFixed(0)}% : ${flickerCountPct(t)} flips`);
  }
  const horizonThresholds = [6, 12, 18, 24, 36];
  for (const t of horizonThresholds) {
    console.log(`months→0 ≤ ${t} : ${flickerCountHorizon(t)} flips`);
  }
}

run();
