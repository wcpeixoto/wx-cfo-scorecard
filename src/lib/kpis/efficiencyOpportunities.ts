import type { DashboardModel, Txn } from '../data/contract';
import {
  shouldExcludeFromProfitability,
  isBusinessIncomeCategory,
  isCapitalDistributionCategory,
  parentCategoryName,
} from '../cashFlow';

const MATERIALITY_MIN_USD = 100;
const WINDOW_SIZE_MONTHS = 3;
const LOOKBACK_MONTHS = 24;
const MAX_ROWS = 4;

// Categories the owner has no near-term operational lever to change.
// Suppressed from Efficiency Opportunities regardless of gap size.
// Names are exact matches against parentCategoryName() output — case-sensitive.
// 'Amortization' not present in current data but kept for future-proofing.
const SUPPRESSED_CATEGORIES = new Set<string>([
  'Rent or Lease',
  'Depreciation',
  'Amortization',
  'Taxes and Licenses',
  'Interest Paid',
  'Loan',
]);

let debugLoggedOnce = false;

export interface EfficiencyRow {
  category: string;
  bestPct: number;         // display percent, rounded
  todayPct: number;        // display percent, rounded
  extraPerMonth: number;   // dollars/month
  bestPeriodLabel: string; // "was 28% avg (Jan–Mar 2025)"
  greenWidthPct: number;   // 0-100
  redWidthPct: number;     // 0-100
}

export interface EfficiencyOpportunitiesResult {
  windowLabel: string;        // "Jan – Mar 2026"
  rows: EfficiencyRow[];      // top N by extraPerMonth
  totalExtraPerMonth: number; // sum across ALL qualifying categories
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function parseMonthParts(month: string): { year: number; monthIndex: number } | null {
  if (!month || month.length < 7) return null;
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

function addMonths(month: string, delta: number): string {
  const parts = parseMonthParts(month);
  if (!parts) return month;
  const total = parts.year * 12 + parts.monthIndex + delta;
  const year = Math.floor(total / 12);
  const monthIndex = ((total % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function monthShort(month: string): string {
  const parts = parseMonthParts(month);
  if (!parts) return month;
  return MONTH_SHORT[parts.monthIndex];
}

function yearOf(month: string): number | null {
  const parts = parseMonthParts(month);
  return parts ? parts.year : null;
}

function formatWindowLabel(startMonth: string, endMonth: string): string {
  const startYear = yearOf(startMonth);
  const endYear = yearOf(endMonth);
  const startLabel = monthShort(startMonth);
  const endLabel = monthShort(endMonth);
  if (startYear === endYear) {
    return `${startLabel} – ${endLabel} ${endYear}`;
  }
  return `${startLabel} ${startYear} – ${endLabel} ${endYear}`;
}

function formatBestPeriodLabel(bestPct: number, startMonth: string, endMonth: string): string {
  return `was ${bestPct}% avg (${formatWindowLabel(startMonth, endMonth)})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute efficiency opportunities for the UI Lab card.
 *
 * Algorithm (V1):
 *  - Anchor "today" to the last full 3-month window ending at model.latestMonth.
 *  - Look back 24 months; enumerate all consecutive 3-month windows where every
 *    month has revenue > 0. Require ≥2 valid windows per category.
 *  - For each expense parent-category: skip if avg current spend < $100/mo.
 *    todayRatio = currentAvgSpend / currentAvgRevenue.
 *    bestRatio = min ratio across all valid windows.
 *    extraPerMonth = (todayRatio - bestRatio) * currentAvgRevenue.
 *    Skip if extraPerMonth ≤ 0.
 *  - Sort desc by extraPerMonth. Top N rows returned; totalExtraPerMonth sums all.
 */
export function computeEfficiencyOpportunities(
  model: DashboardModel,
  txns: Txn[],
): EfficiencyOpportunitiesResult {
  if (!debugLoggedOnce) {
    // eslint-disable-next-line no-console
    console.debug(
      `[efficiencyOpportunities] materiality threshold = $${MATERIALITY_MIN_USD}/mo, ` +
        `window = ${WINDOW_SIZE_MONTHS} months, lookback = ${LOOKBACK_MONTHS} months`,
    );
    debugLoggedOnce = true;
  }

  const emptyResult: EfficiencyOpportunitiesResult = {
    windowLabel: '',
    rows: [],
    totalExtraPerMonth: 0,
  };

  const latestMonth = model.latestMonth;
  if (!latestMonth || !parseMonthParts(latestMonth)) return emptyResult;

  // Build lookback month list (oldest → newest), size = LOOKBACK_MONTHS ending at latestMonth
  const months: string[] = [];
  for (let i = LOOKBACK_MONTHS - 1; i >= 0; i -= 1) {
    months.push(addMonths(latestMonth, -i));
  }
  const monthIndex = new Map<string, number>();
  months.forEach((m, i) => monthIndex.set(m, i));

  // Revenue per month + expense per (parent category, month)
  const revenueByMonth = new Array<number>(months.length).fill(0);
  const expenseByCatMonth = new Map<string, number[]>();

  for (const txn of txns) {
    if (!txn || !txn.month) continue;
    const idx = monthIndex.get(txn.month);
    if (idx === undefined) continue;
    if (shouldExcludeFromProfitability(txn)) continue;

    if (txn.type === 'income') {
      if (isBusinessIncomeCategory(txn.category)) {
        revenueByMonth[idx] += Math.abs(txn.amount);
      }
      continue;
    }

    if (txn.type === 'expense') {
      if (isCapitalDistributionCategory(txn.category)) continue;
      const parent = parentCategoryName(txn.category);
      if (!parent) continue;
      if (SUPPRESSED_CATEGORIES.has(parent)) continue;
      let arr = expenseByCatMonth.get(parent);
      if (!arr) {
        arr = new Array<number>(months.length).fill(0);
        expenseByCatMonth.set(parent, arr);
      }
      arr[idx] += Math.abs(txn.amount);
    }
  }

  // Enumerate valid consecutive 3-month windows (all months revenue > 0)
  type Window = { startIdx: number; endIdx: number; avgRevenue: number };
  const validWindows: Window[] = [];
  for (let start = 0; start + WINDOW_SIZE_MONTHS - 1 < months.length; start += 1) {
    const end = start + WINDOW_SIZE_MONTHS - 1;
    let sumRev = 0;
    let allPositive = true;
    for (let k = start; k <= end; k += 1) {
      if (revenueByMonth[k] <= 0) {
        allPositive = false;
        break;
      }
      sumRev += revenueByMonth[k];
    }
    if (!allPositive) continue;
    validWindows.push({
      startIdx: start,
      endIdx: end,
      avgRevenue: sumRev / WINDOW_SIZE_MONTHS,
    });
  }

  if (validWindows.length === 0) return emptyResult;

  // Current window = last valid window that ends at latestMonth
  const latestIdx = months.length - 1;
  const currentWindow = validWindows.find((w) => w.endIdx === latestIdx);
  if (!currentWindow) return emptyResult;

  const currentStartMonth = months[currentWindow.startIdx];
  const currentEndMonth = months[currentWindow.endIdx];
  const windowLabel = formatWindowLabel(currentStartMonth, currentEndMonth);

  const rowsAll: EfficiencyRow[] = [];

  for (const [category, spendByMonth] of expenseByCatMonth.entries()) {
    // Current avg spend in the current window
    let sumCurrent = 0;
    for (let k = currentWindow.startIdx; k <= currentWindow.endIdx; k += 1) {
      sumCurrent += spendByMonth[k];
    }
    const currentAvgSpend = sumCurrent / WINDOW_SIZE_MONTHS;

    // Materiality guard
    if (currentAvgSpend < MATERIALITY_MIN_USD) continue;

    // Windows where category has been observed are all valid windows (we still
    // compute ratio over each valid window; we require ≥ 2 valid windows total).
    if (validWindows.length < 2) continue;

    const todayRatio = currentAvgSpend / currentWindow.avgRevenue;

    let bestRatio = Number.POSITIVE_INFINITY;
    let bestWindow: Window | null = null;
    for (const w of validWindows) {
      let sumSpend = 0;
      for (let k = w.startIdx; k <= w.endIdx; k += 1) {
        sumSpend += spendByMonth[k];
      }
      const avgSpend = sumSpend / WINDOW_SIZE_MONTHS;
      const ratio = avgSpend / w.avgRevenue;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestWindow = w;
      }
    }
    if (!bestWindow || !Number.isFinite(bestRatio)) continue;

    const extraPerMonth = (todayRatio - bestRatio) * currentWindow.avgRevenue;
    if (extraPerMonth <= 0) continue;

    const bestPct = Math.round(bestRatio * 100);
    const todayPct = Math.round(todayRatio * 100);

    const greenWidthPct = clamp(
      todayRatio > 0 ? (bestRatio / todayRatio) * 100 : 0,
      0,
      100,
    );
    const redWidthPct = clamp(100 - greenWidthPct, 0, 100);

    const bestStartMonth = months[bestWindow.startIdx];
    const bestEndMonth = months[bestWindow.endIdx];

    rowsAll.push({
      category,
      bestPct,
      todayPct,
      extraPerMonth,
      bestPeriodLabel: formatBestPeriodLabel(bestPct, bestStartMonth, bestEndMonth),
      greenWidthPct,
      redWidthPct,
    });
  }

  rowsAll.sort((a, b) => b.extraPerMonth - a.extraPerMonth);

  const totalExtraPerMonth = rowsAll.reduce((acc, r) => acc + r.extraPerMonth, 0);
  const rows = rowsAll.slice(0, MAX_ROWS);

  return {
    windowLabel,
    rows,
    totalExtraPerMonth,
  };
}
