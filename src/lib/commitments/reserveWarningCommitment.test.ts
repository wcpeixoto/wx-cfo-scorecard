import { describe, it, expect } from 'vitest';
import { reserveWarningCommitment } from './reserveWarningCommitment';
import type { Signal } from '../priorities/types';
import type { DashboardModel, MonthlyRollup } from '../data/contract';

function model(cash: number, reserveTarget: number): DashboardModel {
  return {
    monthlyRollups: [],
    runway: { currentCashBalance: cash, reserveTarget },
  } as unknown as DashboardModel;
}

// `count` complete months (each < the current incomplete month, computed relative
// to today so grounding assertions stay date-stable), each with `net` operating
// netCashFlow.
function completeMonthsBeforeNow(count: number, net: number): MonthlyRollup[] {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth(); // 1-indexed value of the latest COMPLETE month (current − 1)
  const out: MonthlyRollup[] = [];
  for (let i = 0; i < count; i++) {
    if (m <= 0) {
      m += 12;
      y -= 1;
    }
    out.push({
      month: `${y}-${String(m).padStart(2, '0')}`,
      revenue: 0,
      expenses: 0,
      netCashFlow: net,
      savingsRate: 0,
      transactionCount: 0,
    });
    m -= 1;
  }
  return out;
}

// A model with enough operating-surplus history for target grounding to produce
// a number (status ok, percentFunded set, rollups provided).
function groundedModel(rollups: MonthlyRollup[]): DashboardModel {
  return {
    monthlyRollups: rollups,
    runway: { status: 'ok', percentFunded: 0.4, currentCashBalance: 4000, reserveTarget: 10000 },
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

const critical = (overrides: Partial<Signal> = {}): Signal => ({
  type: 'reserve_critical',
  severity: 'critical',
  weight: 1,
  metricValue: 0.4,
  targetValue: 1,
  gapAmount: 6000,
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

  it('returns null for a non-reserve signal', () => {
    const d = reserveWarningCommitment(warning({ type: 'cash_flow_negative' }), model(6600, 10000));
    expect(d).toBeNull();
  });

  it('builds a draft for reserve_critical with the same reserve grammar', () => {
    const d = reserveWarningCommitment(critical(), model(4000, 10000));
    expect(d).not.toBeNull();
    expect(d!.signalType).toBe('reserve_critical');
    expect(d!.watchMetricId).toBe('reserve_cash_delta');
    expect(d!.baseline).toBe(4000);
    expect(d!.gapContext).toBe(6000);
    expect(d!.buildAction(500)).toBe('Move $500 into your operating reserve this week.');
  });

  it('grounds the reserve_critical target when operating surplus supports it', () => {
    const d = reserveWarningCommitment(critical(), groundedModel(completeMonthsBeforeNow(6, 3000)));
    expect(d!.grounding.classification).toBe('grounded');
    expect(d!.grounding.recommended).toBeGreaterThanOrEqual(25);
  });

  it('routes the reserve_critical target to unknown (STOP) when history is insufficient', () => {
    const d = reserveWarningCommitment(critical(), model(4000, 10000)); // empty rollups
    expect(d!.grounding.classification).toBe('unknown');
  });
});
