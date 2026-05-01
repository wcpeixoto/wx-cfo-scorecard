import type { Txn } from '../data/contract';
import {
  forecastCashInContribution,
  forecastCashOutContribution,
  parentCategoryName,
} from '../cashFlow';
import { reconstructStartingCash, type Anchor, type ForecastSeries } from './forecastShared';

const HORIZON_MONTHS = 12;

export type CategoryCadence = 'STABLE' | 'PERIODIC' | 'EVENT';

// ─── Classification rules (parent-level unless full-string match needed) ────
//
// STABLE → trailing 3-month average per category.
// PERIODIC → same calendar month one year ago.
// EVENT → same calendar month one year ago (until Known Events lands).
//
// Per-category projection overrides (applied before the cadence dispatch):
//   Business Income:Sales → trailing 12-month average
//     Sales is recurring revenue with high month-to-month variance.
//     YoY (the EVENT default) overweights the lumpiest months; a
//     trailing-12 average smooths to the underlying run-rate. Validated
//     in the harness sweep — F outperformed YoY (current), 3-mo, 6-mo,
//     YoY-blend, and a 50/50 blend of trailing-12 and YoY on
//     worstSingleMonthMiss and per-as-of wins-vs-engine, while keeping
//     safetyLineHitRate at 100%.

const STABLE_PARENTS = new Set<string>([
  'Payroll',
  'Rent or Lease',
  'Merchant Fees',
  'Utilities',
  'Cleaning',
  'Software Subscriptions',
  'Marketing',
  'Office Expenses',
  'Repairs and Maintenance',
  'Bank Service Charges',
]);

const PERIODIC_PARENTS = new Set<string>([
  'Taxes and Licenses',
  'Insurance',
  'Legal, Accounting & Prof. Services',
  'Training & Education',
  'Events & Community',
  'Misc. Expense',
]);

const EVENT_PARENTS = new Set<string>([
  'COGS',
  'Customer Refunds',
  'Interest Paid',
  'Depreciation',
]);

// Full-string overrides — needed when subcategories under one parent have
// genuinely different cadences (e.g. "Sales" is lumpy/event-driven; "Other
// Income" is stable).
const FULL_STRING_RULES: Record<string, CategoryCadence> = {
  'Business Income:Sales': 'EVENT',
  'Business Income:Other Income': 'STABLE',
};

// Statistical fallback thresholds (applied to categories absent from both
// hard-coded sets above).
const STABLE_MONTHS_ACTIVE_RATIO = 0.9;
const STABLE_CV_MAX = 0.6;
const PERIODIC_MONTHS_ACTIVE_RATIO = 0.5;

function operatingCashNet(txn: Txn): number {
  return forecastCashInContribution(txn) - forecastCashOutContribution(txn);
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

/** Build per-category, per-month operating-cash net. Categories whose
 *  contributions are zeroed by cashFlow.ts (transfers, loans, owner
 *  distributions, uncategorized) silently drop out because every txn nets
 *  to 0 for them. */
function buildCategoryNetByMonth(txns: Txn[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const t of txns) {
    const net = operatingCashNet(t);
    if (net === 0) continue;
    let inner = out.get(t.category);
    if (!inner) {
      inner = new Map<string, number>();
      out.set(t.category, inner);
    }
    inner.set(t.month, (inner.get(t.month) ?? 0) + net);
  }
  return out;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Statistical fallback classifier for categories not in the hard-coded sets. */
function classifyByStatistics(
  monthlyNets: number[],
  monthsActive: number,
  availableMonths: number
): CategoryCadence {
  if (availableMonths === 0) return 'EVENT';
  const activeRatio = monthsActive / availableMonths;
  if (activeRatio < PERIODIC_MONTHS_ACTIVE_RATIO) return 'PERIODIC';
  const mean = monthlyNets.reduce((s, v) => s + v, 0) / Math.max(monthlyNets.length, 1);
  const cv = Math.abs(mean) > 1e-9 ? stddev(monthlyNets) / Math.abs(mean) : Number.POSITIVE_INFINITY;
  if (activeRatio >= STABLE_MONTHS_ACTIVE_RATIO && cv < STABLE_CV_MAX) return 'STABLE';
  return 'EVENT';
}

export type CategoryClassification = {
  category: string;
  cadence: CategoryCadence;
  source: 'full-string' | 'parent' | 'statistical';
  monthsActive?: number;
  cv?: number;
};

/** Build classifications for every category that has any operating-cash
 *  activity in the fixture. Used by the forecast and exposed for diagnostics. */
export function classifyCategories(
  txns: Txn[]
): { classifications: Map<string, CategoryClassification>; availableMonths: number } {
  const netByMonth = buildCategoryNetByMonth(txns);
  const allMonths = new Set<string>();
  for (const t of txns) allMonths.add(t.month);
  const availableMonths = allMonths.size;

  const classifications = new Map<string, CategoryClassification>();
  for (const [category, monthMap] of netByMonth) {
    const fullStringCadence = FULL_STRING_RULES[category];
    if (fullStringCadence) {
      classifications.set(category, { category, cadence: fullStringCadence, source: 'full-string' });
      continue;
    }
    const parent = parentCategoryName(category);
    if (STABLE_PARENTS.has(parent)) {
      classifications.set(category, { category, cadence: 'STABLE', source: 'parent' });
      continue;
    }
    if (PERIODIC_PARENTS.has(parent)) {
      classifications.set(category, { category, cadence: 'PERIODIC', source: 'parent' });
      continue;
    }
    if (EVENT_PARENTS.has(parent)) {
      classifications.set(category, { category, cadence: 'EVENT', source: 'parent' });
      continue;
    }
    const monthlyNets = Array.from(monthMap.values());
    const monthsActive = monthMap.size;
    const cadence = classifyByStatistics(monthlyNets, monthsActive, availableMonths);
    const mean = monthlyNets.reduce((s, v) => s + v, 0) / Math.max(monthlyNets.length, 1);
    const cv = Math.abs(mean) > 1e-9 ? stddev(monthlyNets) / Math.abs(mean) : Number.POSITIVE_INFINITY;
    classifications.set(category, {
      category,
      cadence,
      source: 'statistical',
      monthsActive,
      cv,
    });
  }
  return { classifications, availableMonths };
}

/** Trailing 3-month average for a category, ending at the month before
 *  asOfMonth. Missing months are counted as 0 in the numerator with a fixed
 *  denominator of 3 (the locked semantic of "trailing 3-month average"). */
function trailing3MonthAvg(
  catMonths: Map<string, number>,
  asOfMonth: string
): number {
  let sum = 0;
  for (let k = 1; k <= 3; k += 1) {
    const m = addMonths(asOfMonth, -k);
    sum += catMonths.get(m) ?? 0;
  }
  return sum / 3;
}

/** Trailing 12-month average for a category, ending at the month before
 *  asOfMonth. If fewer than 12 of the trailing months have data, divides
 *  by the number that do — so categories with thin history degrade
 *  gracefully instead of being silently halved. */
function trailing12MonthAvg(
  catMonths: Map<string, number>,
  asOfMonth: string
): number {
  let sum = 0;
  let count = 0;
  for (let k = 1; k <= 12; k += 1) {
    const m = addMonths(asOfMonth, -k);
    const v = catMonths.get(m);
    if (v !== undefined) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Category-cadence forecast: each operating-cash category projects on its
 *  own cadence (STABLE → trailing-3 average; PERIODIC/EVENT → same month last
 *  year). Categories whose cashFlow.ts contributions are zero (transfers,
 *  loans, owner distributions, uncategorized) drop out automatically. */
export function categoryCadenceForecast(
  asOfDate: string,
  txns: Txn[],
  anchors: Anchor[]
): ForecastSeries {
  const startingCash = reconstructStartingCash(asOfDate, txns, anchors);
  const startMonth = asOfDate.slice(0, 7);
  const netByCategory = buildCategoryNetByMonth(txns);
  const { classifications } = classifyCategories(txns);

  const points: { month: string; endingCashBalance: number }[] = [];
  let runningBalance = startingCash;
  for (let i = 1; i <= HORIZON_MONTHS; i += 1) {
    const horizonMonth = addMonths(startMonth, i - 1);
    const yoyMonth = addMonths(horizonMonth, -12);
    let monthlyDelta = 0;
    for (const [category, monthMap] of netByCategory) {
      const cls = classifications.get(category);
      if (!cls) continue;
      // Per-category override: Business Income:Sales uses a trailing
      // 12-month average instead of the EVENT-default same-month-last-year.
      // See top-of-file note for the rationale and harness validation.
      if (category === 'Business Income:Sales') {
        monthlyDelta += trailing12MonthAvg(monthMap, startMonth);
        continue;
      }
      if (cls.cadence === 'STABLE') {
        monthlyDelta += trailing3MonthAvg(monthMap, startMonth);
      } else {
        // PERIODIC or EVENT: same calendar month one year before this
        // horizon month. Absent → 0.
        monthlyDelta += monthMap.get(yoyMonth) ?? 0;
      }
    }
    runningBalance += monthlyDelta;
    points.push({ month: horizonMonth, endingCashBalance: runningBalance });
  }

  return { asOfDate, startingCash, points };
}
