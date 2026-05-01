import type { Txn } from '../data/contract';
import { forecastCashInContribution, forecastCashOutContribution } from '../cashFlow';

export type SeriesPoint = {
  month: string; // YYYY-MM
  endingCashBalance: number;
};

export type ForecastSeries = {
  asOfDate: string; // YYYY-MM-DD
  startingCash: number;
  points: SeriesPoint[];
  /** Length of the active seasonal weighting in the engine at this as-of
   *  date. Set by walkForward.forecastAsOf; absent on naive-baseline
   *  series. 0 means the engine used its momentum fallback (no
   *  seasonality). Used by the runner to detect tier mismatches when an
   *  EngineParameterOverrides.yearWeights override is in play. */
  seasonalityWeightingLength?: number;
};

export type Anchor = {
  asOfDate: string; // YYYY-MM-DD
  operatingCashBalance: number;
};

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
 *  Shared by forecastAsOf, realizedBalance, and the category-cadence
 *  comparator to guarantee month-zero reconciliation across all comparators. */
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
