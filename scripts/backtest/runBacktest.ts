import { loadFixture, loadAnchors, getFixturePath } from './loadFixture';
import { forecastAsOf } from './walkForward';
import { realizedBalance } from './realizedBalance';
import { computeMetrics } from './metrics';
import type { AsOfRun } from './types';

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

function main(): void {
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
  console.log('');

  const runs: AsOfRun[] = [];
  for (const asOfDate of AS_OF_DATES) {
    const forecast = forecastAsOf(asOfDate, txns, anchors.anchors);
    const truth = realizedBalance(asOfDate, HORIZON_MONTHS, txns, anchors.anchors);

    if (Math.abs(forecast.startingCash - truth.startingCash) > 0.01) {
      throw new Error(
        `Starting-cash reconciliation failed at ${asOfDate}: forecast=${forecast.startingCash} truth=${truth.startingCash}. This indicates a harness bug.`
      );
    }

    const metrics = computeMetrics(forecast, truth);
    runs.push({ asOfDate, forecast, truth, metrics });
  }

  // Per-run table.
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
    const m = run.metrics;
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

  // Aggregate summary.
  const validMape = (key: 'mape30' | 'mape60' | 'mape90'): number => {
    const vals = runs.map((r) => r.metrics[key]).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return Number.NaN;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };
  const avgDir = runs.reduce((s, r) => s + r.metrics.directionalAccuracy, 0) / runs.length;
  const hitRate = runs.filter((r) => r.metrics.safetyLineHit).length / runs.length;
  const avgWorstMiss = runs.reduce((s, r) => s + r.metrics.worstSingleMonthMiss, 0) / runs.length;

  console.log('AGGREGATE');
  console.log(`  Avg directional accuracy:  ${fmtPct(avgDir)}`);
  console.log(`  Avg MAPE @ month 1 (30d):  ${fmtPct(validMape('mape30'))}`);
  console.log(`  Avg MAPE @ month 2 (60d):  ${fmtPct(validMape('mape60'))}`);
  console.log(`  Avg MAPE @ month 3 (90d):  ${fmtPct(validMape('mape90'))}`);
  console.log(`  Safety-line hit rate:      ${fmtPct(hitRate)}`);
  console.log(`  Avg worst single-month miss: ${fmtCurrency(avgWorstMiss)}`);
}

main();
