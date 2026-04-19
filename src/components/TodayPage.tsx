import { useMemo } from 'react';
import type { DashboardModel, Txn } from '../lib/data/contract';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import { HeroPriorityCard } from './HeroPriorityCard';
import { SecondaryPriority } from './SecondaryPriority';
import { OperatingReserveCard } from './OperatingReserveCard';
import { OwnerDistributionsCard } from './OwnerDistributionsCard';

interface TodayPageProps {
  model: DashboardModel;
  txns: Txn[];
}

export function TodayPage({ model, txns }: TodayPageProps) {
  const signals = useMemo(() => detectSignals(model, txns), [model, txns]);
  const { hero, secondary } = useMemo(() => rankPriorities(signals), [signals]);

  const secondaryClass =
    secondary.length === 2 ? 'today-secondary-row is-pair' : 'today-secondary-row';

  return (
    <div className="today-page">
      <header className="top-bar glass-panel today-header">
        <div className="top-bar-main">
          <div className="top-bar-copy">
            <h2>Today</h2>
            <p className="top-bar-context">What to focus on right now</p>
          </div>
        </div>
      </header>

      <HeroPriorityCard signal={hero} />

      {secondary.length > 0 && (
        <div className={secondaryClass}>
          {secondary.map((s, i) => (
            <SecondaryPriority key={`${s.type}-${i}`} signal={s} />
          ))}
        </div>
      )}

      {/* Context section */}
      <div className="today-context-section">
        <p className="today-context-label">Context</p>
        <div className="today-context-grid">
          <OperatingReserveCard
            currentCashBalance={model.runway.currentCashBalance}
            reserveTarget={model.runway.reserveTarget}
          />
          <OwnerDistributionsCard transactions={txns} />
        </div>
      </div>
    </div>
  );
}
