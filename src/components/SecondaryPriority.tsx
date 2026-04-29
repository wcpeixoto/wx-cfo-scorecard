import type { Signal, SignalType } from '../lib/priorities/types';
import { getFallbackCopy } from '../lib/priorities/copy';

interface SecondaryPriorityProps {
  signal: Signal;
}

// Fallback for any future signal type not yet in the map
function severityLabel(severity: Signal['severity']): string {
  switch (severity) {
    case 'critical': return 'Needs attention';
    case 'warning': return 'Watch';
    case 'healthy': return 'Healthy';
  }
}

const signalLabel: Record<SignalType, string> = {
  reserve_critical:          'Reserve',
  reserve_warning:           'Reserve',
  cash_flow_negative:        'Cash Flow',
  cash_flow_tight:           'Cash Flow',
  expense_surge:             'Expenses',
  revenue_decline:           'Revenue',
  owner_distributions_high:  'Owner Draws',
  steady_state:              'On Track',
};

export function SecondaryPriority({ signal }: SecondaryPriorityProps) {
  const copy = getFallbackCopy(signal);
  const supportingLine = copy.currentState.length <= copy.why.length ? copy.currentState : copy.why;

  return (
    <article className="today-secondary-card">
      <span className={`today-severity-pill is-${signal.severity}`}>
        <span className="today-severity-dot" aria-hidden="true" />
        {signalLabel[signal.type] ?? severityLabel(signal.severity)}
      </span>
      <h3 className="today-secondary-headline">{copy.headline}</h3>
      <p className="today-secondary-line">{supportingLine}</p>
    </article>
  );
}
