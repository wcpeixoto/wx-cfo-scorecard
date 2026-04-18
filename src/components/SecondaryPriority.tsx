import type { Signal } from '../lib/priorities/types';
import { getFallbackCopy } from '../lib/priorities/copy';

interface SecondaryPriorityProps {
  signal: Signal;
}

function severityLabel(severity: Signal['severity']): string {
  switch (severity) {
    case 'critical': return 'Critical';
    case 'warning': return 'Watch';
    case 'healthy': return 'Healthy';
  }
}

export function SecondaryPriority({ signal }: SecondaryPriorityProps) {
  const copy = getFallbackCopy(signal);
  const supportingLine = copy.currentState.length <= copy.why.length ? copy.currentState : copy.why;

  return (
    <article className="today-secondary-card">
      <span className={`today-severity-pill is-${signal.severity}`}>
        <span className="today-severity-dot" aria-hidden="true" />
        {severityLabel(signal.severity)}
      </span>
      <h3 className="today-secondary-headline">{copy.headline}</h3>
      <p className="today-secondary-line">{supportingLine}</p>
    </article>
  );
}
