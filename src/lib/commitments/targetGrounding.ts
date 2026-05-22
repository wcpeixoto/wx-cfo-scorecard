import type { DashboardModel, MonthlyRollup } from '../data/contract';
import type { GroundingUnknownReason, TargetGrounding } from './types';

// TG-0 locked spec (reserve_warning): capacity-bounded-by-gap.
//   recommended = min(ceiling, roundTo25(weeklyCapacity × FRACTION))
//   weeklyCapacity = TTM-smoothed operating surplus ÷ weeks-per-month
// The committed target is grounded in surplus the business actually produces
// (#1/#2/#3 at the target layer); when data can't honestly support a number the
// classification is 'unknown' (the #3 STOP rule — TG-3 routes it to awareness).
const SUSTAINABLE_FRACTION = 0.33; // sweep a third of surplus; leave the rest for ops
const FLOOR_WEEKLY = 25;
const WEEKS_PER_MONTH = 4.33;
const MAX_WINDOW_MONTHS = 12;
const MIN_HISTORY_MONTHS = 6; // matches REVENUE_DECLINE_MIN_HISTORY_MONTHS (signals.ts)

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function roundTo25(value: number): number {
  return Math.round(value / 25) * 25;
}

function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// TTM-smoothed weekly operating-surplus capacity. The current (incomplete)
// calendar month is excluded — mirrors cashTrend.ts so mid-month wobble can't
// move the recommendation. Returns null when fewer than MIN_HISTORY_MONTHS
// complete months exist. (TG-0 knob D's optional trailing-3mo conservative
// guard is intentionally deferred — TTM-only for this slice.)
function weeklyCapacity(rollups: MonthlyRollup[], referenceDate: Date): number | null {
  const currentKey = monthKey(referenceDate);
  const complete = rollups
    .filter((r) => r.month && r.month < currentKey)
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month));
  if (complete.length < MIN_HISTORY_MONTHS) return null;
  const window = complete.slice(-MAX_WINDOW_MONTHS);
  const avgMonthly = window.reduce((sum, r) => sum + r.netCashFlow, 0) / window.length;
  return avgMonthly / WEEKS_PER_MONTH;
}

function unknown(
  reason: GroundingUnknownReason,
  ceiling: number,
  capacity: number | null
): TargetGrounding {
  return {
    classification: 'unknown',
    recommended: null,
    floor: FLOOR_WEEKLY,
    ceiling,
    weeklyCapacity: capacity,
    unknownReason: reason,
  };
}

// Ground the reserve_warning weekly target against available operating data.
// `ceiling` is the full reserve gap $ (already computed as gapContext).
export function groundReserveWarningTarget(
  ceiling: number,
  model: DashboardModel,
  referenceDate: Date = new Date()
): TargetGrounding {
  if (model.runway.status === 'insufficient-history' || model.runway.percentFunded === null) {
    return unknown('insufficient_history', ceiling, null);
  }

  const capacity = weeklyCapacity(model.monthlyRollups, referenceDate);
  if (capacity === null) return unknown('insufficient_history', ceiling, null);
  if (capacity <= 0) return unknown('nonpositive_capacity', ceiling, capacity);

  const recommended = Math.min(ceiling, roundTo25(capacity * SUSTAINABLE_FRACTION));
  if (recommended < FLOOR_WEEKLY) return unknown('below_floor', ceiling, capacity);

  return {
    classification: 'grounded',
    recommended,
    floor: FLOOR_WEEKLY,
    ceiling,
    weeklyCapacity: capacity,
    unknownReason: null,
  };
}

// TG-2: the consent slot's read of a grounded target. Adjacent guidance only —
// a single number + horizon, never a pre-fill (the input keeps its generic
// placeholder). The `floor` rides along so the card can soft-warn (not block)
// below it.
export interface ReserveGroundingHint {
  text: string;
  floor: number; // weekly $ below which to soft-warn
}

// Within ~a quarter the finish line motivates ("…in ~N weeks"); past it a precise
// week count reads as discouraging on a weekly card (real data hit ~141 weeks),
// so the copy reframes to the sustainable pace instead. Boundary inclusive: ≤ 12
// → finish line, > 12 → pace.
const FINISH_LINE_WEEKS_MAX = 12;

// Keyed on `recommended`, NOT `classification`: a positive "do we have a number
// to show?" test. The card therefore never branches on classification, so it
// can't define the unknown render branch by negation — TG-3 owns unknown→
// awareness routing exclusively (the #195 trap). null ⇒ consent slot unchanged.
export function reserveGroundingHint(grounding: TargetGrounding): ReserveGroundingHint | null {
  const { recommended, ceiling, floor } = grounding;
  if (recommended === null) return null;
  const amount = usd.format(recommended);
  const weeks = Math.max(1, Math.ceil(ceiling / recommended));
  const text =
    weeks <= FINISH_LINE_WEEKS_MAX
      ? `Your recent surplus supports about ${amount}/week — that fully funds your reserve in ~${weeks} week${weeks === 1 ? '' : 's'}.`
      : `Your recent surplus supports about ${amount}/week — a sustainable pace toward your reserve.`;
  return { text, floor };
}

// TG-3 awareness/STOP copy for an ungroundable target (#3): honest, carries NO
// number, and is ONE message for every unknownReason (the reason stays on the
// grounding object for tests/telemetry, never rendered). Production UI — ships in
// the bundle (unlike the dev seam, which is stripped).
export const RESERVE_STOP_MESSAGE =
  'Your operating reserve is below target, but recent cash flow does not yet support a weekly amount worth setting aside. Keep it in view as cash flow strengthens.';

// TG-3: the consent slot's exhaustive read of grounding. The card switches on
// `mode` and NEVER inspects `classification` itself, so a future classification
// value can't slip into the STOP branch by negation (the #195 trap). Adding a
// classification value makes `assertNever` a COMPILE error until it's handled.
export type GroundingConsentMode =
  | { mode: 'commit'; hint: ReserveGroundingHint | null } // grounded → consent slot
  | { mode: 'stop'; message: string }; // unknown → awareness/STOP surface

function assertNever(value: never): never {
  throw new Error(`Unhandled grounding classification: ${String(value)}`);
}

export function groundingConsentMode(grounding: TargetGrounding): GroundingConsentMode {
  switch (grounding.classification) {
    case 'grounded':
      return { mode: 'commit', hint: reserveGroundingHint(grounding) };
    case 'unknown':
      return { mode: 'stop', message: RESERVE_STOP_MESSAGE };
    default:
      return assertNever(grounding.classification);
  }
}
