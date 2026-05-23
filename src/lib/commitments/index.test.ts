import { describe, it, expect } from 'vitest';
import { commitmentFromSignal } from './index';
import type { Signal, SignalType } from '../priorities/types';
import type { DashboardModel } from '../data/contract';

const model = {
  monthlyRollups: [],
  runway: { currentCashBalance: 6600, reserveTarget: 10000 },
} as unknown as DashboardModel;

const sig = (type: SignalType): Signal => ({
  type,
  severity: 'warning',
  weight: 0.5,
  gapAmount: 3400,
});

describe('commitmentFromSignal factory (STOP rule)', () => {
  it('returns a draft for the reserve-funding signals', () => {
    expect(commitmentFromSignal(sig('reserve_warning'), model)).not.toBeNull();
    expect(commitmentFromSignal(sig('reserve_critical'), model)).not.toBeNull();
  });

  it('returns null for every awareness-only signal type', () => {
    const others: SignalType[] = [
      'cash_flow_negative',
      'cash_flow_tight',
      'expense_surge',
      'revenue_decline',
      'owner_distributions_high',
      'steady_state',
    ];
    for (const t of others) {
      expect(commitmentFromSignal(sig(t), model)).toBeNull();
    }
  });
});
