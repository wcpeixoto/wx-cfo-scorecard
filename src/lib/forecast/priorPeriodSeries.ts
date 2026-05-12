import type { MonthlyRollup, TrendPoint } from '../data/contract';

function shiftMonthByYears(month: string, years: number): string | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const y = Number.parseInt(match[1], 10);
  if (!Number.isFinite(y)) return null;
  return `${y + years}-${match[2]}`;
}

export type PriorPeriodInput = {
  /** Monthly NET-change TrendPoints aligned to forecast months (same `month` keys
   *  as `data` in CashFlowForecastModule). Caller accumulates these into a
   *  balance trajectory using the same logic as the forecast itself (monthly or
   *  expanded-weekly). */
  netSeries: TrendPoint[];
  /** Cash balance at the start of the prior period (= end of the month before
   *  priorMonths[0]). Caller seeds the cumulative running balance with this. */
  startingBalance: number;
};

/**
 * Build the prior-period inputs aligned 1:1 to the forecast horizon.
 *
 * Returns null when coverage is partial: every prior month (same MM, year − 1)
 * for each forecast bucket must be present in `monthlyRollups`, AND the latest
 * prior month must be ≤ the latest fully-rolled-up actual month. We never
 * render a comparison line that drops off mid-chart.
 *
 * Returns net-change series + starting balance rather than an accumulated
 * balance series, so the caller can apply the same monthly-or-weekly
 * accumulation logic the forecast itself uses for `data`.
 */
export function buildPriorPeriodSeries(
  monthlyRollups: MonthlyRollup[],
  currentCashBalance: number,
  forecastMonths: string[],
): PriorPeriodInput | null {
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

  // Anchor balance_at_end_of(lastActualMonth) = currentCashBalance, then walk
  // backward subtracting each month's netCashFlow to derive the balance at the
  // end of any earlier month present in monthlyRollups.
  const balanceAtEndOfMonth = new Map<string, number>();
  let runningBalance = currentCashBalance;
  balanceAtEndOfMonth.set(lastActualMonth, runningBalance);
  for (let i = monthlyRollups.length - 1; i > 0; i -= 1) {
    runningBalance -= monthlyRollups[i].netCashFlow;
    balanceAtEndOfMonth.set(monthlyRollups[i - 1].month, runningBalance);
  }

  // Starting balance for the prior period = balance at the END of the month
  // immediately before priorMonths[0].
  const firstPriorMonth = priorMonths[0];
  const firstPriorIndex = monthlyRollups.findIndex((r) => r.month === firstPriorMonth);
  if (firstPriorIndex < 0) return null;
  let startingBalance: number;
  if (firstPriorIndex === 0) {
    // No earlier month available — derive backward from the firstPrior end-of-month balance.
    const endOfFirstPrior = balanceAtEndOfMonth.get(firstPriorMonth);
    if (endOfFirstPrior === undefined) return null;
    startingBalance = endOfFirstPrior - monthlyRollups[0].netCashFlow;
  } else {
    const prevMonth = monthlyRollups[firstPriorIndex - 1].month;
    const balance = balanceAtEndOfMonth.get(prevMonth);
    if (balance === undefined) return null;
    startingBalance = balance;
  }

  const netSeries: TrendPoint[] = [];
  for (let i = 0; i < forecastMonths.length; i += 1) {
    const pm = priorMonths[i];
    const rollup = rollupByMonth.get(pm);
    if (!rollup) return null;
    netSeries.push({
      month: forecastMonths[i],
      income: rollup.revenue,
      expense: rollup.expenses,
      net: rollup.netCashFlow,
    });
  }

  return { netSeries, startingBalance };
}
