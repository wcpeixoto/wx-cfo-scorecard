import type { ScenarioPoint, TrendPoint } from '../data/contract';

const RESERVE_WINDOW_DAYS = 30;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month1: number): number {
  if (month1 === 2) return isLeapYear(year) ? 29 : 28;
  if (month1 === 4 || month1 === 6 || month1 === 9 || month1 === 11) return 30;
  return 31;
}

function parseMonthKey(month: string): { year: number; month1: number } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month1: Number(m[2]) };
}

function parseDateKey(date: string): Date | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function endOfMonthUTC(month: string): Date | null {
  const parsed = parseMonthKey(month);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.year, parsed.month1 - 1, daysInMonth(parsed.year, parsed.month1)));
}

function addDaysUTC(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Anchor date for a chart display point — last day of the period.
 *  Monthly: last day of the YYYY-MM month.
 *  Weekly:  periodEnd (already YYYY-MM-DD). Falls back to month end-of-bucket
 *           if periodEnd is missing (defensive — should not happen in practice).
 */
function anchorDate(point: TrendPoint, granularity: 'month' | 'week'): Date | null {
  if (granularity === 'week') {
    if (point.periodEnd) return parseDateKey(point.periodEnd);
    return endOfMonthUTC(point.month);
  }
  return endOfMonthUTC(point.month);
}

/**
 * Build the rolling 30-day Cash Reserve overlay series, aligned 1:1 to the
 * chart's display series.
 *
 * Reserve(point) = sum of projected daily expense rates over the 30 calendar
 * days strictly after the point's end-of-period anchor. The daily rate at any
 * date is derived from the scenario-adjusted monthly forecast as
 *   monthCashOut / daysInMonth(month)
 * matching the existing monthly→weekly normalization used elsewhere.
 *
 * `fullForecast` is the un-sliced ScenarioPoint stream so reserve windows can
 * extend past the visible horizon. When the window would extend past the last
 * month in `fullForecast`, that point's reserve is `null` — caller renders the
 * line truncated rather than fabricating tail values.
 *
 * Returns `null` only if there is no usable data at all (empty inputs or no
 * full 30-day windows available). Otherwise returns an array of the same
 * length as `displaySeries`, with `null` entries for points whose window
 * lacks full coverage.
 */
export function buildReserveSeries(
  fullForecast: ScenarioPoint[],
  displaySeries: TrendPoint[],
  granularity: 'month' | 'week',
): (number | null)[] | null {
  if (fullForecast.length === 0 || displaySeries.length === 0) return null;

  const monthlyCashOut = new Map<string, number>();
  for (const sp of fullForecast) monthlyCashOut.set(sp.month, sp.cashOut);

  const lastMonth = fullForecast[fullForecast.length - 1].month;
  const lastAvailableDay = endOfMonthUTC(lastMonth);
  if (!lastAvailableDay) return null;

  const result: (number | null)[] = displaySeries.map((point) => {
    const anchor = anchorDate(point, granularity);
    if (!anchor) return null;

    const windowStart = addDaysUTC(anchor, 1);
    const windowEnd = addDaysUTC(anchor, RESERVE_WINDOW_DAYS);
    if (windowEnd > lastAvailableDay) return null;

    let sum = 0;
    for (let cursor = windowStart; cursor <= windowEnd; cursor = addDaysUTC(cursor, 1)) {
      const key = monthKey(cursor);
      const monthlyExpense = monthlyCashOut.get(key);
      if (monthlyExpense === undefined) return null;
      sum += monthlyExpense / daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
    }
    return Math.round(sum);
  });

  if (result.every((v) => v === null)) return null;
  return result;
}
