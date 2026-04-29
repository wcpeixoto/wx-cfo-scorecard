import { useMemo } from 'react';
import type { DashboardModel, Txn } from '../lib/data/contract';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import { classifyTxn } from '../lib/cashFlow';
import { HeroPriorityCard } from './HeroPriorityCard';
import { SecondaryPriority } from './SecondaryPriority';
import { OperatingReserveCard } from './OperatingReserveCard';
import { OwnerDistributionsCard } from './OwnerDistributionsCard';

const DIST_ON_TARGET_LOW  = 0.90; // actual >= target × 0.90
const DIST_ON_TARGET_HIGH = 1.10; // actual <= target × 1.10

interface TodayPageProps {
  model: DashboardModel;
  txns: Txn[];
  targetNetMargin?: number;
}

export function TodayPage({ model, txns, targetNetMargin }: TodayPageProps) {
  const signals = useMemo(() => detectSignals(model, txns), [model, txns]);
  const { hero, secondary } = useMemo(() => rankPriorities(signals), [signals]);

  const distributionStatus = useMemo(() => {
    if (
      !model.monthlyRollups ||
      model.monthlyRollups.length < 3 ||
      !targetNetMargin ||
      targetNetMargin === 0 ||
      !txns ||
      txns.length === 0
    ) {
      return { status: 'on_target' as const, targetAmount: 0, actualAmount: 0 };
    }

    const recentMonths = model.monthlyRollups.slice(-12);
    const totalRevenue = recentMonths.reduce((sum, m) => sum + (m.revenue ?? 0), 0);
    const targetAmount = totalRevenue * targetNetMargin;

    const cutoffMonth = recentMonths[0].month;
    const actualAmount = txns
      .filter(txn => classifyTxn(txn) === 'owner-distribution')
      .filter(txn => txn.month >= cutoffMonth)
      .reduce((sum, txn) => sum + Math.abs(txn.amount), 0);

    let status: 'below_target' | 'on_target' | 'above_target';
    if (actualAmount < targetAmount * DIST_ON_TARGET_LOW) {
      status = 'below_target';
    } else if (actualAmount > targetAmount * DIST_ON_TARGET_HIGH) {
      status = 'above_target';
    } else {
      status = 'on_target';
    }

    return { status, targetAmount, actualAmount };
  }, [model, txns, targetNetMargin]);

  const secondaryClass =
    secondary.length === 2 ? 'today-secondary-row is-pair' : 'today-secondary-row';

  return (
    <div className="today-page">
      <div className="today-top-grid">
        <HeroPriorityCard signal={hero} />
        <OperatingReserveCard
          currentCashBalance={model.runway.currentCashBalance}
          reserveTarget={model.runway.reserveTarget}
        />
      </div>

      {secondary.length > 0 && (
        <div className={secondaryClass}>
          {secondary.map((s, i) => (
            <SecondaryPriority key={`${s.type}-${i}`} signal={s} />
          ))}
        </div>
      )}

      {/* Context section */}
      <div className="today-context-section">
        <OwnerDistributionsCard
          transactions={txns}
          distributionStatus={distributionStatus.status}
          distributionTargetAmount={distributionStatus.targetAmount}
          distributionActualAmount={distributionStatus.actualAmount}
          targetNetMargin={targetNetMargin}
        />
      </div>
    </div>
  );
}
