import type { MonthlyRollup, TrendPoint } from '../data/contract';

function shiftMonthByMonths(month: string, offset: number): string | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const y = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  const date = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export { shiftMonthByMonths };

export type PriorPeriodInput = {
  /** Monthly NET-change TrendPoints aligned to forecast months (same `month` keys
   *  as `data` in CashFlowForecastModule). Caller accumulates these into a
   *  balance trajectory using the same logic as the forecast itself (monthly or
   *  expanded-weekly). */
  netSeries: TrendPoint[];
  /** Cash balance at the start of the prior period (= end of the month before
   *  priorMonths[0]). Caller seeds the cumulative running balance with this. */
  startingBalance: number;
  /** Resolved YYYY-MM list of prior months actually used, in forecast order.
   *  Caller uses this to label the overlay range, so the comparison data and
   *  the visible subtitle cannot drift apart. */
  priorMonths: string[];
};

/**
 * Build the prior-period inputs aligned 1:1 to the forecast horizon.
 *
 * Comparison rule (same-period prior year):
 *   shift = -12 * ceil(horizon / 12). The prior window is the same calendar
 *   months as the forecast, pulled from the most recent fully-historical
 *   year. Sub-year horizons (1/2/3/6 months) compare to the same months one
 *   year ago; whole-year horizons (12/24/36 months) compare to the matching
 *   1/2/3-year span ending just before today, which preserves the previous
 *   behavior for those ranges.
 *
 * Coverage must be complete — we never render a line that drops off mid-chart,
 * and we never shift backward by an offset that would push the prior window
 * into months that haven't happened yet. Short horizons without ≥1 full prior
 * year of history degrade to "Compare unavailable" rather than fall back to
 * an adjacent-period (momentum) overlay.
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

  const offset = -12 * Math.ceil(forecastMonths.length / 12);
  const priorMonths: string[] = [];
  for (const m of forecastMonths) {
    const prior = shiftMonthByMonths(m, offset);
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

  return { netSeries, startingBalance, priorMonths };
}
