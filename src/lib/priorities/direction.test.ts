import { describe, it, expect } from 'vitest';
import type { Signal, PriorityHistoryRow } from './types';
import {
  classifyPriorDirection,
  computeMetricDirection,
} from './direction';

function cashFlowNeg(overrides: Partial<Signal> = {}): Signal {
  return {
    type: 'cash_flow_negative',
    severity: 'critical',
    weight: 1,
    metricValue: -14500,
    troughMonth: '2026-06',
    ...overrides,
  };
}

function expenseSurge(overrides: Partial<Signal> = {}): Signal {
  return {
    type: 'expense_surge',
    severity: 'warning',
    weight: 1,
    metricValue: 3200,
    categoryFlagged: 'Rent',
    ...overrides,
  };
}

function steadyState(overrides: Partial<Signal> = {}): Signal {
  return {
    type: 'steady_state',
    severity: 'healthy',
    weight: 1,
    ...overrides,
  };
}

function history(overrides: Partial<PriorityHistoryRow> = {}): PriorityHistoryRow {
  return {
    workspace_id: 'verify',
    fired_at: '2026-04-01T12:00:00Z',
    signal_type: 'cash_flow_negative',
    severity: 'critical',
    metric_value: -14500,
    ...overrides,
  };
}

describe('classifyPriorDirection — nullish handling', () => {
  it('returns p_none when priorHistory is undefined', () => {
    expect(classifyPriorDirection(cashFlowNeg(), undefined)).toBe('p_none');
  });

  it('returns p_none when priorHistory is null', () => {
    expect(classifyPriorDirection(cashFlowNeg(), null)).toBe('p_none');
  });

  it('returns p_none for steady_state when prior is null (overrides unchanged short-circuit)', () => {
    expect(classifyPriorDirection(steadyState(), null)).toBe('p_none');
    expect(classifyPriorDirection(steadyState(), undefined)).toBe('p_none');
  });
});

describe('classifyPriorDirection — five-token mapping', () => {
  it('maps improved → p_improved (cash_flow_negative, current > prior)', () => {
    // WORSE_WHEN_LOWER: now (-14500) > prior (-20000) means improvement
    expect(
      classifyPriorDirection(cashFlowNeg(), history({ metric_value: -20000 })),
    ).toBe('p_improved');
  });

  it('maps worsened → p_worsened (cash_flow_negative, current < prior)', () => {
    // WORSE_WHEN_LOWER: now (-14500) < prior (-10000) means worsening
    expect(
      classifyPriorDirection(cashFlowNeg(), history({ metric_value: -10000 })),
    ).toBe('p_worsened');
  });

  it('maps unchanged → p_unchanged when metric matches prior exactly', () => {
    expect(
      classifyPriorDirection(cashFlowNeg(), history({ metric_value: -14500 })),
    ).toBe('p_unchanged');
  });

  it('maps unknown → p_unknown when prior metric_value is missing', () => {
    expect(
      classifyPriorDirection(cashFlowNeg(), history({ metric_value: undefined })),
    ).toBe('p_unknown');
  });

  it('returns p_unchanged for steady_state when prior is present', () => {
    // steady_state short-circuits computeMetricDirection to 'unchanged'
    // when a prior exists; only nullish prior gets bumped to p_none.
    expect(
      classifyPriorDirection(
        steadyState(),
        history({ signal_type: 'steady_state', metric_value: undefined }),
      ),
    ).toBe('p_unchanged');
  });
});

describe('classifyPriorDirection — business normalization', () => {
  it('expense_surge with rising metric → p_worsened (higher = worse)', () => {
    expect(
      classifyPriorDirection(
        expenseSurge({ metricValue: 4000 }),
        history({ signal_type: 'expense_surge', metric_value: 3000 }),
      ),
    ).toBe('p_worsened');
  });

  it('expense_surge with falling metric → p_improved', () => {
    expect(
      classifyPriorDirection(
        expenseSurge({ metricValue: 2500 }),
        history({ signal_type: 'expense_surge', metric_value: 3000 }),
      ),
    ).toBe('p_improved');
  });

  it('cash_flow_negative with rising metric → p_improved (lower = worse)', () => {
    // -14500 → -10000 means cash floor rose (less negative): improvement.
    expect(
      classifyPriorDirection(
        cashFlowNeg({ metricValue: -10000 }),
        history({ metric_value: -14500 }),
      ),
    ).toBe('p_improved');
  });
});

describe('computeMetricDirection — re-export sanity', () => {
  it('returns unchanged for steady_state regardless of prior', () => {
    expect(computeMetricDirection(steadyState(), undefined)).toBe('unchanged');
    expect(computeMetricDirection(steadyState(), history())).toBe('unchanged');
  });

  it('returns unknown when priorHistory is missing for non-steady signal', () => {
    expect(computeMetricDirection(cashFlowNeg(), undefined)).toBe('unknown');
  });
});
