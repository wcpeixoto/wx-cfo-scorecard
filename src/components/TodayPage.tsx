import { useMemo } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import type { SignalType } from '../lib/priorities/types';
import { classifyTxn } from '../lib/cashFlow';
import { CashOnHandCard } from './CashOnHandCard';
import { SecondaryPriority } from './SecondaryPriority';
import { OperatingReserveCard } from './OperatingReserveCard';
import { OwnerDistributionsCard } from './OwnerDistributionsCard';

const DIST_ON_TARGET_LOW  = 0.90; // actual >= target × 0.90
const DIST_ON_TARGET_HIGH = 1.10; // actual <= target × 1.10

// Signals intentionally hidden from the Today priority surface. detectSignals
// still produces them — CashOnHandCard reads cash_flow_negative for its
// run-out row — they're just not surfaced as their own priority cards.
const SUPPRESSED_PRIORITY_SIGNALS = new Set<SignalType>([
  'reserve_critical',
  'cash_flow_negative',
  'expense_surge',
]);

interface TodayPageProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
  targetNetMargin?: number;
  onCompareYear?: (year: number) => void;
}

export function TodayPage({ model, txns, forecastProjection, targetNetMargin, onCompareYear }: TodayPageProps) {
  const signals = useMemo(
    () => detectSignals(model, txns, forecastProjection),
    [model, txns, forecastProjection]
  );
  const { secondary } = useMemo(
    () => rankPriorities(signals.filter(s => !SUPPRESSED_PRIORITY_SIGNALS.has(s.type))),
    [signals]
  );

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
        <div className="today-context-grid today-context-grid--2-1">
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
          <article className="card next-owner-dist-card" aria-label="Next Owner Distribution (placeholder)">
            <header className="next-owner-dist-header">
              <h3 className="next-owner-dist-title">Next Owner Distribution</h3>
            </header>
            <div className="next-owner-dist-placeholder">Coming soon</div>
          </article>
        </div>
      </div>
    </div>
  );
}
