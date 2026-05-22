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
