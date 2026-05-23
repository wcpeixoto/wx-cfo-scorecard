import { describe, it, expect } from 'vitest';
import { getWatchMetric } from './copy';
import type { Signal } from './types';
import type { DashboardModel } from '../data/contract';

function model(cash: number): DashboardModel {
  return { runway: { currentCashBalance: cash } } as unknown as DashboardModel;
}

const sig = (overrides: Partial<Signal> & Pick<Signal, 'type'>): Signal => ({
  severity: 'warning',
  weight: 0.5,
  ...overrides,
});

// getWatchMetric now serves the FRESH/awareness watch only. Committed-state
// progress ("$Y of $X") moved to commitmentTemplate (commitments/templater.ts);
// see templater.test.ts for those cases.
describe('getWatchMetric — fresh/awareness routing', () => {
  it('reserve_warning, fresh: the baseline-to-be', () => {
    const w = getWatchMetric(sig({ type: 'reserve_warning' }), model(6600));
    expect(w.label).toBe('Cash toward reserve');
    expect(w.value).toBe('starting at $6,600');
  });

  it('reserve_critical, fresh: the baseline-to-be (now commitment-ready, action-tied watch)', () => {
    const w = getWatchMetric(
      sig({ type: 'reserve_critical', severity: 'critical', metricValue: 0.46 }),
      model(6600)
    );
    expect(w.label).toBe('Cash toward reserve');
    expect(w.value).toBe('starting at $6,600');
  });

  it('steady_state shows Cash on Hand from the model', () => {
    const w = getWatchMetric(
      sig({ type: 'steady_state', severity: 'healthy', weight: 0 }),
      model(12345)
    );
    expect(w.label).toBe('Cash on Hand');
    expect(w.value).toBe('$12,345');
  });
});
