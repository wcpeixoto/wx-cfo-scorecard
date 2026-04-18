import type { Signal, SignalType, Severity, RankedPriorities } from './types';

const LADDER: SignalType[] = [
  'reserve_critical',
  'cash_flow_negative',
  'reserve_warning',
  'cash_flow_tight',
  'expense_surge',
  'revenue_decline',
  'owner_distributions_high',
];

const STEADY_STATE_FALLBACK: Signal = {
  type: 'steady_state',
  severity: 'healthy' as Severity,
  weight: 0,
};

export function rankPriorities(signals: Signal[]): RankedPriorities {
  const active = signals.filter(s => s.type !== 'steady_state');

  if (active.length === 0) {
    const steadyState = signals.find(s => s.type === 'steady_state') ?? STEADY_STATE_FALLBACK;
    return { hero: steadyState, secondary: [] };
  }

  const ranked = [...active].sort((a, b) => {
    const posA = LADDER.indexOf(a.type);
    const posB = LADDER.indexOf(b.type);
    return (posA === -1 ? Infinity : posA) - (posB === -1 ? Infinity : posB);
  });

  return {
    hero: ranked[0],
    secondary: ranked.slice(1, 3),
  };
}
