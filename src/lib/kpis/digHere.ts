/**
 * digHere.ts — What Needs Attention compute engine
 *
 * Produces the 3-row "What Needs Attention" card on the Big Picture page.
 *
 * Method:
 *   - Current month is derived from runtime date (new Date()) — the current
 *     calendar month is always excluded as incomplete. Current-month-of-analysis
 *     is the most recent month in filteredTxns that is earlier than runtime.
 *   - Baseline is the 6 complete months immediately preceding the current month.
 *   - Categories are classified via categoryRegistry.ts — fixed vs variable.
 *   - Fixed: compare current spend to 6-month average spend (dollar delta).
 *   - Variable: compare current spend to (baseline ratio × current revenue).
 *   - Double gate: overspend-only + absolute threshold + relative-move threshold.
 *   - Timing-artifact guard (fixed only): suppresses rows where the overspend
 *     is offset by a compensating underspend in an adjacent available month.
 *
 * Respects cashFlow.ts pre-filters (shouldExcludeFromProfitability) and
 * registry exclusions (income/capital/suppressed buckets).
 */

import type { Txn } from '../data/contract';
import {
  parentCategoryName,
  shouldExcludeFromProfitability,
  revenueContribution,
  isBusinessIncomeCategory,
  isRefundCategory,
} from '../cashFlow';
import {
  getCategoryMeta,
  type CategoryBucket,
} from '../data/categoryRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WhatNeedsAttentionBucket = Extract<CategoryBucket, 'fixed' | 'variable'>;

export interface WhatNeedsAttentionRow {
  categoryName: string;
  bucket: WhatNeedsAttentionBucket;
  // Dollar amounts
  currentSpend: number;
  expectedSpend: number;
  delta: number;                // currentSpend - expectedSpend
  // For variable categories
  currentRatio: number;         // currentSpend / currentRevenue
  baselineRatio: number;        // avg ratio over baseline months
  // For fixed categories
  currentAvgSpend: number;      // current month spend
  baselineAvgSpend: number;     // avg spend over baseline months
  // Revenue context
  currentRevenue: number;
  // Sparkline — 6 months, oldest to newest, ending with current
  sparklineData: number[];
}

export interface WhatNeedsAttentionResult {
  currentMonth: string;         // "Mar 2026"
  baselineMonths: string;       // "Sep 2025 – Feb 2026"
  noData: boolean;              // true if < 3 complete baseline months
  rows: WhatNeedsAttentionRow[];
}

// ---------------------------------------------------------------------------
// Tunable thresholds (locked for V1)
// ---------------------------------------------------------------------------

const BASELINE_MONTHS = 6;
const MIN_BASELINE_MONTHS = 3;
const MIN_CATEGORY_MONTHS = 2;            // fixed: ≥2 of 6 months with spend
const MIN_VARIABLE_VALID_MONTHS = 2;      // variable: ≥2 valid ratio months
const FIXED_DOLLAR_GATE = 150;            // absolute overspend floor for fixed
const VARIABLE_RATIO_GATE = 0.02;         // 2pp gate for variable
const RELATIVE_GATE = 0.20;               // 20% relative overspend for both
const TIMING_ARTIFACT_THRESHOLD = 0.70;   // compensation ratio for suppression

// ---------------------------------------------------------------------------
// Month helpers (YYYY-MM strings — matches Txn.month format)
// ---------------------------------------------------------------------------

const EMPTY: WhatNeedsAttentionResult = {
  currentMonth: '',
  baselineMonths: '',
  noData: true,
  rows: [],
};

function dateToMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function prevMonthKey(key: string): string {
  const [yearStr, monthStr] = key.split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

function nextMonthKey(key: string): string {
  const [yearStr, monthStr] = key.split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  if (month === 12) return `${year + 1}-01`;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatMonthLabel(key: string): string {
  const [yearStr, monthStr] = key.split('-');
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return key;
  return `${SHORT_MONTHS[monthIdx]} ${yearStr}`;
}

// ---------------------------------------------------------------------------
// Revenue per month (operating revenue, same rules as the rest of the app)
// ---------------------------------------------------------------------------

function monthlyRevenueMap(txns: Txn[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const txn of txns) {
    const contribution = revenueContribution(txn);
    if (contribution === 0) continue;
    map.set(txn.month, (map.get(txn.month) ?? 0) + contribution);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Expense contribution for Dig Here
//
// We need a clean positive-dollar expense figure per (month, parent category),
// respecting the same exclusions as shouldExcludeFromProfitability but
// without the cash-flow-mode toggle. Refunds & Allowances should count as
// expense spend here (it's a variable-bucket category in the registry).
// ---------------------------------------------------------------------------

function digHereExpenseAmount(txn: Txn): number {
  // Revenue-side transactions don't contribute expenses, except refunds
  // (negative rawAmount within Business Income) which are handled as refund
  // category elsewhere. We rely on the registry + parentCategoryName routing.
  if (isBusinessIncomeCategory(txn.category) && !isRefundCategory(txn.category)) {
    return 0;
  }
  if (txn.rawAmount < 0) return txn.amount;
  if (txn.rawAmount > 0) return -txn.amount; // expense credit reduces spend
  return 0;
}

// ---------------------------------------------------------------------------
// Internal core — accepts referenceDate so the function is testable
// ---------------------------------------------------------------------------

function computeCore(
  filteredTxns: Txn[],
  referenceDate: Date
): WhatNeedsAttentionResult {
  if (filteredTxns.length === 0) return EMPTY;

  // ── Step 1 — Determine the current analysis month ──────────────────────
  //
  // runtimeKey: the referenceDate month — sets the analysis window boundary.
  // currentCalendarMonthKey: the real-world incomplete month (new Date()).
  //   Used only for the timing-artifact guard to exclude genuinely
  //   incomplete data regardless of referenceDate.
  //
  // monthsWithData: months strictly before runtimeKey — the analysis window.
  // availableMonthKeys: all months in the dataset except the current
  //   calendar month — used by the timing-artifact guard to decide whether
  //   adjacent months have data worth checking.
  const runtimeKey = dateToMonthKey(referenceDate);
  const currentCalendarMonthKey = dateToMonthKey(new Date());

  const monthsWithData = new Set<string>();
  const availableMonthKeys = new Set<string>();
  for (const txn of filteredTxns) {
    if (!txn.month) continue;
    // availableMonthKeys: everything except the live incomplete month
    if (txn.month !== currentCalendarMonthKey) {
      availableMonthKeys.add(txn.month);
    }
    // monthsWithData: strictly before the reference date (analysis window)
    if (txn.month < runtimeKey) {
      monthsWithData.add(txn.month);
    }
  }
  if (monthsWithData.size === 0) return EMPTY;

  const sortedMonths = [...monthsWithData].sort();
  const currentMonthKey = sortedMonths[sortedMonths.length - 1];

  // Baseline: 6 months preceding currentMonthKey
  const baselineKeys: string[] = [];
  let cursor = currentMonthKey;
  for (let i = 0; i < BASELINE_MONTHS; i += 1) {
    cursor = prevMonthKey(cursor);
    baselineKeys.push(cursor);
  }
  baselineKeys.reverse(); // oldest → newest

  // Sparkline window: 5 prior baseline months + current month, oldest first
  const sparklineKeys = [...baselineKeys.slice(-(BASELINE_MONTHS - 1)), currentMonthKey];

  // Count how many baseline months actually have data (any classified txn)
  // Use monthsWithData presence as proxy for "month is complete".
  const completeBaselineMonths = baselineKeys.filter((m) => monthsWithData.has(m));
  if (completeBaselineMonths.length < MIN_BASELINE_MONTHS) {
    return {
      currentMonth: formatMonthLabel(currentMonthKey),
      baselineMonths: '',
      noData: true,
      rows: [],
    };
  }

  // ── Step 2 — Build monthly revenue and per-category spend maps ─────────
  const revenueByMonth = monthlyRevenueMap(filteredTxns);

  // categoryName → monthKey → spend
  const spendByCategoryMonth = new Map<string, Map<string, number>>();
  const bucketByCategory = new Map<string, WhatNeedsAttentionBucket>();
  const unclassifiedFallback = new Set<string>();

  // Months relevant to our analysis: baseline + current + adjacent months for
  // the timing-artifact guard. Adjacent months are included so their spend is
  // accumulated and available to the guard — without this, monthMap.get() for
  // an adjacent month returns undefined (→ 0) even when real data exists.
  const relevantMonths = new Set<string>([
    ...baselineKeys,
    currentMonthKey,
    prevMonthKey(currentMonthKey),  // timing-artifact prior check
    nextMonthKey(currentMonthKey),  // timing-artifact next check
  ]);

  for (const txn of filteredTxns) {
    if (!relevantMonths.has(txn.month)) continue;
    if (shouldExcludeFromProfitability(txn)) continue;

    const parent = parentCategoryName(txn.category);
    if (!parent) continue;

    // Classify via registry (silent lookup)
    const meta = getCategoryMeta(parent);
    let bucket: WhatNeedsAttentionBucket;
    if (!meta) {
      unclassifiedFallback.add(parent);
      bucket = 'fixed'; // scoped fallback for Dig Here only
    } else if (meta.bucket === 'fixed' || meta.bucket === 'variable') {
      bucket = meta.bucket;
    } else {
      // income / capital / suppressed → excluded from operating
      continue;
    }

    const amount = digHereExpenseAmount(txn);
    if (amount === 0) continue;

    bucketByCategory.set(parent, bucket);
    let monthMap = spendByCategoryMonth.get(parent);
    if (!monthMap) {
      monthMap = new Map<string, number>();
      spendByCategoryMonth.set(parent, monthMap);
    }
    monthMap.set(txn.month, (monthMap.get(txn.month) ?? 0) + amount);
  }

  // Warn once per unique unclassified category
  if (unclassifiedFallback.size > 0) {
    const list = [...unclassifiedFallback].sort().join(', ');
    console.warn(
      `[digHere] Unclassified categories treated as 'fixed' for this analysis: ${list}. ` +
      `Add them to categoryRegistry.ts to pick a bucket.`
    );
  }

  // ── Step 3 — Compute baseline + current per category, apply gates ──────
  const currentRevenue = revenueByMonth.get(currentMonthKey) ?? 0;
  const rows: WhatNeedsAttentionRow[] = [];

  for (const [categoryName, monthMap] of spendByCategoryMonth.entries()) {
    const bucket = bucketByCategory.get(categoryName);
    if (!bucket) continue;

    const currentSpend = Math.max(0, monthMap.get(currentMonthKey) ?? 0);
    // Negative net spend (refund-heavy month) should not flag as overspend.
    if (currentSpend <= 0) continue;

    // Baseline spend array — zeros included for months with no spend
    const baselineSpend = baselineKeys.map((m) => Math.max(0, monthMap.get(m) ?? 0));
    const monthsWithSpend = baselineSpend.filter((v) => v > 0).length;
    if (monthsWithSpend < MIN_CATEGORY_MONTHS) continue;

    let expectedSpend: number;
    let baselineAvgSpend: number;
    let baselineRatio: number;
    let currentRatio: number;
    let sparklineData: number[];

    if (bucket === 'fixed') {
      baselineAvgSpend =
        baselineSpend.reduce((sum, v) => sum + v, 0) / BASELINE_MONTHS;
      expectedSpend = baselineAvgSpend;
      baselineRatio = 0;
      currentRatio = 0;

      // Sparkline: spend per month
      sparklineData = sparklineKeys.map((m) =>
        Math.max(0, monthMap.get(m) ?? 0)
      );
    } else {
      // variable — ratios per baseline month where revenue > 0
      const validRatios: number[] = [];
      baselineKeys.forEach((m, idx) => {
        const rev = revenueByMonth.get(m) ?? 0;
        if (rev <= 0) return;
        const spend = baselineSpend[idx];
        validRatios.push(spend / rev);
      });
      if (validRatios.length < MIN_VARIABLE_VALID_MONTHS) continue;

      baselineRatio =
        validRatios.reduce((sum, v) => sum + v, 0) / validRatios.length;
      baselineAvgSpend =
        baselineSpend.reduce((sum, v) => sum + v, 0) / BASELINE_MONTHS;
      expectedSpend = baselineRatio * currentRevenue;
      currentRatio = currentRevenue > 0 ? currentSpend / currentRevenue : 0;

      // Sparkline: ratio per month (0 where revenue or spend is 0)
      sparklineData = sparklineKeys.map((m) => {
        const rev = revenueByMonth.get(m) ?? 0;
        const sp = Math.max(0, monthMap.get(m) ?? 0);
        if (rev <= 0 || sp <= 0) return 0;
        return sp / rev;
      });
    }

    const delta = currentSpend - expectedSpend;

    // ── Step 4 — Double gate ─────────────────────────────────────────────
    if (delta <= 0) continue; // overspend only

    const gate1Pass = bucket === 'fixed'
      ? delta > FIXED_DOLLAR_GATE
      : currentRatio - baselineRatio > VARIABLE_RATIO_GATE;
    if (!gate1Pass) continue;

    if (expectedSpend <= 0 || delta / expectedSpend <= RELATIVE_GATE) continue;

    // ── Step 5 — Timing-artifact guard (fixed bucket only) ───────────────
    //
    // Suppresses a flagged row when a compensating underspend exists in an
    // adjacent available month. "Available" means the month exists in the
    // dataset and is not the current incomplete calendar month — this is
    // independent of the referenceDate analysis window, so months after the
    // reference month are visible when the dataset contains them.
    //
    // Missing months (null) are not treated as $0. A category with $0 spend
    // in an available adjacent month does count as compensating.
    // One-hop only — no cascading or multi-month spreading.
    if (bucket === 'fixed') {
      const priorKey = prevMonthKey(currentMonthKey);
      const nextKey = nextMonthKey(currentMonthKey);

      const priorSpend: number | null = availableMonthKeys.has(priorKey)
        ? Math.max(0, monthMap.get(priorKey) ?? 0)
        : null;
      const nextSpend: number | null = availableMonthKeys.has(nextKey)
        ? Math.max(0, monthMap.get(nextKey) ?? 0)
        : null;

      const priorDelta: number | null =
        priorSpend === null ? null : priorSpend - baselineAvgSpend;
      const nextDelta: number | null =
        nextSpend === null ? null : nextSpend - baselineAvgSpend;

      const adjacentNegativeDeltas = [priorDelta, nextDelta].filter(
        (d): d is number => d !== null && d < 0
      );

      if (adjacentNegativeDeltas.length > 0) {
        const largestNegativeMagnitude = Math.max(
          ...adjacentNegativeDeltas.map((d) => Math.abs(d))
        );
        if (largestNegativeMagnitude >= TIMING_ARTIFACT_THRESHOLD * delta) {
          continue; // suppress as timing artifact
        }
      }
    }

    rows.push({
      categoryName,
      bucket,
      currentSpend,
      expectedSpend,
      delta,
      currentRatio,
      baselineRatio,
      currentAvgSpend: currentSpend,
      baselineAvgSpend,
      currentRevenue,
      sparklineData,
    });
  }

  // ── Step 6 — Sort by delta descending ──────────────────────────────────
  rows.sort((a, b) => b.delta - a.delta);

  const baselineLabel =
    baselineKeys.length === 0
      ? ''
      : `${formatMonthLabel(baselineKeys[0])} – ${formatMonthLabel(baselineKeys[baselineKeys.length - 1])}`;

  return {
    currentMonth: formatMonthLabel(currentMonthKey),
    baselineMonths: baselineLabel,
    noData: false,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeWhatNeedsAttention(
  filteredTxns: Txn[]
): WhatNeedsAttentionResult {
  return computeCore(filteredTxns, new Date());
}
