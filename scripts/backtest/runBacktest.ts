import { loadFixture, loadAnchors, getFixturePath } from './loadFixture';
import { BASELINE_PATH, buildBaselineFile, readBaseline, writeBaseline } from './baselineFile';
import { checkRegressions } from './regressionCheck';
import { runHarness } from './runner';
import type { AggregateMetrics, RegressionCheckResult, RunnerAsOfRun } from './types';

const HARNESS_VERSION = 'phase-2';

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
];

const HORIZON_MONTHS = 12;

function fmtCurrency(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '   n/a';
  return `${(n * 100).toFixed(1).padStart(5)}%`;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + ' '.repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  if (s.length >= width) return s;
  return ' '.repeat(width - s.length) + s;
}

function printPerRunTable(runs: RunnerAsOfRun[]): void {
  const headers = [
    pad('as-of', 12),
    padLeft('dirAcc', 7),
    padLeft('mape30', 7),
    padLeft('mape60', 7),
    padLeft('mape90', 7),
    padLeft('lowBalErr', 12),
    padLeft('endptErr', 12),
    padLeft('worstMiss', 12),
    padLeft('safetyHit', 10),
  ];
  console.log(headers.join('  '));
  console.log('-'.repeat(headers.join('  ').length));
  for (const run of runs) {
    const m = run.engineMetrics;
    console.log(
      [
        pad(run.asOfDate, 12),
        padLeft(fmtPct(m.directionalAccuracy), 7),
        padLeft(fmtPct(m.mape30), 7),
        padLeft(fmtPct(m.mape60), 7),
        padLeft(fmtPct(m.mape90), 7),
        padLeft(fmtCurrency(m.lowestBalanceError), 12),
        padLeft(fmtCurrency(m.endpointError), 12),
        padLeft(fmtCurrency(m.worstSingleMonthMiss), 12),
        padLeft(m.safetyLineHit ? 'yes' : 'no', 10),
      ].join('  ')
    );
  }
  console.log('');
}

function printBaselineTable(runs: RunnerAsOfRun[]): void {
  const headers = [
    pad('as-of', 12),
    padLeft('engine miss', 14),
    padLeft('YoY miss', 14),
    padLeft('T12M miss', 14),
    padLeft('CC miss', 14),
    padLeft('beats YoY', 11),
    padLeft('beats T12M', 12),
    padLeft('beats CC', 11),
  ];
  console.log('NAIVE BASELINE COMPARISON (worst single-month miss; informational, no hard-fail)');
  console.log(headers.join('  '));
  console.log('-'.repeat(headers.join('  ').length));
  for (const r of runs) {
    const e = r.engineMetrics.worstSingleMonthMiss;
    const y = r.naiveYoYMetrics.worstSingleMonthMiss;
    const t = r.t12mMetrics.worstSingleMonthMiss;
    const c = r.categoryCadenceMetrics.worstSingleMonthMiss;
    console.log(
      [
        pad(r.asOfDate, 12),
        padLeft(fmtCurrency(e), 14),
        padLeft(fmtCurrency(y), 14),
        padLeft(fmtCurrency(t), 14),
        padLeft(fmtCurrency(c), 14),
        padLeft(e < y ? 'yes' : e > y ? 'no' : 'tie', 11),
        padLeft(e < t ? 'yes' : e > t ? 'no' : 'tie', 12),
        padLeft(e < c ? 'yes' : e > c ? 'no' : 'tie', 11),
      ].join('  ')
    );
  }
  console.log('');
}

function printAggregate(agg: AggregateMetrics): void {
  console.log('AGGREGATE');
  console.log(`  Avg directional accuracy:  ${fmtPct(agg.directionalAccuracy)}`);
  console.log(`  Avg MAPE @ month 1 (30d):  ${fmtPct(agg.mape30)}`);
  console.log(`  Avg MAPE @ month 2 (60d):  ${fmtPct(agg.mape60)}`);
  console.log(`  Avg MAPE @ month 3 (90d):  ${fmtPct(agg.mape90)}`);
  console.log(`  Safety-line hit rate:      ${fmtPct(agg.safetyLineHitRate)}`);
  console.log(`  Avg worst single-month miss: ${fmtCurrency(agg.worstSingleMonthMiss)}`);
  console.log('');
  console.log('  Engine vs naive YoY (worst-miss wins/losses/tied): ' +
    `${agg.engineVsNaiveYoY.wins}/${agg.engineVsNaiveYoY.losses}/${agg.engineVsNaiveYoY.tied}`);
  console.log('  Engine vs T12M-average (worst-miss wins/losses/tied): ' +
    `${agg.engineVsT12M.wins}/${agg.engineVsT12M.losses}/${agg.engineVsT12M.tied}`);
  if (agg.engineVsCategoryCadence) {
    console.log('  Engine vs category-cadence (worst-miss wins/losses/tied): ' +
      `${agg.engineVsCategoryCadence.wins}/${agg.engineVsCategoryCadence.losses}/${agg.engineVsCategoryCadence.tied}`);
  }
  console.log('');
}

function printRegressionResult(result: RegressionCheckResult, allowRegression: boolean): void {
  if (result.passed) {
    console.log('REGRESSION CHECK: PASSED — all locked thresholds within bounds.');
    return;
  }
  console.log('REGRESSION CHECK: FAILED');
  const headers = [
    pad('metric', 24),
    padLeft('baseline', 12),
    padLeft('current', 12),
    padLeft('delta', 12),
    pad('rule', 28),
  ];
  console.log(headers.join('  '));
  console.log('-'.repeat(headers.join('  ').length));
  for (const b of result.breaches) {
    const isRatioMetric = b.metric === 'worstSingleMonthMiss';
    const fmt = isRatioMetric ? fmtCurrency : fmtPct;
    console.log(
      [
        pad(b.metric, 24),
        padLeft(fmt(b.baseline), 12),
        padLeft(fmt(b.current), 12),
        padLeft(fmt(b.delta), 12),
        pad(b.description, 28),
      ].join('  ')
    );
  }
  if (allowRegression) {
    console.log('');
    console.log('--allow-regression set: exiting 0 despite breaches.');
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const updateBaseline = argv.includes('--update-baseline');
  const allowRegression = argv.includes('--allow-regression');

  let txns;
  try {
    txns = loadFixture();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
    return;
  }

  const anchors = loadAnchors();
  if (anchors.loaded) {
    console.log(`STARTING CASH ANCHORS: ${anchors.anchors.length} loaded from ${anchors.path}`);
  } else {
    console.log(
      'STARTING CASH ANCHORS: none — level-dependent metrics (safetyLineHitRate, lowestBalanceError, endpointError, worstSingleMonthMiss) will be reported but unreliable until anchors are provided'
    );
  }
  console.log(`Fixture: ${getFixturePath()} (${txns.length} transactions)`);
  console.log(`As-of dates: ${AS_OF_DATES.length}, horizon: ${HORIZON_MONTHS} months`);
  console.log(`Mode: ${updateBaseline ? '--update-baseline' : 'check'}${allowRegression ? ' --allow-regression' : ''}`);
  console.log('');

  const result = runHarness({
    transactions: txns,
    anchors: anchors.anchors,
    asOfDates: AS_OF_DATES,
    horizonMonths: HORIZON_MONTHS,
  });

  printPerRunTable(result.perAsOf);
  printBaselineTable(result.perAsOf);
  printAggregate(result.aggregate);

  if (updateBaseline) {
    const file = buildBaselineFile({
      fixturePath: getFixturePath(),
      fixtureRowCount: txns.length,
      anchorsLoaded: anchors.anchors.length,
      asOfDateCount: AS_OF_DATES.length,
      harnessVersion: HARNESS_VERSION,
      aggregate: result.aggregate,
    });
    writeBaseline(BASELINE_PATH, file);
    console.log(`BASELINE WRITTEN: ${BASELINE_PATH}`);
    process.exit(0);
    return;
  }

  const baseline = readBaseline(BASELINE_PATH);
  if (!baseline) {
    console.error('');
    console.error(`ERROR: baseline file missing at ${BASELINE_PATH}`);
    console.error('Run `npx tsx scripts/backtest/runBacktest.ts --update-baseline` to create it.');
    console.error('See scripts/backtest/README.md for the baseline workflow.');
    process.exit(2);
    return;
  }

  const check = checkRegressions(result.aggregate, baseline);
  printRegressionResult(check, allowRegression);

  if (!check.passed && !allowRegression) {
    process.exit(1);
    return;
  }
  process.exit(0);
}

main();
