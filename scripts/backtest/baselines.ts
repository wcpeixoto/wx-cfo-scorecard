import type { Txn } from '../../src/lib/data/contract';
import { forecastCashInContribution, forecastCashOutContribution } from '../../src/lib/cashFlow';
import { reconstructStartingCash } from './walkForward';
import type { Anchor, ForecastSeries } from './types';

const HORIZON_MONTHS = 12;

function operatingCashNet(txn: Txn): number {
  return forecastCashInContribution(txn) - forecastCashOutContribution(txn);
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, (m - 1) + n, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function netByMonth(txns: Txn[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of txns) {
    const net = operatingCashNet(t);
    if (net === 0) continue;
    map.set(t.month, (map.get(t.month) ?? 0) + net);
  }
  return map;
}

/** Naive YoY baseline: each horizon month projects the operating-cash net
 *  from the same calendar month one year earlier. */
export function naiveYoYBaseline(
  asOfDate: string,
  txns: Txn[],
  anchors: Anchor[]
): ForecastSeries {
  const startingCash = reconstructStartingCash(asOfDate, txns, anchors);
  const startMonth = asOfDate.slice(0, 7);
  const allNet = netByMonth(txns);

  const points = [];
  let runningBalance = startingCash;
  for (let i = 1; i <= HORIZON_MONTHS; i += 1) {
    const horizonMonth = addMonths(startMonth, i - 1);
    const yoyMonth = addMonths(horizonMonth, -12);
    runningBalance += allNet.get(yoyMonth) ?? 0;
    points.push({ month: horizonMonth, endingCashBalance: runningBalance });
  }

  return { asOfDate, startingCash, points };
}

/** T12M-average baseline: flat monthly delta = average operating-cash net
 *  across the trailing 12 months ending one month before as-of's month. */
export function t12mAverageBaseline(
  asOfDate: string,
  txns: Txn[],
  anchors: Anchor[]
): ForecastSeries {
  const startingCash = reconstructStartingCash(asOfDate, txns, anchors);
  const startMonth = asOfDate.slice(0, 7);
  const allNet = netByMonth(txns);

  // Window: 12 months ending at addMonths(startMonth, -1).
  const windowMonths: string[] = [];
  for (let k = 12; k >= 1; k -= 1) {
    windowMonths.push(addMonths(startMonth, -k));
  }

  // Use only window months that actually have transaction history.
  // Fall back to whatever's available if the full window predates the data.
  const monthsWithData = windowMonths.filter((m) => allNet.has(m));
  let avgMonthlyNet = 0;
  if (monthsWithData.length > 0) {
    const totalNet = monthsWithData.reduce((s, m) => s + (allNet.get(m) ?? 0), 0);
    avgMonthlyNet = totalNet / monthsWithData.length;
  }

  const points = [];
  let runningBalance = startingCash;
  for (let i = 1; i <= HORIZON_MONTHS; i += 1) {
    const horizonMonth = addMonths(startMonth, i - 1);
    runningBalance += avgMonthlyNet;
    points.push({ month: horizonMonth, endingCashBalance: runningBalance });
  }

  return { asOfDate, startingCash, points };
}
