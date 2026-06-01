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

// Revenue-qualification of "best" windows (see computeCore).
const REVENUE_FLOOR_RATIO = 0.7;  // a window's avg revenue must clear 0.7 × floor
const MIN_WINDOWS = 2;            // ≥2 windows needed for a credible benchmark

// A category becomes "benchmark-ready" only after its first run of this many
// consecutive months where ≥1 transaction was recorded. Matches the 3-month
// window size by design — the smallest unit the card considers as a "best
// stretch" is also the smallest unit of demonstrated sustained tracking.
const SUSTAINED_TRACKING_MIN_MONTHS = 3;

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

export interface WindowMonthDetail {
  monthLabel: string;  // e.g. "Jan"
  revenue: number;
  spend: number;
  ratio: number;       // raw ratio, e.g. 0.28
}

export interface WindowDetail {
  label: string;                // e.g. "Jan – Mar 2025"
  months: WindowMonthDetail[];  // always WINDOW_SIZE_MONTHS entries
}

export interface EfficiencyRow {
  category: string;
  bestPct: number;         // display percent, rounded
  todayPct: number;        // display percent, rounded
  extraPerMonth: number;   // dollars/month
  bestPeriodLabel: string; // "was 28% avg (Jan–Mar 2025)"
  greenWidthPct: number;   // 0-100
  redWidthPct: number;     // 0-100
  bestWindow: WindowDetail;
  todayWindow: WindowDetail;
}

// Payroll Efficiency card chart data — one entry per VALID 3-month window in
// the 24-month lookback (revenue > 0 in all 3 months). Ineligible windows are
// still included so the chart can show context, but isBenchmarkEligible is
// false and the renderer hides their y-value so they can't be misread as
// candidates for "best stretch". `isBest` only marks the eligible window the
// hero/card label points to; `isCurrent` only marks the last-complete window
// the hero "today %" reads from. Series respects the same gates as
// payrollTodayPct / payrollBestPct so all four card surfaces (hero, subtitle,
// chart, footer) read from the same logic.
export interface PayrollRollingPoint {
  label: string;                    // e.g. "Jan – Mar 2025"
  payrollPct: number;               // payroll / revenue * 100, rounded
  revenue: number;                  // sum revenue across the 3-month window
  payroll: number;                  // sum payroll across the 3-month window
  revenuePerPayrollDollar: number;  // revenue / payroll
  isCurrent: boolean;               // matches the "today" window
  isBest: boolean;                  // matches the picked best window
  isBenchmarkEligible: boolean;     // passes both the firstActiveMonth gate
                                    // AND revenue-qualification gate
}

export interface EfficiencyOpportunitiesResult {
  windowLabel: string;        // "Jan – Mar 2026"
  rows: EfficiencyRow[];      // top N by extraPerMonth
  totalExtraPerMonth: number; // sum across ALL qualifying categories
  // Payroll-specific excess ($/mo), taken from the full (pre-top-N) category
  // set so it survives display truncation. Same methodology as `rows`; null
  // when Payroll has no positive excess. Never the all-category total.
  payrollExtraPerMonth: number | null;
  // Payroll-specific 3-month basis for the Payroll Efficiency card hero,
  // computed independently of the per-row excess/materiality gates so the hero
  // still renders when payroll is at or better than its best stretch (no row,
  // payrollExtraPerMonth null). When a Payroll row exists these equal its
  // todayPct / bestPct. Null when there is no payroll spend / no valid window.
  payrollTodayPct: number | null;        // payroll % of revenue, last 3 complete months
  payrollBestPct: number | null;         // lowest payroll % over the candidate 3-month windows
  payrollBestWindowLabel: string | null; // e.g. "Jan – Mar 2025"
  // Chart series for the Payroll Efficiency card — every valid 3-month window
  // in the lookback, with isCurrent/isBest/isBenchmarkEligible flags. Empty
  // when there is no payroll spend / no valid window. See PayrollRollingPoint.
  payrollRollingSeries: PayrollRollingPoint[];
  // True when "best" was chosen from revenue-qualified windows (≥2 windows
  // clearing the dual revenue floor). False when too few qualified and every
  // category fell back to the unfiltered best. Globally uniform per run today
  // (the floor is revenue-only); a per-row field can be added later if
  // qualification ever becomes category-specific.
  benchmarkRevenueQualified: boolean;
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

function formatMonthLabel(month: string): string {
  return monthShort(month);
}

function buildWindowDetail(
  startIdx: number,
  endIdx: number,
  months: string[],
  revenueByMonth: number[],
  spendByMonth: number[],
): WindowDetail {
  const label = formatWindowLabel(months[startIdx], months[endIdx]);
  const monthDetails: WindowMonthDetail[] = [];
  for (let k = startIdx; k <= endIdx; k += 1) {
    const revenue = revenueByMonth[k];
    const spend = spendByMonth[k];
    const ratio = revenue > 0 ? spend / revenue : 0;
    monthDetails.push({
      monthLabel: formatMonthLabel(months[k]),
      revenue,
      spend,
      ratio,
    });
  }
  return { label, months: monthDetails };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Median of a pre-sorted (ascending) numeric array. 0 for empty input.
function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
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
  return computeCore(model, txns, new Date());
}

// Internal core split out so tests can inject a fixed reference date (mirrors
// digHere.ts). `referenceDate` sets the "last complete month" boundary.
export function computeCore(
  model: DashboardModel,
  txns: Txn[],
  referenceDate: Date,
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
    payrollExtraPerMonth: null,
    payrollTodayPct: null,
    payrollBestPct: null,
    payrollBestWindowLabel: null,
    payrollRollingSeries: [],
    benchmarkRevenueQualified: false,
  };

  const latestMonth = model.latestMonth;
  if (!latestMonth || !parseMonthParts(latestMonth)) return emptyResult;

  // Derive the last complete month from the current date at runtime.
  // A month is complete only if it is strictly before the current calendar month.
  // e.g. on April 21 2026, April is incomplete → last complete month = March 2026.
  const now = referenceDate;
  const currentYearMonth = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // lastCompleteMonth is one month before the current calendar month.
  const lastCompleteMonth = addMonths(currentYearMonth, -1);

  // The window anchor is the lesser of latestMonth and lastCompleteMonth.
  // This ensures we never include a month that is either in the future
  // or is the current (incomplete) calendar month.
  function monthIsEarlierOrEqual(a: string, b: string): boolean {
    return a <= b; // ISO year-month strings sort lexicographically
  }
  const windowAnchor = monthIsEarlierOrEqual(latestMonth, lastCompleteMonth)
    ? latestMonth
    : lastCompleteMonth;

  // Build lookback month list (oldest → newest), size = LOOKBACK_MONTHS ending at windowAnchor.
  // All months in this list are guaranteed to be complete.
  const months: string[] = [];
  for (let i = LOOKBACK_MONTHS - 1; i >= 0; i -= 1) {
    months.push(addMonths(windowAnchor, -i));
  }
  const monthIndex = new Map<string, number>();
  months.forEach((m, i) => monthIndex.set(m, i));

  // Revenue per month + expense per (parent category, month) + presence per
  // (parent category, month). Presence is by transaction existence (not
  // summed-spend nonzero — sign flips / same-month offsets can net to $0 while
  // real tracking exists). After the loop we derive each category's
  // `firstActiveMonth`: the start index of its first SUSTAINED_TRACKING_MIN_MONTHS-
  // consecutive run of presence. That gates the "best window" search below.
  //
  // First-appearance (PR #360) wasn't enough: real Customer Refunds data has
  // stray 2022–early-2025 transactions before sustained mid-2025 tracking, so
  // first-appearance unlocked years of zero-padded pre-sustained windows. The
  // sustained run is the right signal — once a category has ≥3 consecutive
  // months of recorded activity, the data path is credible enough to benchmark.
  const revenueByMonth = new Array<number>(months.length).fill(0);
  const expenseByCatMonth = new Map<string, number[]>();
  const presenceByCatMonth = new Map<string, boolean[]>();

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

      let presence = presenceByCatMonth.get(parent);
      if (!presence) {
        presence = new Array<boolean>(months.length).fill(false);
        presenceByCatMonth.set(parent, presence);
      }
      presence[idx] = true;
    }
  }

  // Derive firstActiveMonth from presence runs. A category that never gets a
  // 3-consecutive-month run gets no entry → its row is dropped below (no fair
  // benchmark exists when sustained tracking can't be demonstrated).
  const firstActiveMonth = new Map<string, number>();
  for (const [category, presence] of presenceByCatMonth.entries()) {
    let runLength = 0;
    for (let i = 0; i < presence.length; i += 1) {
      if (presence[i]) {
        runLength += 1;
        if (runLength >= SUSTAINED_TRACKING_MIN_MONTHS) {
          firstActiveMonth.set(category, i - SUSTAINED_TRACKING_MIN_MONTHS + 1);
          break;
        }
      } else {
        runLength = 0;
      }
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

  // ── Revenue-qualify the candidate windows ────────────────────────────────
  // A 3-month window is only a fair "best" benchmark if its revenue scale is
  // comparable to today's. Qualify each window by avg monthly revenue against a
  // dual floor:
  //   Floor 1 = 0.7 × current 6-month avg revenue  (excludes low-revenue eras
  //             whose ratios look good only because revenue was small)
  //   Floor 2 = 0.7 × trailing 24-month median     (anchors to the long-run
  //             normal so a cratered current period can't qualify weak history)
  // Both inputs count only months with revenue > 0 (matches window validity).
  const last6Revenue = revenueByMonth.slice(-6).filter((v) => v > 0);
  const current6moAvgRevenue = last6Revenue.length
    ? last6Revenue.reduce((a, b) => a + b, 0) / last6Revenue.length
    : 0;
  const median24moRevenue = median(
    revenueByMonth.filter((v) => v > 0).sort((a, b) => a - b),
  );
  const revenueFloor = Math.max(
    REVENUE_FLOOR_RATIO * current6moAvgRevenue,
    REVENUE_FLOOR_RATIO * median24moRevenue,
  );

  // ≥2 windows must clear the floor for a credible qualified benchmark.
  // Otherwise every category falls back to the unfiltered best so the card
  // never silently empties. The flag is globally uniform for the run.
  const qualifyingWindows = validWindows.filter((w) => w.avgRevenue >= revenueFloor);
  const benchmarkRevenueQualified = qualifyingWindows.length >= MIN_WINDOWS;
  const candidateWindows = benchmarkRevenueQualified ? qualifyingWindows : validWindows;

  // Current window = last valid window that ends at windowAnchor (the last complete month)
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

    // Need ≥2 valid windows at all for any credible benchmark.
    if (validWindows.length < MIN_WINDOWS) continue;

    const todayRatio = currentAvgSpend / currentWindow.avgRevenue;

    // Skip "best window" candidates whose start predates this category's first
    // sustained-tracking run. Categories without any sustained run (no entry
    // in firstActiveMonth) get no benchmark row at all — there's no credible
    // "best" when the data path can't be demonstrated to be reliable.
    const categoryFirstActive = firstActiveMonth.get(category);
    if (categoryFirstActive === undefined) continue;

    // Best = lowest cost ratio among the revenue-qualified candidate windows
    // (or all valid windows when the floor disqualified too many — see fallback).
    let bestRatio = Number.POSITIVE_INFINITY;
    let bestWindow: Window | null = null;
    for (const w of candidateWindows) {
      if (w.startIdx < categoryFirstActive) continue;
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
      bestWindow: buildWindowDetail(
        bestWindow.startIdx,
        bestWindow.endIdx,
        months,
        revenueByMonth,
        spendByMonth,
      ),
      todayWindow: buildWindowDetail(
        currentWindow.startIdx,
        currentWindow.endIdx,
        months,
        revenueByMonth,
        spendByMonth,
      ),
    });
  }

  rowsAll.sort((a, b) => b.extraPerMonth - a.extraPerMonth);

  const totalExtraPerMonth = rowsAll.reduce((acc, r) => acc + r.extraPerMonth, 0);
  const rows = rowsAll.slice(0, MAX_ROWS);

  // Payroll-specific excess from the FULL set — survives the top-N truncation above.
  const payrollRow = rowsAll.find((r) => r.category === 'Payroll');

  // Payroll 3-month basis for the Payroll Efficiency card hero. Recomputed here
  // (not read from payrollRow) so the hero renders even when payroll has no
  // positive excess — in that case payrollRow is undefined but the card still
  // needs today's % and the best-stretch %. Uses the same currentWindow /
  // candidateWindows as the row math, so the values coincide whenever a Payroll
  // row exists.
  let payrollTodayPct: number | null = null;
  let payrollBestPct: number | null = null;
  let payrollBestWindowLabel: string | null = null;
  let payrollBestStartIdx: number | null = null;
  const payrollSpendByMonth = expenseByCatMonth.get('Payroll');
  if (payrollSpendByMonth && currentWindow.avgRevenue > 0) {
    let sumCurrent = 0;
    for (let k = currentWindow.startIdx; k <= currentWindow.endIdx; k += 1) {
      sumCurrent += payrollSpendByMonth[k];
    }
    payrollTodayPct = Math.round(((sumCurrent / WINDOW_SIZE_MONTHS) / currentWindow.avgRevenue) * 100);

    // Apply the same sustained-tracking gate the per-row loop uses (#362), so
    // the hero's best stretch can't pick a pre-sustained zero-padded window
    // that the gated Payroll row would reject — keeps payrollBestPct /
    // payrollBestWindowLabel aligned with the Money Left Payroll row. If
    // Payroll has no sustained run (very unlikely in practice but possible
    // with sparse imports), the best fields stay null; payrollTodayPct above
    // is still populated so the hero can show "today" without a misleading
    // benchmark.
    const payrollFirstActive = firstActiveMonth.get('Payroll');
    if (payrollFirstActive !== undefined) {
      let bestRatio = Number.POSITIVE_INFINITY;
      let bestWin: Window | null = null;
      for (const w of candidateWindows) {
        if (w.startIdx < payrollFirstActive) continue;
        let sumSpend = 0;
        for (let k = w.startIdx; k <= w.endIdx; k += 1) {
          sumSpend += payrollSpendByMonth[k];
        }
        const ratio = sumSpend / WINDOW_SIZE_MONTHS / w.avgRevenue;
        if (ratio < bestRatio) {
          bestRatio = ratio;
          bestWin = w;
        }
      }
      if (bestWin && Number.isFinite(bestRatio)) {
        payrollBestPct = Math.round(bestRatio * 100);
        payrollBestWindowLabel = formatWindowLabel(months[bestWin.startIdx], months[bestWin.endIdx]);
        payrollBestStartIdx = bestWin.startIdx;
      }
    }
  }

  // Chart series for the Payroll Efficiency card — one entry per VALID 3-month
  // window in the lookback (revenue > 0 in all 3 months, so up to 22 entries
  // for a 24-month lookback). Each entry carries the same eligibility flags
  // the hero/best logic applies, so the chart can hide or de-emphasize windows
  // the "best stretch" math wouldn't pick.
  //
  // - isCurrent: window ends at windowAnchor (the "today" window).
  // - isBest: window === the selected payroll-best window (null if no best).
  // - isBenchmarkEligible: window is in candidateWindows (passed the revenue
  //   floor when applicable) AND starts at/after Payroll's firstActiveMonth.
  //   The renderer hides ineligible points so they can't be misread as
  //   candidates for "best stretch".
  const candidateStartIdxSet = new Set(candidateWindows.map((w) => w.startIdx));
  const payrollFirstActiveForSeries = firstActiveMonth.get('Payroll');
  const payrollRollingSeries: PayrollRollingPoint[] = [];
  if (payrollSpendByMonth) {
    for (const w of validWindows) {
      let revSum = 0;
      let payrollSum = 0;
      for (let k = w.startIdx; k <= w.endIdx; k += 1) {
        revSum += revenueByMonth[k];
        payrollSum += payrollSpendByMonth[k];
      }
      const pct = revSum > 0 ? Math.round((payrollSum / revSum) * 100) : 0;
      const isInCandidates = candidateStartIdxSet.has(w.startIdx);
      const isAfterFirstActive =
        payrollFirstActiveForSeries !== undefined && w.startIdx >= payrollFirstActiveForSeries;
      payrollRollingSeries.push({
        label: formatWindowLabel(months[w.startIdx], months[w.endIdx]),
        payrollPct: pct,
        revenue: revSum,
        payroll: payrollSum,
        revenuePerPayrollDollar: payrollSum > 0 ? revSum / payrollSum : 0,
        isCurrent: w.endIdx === latestIdx,
        isBest: payrollBestStartIdx !== null && w.startIdx === payrollBestStartIdx,
        isBenchmarkEligible: isInCandidates && isAfterFirstActive,
      });
    }
  }

  return {
    windowLabel,
    rows,
    totalExtraPerMonth,
    payrollExtraPerMonth: payrollRow ? payrollRow.extraPerMonth : null,
    payrollTodayPct,
    payrollBestPct,
    payrollBestWindowLabel,
    payrollRollingSeries,
    benchmarkRevenueQualified,
  };
}
