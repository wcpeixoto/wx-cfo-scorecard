// Next Owner Distribution — pure helper.
//
// Given a dedicated Reality/Base/15-month forecast series (events-parity
// applied upstream in Dashboard.tsx) and an effective reserve floor, decide
// when the owner can next take a distribution without breaching the reserve
// safety line, and produce per-bar chart segments for the 12-month display
// window.
//
// Internal window: months 0..14 (15 months) — the 4-month safety window for
// candidate month 11 looks at months 11..14.
// Display window:  months 0..11 (12 bars).

import type { ScenarioPoint } from './contract';

/** Minimum 4-month safety-window surplus (in $) for a month to qualify as a
 *  payout month. Hardcoded in v1 — no Settings UI. */
export const MIN_DISTRIBUTION_THRESHOLD = 3000;

/** Months required in the input series (display 12 + 3 look-ahead). */
export const REQUIRED_SERIES_LENGTH = 15;

/** Number of display bars (candidate months 0..11). */
const DISPLAY_MONTHS = 12;

/** Safety window length: candidate month + next 3 = 4 months. */
const SAFETY_WINDOW = 4;

export type NextDistributionBlocker =
  | 'reserve_shortfall'
  | 'negative_distributable_cash'
  | 'below_minimum_payout';

export type BarSegments = {
  monthLabel: string;
  /** Mapped from ScenarioPoint.endingCashBalance. Total bar height invariant. */
  endingCashBeforePayout: number;
  reserveSegment: number;
  safeCashSegment: number;
  distributionSegment: number;
  isFirstPayout: boolean;
};

export type NextDistributionResult =
  | {
      state: 'forecast';
      monthLabel: string;
      distributionAmount: number;
      bars: BarSegments[];
    }
  | {
      state: 'blocked';
      blocker: NextDistributionBlocker;
      bars: BarSegments[];
    };

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2026-08" -> "Aug 2026". Token construction only — no Date parsing. */
function formatMonthLabel(token: string): string {
  const [year, month] = token.split('-');
  const idx = Number(month) - 1;
  const name = SHORT_MONTHS[idx] ?? month;
  return `${name} ${year}`;
}

/**
 * Compute the next owner distribution state and per-bar chart segments.
 *
 * @param ownerPayProjection Dedicated Reality/Base/15-month series with
 *   known-events overlay applied upstream. Must have >= 15 points.
 * @param reserveFloor Effective reserve floor — the Settings-fixed-aware
 *   value identical to the Forecast safety-line rule (NOT raw reserveTarget).
 * @throws if the series has fewer than 15 points.
 */
export function computeNextOwnerDistribution(
  ownerPayProjection: ScenarioPoint[],
  reserveFloor: number
): NextDistributionResult {
  if (!ownerPayProjection || ownerPayProjection.length < REQUIRED_SERIES_LENGTH) {
    throw new Error(
      `computeNextOwnerDistribution: expected at least ${REQUIRED_SERIES_LENGTH} ` +
        `projection points, received ${ownerPayProjection?.length ?? 0}.`
    );
  }

  const endingCash = ownerPayProjection.map((p) => p.endingCashBalance);

  // First qualifying candidate month in the 12-month display window.
  let firstPayoutIndex = -1;
  let firstPayoutAmount = 0;
  for (let i = 0; i < DISPLAY_MONTHS; i += 1) {
    // 4-month safety window: months [i, i+1, i+2, i+3].
    let windowMin = endingCash[i];
    for (let k = 1; k < SAFETY_WINDOW; k += 1) {
      windowMin = Math.min(windowMin, endingCash[i + k]);
    }
    const surplus = windowMin - reserveFloor;
    if (surplus >= MIN_DISTRIBUTION_THRESHOLD) {
      firstPayoutIndex = i;
      firstPayoutAmount = surplus;
      break;
    }
  }

  const qualifying = firstPayoutIndex >= 0;

  // Build the 12 display bars (Option A — distribution carved from safe cash).
  const bars: BarSegments[] = [];
  for (let i = 0; i < DISPLAY_MONTHS; i += 1) {
    const cash = endingCash[i];
    const reserveSegment = Math.min(cash, reserveFloor);
    const isThisMonthPayout = qualifying && i === firstPayoutIndex;
    const distributionSegment = isThisMonthPayout ? firstPayoutAmount : 0;
    const safeCashSegment = Math.max(
      cash - reserveSegment - distributionSegment,
      0
    );
    bars.push({
      monthLabel: formatMonthLabel(ownerPayProjection[i].month),
      endingCashBeforePayout: cash,
      reserveSegment,
      safeCashSegment,
      distributionSegment,
      isFirstPayout: isThisMonthPayout,
    });
  }

  if (qualifying) {
    return {
      state: 'forecast',
      monthLabel: formatMonthLabel(ownerPayProjection[firstPayoutIndex].month),
      distributionAmount: firstPayoutAmount,
      bars,
    };
  }

  // No qualifying month — pick exactly one blocker by priority.
  const blocker = selectBlocker(endingCash, reserveFloor);
  return { state: 'blocked', blocker, bars };
}

/**
 * Blocker selection, highest priority first:
 *  1. reserve_shortfall — any ending cash in months 0..11 below reserveFloor.
 *  2. negative_distributable_cash — no positive (endingCash - reserve) value
 *     exists across months 0..11.
 *  3. below_minimum_payout — at least one candidate produces a 4-month
 *     safety-window surplus > 0 but < MIN_DISTRIBUTION_THRESHOLD.
 *
 * Falls back to below_minimum_payout when none of the above strictly apply
 * (e.g. all surpluses are exactly 0): there is non-negative distributable
 * cash but nothing reaches the minimum payout.
 */
function selectBlocker(
  endingCash: number[],
  reserveFloor: number
): NextDistributionBlocker {
  // 1. Reserve shortfall — any display-window month below the floor.
  for (let i = 0; i < DISPLAY_MONTHS; i += 1) {
    if (endingCash[i] < reserveFloor) {
      return 'reserve_shortfall';
    }
  }

  // 2. Negative distributable cash — no positive (cash - reserve) anywhere.
  let anyPositiveDistributable = false;
  for (let i = 0; i < DISPLAY_MONTHS; i += 1) {
    if (endingCash[i] - reserveFloor > 0) {
      anyPositiveDistributable = true;
      break;
    }
  }
  if (!anyPositiveDistributable) {
    return 'negative_distributable_cash';
  }

  // 3. Below minimum payout — some candidate's safety-window surplus is in
  //    (0, MIN_DISTRIBUTION_THRESHOLD). This is also the default fallthrough.
  return 'below_minimum_payout';
}

export const BLOCKER_LABELS: Record<NextDistributionBlocker, string> = {
  reserve_shortfall: 'Reserve shortfall',
  negative_distributable_cash: 'Negative distributable cash',
  below_minimum_payout: 'Below minimum payout',
};
