import type { Txn, ScenarioInput } from '../../src/lib/data/contract';
import { computeDashboardModel, projectScenario, type EngineParameterOverrides } from '../../src/lib/kpis/compute';
import { forecastCashInContribution, forecastCashOutContribution } from '../../src/lib/cashFlow';
import type { Anchor, ForecastSeries } from './types';

const BASE_SCENARIO: ScenarioInput = {
  scenarioKey: 'base',
  revenueGrowthPct: 0,
  expenseChangePct: 0,
  receivableDays: 3,
  payableDays: 3,
  months: 12,
};

const HORIZON_MONTHS = 12;

/** Operating-cash net for a single transaction (cash-in minus cash-out, signed). */
function operatingCashNet(txn: Txn): number {
  return forecastCashInContribution(txn) - forecastCashOutContribution(txn);
}

/** Find the closest anchor with date <= asOfDate (ISO YYYY-MM-DD lexicographic). */
function closestPrecedingAnchor(asOfDate: string, anchors: Anchor[]): Anchor | null {
  let best: Anchor | null = null;
  for (const a of anchors) {
    if (a.asOfDate <= asOfDate) {
      if (!best || a.asOfDate > best.asOfDate) best = a;
    }
  }
  return best;
}

/** Reconstruct starting operating-cash balance at as-of date `D`.
 *  - With anchor: anchor.balance + sum(operating-cash net) for txns where anchor.date <= txn.date < D
 *  - Without anchor: sum(operating-cash net) for all txns where txn.date < D (zero-anchored)
 *  This function is shared by forecastAsOf and realizedBalance to guarantee
 *  month-zero reconciliation.
 */
export function reconstructStartingCash(
  asOfDate: string,
  txns: Txn[],
  anchors: Anchor[]
): number {
  const anchor = closestPrecedingAnchor(asOfDate, anchors);
  const lowerBound = anchor?.asOfDate ?? null;
  const base = anchor?.operatingCashBalance ?? 0;
  let net = 0;
  for (const t of txns) {
    if (t.date >= asOfDate) continue;
    if (lowerBound !== null && t.date < lowerBound) continue;
    net += operatingCashNet(t);
  }
  return base + net;
}

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
