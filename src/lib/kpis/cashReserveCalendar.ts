/**
 * Cash Reserve Calendar — historical "which months drain operating cash"
 *
 * Replaces the prior Seasonality logic. Where Seasonality compared
 * revenue/spending averages per calendar month, this selector evaluates
 * the months that historically pull operating cash DOWN, so the owner
 * can protect reserve, slow optional spending, and time discretionary
 * purchases to stronger months.
 *
 * Data definition (locked):
 *   • Source = `MonthlyRollup.netCashFlow` from `computeMonthlyRollups`
 *     in the default operating mode. That field is already exactly:
 *     operating revenue − operating expenses, excluding Owner
 *     Distributions, Transfers, financing, and uncategorized
 *     transactions. See `compute.ts:503`.
 *
 * Window:
 *   • Trailing 24 completed months from the latest completed month
 *     (the current incomplete calendar month is excluded). Fewer than
 *     24 completed months → low-data state, no chart.
 *
 * Tier rule (per calendar month within the window):
 *   • constrain: avgNetCash < 0 AND negativeCount === observationCount
 *     (every observation in the last 24 months was a drain — structural)
 *   • watch: avgNetCash < 0 AND negativeCount < observationCount
 *     (drain on average, but mixed history — sometimes positive)
 *   • healthy: otherwise (avgNetCash >= 0)
 *
 * topPositiveMonths (for "stronger months" copy):
 *   • Up to 2 calendar months with the highest positive avgNetCash.
 *
 * The card's owner-facing advice copy is built in
 * `CashReserveCalendarCard` from these month lists — this module owns
 * the math and tiers, not the wording.
 */

import type { MonthlyRollup } from '../data/contract';

export type CashReserveTier = 'constrain' | 'watch' | 'healthy';
export type CashReserveState = 'low-data' | 'normal';

export type CashReserveMonth = {
  /** 1..12 — January is 1. */
  monthNumber: number;
  /** Short label, e.g. "Jan" — for chart x-axis. */
  shortLabel: string;
  /** Full label, e.g. "January" — for advice copy. */
  fullLabel: string;
  /** Number of historical observations of this calendar month in the window. */
  observationCount: number;
  /** Of those observations, how many had netCashFlow < 0. */
  negativeCount: number;
  /** Mean of netCashFlow across observations. May be 0 if observationCount=0. */
  avgNetCash: number;
  tier: CashReserveTier;
};

export type CashReserveCalendarResult = {
  state: CashReserveState;
  /** Number of completed months in the trailing-24 window actually used. */
  windowMonthCount: number;
  /** 12 entries, Jan (index 0) … Dec (index 11). */
  byMonth: CashReserveMonth[];
  /** Constrain months in calendar order. */
  constrainMonths: CashReserveMonth[];
  /** Watch months in calendar order. */
  watchMonths: CashReserveMonth[];
  /** Up to 2 healthy months with the highest positive avgNetCash. */
  topPositiveMonths: CashReserveMonth[];
};

const MONTH_SHORT_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTH_FULL_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Trailing-window size in completed months. */
const WINDOW_MONTHS = 24;
/** Threshold below which the card renders the low-data state. */
const LOW_DATA_THRESHOLD = WINDOW_MONTHS;
const TOP_POSITIVE_CAP = 2;

/**
 * YYYY-MM token from a Date (local time). Mirrors how MonthlyRollup.month
 * is derived from Txn.month.
 */
function monthTokenFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function calendarMonthFromToken(token: string): number | null {
  const match = token.match(/^\d{4}-(\d{2})$/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return n;
}

/**
 * Compute the Cash Reserve Calendar V1 result.
 *
 * @param monthlyRollups DashboardModel.monthlyRollups (already operating
 *   mode in this app — see compute.ts). Reads `month`, `netCashFlow`.
 * @param referenceDate "Today" — used to derive the current (incomplete)
 *   calendar month, which is excluded from the window. Defaults to now.
 */
export function computeCashReserveCalendar(
  monthlyRollups: MonthlyRollup[],
  referenceDate: Date = new Date(),
): CashReserveCalendarResult {
  const currentToken = monthTokenFromDate(referenceDate);

  // Step 1 — completed rollups only, in chronological order.
  const completed = monthlyRollups
    .filter((r) => r.month < currentToken)
    .slice()
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  // Step 2 — low-data short-circuit (returns stable 12-month skeleton).
  if (completed.length < LOW_DATA_THRESHOLD) {
    return {
      state: 'low-data',
      windowMonthCount: completed.length,
      byMonth: buildEmptyByMonth(),
      constrainMonths: [],
      watchMonths: [],
      topPositiveMonths: [],
    };
  }

  // Step 3 — trailing 24 from the latest completed month.
  const window = completed.slice(-WINDOW_MONTHS);

  // Step 4 — group by calendar month (1..12) and aggregate.
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  for (const r of window) {
    const m = calendarMonthFromToken(r.month);
    if (m === null) continue;
    buckets[m - 1].push(r.netCashFlow);
  }

  const byMonth: CashReserveMonth[] = buckets.map((values, idx) => {
    const observationCount = values.length;
    const negativeCount = values.filter((v) => v < 0).length;
    const avgNetCash =
      observationCount === 0
        ? 0
        : values.reduce((sum, v) => sum + v, 0) / observationCount;

    let tier: CashReserveTier;
    if (observationCount === 0) {
      // No data for this calendar month inside the trailing window —
      // treat as healthy. We don't have enough signal to flag drain.
      tier = 'healthy';
    } else if (avgNetCash < 0 && negativeCount === observationCount) {
      tier = 'constrain';
    } else if (avgNetCash < 0) {
      tier = 'watch';
    } else {
      tier = 'healthy';
    }

    return {
      monthNumber: idx + 1,
      shortLabel: MONTH_SHORT_LABELS[idx],
      fullLabel: MONTH_FULL_LABELS[idx],
      observationCount,
      negativeCount,
      avgNetCash,
      tier,
    };
  });

  // Step 5 — bucket the tiers and pick top-positive months.
  // Constrain / watch are returned in calendar order so they read
  // naturally in copy ("Apr and Aug" rather than "Aug and Apr").
  const constrainMonths = byMonth.filter((m) => m.tier === 'constrain');
  const watchMonths = byMonth.filter((m) => m.tier === 'watch');

  const topPositiveMonths = byMonth
    .filter((m) => m.tier === 'healthy' && m.avgNetCash > 0)
    .sort((a, b) => b.avgNetCash - a.avgNetCash)
    .slice(0, TOP_POSITIVE_CAP);

  return {
    state: 'normal',
    windowMonthCount: window.length,
    byMonth,
    constrainMonths,
    watchMonths,
    topPositiveMonths,
  };
}

function buildEmptyByMonth(): CashReserveMonth[] {
  return MONTH_SHORT_LABELS.map((shortLabel, idx) => ({
    monthNumber: idx + 1,
    shortLabel,
    fullLabel: MONTH_FULL_LABELS[idx],
    observationCount: 0,
    negativeCount: 0,
    avgNetCash: 0,
    tier: 'healthy' as CashReserveTier,
  }));
}
