import type { Txn } from '../../src/lib/data/contract';
import { forecastCashInContribution, forecastCashOutContribution } from '../../src/lib/cashFlow';
import type { Anchor, TruthSeries } from './types';
import { reconstructStartingCash } from './walkForward';

/** Add `n` months to a YYYY-MM string. */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, (m - 1) + n, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

export function realizedBalance(
  asOfDate: string,
  horizonMonths: number,
  txns: Txn[],
  anchors: Anchor[]
): TruthSeries {
  const startingCash = reconstructStartingCash(asOfDate, txns, anchors);
  const startMonth = asOfDate.slice(0, 7); // month of as-of date itself is index 0 (the in-progress month at as-of)

  // Bucket operating-cash net by YYYY-MM for fast lookup.
  const netByMonth = new Map<string, number>();
  for (const t of txns) {
    if (t.date < asOfDate) continue;
    const net = forecastCashInContribution(t) - forecastCashOutContribution(t);
    if (net === 0) continue;
    netByMonth.set(t.month, (netByMonth.get(t.month) ?? 0) + net);
  }

  const points = [];
  let runningBalance = startingCash;
  // Truth series mirrors the forecast: the engine projects 12 months *after*
  // the last complete month (which is the month before asOfDate's month).
  // So index 1 of the projection corresponds to the as-of month itself.
  for (let i = 1; i <= horizonMonths; i += 1) {
    const month = addMonths(startMonth, i - 1);
    runningBalance += netByMonth.get(month) ?? 0;
    points.push({ month, endingCashBalance: runningBalance });
  }

  return {
    asOfDate,
    startingCash,
    points,
  };
}
