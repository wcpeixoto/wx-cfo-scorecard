import type { Txn } from '../../src/lib/data/contract';
import {
  forecastCashInContribution,
  forecastCashOutContribution,
  parentCategoryName,
} from '../../src/lib/cashFlow';
import { reconstructStartingCash } from './walkForward';
import type { Anchor, ForecastSeries } from './types';

const HORIZON_MONTHS = 12;

export type CategoryCadence = 'STABLE' | 'PERIODIC' | 'EVENT';

// ─── Classification rules (parent-level unless full-string match needed) ────
//
// STABLE → trailing 3-month average per category.
// PERIODIC → same calendar month one year ago.
// EVENT → same calendar month one year ago (until Known Events lands).

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
