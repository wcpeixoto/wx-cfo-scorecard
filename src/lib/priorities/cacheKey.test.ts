import { describe, it, expect } from 'vitest';
import type { Signal, SignalType, Severity } from './types';
import {
  AI_PROSE_PROMPT_VERSION,
  buildPriorityProseCacheKey,
} from './cacheKey';

// Builder helpers. Defaults give a valid signal of each type; tests
// override only the fields they care about.
function reserve(overrides: Partial<Signal> = {}): Signal {
  return {
    type: 'reserve_warning',
    severity: 'warning',
    weight: 1,
    metricValue: 5500,
    targetValue: 10000,
    ...overrides,
  };
}

function cashFlowNeg(overrides: Partial<Signal> = {}): Signal {
  return {
    type: 'cash_flow_negative',
    severity: 'critical',
    weight: 1,
    metricValue: 14091,
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

function revenueDecline(overrides: Partial<Signal> = {}): Signal {
  return {
    type: 'revenue_decline',
    severity: 'warning',
    weight: 1,
    metricValue: 8200,
    ...overrides,
  };
}

function ownerDistHigh(overrides: Partial<Signal> = {}): Signal {
  return {
    type: 'owner_distributions_high',
    severity: 'warning',
    weight: 1,
    gapAmount: 2200,
    ...overrides,
  };
}

function steady(overrides: Partial<Signal> = {}): Signal {
  return {
    type: 'steady_state',
    severity: 'healthy',
    weight: 1,
    ...overrides,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('AI_PROSE_PROMPT_VERSION', () => {
  it('is "v1"', () => {
    expect(AI_PROSE_PROMPT_VERSION).toBe('v1');
  });
});

// ─── Stability ────────────────────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — stability', () => {
  it('same signal → same key', () => {
    const s = reserve();
    expect(buildPriorityProseCacheKey(s)).toBe(buildPriorityProseCacheKey(s));
  });

  it('two separately constructed identical signals → same key', () => {
    expect(buildPriorityProseCacheKey(reserve())).toBe(
      buildPriorityProseCacheKey(reserve())
    );
  });
});

// ─── Sensitivity ──────────────────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — sensitivity', () => {
  it('changing severity changes the key', () => {
    const a = reserve({ severity: 'warning' });
    const b = reserve({ severity: 'critical' });
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });

  it('changing signal type changes the key', () => {
    const a = reserve({ type: 'reserve_warning' });
    const b = reserve({ type: 'reserve_critical' });
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });

  it('every SignalType produces a distinct key from every other (severity/metric controlled)', () => {
    const types: SignalType[] = [
      'reserve_critical',
      'reserve_warning',
      'cash_flow_negative',
      'cash_flow_tight',
      'expense_surge',
      'revenue_decline',
      'owner_distributions_high',
      'steady_state',
    ];
    const keys = new Set(
      types.map((t) =>
        buildPriorityProseCacheKey({
          type: t,
          severity: 'warning' as Severity,
          weight: 1,
        })
      )
    );
    expect(keys.size).toBe(types.length);
  });
});

// ─── Reserve ratio: 5% bands, computed after division ────────────────────────

describe('buildPriorityProseCacheKey — reserve ratio 5% band', () => {
  it('ratios in same 5% band → same key (55% band)', () => {
    const a = reserve({ metricValue: 5500, targetValue: 10000 }); // 55.00%
    const b = reserve({ metricValue: 5999, targetValue: 10000 }); // 59.99%
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('ratios in adjacent 5% bands → different keys', () => {
    const a = reserve({ metricValue: 5499, targetValue: 10000 }); // 54.99% → 50 band
    const b = reserve({ metricValue: 5500, targetValue: 10000 }); // 55.00% → 55 band
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });

  it('exact band boundary floors down', () => {
    const onBoundary = reserve({ metricValue: 6000, targetValue: 10000 }); // 60.00%
    const justBelow = reserve({ metricValue: 5999, targetValue: 10000 }); // 59.99%
    expect(buildPriorityProseCacheKey(onBoundary)).not.toBe(
      buildPriorityProseCacheKey(justBelow)
    );
  });

  it('quantizes ratio AFTER division (same ratio from different metric/target → same key)', () => {
    const a = reserve({ metricValue: 5500, targetValue: 10000 }); // 0.55
    const b = reserve({ metricValue: 11000, targetValue: 20000 }); // 0.55
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('does not quantize numerator/denominator independently (sanity)', () => {
    // If numerator/denominator were each floored to $1K and then divided,
    // the two cases below would land in the same key. With ratio-first
    // quantization, they fall in different 5% bands.
    const a = reserve({ metricValue: 5500, targetValue: 10000 }); // 55%
    const b = reserve({ metricValue: 6000, targetValue: 11000 }); // 54.5% → 50 band
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });

  it('handles zero target gracefully (no NaN, no throw)', () => {
    const s = reserve({ metricValue: 5000, targetValue: 0 });
    expect(() => buildPriorityProseCacheKey(s)).not.toThrow();
    expect(buildPriorityProseCacheKey(s)).toContain('reserve_warning');
  });
});

// ─── Dollar bands ($1K) ───────────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — $1K dollar bands', () => {
  it('cash_flow_negative: same $1K band → same key', () => {
    const a = cashFlowNeg({ metricValue: 14091 });
    const b = cashFlowNeg({ metricValue: 14999 });
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('cash_flow_negative: adjacent $1K bands → different keys', () => {
    const a = cashFlowNeg({ metricValue: 13999 });
    const b = cashFlowNeg({ metricValue: 14000 });
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });

  it('cash_flow_negative: floors absolute value (sign-insensitive)', () => {
    const a = cashFlowNeg({ metricValue: -14091 });
    const b = cashFlowNeg({ metricValue: 14091 });
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('cash_flow_tight: $1K band on metricValue', () => {
    const a = cashFlowNeg({ type: 'cash_flow_tight', metricValue: 7200 });
    const b = cashFlowNeg({ type: 'cash_flow_tight', metricValue: 7999 });
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('expense_surge: $1K band on metricValue', () => {
    const a = expenseSurge({ metricValue: 3200 });
    const b = expenseSurge({ metricValue: 3999 });
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('revenue_decline: $1K band on metricValue', () => {
    const a = revenueDecline({ metricValue: 8200 });
    const b = revenueDecline({ metricValue: 8999 });
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('revenue_decline: adjacent bands differ', () => {
    const a = revenueDecline({ metricValue: 7999 });
    const b = revenueDecline({ metricValue: 8000 });
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });

  it('owner_distributions_high: $1K band on gapAmount', () => {
    const a = ownerDistHigh({ gapAmount: 2200 });
    const b = ownerDistHigh({ gapAmount: 2999 });
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('owner_distributions_high: adjacent bands differ', () => {
    const a = ownerDistHigh({ gapAmount: 1999 });
    const b = ownerDistHigh({ gapAmount: 2000 });
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });
});

// ─── Exact-value components ──────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — exact-value components', () => {
  it('cash_flow_negative: differing troughMonth → different keys', () => {
    const a = cashFlowNeg({ troughMonth: '2026-06' });
    const b = cashFlowNeg({ troughMonth: '2026-07' });
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });

  it('expense_surge: differing categoryFlagged → different keys', () => {
    const a = expenseSurge({ categoryFlagged: 'Rent' });
    const b = expenseSurge({ categoryFlagged: 'Insurance' });
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });
});

// ─── steady_state minimality ─────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — steady_state minimality', () => {
  it('key does not depend on metric fields', () => {
    const a = steady({ metricValue: 100 });
    const b = steady({ metricValue: 9999, gapAmount: 500, targetValue: 1234 });
    expect(buildPriorityProseCacheKey(a)).toBe(buildPriorityProseCacheKey(b));
  });

  it('key still distinguishes severity', () => {
    const a = steady({ severity: 'healthy' });
    const b = steady({ severity: 'warning' });
    expect(buildPriorityProseCacheKey(a)).not.toBe(
      buildPriorityProseCacheKey(b)
    );
  });
});
