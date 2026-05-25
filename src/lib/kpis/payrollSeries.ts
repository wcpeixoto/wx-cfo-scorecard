import type { MonthlyRollup, Txn } from '../data/contract';
import { expenseContribution, parentCategoryName } from '../cashFlow';

/**
 * Payroll Health — annual payroll as a % of revenue.
 *
 * Numerator: net Payroll cost per calendar year — Σ expenseContribution over
 * txns whose PARENT category is 'Payroll' (subcategories roll up; refund /
 * reversal rows net out via expenseContribution). Owner Distributions are a
 * separate parent and are excluded automatically.
 *
 * Denominator: revenue per calendar year, summed from MonthlyRollup.revenue —
 * the same basis the Income & Expense card renders, so the two cards reconcile
 * (UI_RULES Part 6B card coherence).
 */

const PAYROLL_PARENT = 'Payroll';

/** Most recent calendar years to surface on the chart. */
const MAX_YEARS = 6;

/**
 * A leading (earliest) year with fewer months than this is a thin onboarding
 * stub (e.g. a single December of data) and is dropped so it doesn't distort
 * the trend. The current/trailing year is never dropped — it is flagged
 * partial / YTD instead.
 */
const LEADING_STUB_MIN_MONTHS = 6;

export type PayrollYearPoint = {
  year: string; // 'YYYY'
  payroll: number; // net payroll cost, dollars
  revenue: number; // revenue, dollars (reconciles with Income & Expense)
  payrollPct: number | null; // payroll / revenue * 100; null when revenue <= 0
  monthCount: number; // distinct rollup months present in the year
  isPartial: boolean; // fewer than 12 months of data
  isCurrent: boolean; // latest year in the (trimmed) series
};

export type PayrollSeries = {
  points: PayrollYearPoint[];
  /** Latest year — drives the hero metric. Null when there is no data. */
  current: PayrollYearPoint | null;
  /** Most efficient year — the lowest payroll-as-%-of-revenue among years
   *  with revenue. Drives the "Best year" comparisons. Null when no valid
   *  year exists. Computed, never hardcoded. */
  bestYear: PayrollYearPoint | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function yearOf(period: string): string {
  return period.slice(0, 4);
}

export function selectPayrollHealth(
  txns: readonly Txn[],
  monthlyRollups: readonly MonthlyRollup[],
): PayrollSeries {
  const revenueByYear = new Map<string, number>();
  const monthsByYear = new Map<string, Set<string>>();
  for (const r of monthlyRollups) {
    const year = yearOf(r.month);
    revenueByYear.set(year, (revenueByYear.get(year) ?? 0) + r.revenue);
    let months = monthsByYear.get(year);
    if (!months) {
      months = new Set();
      monthsByYear.set(year, months);
    }
    months.add(r.month);
  }

  const payrollByYear = new Map<string, number>();
  for (const t of txns) {
    if (parentCategoryName(t.category) !== PAYROLL_PARENT) continue;
    const year = yearOf(t.month);
    payrollByYear.set(year, (payrollByYear.get(year) ?? 0) + expenseContribution(t, 'operating'));
  }

  const years = [...new Set([...revenueByYear.keys(), ...payrollByYear.keys()])].sort();

  let points: PayrollYearPoint[] = years.map((year) => {
    const payroll = round2(payrollByYear.get(year) ?? 0);
    const revenue = round2(revenueByYear.get(year) ?? 0);
    const monthCount = monthsByYear.get(year)?.size ?? 0;
    return {
      year,
      payroll,
      revenue,
      payrollPct: revenue > 0 ? round1((100 * payroll) / revenue) : null,
      monthCount,
      isPartial: monthCount > 0 && monthCount < 12,
      isCurrent: false,
    };
  });

  // Drop leading thin-stub years (always keep at least one).
  while (
    points.length > 1 &&
    points[0].monthCount > 0 &&
    points[0].monthCount < LEADING_STUB_MIN_MONTHS
  ) {
    points = points.slice(1);
  }

  // Keep only the most recent MAX_YEARS.
  points = points.slice(-MAX_YEARS);

  if (points.length > 0) points[points.length - 1].isCurrent = true;

  // Best year = lowest payroll-as-%-of-revenue among years with revenue.
  let bestYear: PayrollYearPoint | null = null;
  for (const p of points) {
    if (p.payrollPct == null) continue;
    if (bestYear == null || p.payrollPct < (bestYear.payrollPct ?? Infinity)) bestYear = p;
  }

  return {
    points,
    current: points.length > 0 ? points[points.length - 1] : null,
    bestYear,
  };
}
