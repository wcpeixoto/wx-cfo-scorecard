// Owner-distribution status — pure helper.
//
// Extracted VERBATIM from TodayPage's `distributionStatus` useMemo so BOTH the Today page and the
// monthly-source export read ONE source of truth for the trailing-12 owner-draw actual-vs-target
// number (deterministic-layer doctrine). Behavior-identical to the former inline logic — proven by
// the parity test in ownerDistributionStatus.test.ts.
//
// It additionally exposes the trailing-12 window bounds it actually used (`windowStart`/`windowEnd`),
// so a caller can report the REAL window rather than assuming it ends on the last complete month. The
// window is `monthlyRollups.slice(-12)`, whose last entry INCLUDES the partial current month when one
// is present — so `windowEnd` can be later than the export's scorecard month. Null in the degenerate
// early-return (insufficient rollups / no txns / margin unset), where no target is computed.

import type { DashboardModel, Txn } from './contract';
import { classifyTxn } from '../cashFlow';

/** On-target band: actual within [0.90, 1.10] × target. */
const DIST_ON_TARGET_LOW = 0.9;
const DIST_ON_TARGET_HIGH = 1.1;

export type OwnerDistributionStatusValue = 'below_target' | 'on_target' | 'above_target';

export type OwnerDistributionStatus = {
  status: OwnerDistributionStatusValue;
  targetAmount: number;
  actualAmount: number;
  // Trailing-12 window actually used (recentMonths[0].month … last rollup month). Null in the
  // degenerate case where no target is computed — the caller reports window:null + target_configured:false.
  windowStart: string | null;
  windowEnd: string | null;
};

/**
 * Trailing-12 owner-distribution status: actual owner draws vs the target (trailing-12 revenue ×
 * targetNetMargin). Degenerate inputs (fewer than 3 rollups, no txns, or an unset/zero margin) return
 * a neutral on-target/zero result with a null window — the target is not meaningful there.
 */
export function computeOwnerDistributionStatus(
  model: DashboardModel,
  txns: Txn[],
  targetNetMargin: number | undefined,
): OwnerDistributionStatus {
  if (
    !model.monthlyRollups ||
    model.monthlyRollups.length < 3 ||
    !targetNetMargin ||
    targetNetMargin === 0 ||
    !txns ||
    txns.length === 0
  ) {
    return { status: 'on_target', targetAmount: 0, actualAmount: 0, windowStart: null, windowEnd: null };
  }

  const recentMonths = model.monthlyRollups.slice(-12);
  const totalRevenue = recentMonths.reduce((sum, m) => sum + (m.revenue ?? 0), 0);
  const targetAmount = totalRevenue * targetNetMargin;

  const cutoffMonth = recentMonths[0].month;
  const actualAmount = txns
    .filter((txn) => classifyTxn(txn) === 'owner-distribution')
    .filter((txn) => txn.month >= cutoffMonth)
    .reduce((sum, txn) => sum + Math.abs(txn.amount), 0);

  let status: OwnerDistributionStatusValue;
  if (actualAmount < targetAmount * DIST_ON_TARGET_LOW) {
    status = 'below_target';
  } else if (actualAmount > targetAmount * DIST_ON_TARGET_HIGH) {
    status = 'above_target';
  } else {
    status = 'on_target';
  }

  return {
    status,
    targetAmount,
    actualAmount,
    windowStart: cutoffMonth,
    windowEnd: recentMonths[recentMonths.length - 1].month,
  };
}
