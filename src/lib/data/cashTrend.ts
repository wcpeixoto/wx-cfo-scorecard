import type { MonthlyRollup } from './contract';

export type CashTrendDelta = { pct: number; direction: 'up' | 'down' };

export type CashTrend = {
  series: number[];
  delta: CashTrendDelta | null;
};

// Walk monthlyRollups backward from currentCashBalance to derive month-start
// cash balances (last 6 months). delta = month-over-month % change of the
// trailing two points. Shared by the Cash on Hand sparkline/trend and the
// Operating Reserve subtitle delta so the two cards never drift.
export function computeCashTrend(
  monthlyRollups: MonthlyRollup[],
  currentCashBalance: number
): CashTrend {
  const sorted = [...monthlyRollups].sort((a, b) => a.month.localeCompare(b.month));
  const last6 = sorted.slice(-6);
  if (last6.length === 0) return { series: [], delta: null };

  const series: number[] = new Array(last6.length);
  let balance = currentCashBalance;
  series[last6.length - 1] = balance;
  for (let i = last6.length - 1; i > 0; i--) {
    balance -= last6[i].netCashFlow;
    series[i - 1] = balance;
  }

  if (series.length < 2) return { series, delta: null };
  const current = series[series.length - 1];
  const prior = series[series.length - 2];
  if (prior === 0 || !Number.isFinite(prior)) return { series, delta: null };
  const pct = (current - prior) / Math.abs(prior);
  return { series, delta: { pct, direction: pct >= 0 ? 'up' : 'down' } };
}
