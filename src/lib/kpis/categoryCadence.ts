import type {
  DashboardModel,
  ForecastEvent,
  ForecastProjectionResult,
  ForecastSeasonalityMeta,
  ScenarioInput,
  ScenarioPoint,
  Txn,
} from '../data/contract';
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
//   Business Income:Sales → 50/50 blend of trailing-12 + 2-yr-YoY-average
//     Sales is recurring revenue with high month-to-month variance and a
//     consistent July strength signal across 2022–2025. The previous rule
//     (trailing-12 alone) erased all monthly shape — projecting May=Jun=Jul
//     — including the year-after-year July spike. Pure same-month-last-year
//     stakes the projection on a single noisy year; pure 2-yr-YoY captures
//     the full seasonal shape but commits 100% to two-year-old data. The
//     50/50 blend (trailing-12 run-rate + average of the same calendar
//     month from the prior two years, computed component-wise) keeps July
//     strength and non-flat shape visible while damping single-year noise.
//     2-yr-YoY-average degrades gracefully when one prior year is missing
//     by averaging the available prior-year months instead of treating
//     missing history as zero.

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

/** Average of the same calendar month from the prior 1 and 2 years.
 *  Missing prior-year months are dropped from the average rather than
 *  treated as zero — matches trailing12MonthAvg's graceful-degradation
 *  semantics. If both prior years are missing, returns 0 (no signal). */
function twoYearYoYAvg(
  catMonths: Map<string, number>,
  horizonMonth: string
): number {
  let sum = 0;
  let count = 0;
  for (const lookback of [-12, -24]) {
    const v = catMonths.get(addMonths(horizonMonth, lookback));
    if (v !== undefined) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Already-clamped scenario ratios applied per-category by sign. Inflows
 *  (positive contribution) scale by (1 + revenueRatio); outflows (negative
 *  contribution) scale by (1 + expenseRatio). Mirrors the Engine's
 *  projectScenario intent: revenueGrowth affects cash-in only, expenseChange
 *  affects cash-out only. Sign-based dispatch (rather than a hard-coded
 *  category list) ensures future income/expense lines are scaled correctly. */
export type CategoryCadenceScenario = {
  revenueRatio: number;
  expenseRatio: number;
};

function applyScenarioScale(contribution: number, scenario?: CategoryCadenceScenario): number {
  if (!scenario) return contribution;
  if (contribution > 0) return contribution * (1 + scenario.revenueRatio);
  if (contribution < 0) return contribution * (1 + scenario.expenseRatio);
  return contribution;
}

/** Category-cadence forecast: each operating-cash category projects on its
 *  own cadence (STABLE → trailing-3 average; PERIODIC/EVENT → same month last
 *  year). Categories whose cashFlow.ts contributions are zero (transfers,
 *  loans, owner distributions, uncategorized) drop out automatically.
 *  Optional `scenario` applies revenue/expense multipliers per category by
 *  sign of contribution; omit it (or pass undefined) for unstressed output. */
export function categoryCadenceForecast(
  asOfDate: string,
  txns: Txn[],
  anchors: Anchor[],
  scenario?: CategoryCadenceScenario
): ForecastSeries {
  const startingCash = reconstructStartingCash(asOfDate, txns, anchors);
  const startMonth = asOfDate.slice(0, 7);
  const netByCategory = buildCategoryNetByMonth(txns);
  const { classifications } = classifyCategories(txns);

  const points: { month: string; endingCashBalance: number; cashIn: number; cashOut: number }[] = [];
  let runningBalance = startingCash;
  for (let i = 1; i <= HORIZON_MONTHS; i += 1) {
    const horizonMonth = addMonths(startMonth, i - 1);
    const yoyMonth = addMonths(horizonMonth, -12);
    // Accumulate inflows and outflows separately so callers can compose
    // asymmetric hybrids (e.g. Split Conservative = Engine cash-in +
    // Cadence cash-out). Net behavior is identical: monthlyDelta = in - out.
    let monthlyCashIn = 0;
    let monthlyCashOut = 0;
    for (const [category, monthMap] of netByCategory) {
      const cls = classifications.get(category);
      if (!cls) continue;
      let contribution = 0;
      // Per-category override: Business Income:Sales uses a 50/50 blend of
      // a trailing-12 run-rate and a 2-year YoY average (component-wise).
      // Trailing-12 alone erases all monthly shape; 2-yr-YoY alone overcommits
      // to two-year-old data. The blend restores July strength and seasonal
      // shape while damping single-year noise. See top-of-file note.
      //
      // Cutoff safety (Sales only): both component lookups query strictly
      // months before startMonth — trailing-12 walks back from startMonth-1,
      // 2-yr-YoY queries horizonMonth-12 and horizonMonth-24 (both before
      // startMonth for every horizon month). No future-dated txn can affect
      // the Sales projection. This claim is scoped to Sales — classifyCategories
      // runs over the full txns array and the statistical fallback (months-
      // active ratio + CV) can shift if future-dated rows are present, so a
      // global cutoff-safety claim for non-hard-coded categories is not made.
      if (category === 'Business Income:Sales') {
        const trailingComponent = trailing12MonthAvg(monthMap, startMonth);
        const yoyComponent = twoYearYoYAvg(monthMap, horizonMonth);
        contribution = 0.5 * trailingComponent + 0.5 * yoyComponent;
      } else if (cls.cadence === 'STABLE') {
        contribution = trailing3MonthAvg(monthMap, startMonth);
      } else {
        // PERIODIC or EVENT: same calendar month one year before this
        // horizon month. Absent → 0.
        contribution = monthMap.get(yoyMonth) ?? 0;
      }
      const scaled = applyScenarioScale(contribution, scenario);
      if (scaled > 0) monthlyCashIn += scaled;
      else if (scaled < 0) monthlyCashOut += (-scaled);
    }
    const monthlyDelta = monthlyCashIn - monthlyCashOut;
    runningBalance += monthlyDelta;
    points.push({ month: horizonMonth, endingCashBalance: runningBalance, cashIn: monthlyCashIn, cashOut: monthlyCashOut });
  }

  return { asOfDate, startingCash, points };
}

// ─── Stage 2 adapter ─────────────────────────────────────────────────────────
// Production-facing wrapper that mirrors projectScenario's output shape so
// call sites can swap the function name without rewriting the surrounding
// code.
//
// Stage 2 adapter: signature differs from projectScenario by
// one required argument — txns — because the category-cadence
// comparator builds its forecast directly from transactions
// rather than from the precomputed rollups in DashboardModel.
// Stage 3 call sites must pass filteredTxns explicitly.

const EMPTY_SEASONALITY: ForecastSeasonalityMeta = {
  mode: 'fallback',
  confidence: 'none',
  completeYearsUsed: [],
  partialYearsExcluded: [],
  weighting: [],
  capMin: 0,
  capMax: 0,
  divergenceThresholdPct: 0,
  warning: null,
};

/** Production-facing adapter for the category-cadence forecast. Mirrors
 *  projectScenario's argument order and return shape so call sites can swap
 *  function names with one extra argument (txns). The comparator caps the
 *  projection horizon at 12 months; if input.months is larger, the result
 *  is still 12 points. */
export function projectCategoryCadenceScenario(
  model: DashboardModel,
  input: ScenarioInput,
  txns: Txn[],
  startingCashBalance = 0,
  // STAGE 2: events are accepted for signature compatibility
  // with projectScenario but not yet applied. Known Events
  // overlay is planned for a future stage.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  events: ForecastEvent[] = []
): ForecastProjectionResult {
  if (model.forecastCashRollups.length === 0 || !model.latestMonth) {
    return { points: [], seasonality: EMPTY_SEASONALITY };
  }

  // Project starting at the month *after* the model's last complete month,
  // matching projectScenario's output alignment. The comparator's
  // `categoryCadenceForecast` treats `monthOf(asOfDate)` as horizon month 1,
  // so an as-of date in the next month yields the same first projected
  // month as projectScenario.
  //
  // Source the anchor from forecastCashRollups (which excludes the in-progress
  // current calendar month, per compute.ts:1737) rather than monthlyRollups.
  // model.latestMonth tracks monthlyRollups and includes partial months —
  // using it would shift the cadence start one month past projectScenario's
  // start whenever the latest import contains same-day partial-month rows,
  // breaking composeConservativeFloor's index-aligned month invariant.
  // Fallback to model.latestMonth preserves the empty-rollup edge case.
  const lastForecastRollup =
    model.forecastCashRollups[model.forecastCashRollups.length - 1];
  const startMonth = addMonths(lastForecastRollup?.month ?? model.latestMonth, 1);
  const asOfDate = `${startMonth}-01`;

  // Production has no historical anchor file; pass [] and let the comparator
  // zero-anchor its internal starting cash. We then overwrite endingCashBalance
  // with the explicit startingCashBalance argument so absolute levels track
  // production's current-cash convention rather than the harness's
  // reconciliation anchor.
  //
  // Scenario sliders (revenueGrowthPct / expenseChangePct) are clamped to
  // match Engine's projectScenario bounds, then applied per-category by sign
  // of contribution inside categoryCadenceForecast. Inflows scale with
  // revenueGrowth, outflows with expenseChange; zero-valued sliders pass
  // through as identity scaling.
  const revenueRatio = Math.max(-0.6, Math.min(0.6, input.revenueGrowthPct / 100));
  const expenseRatio = Math.max(-0.5, Math.min(0.5, input.expenseChangePct / 100));
  const scenario =
    revenueRatio !== 0 || expenseRatio !== 0 ? { revenueRatio, expenseRatio } : undefined;
  const series: ForecastSeries = categoryCadenceForecast(asOfDate, txns, [], scenario);

  const requestedMonths = Math.max(0, Math.min(input.months, series.points.length));
  const points: ScenarioPoint[] = [];
  let prevBalance = startingCashBalance;
  for (let i = 0; i < requestedMonths; i += 1) {
    const cur = series.points[i];
    // Re-anchor onto the production-supplied starting cash. The comparator's
    // internal series uses its own zero-anchored starting cash; we walk the
    // monthly deltas it produced and re-apply them to startingCashBalance.
    const internalPrev = i === 0 ? series.startingCash : series.points[i - 1].endingCashBalance;
    const monthlyDelta = cur.endingCashBalance - internalPrev;
    const endingCashBalance = prevBalance + monthlyDelta;
    // Category-Cadence has no AR/AP carry layer in this phase, so
    // operating* and cashIn/cashOut fields are intentionally equal.
    // Engine retains its own separate carry semantics.
    const pCashIn = cur.cashIn ?? 0;
    const pCashOut = cur.cashOut ?? 0;
    points.push({
      month: cur.month,
      operatingCashIn: pCashIn,
      operatingCashOut: pCashOut,
      cashIn: pCashIn,
      cashOut: pCashOut,
      netCashFlow: pCashIn - pCashOut,
      endingCashBalance,
    });
    prevBalance = endingCashBalance;
  }

  return { points, seasonality: EMPTY_SEASONALITY };
}
