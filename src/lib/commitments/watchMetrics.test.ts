import { describe, it, expect } from 'vitest';
import { WATCH_METRICS, watchMetricForSignal } from './watchMetrics';
import type { DashboardModel } from '../data/contract';

function modelWithCash(cash: number): DashboardModel {
  return { runway: { currentCashBalance: cash } } as unknown as DashboardModel;
}

describe('watch metric registry', () => {
  it('reserve_warning maps to reserve_cash_delta', () => {
    expect(watchMetricForSignal('reserve_warning')?.id).toBe('reserve_cash_delta');
  });

  it('awareness-only types map to no watch metric', () => {
    expect(watchMetricForSignal('reserve_critical')).toBeNull();
    expect(watchMetricForSignal('steady_state')).toBeNull();
    expect(watchMetricForSignal('expense_surge')).toBeNull();
  });

  it('baseline and current read the same quantity (agree by construction)', () => {
    const m = modelWithCash(12345);
    const spec = WATCH_METRICS.reserve_cash_delta;
    expect(spec.captureBaseline(m)).toBe(12345);
    expect(spec.computeCurrent(m)).toBe(12345);
    expect(spec.captureBaseline(m)).toBe(spec.computeCurrent(m));
  });

  it('progress is the cash delta from baseline (can be negative)', () => {
    const spec = WATCH_METRICS.reserve_cash_delta;
    const baseline = spec.captureBaseline(modelWithCash(10000));
    expect(spec.computeCurrent(modelWithCash(10500)) - baseline).toBe(500);
    expect(spec.computeCurrent(modelWithCash(9000)) - baseline).toBe(-1000);
  });
});
