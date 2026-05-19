import { useMemo } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import { classifyTxn } from '../lib/cashFlow';
import { CashOnHandCard } from './CashOnHandCard';
import { OperatingReserveCard } from './OperatingReserveCard';
import { OwnerDistributionsCard } from './OwnerDistributionsCard';
import { NextOwnerDistributionCard } from './NextOwnerDistributionCard';

const DIST_ON_TARGET_LOW  = 0.90; // actual >= target × 0.90
const DIST_ON_TARGET_HIGH = 1.10; // actual <= target × 1.10

interface TodayPageProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
  ownerPayProjection: ScenarioPoint[];
  ownerPayReserveFloor: number;
  targetNetMargin?: number;
  onCompareYear?: (year: number) => void;
}

export function TodayPage({ model, txns, forecastProjection, ownerPayProjection, ownerPayReserveFloor, targetNetMargin, onCompareYear }: TodayPageProps) {
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

  return (
    <div className="today-page">
      <div className="today-top-grid">
        <CashOnHandCard
          model={model}
          txns={txns}
          forecastProjection={forecastProjection}
        />
        <OperatingReserveCard
          currentCashBalance={model.runway.currentCashBalance}
          reserveTarget={model.runway.reserveTarget}
          monthlyRollups={model.monthlyRollups}
        />
        <div className="card card--placeholder" aria-hidden="true" />
      </div>

      {/* Context section */}
      <div className="today-context-section">
        <div className="today-context-grid">
          <OwnerDistributionsCard
            transactions={txns}
            distributionStatus={distributionStatus.status}
            distributionTargetAmount={distributionStatus.targetAmount}
            distributionActualAmount={distributionStatus.actualAmount}
            targetNetMargin={targetNetMargin}
            forecastProjection={forecastProjection}
            reserveTarget={model.runway.reserveTarget}
            currentCashBalance={model.runway.currentCashBalance}
            onCompareYear={onCompareYear}
          />
          <NextOwnerDistributionCard
            ownerPayProjection={ownerPayProjection}
            reserveFloor={ownerPayReserveFloor}
          />
        </div>
      </div>
    </div>
  );
}
