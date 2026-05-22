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

describe('getWatchMetric — Phase 2.5 registry routing', () => {
  it('reserve_warning, fresh (no commitment): the baseline-to-be', () => {
    const w = getWatchMetric(sig({ type: 'reserve_warning' }), model(6600), null);
    expect(w.label).toBe('Cash toward reserve');
    expect(w.value).toBe('starting at $6,600');
  });

  it('reserve_warning, committed: progress "$Y of $X" (positive)', () => {
    const w = getWatchMetric(
      sig({ type: 'reserve_warning' }),
      model(7100),
      { baseline: 6600, target: 3400 }
    );
    expect(w.label).toBe('Cash toward reserve');
    expect(w.value).toBe('$500 of $3,400');
  });

  it('reserve_warning, committed: reads honestly when cash fell (negative)', () => {
    const w = getWatchMetric(
      sig({ type: 'reserve_warning' }),
      model(6000),
      { baseline: 6600, target: 3400 }
    );
    expect(w.value).toBe('-$600 of $3,400');
  });

  it('reserve_critical stays awareness-only (portfolio % in Watch)', () => {
    const w = getWatchMetric(
      sig({ type: 'reserve_critical', severity: 'critical', metricValue: 0.46 }),
      model(6600),
      null
    );
    expect(w.label).toBe('Reserve funded');
    expect(w.value).toBe('46%');
  });

  it('steady_state shows Cash on Hand from the model', () => {
    const w = getWatchMetric(
      sig({ type: 'steady_state', severity: 'healthy', weight: 0 }),
      model(12345),
      null
    );
    expect(w.label).toBe('Cash on Hand');
    expect(w.value).toBe('$12,345');
  });
});
