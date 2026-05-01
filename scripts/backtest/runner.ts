import type { Txn } from '../../src/lib/data/contract';
import type { EngineParameterOverrides } from '../../src/lib/kpis/compute';
import { forecastAsOf } from './walkForward';
import { realizedBalance } from './realizedBalance';
import { computeMetrics } from './metrics';
import { naiveYoYBaseline, t12mAverageBaseline } from './baselines';
import { categoryCadenceForecast } from '../../src/lib/kpis/categoryCadence';
import type {
  AggregateMetrics,
  Anchor,
  BaselineComparison,
  EngineOverrideTierMismatch,
  RunnerAsOfRun,
  RunnerResult,
} from './types';

export type RunnerOptions = {
  transactions: Txn[];
  anchors: Anchor[];
  asOfDates: string[]; // YYYY-MM-DD
  horizonMonths: number;
  engineOverrides?: EngineParameterOverrides;
};

function compareBaseline(runs: RunnerAsOfRun[], pick: (r: RunnerAsOfRun) => number): BaselineComparison {
  let wins = 0;
  let losses = 0;
  let tied = 0;
  for (const r of runs) {
    const engine = r.engineMetrics.worstSingleMonthMiss;
    const baseline = pick(r);
    if (engine < baseline) wins += 1;
    else if (engine > baseline) losses += 1;
    else tied += 1;
  }
  return { wins, losses, tied };
}

function aggregate(runs: RunnerAsOfRun[]): AggregateMetrics {
  const validMape = (key: 'mape30' | 'mape60' | 'mape90'): number => {
    const vals = runs.map((r) => r.engineMetrics[key]).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return Number.NaN;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };
  const directionalAccuracy =
    runs.reduce((s, r) => s + r.engineMetrics.directionalAccuracy, 0) / runs.length;
  const safetyLineHitRate = runs.filter((r) => r.engineMetrics.safetyLineHit).length / runs.length;
  const worstSingleMonthMiss =
    runs.reduce((s, r) => s + r.engineMetrics.worstSingleMonthMiss, 0) / runs.length;
  return {
    directionalAccuracy,
    mape30: validMape('mape30'),
    mape60: validMape('mape60'),
    mape90: validMape('mape90'),
    safetyLineHitRate,
    worstSingleMonthMiss,
    engineVsNaiveYoY: compareBaseline(runs, (r) => r.naiveYoYMetrics.worstSingleMonthMiss),
    engineVsT12M: compareBaseline(runs, (r) => r.t12mMetrics.worstSingleMonthMiss),
    engineVsCategoryCadence: compareBaseline(runs, (r) => r.categoryCadenceMetrics.worstSingleMonthMiss),
  };
}

function detectTierMismatches(
  runs: RunnerAsOfRun[],
  overrides: EngineParameterOverrides | undefined
): EngineOverrideTierMismatch[] {
  if (!overrides?.yearWeights) return [];
  const overrideLength = overrides.yearWeights.length;
  const mismatches: EngineOverrideTierMismatch[] = [];
  for (const r of runs) {
    const activeLength = r.engineForecast.seasonalityWeightingLength ?? 0;
    if (activeLength !== overrideLength) {
      mismatches.push({ parameter: 'yearWeights', asOfDate: r.asOfDate });
    }
  }
  return mismatches;
}

/** Execute the full harness loop in-memory and return all per-as-of and
 *  aggregate results. Pure data — no console output, no file I/O, no
 *  process.exit. Suitable for both the CLI entry in runBacktest.ts and
 *  the parameter sensitivity sweep. */
export function runHarness(opts: RunnerOptions): RunnerResult {
  const { transactions, anchors, asOfDates, horizonMonths, engineOverrides } = opts;

  const perAsOf: RunnerAsOfRun[] = [];
  for (const asOfDate of asOfDates) {
    const engineForecast = forecastAsOf(asOfDate, transactions, anchors, engineOverrides);
    const truth = realizedBalance(asOfDate, horizonMonths, transactions, anchors);

    if (Math.abs(engineForecast.startingCash - truth.startingCash) > 0.01) {
      throw new Error(
        `Starting-cash reconciliation failed at ${asOfDate}: forecast=${engineForecast.startingCash} truth=${truth.startingCash}. This indicates a harness bug.`
      );
    }

    const naiveYoYForecast = naiveYoYBaseline(asOfDate, transactions, anchors);
    const t12mAverageForecast = t12mAverageBaseline(asOfDate, transactions, anchors);
    const categoryCadenceForecastSeries = categoryCadenceForecast(asOfDate, transactions, anchors);

    perAsOf.push({
      asOfDate,
      engineForecast,
      naiveYoYForecast,
      t12mAverageForecast,
      categoryCadenceForecast: categoryCadenceForecastSeries,
      truth,
      engineMetrics: computeMetrics(engineForecast, truth),
      naiveYoYMetrics: computeMetrics(naiveYoYForecast, truth),
      t12mMetrics: computeMetrics(t12mAverageForecast, truth),
      categoryCadenceMetrics: computeMetrics(categoryCadenceForecastSeries, truth),
    });
  }

  return {
    perAsOf,
    aggregate: aggregate(perAsOf),
    engineOverrideTierMismatches: detectTierMismatches(perAsOf, engineOverrides),
  };
}
