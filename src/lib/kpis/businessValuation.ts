// Business Valuation — SDE-based owner-guidance selectors.
//
// Architecture: pure selectors. The deterministic layer; no AI, no hidden
// scoring. Drivers EXPLAIN the valuation (qualitative grades the owner sets),
// they do NOT calculate it. Multiple Range is owner-controlled; we never
// auto-derive it from driver grades.
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

export interface BusinessValuationInputs {
  ttmOperatingProfit: number | null;
  ownerW2Compensation: number | null;
  personalExpensesThroughBusiness: number | null;
  oneTimeExpensesToAddBack: number | null;
  oneTimeGainsToSubtract: number | null;
  multipleRange: Range;
  replacementCost: Range | null;
  driverGrades: DriverGrades;
  lease: LeaseInputs;
}

export interface BusinessValuationResult {
  ttmOperatingProfit: number | null;
  ttmSde: number | null;
  allAddBacksBlank: boolean;
  ownerOperatorValue: Range | null;
  transferableValue: Range | null;
  gap: number | null;
  leaseRunway: LeaseRunwayGrade;
  driverGrades: DriverGrades;
  multipleRange: Range;
  replacementCost: Range | null;
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

// Multiple Range: empty REJECTED (always has a default value).
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

  const ownerOperatorValue = computeOwnerOperatorValue(
    ttmSde,
    inputs.multipleRange
  );
  const transferableSde = computeTransferableSde(ttmSde, inputs.replacementCost);
  const transferableValue = computeTransferableValue(
    transferableSde,
    inputs.multipleRange
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
    leaseRunway: gradeLeaseRunway(referenceDate, inputs.lease),
    driverGrades: inputs.driverGrades,
    multipleRange: inputs.multipleRange,
    replacementCost: inputs.replacementCost,
  };
}

// Silence unused-warning for the documentary constant.
void MS_PER_MONTH;
