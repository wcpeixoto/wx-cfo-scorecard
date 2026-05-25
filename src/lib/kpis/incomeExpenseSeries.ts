import type { MonthlyRollup } from '../data/contract';

/** Card-local timeframe options — independent from the Big Picture page header timeframe. */
export type IncomeExpenseTimeframe = '6m' | '12m' | '18m' | '24m' | '36m' | '5y' | 'all';

export type IncomeExpenseGranularity = 'monthly' | 'yearly';

export type IncomeExpenseSeries = {
  /** Period keys — 'YYYY-MM' when monthly, 'YYYY' when yearly. Display formatting happens in the card. */
  labels: string[];
  income: number[];
  expense: number[];
  totalIncome: number;
  totalExpense: number;
  netIncome: number;
};

export type ResolvedWindow = {
  startMonth: string; // 'YYYY-MM', inclusive
  endMonth: string; // 'YYYY-MM', inclusive
  granularity: IncomeExpenseGranularity;
};

/** Nominal span in months for each fixed timeframe ('all' is data-driven). */
const SPAN_MONTHS: Record<Exclude<IncomeExpenseTimeframe, 'all'>, number> = {
  '6m': 6,
  '12m': 12,
  '18m': 18,
  '24m': 24,
  '36m': 36,
  '5y': 60,
};

/** Never render more than 18 bars on screen (18m is the widest monthly view; keeps yearly 'All' legible). */
const MAX_BARS = 18;

function monthIndex(month: string): number {
  const [y, m] = month.split('-');
  return Number(y) * 12 + (Number(m) - 1);
}

function addMonths(month: string, delta: number): string {
  const total = monthIndex(month) + delta;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function spanInclusive(startMonth: string, endMonth: string): number {
  return monthIndex(endMonth) - monthIndex(startMonth) + 1;
}

export function latestRollupMonth(rollups: readonly MonthlyRollup[]): string | null {
  let latest: string | null = null;
  for (const r of rollups) if (latest === null || r.month > latest) latest = r.month;
  return latest;
}

function earliestRollupMonth(rollups: readonly MonthlyRollup[]): string | null {
  let earliest: string | null = null;
  for (const r of rollups) if (earliest === null || r.month < earliest) earliest = r.month;
  return earliest;
}

/**
 * Resolve the visible window for a card timeframe, anchored to the LATEST
 * available rollup month (not real today) so the card stays data-grounded.
 *
 * Granularity: 6/12/18m are monthly; 24/36m and 5y are yearly; 'All' is monthly
 * only when the full data span is ≤12 months, otherwise yearly.
 */
export function resolveWindow(
  rollups: readonly MonthlyRollup[],
  timeframe: IncomeExpenseTimeframe,
): ResolvedWindow | null {
  const end = latestRollupMonth(rollups);
  if (!end) return null;

  const start =
    timeframe === 'all'
      ? (earliestRollupMonth(rollups) ?? end)
      : addMonths(end, -(SPAN_MONTHS[timeframe] - 1));

  const granularity: IncomeExpenseGranularity =
    timeframe === '6m' || timeframe === '12m' || timeframe === '18m'
      ? 'monthly'
      : timeframe === 'all'
        ? spanInclusive(start, end) <= 12
          ? 'monthly'
          : 'yearly'
        : 'yearly';

  return { startMonth: start, endMonth: end, granularity };
}

function inWindow(
  rollups: readonly MonthlyRollup[],
  startMonth: string,
  endMonth: string,
): MonthlyRollup[] {
  return rollups.filter((r) => r.month >= startMonth && r.month <= endMonth);
}

function finalize(labels: string[], income: number[], expense: number[]): IncomeExpenseSeries {
  const totalIncome = income.reduce((sum, v) => sum + v, 0);
  const totalExpense = expense.reduce((sum, v) => sum + v, 0);
  return {
    labels,
    income,
    expense,
    totalIncome,
    totalExpense,
    netIncome: totalIncome - totalExpense,
  };
}

/** Per-month income/expense across [startMonth, endMonth]. Totals reconcile with the (capped) visible bars. */
export function selectMonthlyIncomeExpense(
  rollups: readonly MonthlyRollup[],
  startMonth: string,
  endMonth: string,
): IncomeExpenseSeries {
  const rows = inWindow(rollups, startMonth, endMonth)
    .slice()
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .slice(-MAX_BARS);
  return finalize(
    rows.map((r) => r.month),
    rows.map((r) => r.revenue),
    rows.map((r) => r.expenses),
  );
}

/** Calendar-year income/expense across [startMonth, endMonth]. Partial edge years are included as-is (no padding). */
export function selectYearlyIncomeExpense(
  rollups: readonly MonthlyRollup[],
  startMonth: string,
  endMonth: string,
): IncomeExpenseSeries {
  const byYear = new Map<string, { income: number; expense: number }>();
  for (const r of inWindow(rollups, startMonth, endMonth)) {
    const year = r.month.slice(0, 4);
    const acc = byYear.get(year) ?? { income: 0, expense: 0 };
    acc.income += r.revenue;
    acc.expense += r.expenses;
    byYear.set(year, acc);
  }
  const years = [...byYear.keys()].sort().slice(-MAX_BARS);
  return finalize(
    years,
    years.map((y) => byYear.get(y)!.income),
    years.map((y) => byYear.get(y)!.expense),
  );
}

/** One-shot resolver for the card: timeframe → resolved series + the granularity it was rendered at. */
export function selectIncomeExpense(
  rollups: readonly MonthlyRollup[],
  timeframe: IncomeExpenseTimeframe,
): { series: IncomeExpenseSeries; granularity: IncomeExpenseGranularity } {
  const window = resolveWindow(rollups, timeframe);
  if (!window) return { series: finalize([], [], []), granularity: 'monthly' };
  const series =
    window.granularity === 'monthly'
      ? selectMonthlyIncomeExpense(rollups, window.startMonth, window.endMonth)
      : selectYearlyIncomeExpense(rollups, window.startMonth, window.endMonth);
  return { series, granularity: window.granularity };
}
