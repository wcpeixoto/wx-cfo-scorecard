// SecondaryPrioritiesLab — UI Lab home for the ranked secondary-priority
// cards (Cash Flow / Revenue / etc.). These used to render on the Today
// page; they were moved here. Same signal → rank → render pipeline as the
// Today page used, wired to live data.

import { useMemo } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import type { SignalType } from '../lib/priorities/types';
import { SecondaryPriority } from './SecondaryPriority';

// Signals intentionally not surfaced as their own priority cards
// (preserved from the Today pipeline).
const SUPPRESSED_PRIORITY_SIGNALS = new Set<SignalType>([
  'reserve_critical',
  'cash_flow_negative',
  'expense_surge',
]);

interface SecondaryPrioritiesLabProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
}

export function SecondaryPrioritiesLab({
  model,
  txns,
  forecastProjection,
}: SecondaryPrioritiesLabProps) {
  const signals = useMemo(
    () => detectSignals(model, txns, forecastProjection),
    [model, txns, forecastProjection]
  );
  const { secondary } = useMemo(
    () => rankPriorities(signals.filter((s) => !SUPPRESSED_PRIORITY_SIGNALS.has(s.type))),
    [signals]
  );

  if (secondary.length === 0) {
    return (
      <p className="ui-lab-section-subtitle">
        No secondary priorities for the current data.
      </p>
    );
  }

  const secondaryClass =
    secondary.length === 2 ? 'today-secondary-row is-pair' : 'today-secondary-row';

  return (
    <div className={secondaryClass}>
      {secondary.map((s, i) => (
        <SecondaryPriority key={`${s.type}-${i}`} signal={s} />
      ))}
    </div>
  );
}
