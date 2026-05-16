import type { Signal, SignalType } from '../lib/priorities/types';
import { getFallbackCopy } from '../lib/priorities/copy';

interface SecondaryPriorityProps {
  signal: Signal;
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
      <div className="today-secondary-header">
        <h3 className="today-secondary-headline">{copy.headline}</h3>
        <span className={`card-domain-tag is-${signal.severity}`}>
          {signalLabel[signal.type]}
        </span>
      </div>
      <p className="today-secondary-line">{supportingLine}</p>
    </article>
  );
}
