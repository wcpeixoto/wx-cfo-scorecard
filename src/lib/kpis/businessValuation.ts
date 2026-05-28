// Business Valuation — SDE-based owner-guidance selectors.
//
// Architecture: pure selectors. The deterministic layer; no AI, no hidden
// scoring. The multiple is DERIVED from driver grades using an additive
// weights model (see DRIVER_WEIGHTS). The displayed multiple range is a
// ±DISPLAY_BUFFER buffer around the derived value, clipped to the
// [MULTIPLE_FLOOR, MULTIPLE_CEILING] cap. Owner Independence grade also
// gates Replacement Cost resolution — Strong forces effective cost to $0
// (transferable = owner-operator), Mixed/Weak defaults a blank field to
// DEFAULT_REPLACEMENT_COST, Needs input leaves it null.
//
// TTM convention reuses the pattern from src/lib/commitments/targetGrounding.ts
// `weeklyCapacity()`: complete-month filter (current incomplete month excluded
// to mirror cashTrend mid-month wobble policy) + slice(-12). We SUM (not
// average) — TTM is the annualized total operating profit.
//
// Owner distributions: NOT added back. computeMonthlyRollups(txns, 'operating')
// already excludes capital distributions (the registry's Owner Distribution
// bucket). Owner W-2 / payroll IS included in operating expenses, so the spec
// correctly asks to add it back to reach SDE.

import type { MonthlyRollup } from '../data/contract';

export const TTM_MONTHS = 12;
const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000; // unused; documented intent only

// Derived-multiple model. Asymmetric weights — weak hurts more than strong
// helps. Sum of all-Strong = +0.80, sum of all-Weak = −1.15, both fall outside
// the cap and clip to the floor/ceiling. Direction is market-supported; the
// specific per-driver weights are this product's scoring model, not a
// market-derived coefficient. (Tooltip copy reflects that.)
export const BASE_MULTIPLE = 2.25;
export const MULTIPLE_FLOOR = 1.5;
export const MULTIPLE_CEILING = 3.0;
export const DISPLAY_BUFFER = 0.25;
export const DEFAULT_REPLACEMENT_COST = 60_000;

export type ValuationDriverKey =
  | 'recurringRevenue'
  | 'leaseRunway'
  | 'coachDepth'
  | 'ownerIndependence'
  | 'financialClarity'
  | 'churnTracking'
  | 'brandStrength';

interface DriverWeightRow {
  strong: number;
  mixed: number;
  weak: number;
}

// Order of entries here is the render order in the card's Drivers list and the
// order returned by buildDriverImpacts(). Don't reorder without updating the
// card's layout expectations.
const DRIVER_WEIGHTS: Record<ValuationDriverKey, DriverWeightRow> = {
  recurringRevenue:    { strong: +0.15, mixed: 0, weak: -0.20 },
  leaseRunway:         { strong: +0.15, mixed: 0, weak: -0.20 },
  coachDepth:          { strong: +0.15, mixed: 0, weak: -0.20 },
  ownerIndependence:   { strong: +0.15, mixed: 0, weak: -0.20 },
  financialClarity:    { strong: +0.05, mixed: 0, weak: -0.10 },
  churnTracking:       { strong: +0.10, mixed: 0, weak: -0.15 },
  brandStrength:       { strong: +0.05, mixed: 0, weak: -0.10 },
};

const DRIVER_IMPACT_ORDER: { key: ValuationDriverKey; label: string }[] = [
  { key: 'recurringRevenue',  label: 'Recurring revenue' },
  { key: 'leaseRunway',       label: 'Lease runway' },
  { key: 'coachDepth',        label: 'Coach depth' },
  { key: 'ownerIndependence', label: 'Owner independence' },
  { key: 'financialClarity',  label: 'Financial clarity' },
  { key: 'churnTracking',     label: 'Churn tracking' },
  { key: 'brandStrength',     label: 'Brand strength' },
];

// ── Domain types ────────────────────────────────────────────────────────────

export type DriverGrade = 'needs_input' | 'weak' | 'mixed' | 'strong';
export const DRIVER_GRADE_VALUES: readonly DriverGrade[] = [
  'needs_input',
  'weak',
  'mixed',
  'strong',
] as const;

export type LeaseRunwayGrade = 'strong' | 'mixed' | 'weak' | 'not_tracked';

export interface Range {
  lower: number;
  upper: number;
}

export interface DriverGrades {
  recurringRevenue: DriverGrade;
  financialClarity: DriverGrade;
  churnTracking: DriverGrade;
  coachDepth: DriverGrade;
  ownerIndependence: DriverGrade;
  brandStrength: DriverGrade;
}

export interface LeaseInputs {
  startDate: string | null; // ISO 'YYYY-MM-DD'
  endDate: string | null;
  renewalOption: boolean | null;
  renewalYears: number | null;
}

// Unified grade for the impacts list. Includes lease's 'not_tracked' (math
// treats it as 0; the renderer displays "Not tracked", not "Needs input").
export type ValuationGrade = DriverGrade | 'not_tracked';

export interface ValuationDriverImpact {
  key: ValuationDriverKey;
  label: string;
  grade: ValuationGrade;
  // Weight from DRIVER_WEIGHTS for the current grade. Same as `contribution`
  // for strong/weak; 0 for mixed/needs_input/not_tracked.
  weight: number;
  // Effective contribution to the derived multiple (= weight; kept separate
  // for renderer ergonomics — the impact column shows this).
  contribution: number;
  // Lease runway is auto-graded from Settings lease dates; recurring revenue
  // becomes auto in PR-B. Owner-set drivers carry isAuto=false in PR-A.
  isAuto: boolean;
}

export interface BusinessValuationInputs {
  ttmOperatingProfit: number | null;
  ownerW2Compensation: number | null;
  personalExpensesThroughBusiness: number | null;
  oneTimeExpensesToAddBack: number | null;
  oneTimeGainsToSubtract: number | null;
  // Persisted replacement cost. Effective cost is derived from this + the
  // Owner Independence grade by resolveEffectiveReplacementCost().
  replacementCost: Range | null;
  driverGrades: DriverGrades;
  lease: LeaseInputs;
}

export interface BusinessValuationResult {
  ttmOperatingProfit: number | null;
  ttmSde: number | null;
  allAddBacksBlank: boolean;
  // Math results — driven by the DERIVED multiple's display range and the
  // EFFECTIVE replacement cost. Renderer surfaces these directly.
  ownerOperatorValue: Range | null;
  transferableValue: Range | null;
  gap: number | null;
  // Driver grades pass-through for the renderer (it shows the lease and
  // owner-set grades together via the impacts list).
  leaseRunway: LeaseRunwayGrade;
  driverGrades: DriverGrades;
  // Derived multiple model. derivedMultiple is the math midpoint (clamped to
  // [MULTIPLE_FLOOR, MULTIPLE_CEILING] by deriveMultiple — that's the
  // industry-range guarantee). displayMultipleRange is derived ± DISPLAY_BUFFER,
  // UNCLIPPED. Math and display use the same range so midpoint(display) =
  // derived = on-screen reconciliation: SDE × midpoint(display) = hero.
  derivedMultiple: number;
  displayMultipleRange: Range;
  // Per-driver impacts in render order. 7 entries.
  driverImpacts: ValuationDriverImpact[];
  // Replacement cost — persisted value (unchanged from V1) and the effective
  // value used in math. defaultApplied = true when Owner Independence is
  // Mixed/Weak AND the persisted value was null/zero → effective falls back
  // to DEFAULT_REPLACEMENT_COST.
  replacementCost: Range | null;
  effectiveReplacementCost: Range | null;
  replacementCostDefaultApplied: boolean;
}

export interface RangeValidationOk {
  ok: true;
  range: Range;
}
export interface RangeValidationErr {
  ok: false;
  reason: 'empty' | 'negative' | 'min_gt_max' | 'not_a_number';
}
export type RangeValidation = RangeValidationOk | RangeValidationErr;

// ── TTM operating profit ────────────────────────────────────────────────────

function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// Strict TTM: requires 12 complete months of history. "Trailing twelve months"
// without 12 months is misleading for valuation, so we return null and the
// downstream selectors fall through to "Needs input" displays.
export function computeTtmOperatingProfit(
  rollups: MonthlyRollup[],
  referenceDate: Date = new Date()
): number | null {
  if (!Array.isArray(rollups) || rollups.length === 0) return null;
  const currentKey = monthKey(referenceDate);
  const complete = rollups
    .filter((r) => r.month && r.month < currentKey)
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month));
  if (complete.length < TTM_MONTHS) return null;
  const window = complete.slice(-TTM_MONTHS);
  return window.reduce((sum, r) => sum + r.netCashFlow, 0);
}

// ── SDE ─────────────────────────────────────────────────────────────────────

function blankAsZero(value: number | null): number {
  return value ?? 0;
}

// Returns null when TTM operating profit is null (insufficient history).
export function computeSde(inputs: {
  ttmOperatingProfit: number | null;
  ownerW2Compensation: number | null;
  personalExpensesThroughBusiness: number | null;
  oneTimeExpensesToAddBack: number | null;
  oneTimeGainsToSubtract: number | null;
}): number | null {
  if (inputs.ttmOperatingProfit === null) return null;
  return (
    inputs.ttmOperatingProfit +
    blankAsZero(inputs.ownerW2Compensation) +
    blankAsZero(inputs.personalExpensesThroughBusiness) +
    blankAsZero(inputs.oneTimeExpensesToAddBack) -
    blankAsZero(inputs.oneTimeGainsToSubtract)
  );
}

// True when ALL four add-back inputs are null/blank — triggers the
// "Add SDE add-backs in Settings for full accuracy" note on the card.
export function allAddBacksBlank(inputs: {
  ownerW2Compensation: number | null;
  personalExpensesThroughBusiness: number | null;
  oneTimeExpensesToAddBack: number | null;
  oneTimeGainsToSubtract: number | null;
}): boolean {
  return (
    inputs.ownerW2Compensation === null &&
    inputs.personalExpensesThroughBusiness === null &&
    inputs.oneTimeExpensesToAddBack === null &&
    inputs.oneTimeGainsToSubtract === null
  );
}

// ── Valuation ranges ────────────────────────────────────────────────────────

// Owner-Operator Value: SDE × multiple range. Single SDE, ranged multiple
// → range with both ends scaled by the same SDE.
export function computeOwnerOperatorValue(
  sde: number | null,
  multipleRange: Range
): Range | null {
  if (sde === null) return null;
  return {
    lower: sde * multipleRange.lower,
    upper: sde * multipleRange.upper,
  };
}

// Transferable SDE: SDE minus the replacement-cost range. The owner-facing
// "low" transferable SDE uses the high-end replacement (most expensive to
// replace yourself), and the "high" uses the low-end replacement (cheapest).
// Each end is floored at $0 — never show negative valuation.
export function computeTransferableSde(
  sde: number | null,
  replacementCost: Range | null
): Range | null {
  if (sde === null || replacementCost === null) return null;
  return {
    lower: Math.max(0, sde - replacementCost.upper),
    upper: Math.max(0, sde - replacementCost.lower),
  };
}

// Transferable Value: transferable-SDE range × multiple range. Each end
// scaled by the matching multiple end.
export function computeTransferableValue(
  transferableSde: Range | null,
  multipleRange: Range
): Range | null {
  if (transferableSde === null) return null;
  return {
    lower: transferableSde.lower * multipleRange.lower,
    upper: transferableSde.upper * multipleRange.upper,
  };
}

function midpoint(range: Range): number {
  return (range.lower + range.upper) / 2;
}

// Gap = midpoint(OOV) − midpoint(TV). Null when either input is null —
// "Needs input" in the UI.
export function computeGap(
  ownerOperatorValue: Range | null,
  transferableValue: Range | null
): number | null {
  if (ownerOperatorValue === null || transferableValue === null) return null;
  return midpoint(ownerOperatorValue) - midpoint(transferableValue);
}

// ── Lease runway ────────────────────────────────────────────────────────────

// Local-time date construction (AGENTS.md gotcha: never `new Date('YYYY-MM-DD')`,
// which parses as UTC midnight and shifts the window in US timezones).
export function parseLocalDate(iso: string | null): Date | null {
  if (!iso) return null;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  if (
    !Number.isFinite(year) ||
    month < 0 ||
    month > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return new Date(year, month, day);
}

// Integer months from `from` to `to`. Negative when `to` is before `from`.
// Floors on partial months (matches "60+ months secured" spec semantics).
export function monthsBetween(from: Date, to: Date): number {
  const years = to.getFullYear() - from.getFullYear();
  const months = to.getMonth() - from.getMonth();
  let total = years * 12 + months;
  if (to.getDate() < from.getDate()) total -= 1;
  return total;
}

// Lease grading per spec:
//   Strong : 60+ months secured (incl. renewal years)
//   Mixed  : 24–59 months secured
//   Weak   : <24 months  OR  end date past with no renewal
//   Not tracked : no usable lease data (specifically: end date missing —
//                 without it we cannot grade)
export function gradeLeaseRunway(
  today: Date,
  lease: LeaseInputs
): LeaseRunwayGrade {
  const endDate = parseLocalDate(lease.endDate);
  if (endDate === null) return 'not_tracked';

  const baseMonths = monthsBetween(today, endDate);

  const renewalActive =
    lease.renewalOption === true &&
    lease.renewalYears !== null &&
    lease.renewalYears > 0;
  const renewalMonths = renewalActive ? (lease.renewalYears as number) * 12 : 0;

  // End date past with no renewal → Weak (explicit spec rule).
  if (baseMonths < 0 && renewalMonths === 0) return 'weak';

  const totalMonths = baseMonths + renewalMonths;
  if (totalMonths >= 60) return 'strong';
  if (totalMonths >= 24) return 'mixed';
  return 'weak';
}

// ── Validators (inline editors) ─────────────────────────────────────────────

/**
 * @deprecated PR-A: the multiple is now derived from driver grades; no inline
 * editor remains. Kept for backward compatibility while the persistence
 * columns still exist. Slated for removal in PR-B alongside the
 * valuation_multiple_lower/upper column disposition.
 */
export function validateMultipleRange(
  lower: number | null,
  upper: number | null
): RangeValidation {
  return validateRangeStrict(lower, upper, { allowEmpty: false });
}

// Replacement Cost: empty acceptable — caller treats { ok: false, reason:
// 'empty' } as "revert to Needs input" (clearing the value).
export function validateReplacementCostRange(
  lower: number | null,
  upper: number | null
): RangeValidation {
  return validateRangeStrict(lower, upper, { allowEmpty: true });
}

function validateRangeStrict(
  lower: number | null,
  upper: number | null,
  options: { allowEmpty: boolean }
): RangeValidation {
  if (lower === null && upper === null) {
    return options.allowEmpty
      ? { ok: false, reason: 'empty' }
      : { ok: false, reason: 'empty' };
  }
  // Single-value entry: point range (value to value).
  const l = lower ?? upper;
  const u = upper ?? lower;
  if (l === null || u === null) {
    return { ok: false, reason: 'not_a_number' };
  }
  if (!Number.isFinite(l) || !Number.isFinite(u)) {
    return { ok: false, reason: 'not_a_number' };
  }
  if (l < 0 || u < 0) {
    return { ok: false, reason: 'negative' };
  }
  if (l > u) {
    return { ok: false, reason: 'min_gt_max' };
  }
  return { ok: true, range: { lower: l, upper: u } };
}

// ── Derived multiple model ─────────────────────────────────────────────────

// Build the 7-entry impacts list in render order. Lease's 'not_tracked' is
// preserved on the grade field but contributes 0 (same math as Needs input).
export function buildDriverImpacts(
  driverGrades: DriverGrades,
  leaseGrade: LeaseRunwayGrade
): ValuationDriverImpact[] {
  return DRIVER_IMPACT_ORDER.map(({ key, label }) => {
    const grade: ValuationGrade =
      key === 'leaseRunway' ? leaseGrade : driverGrades[key];
    const weights = DRIVER_WEIGHTS[key];
    let contribution = 0;
    if (grade === 'strong') contribution = weights.strong;
    else if (grade === 'weak') contribution = weights.weak;
    // 'mixed' | 'needs_input' | 'not_tracked' → 0
    return {
      key,
      label,
      grade,
      // weight surfaces the magnitude associated with the current grade —
      // 0 when the grade is non-active. (Renderer reads `contribution`.)
      weight: contribution,
      contribution,
      isAuto: key === 'leaseRunway',
    };
  });
}

// Sum impact contributions on top of BASE_MULTIPLE, then clamp to the
// [MULTIPLE_FLOOR, MULTIPLE_CEILING] cap.
export function deriveMultiple(impacts: ValuationDriverImpact[]): number {
  const sum = impacts.reduce((acc, i) => acc + i.contribution, 0);
  const raw = BASE_MULTIPLE + sum;
  if (raw < MULTIPLE_FLOOR) return MULTIPLE_FLOOR;
  if (raw > MULTIPLE_CEILING) return MULTIPLE_CEILING;
  return raw;
}

// Display range = derived ± DISPLAY_BUFFER. NO clipping — math and display
// share this range so midpoint(display) = derived. The derivedMultiple is
// already clamped to [MULTIPLE_FLOOR, MULTIPLE_CEILING] upstream by
// deriveMultiple; the displayed buffer can extend slightly past the cap
// (e.g. derived=3.00 → display=[2.75, 3.25]) as honest uncertainty around
// the midpoint, not an off-market claim.
export function bufferDisplayRange(derived: number): Range {
  return {
    lower: derived - DISPLAY_BUFFER,
    upper: derived + DISPLAY_BUFFER,
  };
}

export interface EffectiveReplacementCost {
  effective: Range | null;
  defaultApplied: boolean;
}

// Owner Independence gates effective replacement cost:
//   strong       → effective = $0 (transferable = owner-operator, gap = $0).
//                  Persisted value is preserved untouched so the owner can
//                  switch back to mixed/weak later without re-entering it.
//   mixed | weak → effective = persisted, OR DEFAULT_REPLACEMENT_COST when
//                  persisted is null / a zero range (defaultApplied = true).
//   needs_input  → effective = null ("Needs input" downstream).
export function resolveEffectiveReplacementCost(
  persisted: Range | null,
  ownerIndependence: DriverGrade
): EffectiveReplacementCost {
  if (ownerIndependence === 'strong') {
    return { effective: { lower: 0, upper: 0 }, defaultApplied: false };
  }
  if (ownerIndependence === 'needs_input') {
    return { effective: null, defaultApplied: false };
  }
  // mixed | weak
  const isBlankOrZero =
    persisted === null ||
    (persisted.lower === 0 && persisted.upper === 0);
  if (isBlankOrZero) {
    return {
      effective: {
        lower: DEFAULT_REPLACEMENT_COST,
        upper: DEFAULT_REPLACEMENT_COST,
      },
      defaultApplied: true,
    };
  }
  return { effective: persisted, defaultApplied: false };
}

// ── Main composer ──────────────────────────────────────────────────────────

export function computeBusinessValuation(
  inputs: BusinessValuationInputs,
  referenceDate: Date = new Date()
): BusinessValuationResult {
  const ttmSde = computeSde({
    ttmOperatingProfit: inputs.ttmOperatingProfit,
    ownerW2Compensation: inputs.ownerW2Compensation,
    personalExpensesThroughBusiness: inputs.personalExpensesThroughBusiness,
    oneTimeExpensesToAddBack: inputs.oneTimeExpensesToAddBack,
    oneTimeGainsToSubtract: inputs.oneTimeGainsToSubtract,
  });

  const leaseRunway = gradeLeaseRunway(referenceDate, inputs.lease);
  const driverImpacts = buildDriverImpacts(inputs.driverGrades, leaseRunway);
  const derivedMultiple = deriveMultiple(driverImpacts);
  const displayMultipleRange = bufferDisplayRange(derivedMultiple);

  const { effective: effectiveReplacementCost, defaultApplied } =
    resolveEffectiveReplacementCost(
      inputs.replacementCost,
      inputs.driverGrades.ownerIndependence
    );

  // OOV / TV math and the displayed multiple range share the SAME
  // derived ± DISPLAY_BUFFER range. The midpoint of that range = derived,
  // which keeps midpoint(OOV) = SDE × derived and midpoint(TV) =
  // transferableSde.midpoint × derived — the midpoint-preservation invariant
  // also reconciles on screen now (SDE × midpoint(displayed multiple) = hero).
  // The industry-range guarantee on the underlying value lives upstream in
  // deriveMultiple's [MULTIPLE_FLOOR, MULTIPLE_CEILING] clamp.
  const ownerOperatorValue = computeOwnerOperatorValue(
    ttmSde,
    displayMultipleRange
  );
  const transferableSde = computeTransferableSde(ttmSde, effectiveReplacementCost);
  const transferableValue = computeTransferableValue(
    transferableSde,
    displayMultipleRange
  );
  const gap = computeGap(ownerOperatorValue, transferableValue);

  return {
    ttmOperatingProfit: inputs.ttmOperatingProfit,
    ttmSde,
    allAddBacksBlank: allAddBacksBlank({
      ownerW2Compensation: inputs.ownerW2Compensation,
      personalExpensesThroughBusiness: inputs.personalExpensesThroughBusiness,
      oneTimeExpensesToAddBack: inputs.oneTimeExpensesToAddBack,
      oneTimeGainsToSubtract: inputs.oneTimeGainsToSubtract,
    }),
    ownerOperatorValue,
    transferableValue,
    gap,
    leaseRunway,
    driverGrades: inputs.driverGrades,
    derivedMultiple,
    displayMultipleRange,
    driverImpacts,
    replacementCost: inputs.replacementCost,
    effectiveReplacementCost,
    replacementCostDefaultApplied: defaultApplied,
  };
}

// Silence unused-warning for the documentary constant.
void MS_PER_MONTH;
