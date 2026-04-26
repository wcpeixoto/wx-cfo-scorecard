/**
 * cashTrend.ts — Cash Trend macro signal compute engine
 *
 * Produces the "Cash Trend" hero card at the top of the Big Picture signal
 * hierarchy. Evaluates 6-month operating cash health using three inputs
 * together (margin, pattern, target gap) and applies stateless hysteresis to
 * prevent month-to-month status whiplash near threshold boundaries.
 *
 * Inputs: monthlyRollups (already classified as operating cash — transfers,
 * loans, owner distributions excluded by computeMonthlyRollups in 'operating'
 * mode). The current calendar month (incomplete) is excluded inside this
 * function based on referenceDate.
 *
 * Hysteresis is computed statelessly from two adjacent T6M windows; no
 * persistence layer required.
 */

import type { MonthlyRollup } from '../data/contract';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashTrendStatus = 'building' | 'treading' | 'pressure' | 'burning';
export type VelocityTag = 'improving' | 'softer' | 'stable';

export interface CashTrendBar {
  month: string;       // 'YYYY-MM'
  label: string;       // 'Jan 2026'
  netCash: number;
  isNegative: boolean;
}

export interface CashTrendResult {
  noData: boolean;
  status: CashTrendStatus;
  priorStatus: CashTrendStatus;
  velocityTag: VelocityTag;
  t6mNetCash: number;
  t6mRevenue: number;
  t6mMargin: number;          // decimal, e.g. 0.113
  priorT6mMargin: number;     // decimal — prior window margin (for diagnostics)
  negativeMonthCount: number;
  targetNetCash: number;
  gap: number;
  monthlyBars: CashTrendBar[]; // 6 entries, oldest → newest (or fewer if short history)
  windowLabel: string;         // 'Nov 2025 – Apr 2026'
}

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

const WINDOW_MONTHS = 6;
const MIN_WINDOW_MONTHS = 3; // require at least 3 complete months to render

// TODO: surface in workspace settings
const TARGET_MARGIN = 0.10;

// Status thresholds
const BUILDING_MARGIN = 0.10;
const BUILDING_MAX_NEG = 2;
const BURNING_MARGIN = -0.015;
const BURNING_MIN_NEG = 3;
const PRESSURE_UPPER_MARGIN = 0.05;
const PRESSURE_MIN_NEG = 3;

// Hysteresis hold thresholds (1.5pp buffer past entry threshold)
const BUILDING_HOLD_MARGIN = 0.085;
const BURNING_HOLD_MARGIN = 0.0;
const PRESSURE_RELEASE_MARGIN = 0.065;

// Velocity bands
const VELOCITY_BAND = 0.02;

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function dateToMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatMonthLabel(key: string): string {
  const [yearStr, monthStr] = key.split('-');
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return key;
  return `${SHORT_MONTHS[monthIdx]} ${yearStr}`;
}

// ---------------------------------------------------------------------------
// Status rules
// ---------------------------------------------------------------------------

function rawStatus(margin: number, negMonths: number): CashTrendStatus {
  if (margin >= BUILDING_MARGIN && negMonths <= BUILDING_MAX_NEG) return 'building';
  if (margin <= BURNING_MARGIN && negMonths >= BURNING_MIN_NEG) return 'burning';
  if (
    margin > BURNING_MARGIN &&
    margin < PRESSURE_UPPER_MARGIN &&
    negMonths >= PRESSURE_MIN_NEG
  ) {
    return 'pressure';
  }
  return 'treading';
}

function applyHysteresis(
  raw: CashTrendStatus,
  prior: CashTrendStatus,
  currentMargin: number,
  currentNegMonths: number
): CashTrendStatus {
  switch (prior) {
    case 'building':
      // Hold Building until margin drops below +8.5%
      if (currentMargin >= BUILDING_HOLD_MARGIN) return 'building';
      return raw;
    case 'burning':
      // Hold Burning until margin rises above 0%
      if (currentMargin <= BURNING_HOLD_MARGIN) return 'burning';
      return raw;
    case 'pressure':
      // Mirror Building/Burning pattern: check raw rule, then hold or release
      // based on the 6.5% buffer.
      if (raw === 'burning') return 'burning';
      if (raw === 'building' && currentMargin >= PRESSURE_RELEASE_MARGIN) return 'building';
      if (raw === 'treading' && currentMargin >= PRESSURE_RELEASE_MARGIN) return 'treading';
      return 'pressure';
    case 'treading':
      // Treading transitions normally with no stickiness
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Window math
// ---------------------------------------------------------------------------

interface WindowMetrics {
  netCash: number;
  revenue: number;
  margin: number;
  negativeMonthCount: number;
}

function computeWindowMetrics(window: MonthlyRollup[]): WindowMetrics {
  let netCash = 0;
  let revenue = 0;
  let negativeMonthCount = 0;
  for (const r of window) {
    netCash += r.netCashFlow;
    revenue += r.revenue;
    if (r.netCashFlow < 0) negativeMonthCount += 1;
  }
  const margin = revenue > 0 ? netCash / revenue : 0;
  return { netCash, revenue, margin, negativeMonthCount };
}

// ---------------------------------------------------------------------------
// Empty result
// ---------------------------------------------------------------------------

const EMPTY: CashTrendResult = {
  noData: true,
  status: 'treading',
  priorStatus: 'treading',
  velocityTag: 'stable',
  t6mNetCash: 0,
  t6mRevenue: 0,
  t6mMargin: 0,
  priorT6mMargin: 0,
  negativeMonthCount: 0,
  targetNetCash: 0,
  gap: 0,
  monthlyBars: [],
  windowLabel: '',
};

// ---------------------------------------------------------------------------
// Internal core — accepts referenceDate so the function is testable
// ---------------------------------------------------------------------------

function computeCore(
  rollups: MonthlyRollup[],
  referenceDate: Date
): CashTrendResult {
  if (rollups.length === 0) return EMPTY;

  // Exclude the current calendar month (incomplete) from the analysis.
  const currentCalendarMonthKey = dateToMonthKey(referenceDate);

  const completeRollups = rollups
    .filter((r) => r.month && r.month < currentCalendarMonthKey)
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month));

  if (completeRollups.length < MIN_WINDOW_MONTHS) return EMPTY;

  // Current window — last 6 (or fewer) complete months, oldest first
  const currentWindow = completeRollups.slice(-WINDOW_MONTHS);
  // Prior window — ends one month before current. Same length as current
  // window where possible, but the last index is exclusive.
  const priorWindow = completeRollups.slice(
    Math.max(0, completeRollups.length - WINDOW_MONTHS - 1),
    completeRollups.length - 1
  );

  const current = computeWindowMetrics(currentWindow);

  let priorMargin = 0;
  let priorStatus: CashTrendStatus;
  let velocityTag: VelocityTag;
  let status: CashTrendStatus;

  const rawCurrent = rawStatus(current.margin, current.negativeMonthCount);

  if (priorWindow.length >= MIN_WINDOW_MONTHS) {
    const prior = computeWindowMetrics(priorWindow);
    priorMargin = prior.margin;
    priorStatus = rawStatus(prior.margin, prior.negativeMonthCount);
    status = applyHysteresis(rawCurrent, priorStatus, current.margin, current.negativeMonthCount);

    const marginDiff = current.margin - prior.margin;
    if (marginDiff >= VELOCITY_BAND) velocityTag = 'improving';
    else if (marginDiff <= -VELOCITY_BAND) velocityTag = 'softer';
    else velocityTag = 'stable';
  } else {
    // Edge case: no prior window — skip hysteresis, velocity = stable
    priorStatus = rawCurrent;
    status = rawCurrent;
    velocityTag = 'stable';
  }

  const targetNetCash = current.revenue * TARGET_MARGIN;
  const gap = current.netCash - targetNetCash;

  const monthlyBars: CashTrendBar[] = currentWindow.map((r) => ({
    month: r.month,
    label: formatMonthLabel(r.month),
    netCash: r.netCashFlow,
    isNegative: r.netCashFlow < 0,
  }));

  const windowLabel =
    currentWindow.length > 0
      ? `${formatMonthLabel(currentWindow[0].month)} – ${formatMonthLabel(currentWindow[currentWindow.length - 1].month)}`
      : '';

  return {
    noData: false,
    status,
    priorStatus,
    velocityTag,
    t6mNetCash: current.netCash,
    t6mRevenue: current.revenue,
    t6mMargin: current.margin,
    priorT6mMargin: priorMargin,
    negativeMonthCount: current.negativeMonthCount,
    targetNetCash,
    gap,
    monthlyBars,
    windowLabel,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeCashTrend(rollups: MonthlyRollup[]): CashTrendResult {
  return computeCore(rollups, new Date());
}

/** Diagnostic entry point — backtest against any reference date. */
export function computeCashTrendForDate(
  rollups: MonthlyRollup[],
  referenceDate: Date
): CashTrendResult {
  return computeCore(rollups, referenceDate);
}
