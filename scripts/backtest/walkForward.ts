import type { Txn, ScenarioInput } from '../../src/lib/data/contract';
import { computeDashboardModel, projectScenario, type EngineParameterOverrides } from '../../src/lib/kpis/compute';
import type { Anchor, ForecastSeries } from './types';
// reconstructStartingCash now lives in src/lib/kpis/forecastShared so
// production code can depend on the same helper without reaching into
// scripts/. Imported and re-exported here so existing harness consumers
// (baselines.ts, realizedBalance.ts) keep their `from './walkForward'`
// imports unchanged.
import { reconstructStartingCash } from '../../src/lib/kpis/forecastShared';
export { reconstructStartingCash };

const BASE_SCENARIO: ScenarioInput = {
  scenarioKey: 'base',
  revenueGrowthPct: 0,
  expenseChangePct: 0,
  receivableDays: 3,
  payableDays: 3,
  months: 12,
};

const HORIZON_MONTHS = 12;

/** Convert YYYY-MM-DD as-of date to YYYY-MM month string. */
function monthOf(asOfDate: string): string {
  return asOfDate.slice(0, 7);
}

export function forecastAsOf(
  asOfDate: string,
  txns: Txn[],
  anchors: Anchor[],
  overrides?: EngineParameterOverrides
): ForecastSeries {
  const filtered = txns.filter((t) => t.date < asOfDate);
  const startingCash = reconstructStartingCash(asOfDate, txns, anchors);
  const thisMonthAnchor = monthOf(asOfDate);

  const model = computeDashboardModel(filtered, {
    cashFlowMode: 'operating',
    thisMonthAnchor,
    currentCashBalance: startingCash,
  });

  const result = projectScenario(
    model,
    { ...BASE_SCENARIO, months: HORIZON_MONTHS },
    startingCash,
    [],
    overrides
  );

  return {
    asOfDate,
    startingCash,
    points: result.points.map((p) => ({
      month: p.month,
      endingCashBalance: p.endingCashBalance,
    })),
    // Length of the active seasonal weighting at this as-of date. 0 means
    // the engine fell back to its momentum model (no seasonality). Used by
    // the runner to detect when a yearWeights override is silently ignored
    // because the active tier's natural weighting has a different length.
    seasonalityWeightingLength: result.seasonality.weighting.length,
  };
}
