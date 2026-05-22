import { describe, it, expect } from 'vitest';
import { reserveWarningCommitment } from './reserveWarningCommitment';
import type { Signal } from '../priorities/types';
import type { DashboardModel } from '../data/contract';

function model(cash: number, reserveTarget: number): DashboardModel {
  return {
    monthlyRollups: [],
    runway: { currentCashBalance: cash, reserveTarget },
  } as unknown as DashboardModel;
}

const warning = (overrides: Partial<Signal> = {}): Signal => ({
  type: 'reserve_warning',
  severity: 'warning',
  weight: 0.7,
  metricValue: 0.66,
  targetValue: 1,
  gapAmount: 3400,
  ...overrides,
});

describe('reserveWarningCommitment generator', () => {
  it('builds a draft for reserve_warning', () => {
    const d = reserveWarningCommitment(warning(), model(6600, 10000));
    expect(d).not.toBeNull();
    expect(d!.signalType).toBe('reserve_warning');
    expect(d!.watchMetricId).toBe('reserve_cash_delta');
  });

  it('captures the cash balance as the watch baseline', () => {
    const d = reserveWarningCommitment(warning(), model(6600, 10000));
    expect(d!.baseline).toBe(6600);
  });

  it('uses the signal gap as context (ceiling), not the target', () => {
    const d = reserveWarningCommitment(warning({ gapAmount: 3400 }), model(6600, 10000));
    expect(d!.gapContext).toBe(3400);
  });

  it('falls back to reserveTarget − cash when gapAmount is absent', () => {
    const d = reserveWarningCommitment(warning({ gapAmount: undefined }), model(6600, 10000));
    expect(d!.gapContext).toBe(3400);
  });

  it('action is one line, denominated in the owner target', () => {
    const d = reserveWarningCommitment(warning(), model(6600, 10000));
    expect(d!.buildAction(500)).toBe('Move $500 into your operating reserve this week.');
  });

  it('returns null for any non-reserve_warning signal', () => {
    const d = reserveWarningCommitment(warning({ type: 'reserve_critical' }), model(6600, 10000));
    expect(d).toBeNull();
  });
});
