import type { BalancePoint } from './balanceSeries';

export type CashTrendDelta = { pct: number; direction: 'up' | 'down' };

export type CashTrend = {
  series: number[];
  delta: CashTrendDelta | null;
};

const EPSILON = 0.00001;
const ROLLING_WINDOW_DAYS = 30;
const MIN_REQUIRED_DAYS = ROLLING_WINDOW_DAYS * 2;
const ANCHOR_SERIES_LENGTH = 6;

// Index of the latest series point with dateISO <= asOfDate.
function findAnchorIndex(series: BalancePoint[], asOfDate: string): number {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].dateISO <= asOfDate) return i;
  }
  return -1;
}

// Returns the ISO date string for the last day of the month containing
// `referenceISO`, optionally offset by `monthsBack` months.
function endOfMonthISO(referenceISO: string, monthsBack: number): string {
  const [yearStr, monthStr] = referenceISO.split('-');
  const year = Number.parseInt(yearStr, 10);
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  // Day 0 of (target month + 1) = last day of target month, in UTC.
  const targetMonthIndex = monthIdx - monthsBack + 1;
  const eom = new Date(Date.UTC(year, targetMonthIndex, 0));
  return eom.toISOString().slice(0, 10);
}

// Look up the balance at `dateISO` in the daily series. Walks backward from
// the anchor (the rightmost point <= asOfDate) since callers only ever ask
// for dates on or before asOfDate. Returns null if `dateISO` is earlier than
// the first point in the series.
function balanceAt(series: BalancePoint[], anchorIndex: number, dateISO: string): number | null {
  for (let i = anchorIndex; i >= 0; i--) {
    if (series[i].dateISO <= dateISO) return series[i].balance;
  }
  return null;
}

// Reconstructs (1) a 6-point chronological series of end-of-month balances
// drawn from the daily balance series, with `currentCashBalance` as the
// rightmost point; and (2) a 30-day rolling-average delta vs the prior
// 30-day window. Callers MUST pass `asOfDate = latestAvailableTxnDate` (not
// real today) so stale-data carry-forward doesn't flatline both windows.
//
// Returns the null-fallback `{ series: [currentCashBalance], delta: null }`
// when `asOfDate` is null or the daily series has fewer than 60 points.
export function computeCashTrend(
  balanceSeries: BalancePoint[],
  currentCashBalance: number,
  asOfDate: string | null,
): CashTrend {
  if (!asOfDate || balanceSeries.length < MIN_REQUIRED_DAYS) {
    return { series: [currentCashBalance], delta: null };
  }

  const anchorIndex = findAnchorIndex(balanceSeries, asOfDate);
  if (anchorIndex < MIN_REQUIRED_DAYS - 1) {
    return { series: [currentCashBalance], delta: null };
  }

  // End-of-month anchor series. 6 points chronological; the rightmost is
  // `currentCashBalance` (the "now" anchor). The five prior points are end-
  // of-month balances reconstructed from the daily series.
  const series: number[] = [currentCashBalance];
  const anchorMs = Date.parse(`${asOfDate}T00:00:00Z`);
  for (let monthsBack = 1; monthsBack < ANCHOR_SERIES_LENGTH; monthsBack++) {
    const targetISO = endOfMonthISO(asOfDate, monthsBack);
    const targetMs = Date.parse(`${targetISO}T00:00:00Z`);
    if (!Number.isFinite(targetMs) || targetMs > anchorMs) break;
    const balance = balanceAt(balanceSeries, anchorIndex, targetISO);
    if (balance === null) break;
    series.unshift(balance);
  }

  // 30-day rolling means, ending at the anchor.
  let last30Sum = 0;
  let prior30Sum = 0;
  for (let i = anchorIndex - (ROLLING_WINDOW_DAYS - 1); i <= anchorIndex; i++) {
    last30Sum += balanceSeries[i].balance;
  }
  for (let i = anchorIndex - (MIN_REQUIRED_DAYS - 1); i <= anchorIndex - ROLLING_WINDOW_DAYS; i++) {
    prior30Sum += balanceSeries[i].balance;
  }
  const last30 = last30Sum / ROLLING_WINDOW_DAYS;
  const prior30 = prior30Sum / ROLLING_WINDOW_DAYS;
  if (Math.abs(prior30) < EPSILON) {
    return { series, delta: null };
  }
  const pct = (last30 - prior30) / Math.abs(prior30);
  return { series, delta: { pct, direction: pct >= 0 ? 'up' : 'down' } };
}
