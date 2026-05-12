import type { MonthlyRollup, TrendPoint } from '../data/contract';

function shiftMonthByYears(month: string, years: number): string | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const y = Number.parseInt(match[1], 10);
  if (!Number.isFinite(y)) return null;
  return `${y + years}-${match[2]}`;
}

/**
 * Build a prior-period balance series aligned 1:1 to the forecast horizon.
 *
 * Returns null when coverage is partial: every prior month (same MM, year − 1)
 * for each forecast bucket must be present in `monthlyRollups`, AND the latest
 * prior month must be ≤ the latest fully-rolled-up actual month. We never
 * render a comparison line that drops off mid-chart.
 *
 * Caller is responsible for granularity gating — this helper assumes monthly
 * granularity. Weekly forecasts pass `null` for the prior series.
 */
export function buildPriorPeriodSeries(
  monthlyRollups: MonthlyRollup[],
  currentCashBalance: number,
  forecastMonths: string[],
): TrendPoint[] | null {
  if (monthlyRollups.length === 0 || forecastMonths.length === 0) return null;

  const priorMonths: string[] = [];
  for (const m of forecastMonths) {
    const prior = shiftMonthByYears(m, -1);
    if (!prior) return null;
    priorMonths.push(prior);
  }

  const rollupByMonth = new Map<string, MonthlyRollup>();
  for (const r of monthlyRollups) rollupByMonth.set(r.month, r);

  const lastActualMonth = monthlyRollups[monthlyRollups.length - 1].month;
  if (priorMonths[priorMonths.length - 1] > lastActualMonth) return null;

  for (const pm of priorMonths) {
    if (!rollupByMonth.has(pm)) return null;
  }

  // Walk monthlyRollups in reverse, anchoring balance_at_end_of(lastActualMonth)
  // = currentCashBalance, then subtracting each month's netCashFlow to derive
  // the prior month's end-of-month balance.
  const balanceByMonth = new Map<string, number>();
  let runningBalance = currentCashBalance;
  balanceByMonth.set(lastActualMonth, runningBalance);
  for (let i = monthlyRollups.length - 1; i > 0; i -= 1) {
    runningBalance -= monthlyRollups[i].netCashFlow;
    balanceByMonth.set(monthlyRollups[i - 1].month, runningBalance);
  }

  const series: TrendPoint[] = [];
  for (let i = 0; i < forecastMonths.length; i += 1) {
    const pm = priorMonths[i];
    const balance = balanceByMonth.get(pm);
    if (balance === undefined) return null;
    const rollup = rollupByMonth.get(pm)!;
    series.push({
      month: forecastMonths[i],
      income: rollup.revenue,
      expense: rollup.expenses,
      net: balance,
    });
  }

  return series;
}
