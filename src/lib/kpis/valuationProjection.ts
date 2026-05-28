// Business Valuation — projection selectors.
//
// Sister module to businessValuation.ts. Takes the 12-month forecast (from
// Dashboard scenarioProjection) plus a slider-neutral baseline projection
// and produces two projection legs:
//   actual : slider-driven projection — moves with revenue/expense sliders
//   goal   : slider-neutral projection at the fixed target net margin —
//            the "stable prize" hero that must NOT move with sliders
//
// Both legs apply a margin-quality adjustment to the derived multiple, then
// clamp the result inside the existing driver-based display band. The
// adjustment is a single mechanism (NOT a stacked bonus): margin >= 25%
// earns the top of the band, 10-24.9% sits at derived, < 10% takes a hit.
//
// Owner Independence and the other 6 driver rows remain the bigger lever —
// this adjustment moves the point inside the band, not the band edges.
//
// Negative valuation floor: a negative projected SDE produces a non-sensical
// negative sale price. The displayed valuation is floored at 0. The actual
// leg's isFloored flag signals "not buyer-ready" copy at the call site.
// The underlying SDE/margin math is NOT clamped — tests assert on the raw
// arithmetic.
//
// Same accounting layer reconciliation: ScenarioPoint.netCashFlow and
// MonthlyRollup.netCashFlow (operating mode) both exclude owner distributions
// and include W2/personal-expenses, so add-backs apply identically to TTM
// SDE and projected SDE (see cashFlow.ts forecastCashOutContribution and
// compute.ts computeMonthlyRollups).

import type { Range } from './businessValuation';

export const PROJECTION_WINDOW_MONTHS = 12;
export const MARGIN_QUALITY_LOW_THRESHOLD = 0.10;
export const MARGIN_QUALITY_HIGH_THRESHOLD = 0.25;
export const MARGIN_QUALITY_PENALTY = -0.10;
export const MARGIN_QUALITY_BONUS = 0.15;

export interface ProjectionAddBacks {
  ownerW2Compensation: number | null;
  personalExpensesThroughBusiness: number | null;
  oneTimeExpensesToAddBack: number | null;
  oneTimeGainsToSubtract: number | null;
}

export interface ProjectionPoint {
  cashIn: number;
  netCashFlow: number;
}

export interface ValuationProjectionLeg {
  annualNet: number;
  annualRevenue: number;
  margin: number;
  sde: number;
  marginQualityAdjustment: number;
  adjustedMultiple: number;
  // Floored at 0. When sde <= 0, isFloored = true; the actual hero shows
  // honest-floor copy instead of the dollar amount.
  displayedValuation: number;
  isFloored: boolean;
  // sde × displayMultipleRange — the band the hero sits INSIDE (adjusted
  // multiple is clamped within displayMultipleRange). Same band edges in ×
  // terms as the driver-based display range; dollar endpoints scale with
  // projected SDE.
  displayedRange: Range;
}

export interface ValuationProjectionResult {
  actual: ValuationProjectionLeg | null;
  goal: ValuationProjectionLeg | null;
}

export interface ValuationProjectionInputs {
  // Slider-driven projection. First 12 entries used.
  forecastPoints: ProjectionPoint[] | null;
  // Slider-neutral baseline (Dashboard `baselineProjection ?? scenarioProjection`).
  // First 12 entries used. When null, goal leg returns null.
  baselineForecastPoints: ProjectionPoint[] | null;
  addBacks: ProjectionAddBacks;
  // From BusinessValuationResult.derivedMultiple / displayMultipleRange.
  // Same range as the on-screen "Range: lower – upper" subtitle band in
  // multiple-× terms.
  derivedMultiple: number;
  displayMultipleRange: Range;
  // From CashFlowForecastModule's effectiveTargetNetMargin (settings target
  // when > 0, else default 25%). null skips the goal leg.
  effectiveTargetNetMargin: number | null;
}

// Neutral vs. active scenario test for the dominant valuation hero.
// Active = the operator has dialed in a revenue or expense delta and the
// hero should reflect that what-if scenario; neutral = show today's
// current TTM-based valuation.
//
// Decision: gate ONLY on revenueGrowthPct / expenseChangePct. The active
// scenarioInput shape also carries receivableDays / payableDays — those
// are working-capital timing controls and DO shift cashIn buckets at the
// 12-month window edge, but the shifts are small second-order effects.
// Including them here would make the headline valuation flip to "scenario"
// when the operator only tuned AR timing, which doesn't match the
// owner-facing intent of the two-hero model (current vs. what-if revenue/
// expense scenario).
//
// scenarioKey ('base' | 'best' | 'worst' | 'custom') is also intentionally
// NOT consulted: a Best/Worst preset that carries nonzero deltas is active,
// and a 'custom' scenario reset to 0/0 is neutral. The deltas are the
// source of truth.
export function isValuationScenarioActive(input: {
  revenueGrowthPct: number;
  expenseChangePct: number;
}): boolean {
  return input.revenueGrowthPct !== 0 || input.expenseChangePct !== 0;
}

export function marginQualityAdjustment(margin: number): number {
  if (margin >= MARGIN_QUALITY_HIGH_THRESHOLD) return MARGIN_QUALITY_BONUS;
  if (margin >= MARGIN_QUALITY_LOW_THRESHOLD) return 0;
  return MARGIN_QUALITY_PENALTY;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function blankAsZero(value: number | null): number {
  return value ?? 0;
}

// Reconciled projected SDE. annualNet is at the same accounting layer as
// ttmOperatingProfit (operating cash before owner distributions, with W2 /
// personal still as outflows), so the add-backs reverse owner-specific
// expenses exactly the same way computeSde does.
export function buildProjectedSde(
  annualNet: number,
  addBacks: ProjectionAddBacks
): number {
  return (
    annualNet
    + blankAsZero(addBacks.ownerW2Compensation)
    + blankAsZero(addBacks.personalExpensesThroughBusiness)
    + blankAsZero(addBacks.oneTimeExpensesToAddBack)
    - blankAsZero(addBacks.oneTimeGainsToSubtract)
  );
}

function buildLeg(
  annualNet: number,
  annualRevenue: number,
  margin: number,
  addBacks: ProjectionAddBacks,
  derivedMultiple: number,
  displayMultipleRange: Range
): ValuationProjectionLeg {
  const sde = buildProjectedSde(annualNet, addBacks);
  const adjustment = marginQualityAdjustment(margin);
  const adjustedMultiple = clamp(
    derivedMultiple + adjustment,
    displayMultipleRange.lower,
    displayMultipleRange.upper
  );
  const rawValuation = sde * adjustedMultiple;
  return {
    annualNet,
    annualRevenue,
    margin,
    sde,
    marginQualityAdjustment: adjustment,
    adjustedMultiple,
    displayedValuation: Math.max(0, rawValuation),
    isFloored: sde <= 0,
    displayedRange: {
      lower: Math.max(0, sde * displayMultipleRange.lower),
      upper: Math.max(0, sde * displayMultipleRange.upper),
    },
  };
}

function take12(points: ProjectionPoint[] | null): ProjectionPoint[] | null {
  if (!points) return null;
  if (points.length < PROJECTION_WINDOW_MONTHS) return null;
  return points.slice(0, PROJECTION_WINDOW_MONTHS);
}

export function computeValuationProjection(
  inputs: ValuationProjectionInputs
): ValuationProjectionResult {
  const forecast12 = take12(inputs.forecastPoints);
  const baseline12 = take12(inputs.baselineForecastPoints);

  let actual: ValuationProjectionLeg | null = null;
  if (forecast12 !== null) {
    const annualNet = forecast12.reduce((s, p) => s + p.netCashFlow, 0);
    const annualRevenue = forecast12.reduce((s, p) => s + p.cashIn, 0);
    if (annualRevenue > 0) {
      const margin = annualNet / annualRevenue;
      actual = buildLeg(
        annualNet,
        annualRevenue,
        margin,
        inputs.addBacks,
        inputs.derivedMultiple,
        inputs.displayMultipleRange
      );
    }
  }

  let goal: ValuationProjectionLeg | null = null;
  if (
    baseline12 !== null
    && inputs.effectiveTargetNetMargin !== null
    && inputs.effectiveTargetNetMargin > 0
  ) {
    const baselineRevenue = baseline12.reduce((s, p) => s + p.cashIn, 0);
    if (baselineRevenue > 0) {
      const goalMargin = inputs.effectiveTargetNetMargin;
      const goalNet = baselineRevenue * goalMargin;
      goal = buildLeg(
        goalNet,
        baselineRevenue,
        goalMargin,
        inputs.addBacks,
        inputs.derivedMultiple,
        inputs.displayMultipleRange
      );
    }
  }

  return { actual, goal };
}
