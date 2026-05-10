import { describe, it, expect } from 'vitest';
import type { Signal, SignalType, Severity } from './types';
import {
  AI_PROSE_PROMPT_VERSION,
  buildPriorityProseCacheKey,
} from './cacheKey';
import type { PriorDirectionBucket } from './direction';

// Default direction bucket used by tests that aren't exercising the
// prior-history dimension. p_none mirrors the "no prior on record" case.
const NONE: PriorDirectionBucket = 'p_none';

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
  it('is "v2"', () => {
    expect(AI_PROSE_PROMPT_VERSION).toBe('v2');
  });
});

// ─── Stability ────────────────────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — stability', () => {
  it('same signal → same key', () => {
    const s = reserve();
    expect(buildPriorityProseCacheKey(s, NONE)).toBe(buildPriorityProseCacheKey(s, NONE));
  });

  it('two separately constructed identical signals → same key', () => {
    expect(buildPriorityProseCacheKey(reserve(), NONE)).toBe(
      buildPriorityProseCacheKey(reserve(), NONE)
    );
  });
});

// ─── Sensitivity ──────────────────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — sensitivity', () => {
  it('changing severity changes the key', () => {
    const a = reserve({ severity: 'warning' });
    const b = reserve({ severity: 'critical' });
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });

  it('changing signal type changes the key', () => {
    const a = reserve({ type: 'reserve_warning' });
    const b = reserve({ type: 'reserve_critical' });
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
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
        buildPriorityProseCacheKey(
          {
            type: t,
            severity: 'warning' as Severity,
            weight: 1,
          },
          NONE,
        )
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
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('ratios in adjacent 5% bands → different keys', () => {
    const a = reserve({ metricValue: 5499, targetValue: 10000 }); // 54.99% → 50 band
    const b = reserve({ metricValue: 5500, targetValue: 10000 }); // 55.00% → 55 band
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });

  it('exact band boundary floors down', () => {
    const onBoundary = reserve({ metricValue: 6000, targetValue: 10000 }); // 60.00%
    const justBelow = reserve({ metricValue: 5999, targetValue: 10000 }); // 59.99%
    expect(buildPriorityProseCacheKey(onBoundary, NONE)).not.toBe(
      buildPriorityProseCacheKey(justBelow, NONE)
    );
  });

  it('quantizes ratio AFTER division (same ratio from different metric/target → same key)', () => {
    const a = reserve({ metricValue: 5500, targetValue: 10000 }); // 0.55
    const b = reserve({ metricValue: 11000, targetValue: 20000 }); // 0.55
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('does not quantize numerator/denominator independently (sanity)', () => {
    // If numerator/denominator were each floored to $1K and then divided,
    // the two cases below would land in the same key. With ratio-first
    // quantization, they fall in different 5% bands.
    const a = reserve({ metricValue: 5500, targetValue: 10000 }); // 55%
    const b = reserve({ metricValue: 6000, targetValue: 11000 }); // 54.5% → 50 band
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });

  it('handles zero target gracefully (no NaN, no throw)', () => {
    const s = reserve({ metricValue: 5000, targetValue: 0 });
    expect(() => buildPriorityProseCacheKey(s, NONE)).not.toThrow();
    expect(buildPriorityProseCacheKey(s, NONE)).toContain('reserve_warning');
  });
});

// ─── Dollar bands ($1K) ───────────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — $1K dollar bands', () => {
  it('cash_flow_negative: same $1K band → same key', () => {
    const a = cashFlowNeg({ metricValue: 14091 });
    const b = cashFlowNeg({ metricValue: 14999 });
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('cash_flow_negative: adjacent $1K bands → different keys', () => {
    const a = cashFlowNeg({ metricValue: 13999 });
    const b = cashFlowNeg({ metricValue: 14000 });
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });

  it('cash_flow_negative: floors absolute value (sign-insensitive)', () => {
    const a = cashFlowNeg({ metricValue: -14091 });
    const b = cashFlowNeg({ metricValue: 14091 });
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('cash_flow_tight: $1K band on metricValue', () => {
    const a = cashFlowNeg({ type: 'cash_flow_tight', metricValue: 7200 });
    const b = cashFlowNeg({ type: 'cash_flow_tight', metricValue: 7999 });
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('expense_surge: $1K band on metricValue', () => {
    const a = expenseSurge({ metricValue: 3200 });
    const b = expenseSurge({ metricValue: 3999 });
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('revenue_decline: $1K band on metricValue', () => {
    const a = revenueDecline({ metricValue: 8200 });
    const b = revenueDecline({ metricValue: 8999 });
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('revenue_decline: adjacent bands differ', () => {
    const a = revenueDecline({ metricValue: 7999 });
    const b = revenueDecline({ metricValue: 8000 });
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });

  it('owner_distributions_high: $1K band on gapAmount', () => {
    const a = ownerDistHigh({ gapAmount: 2200 });
    const b = ownerDistHigh({ gapAmount: 2999 });
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('owner_distributions_high: adjacent bands differ', () => {
    const a = ownerDistHigh({ gapAmount: 1999 });
    const b = ownerDistHigh({ gapAmount: 2000 });
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });
});

// ─── Exact-value components ──────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — exact-value components', () => {
  it('cash_flow_negative: differing troughMonth → different keys', () => {
    const a = cashFlowNeg({ troughMonth: '2026-06' });
    const b = cashFlowNeg({ troughMonth: '2026-07' });
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });

  it('expense_surge: differing categoryFlagged → different keys', () => {
    const a = expenseSurge({ categoryFlagged: 'Rent' });
    const b = expenseSurge({ categoryFlagged: 'Insurance' });
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });
});

// ─── steady_state minimality ─────────────────────────────────────────────────

describe('buildPriorityProseCacheKey — steady_state minimality', () => {
  it('key does not depend on metric fields', () => {
    const a = steady({ metricValue: 100 });
    const b = steady({ metricValue: 9999, gapAmount: 500, targetValue: 1234 });
    expect(buildPriorityProseCacheKey(a, NONE)).toBe(buildPriorityProseCacheKey(b, NONE));
  });

  it('key still distinguishes severity', () => {
    const a = steady({ severity: 'healthy' });
    const b = steady({ severity: 'warning' });
    expect(buildPriorityProseCacheKey(a, NONE)).not.toBe(
      buildPriorityProseCacheKey(b, NONE)
    );
  });
});

// ─── Prior-direction dimension ───────────────────────────────────────────────

describe('buildPriorityProseCacheKey — prior-direction bucket', () => {
  const allBuckets: PriorDirectionBucket[] = [
    'p_none',
    'p_improved',
    'p_worsened',
    'p_unchanged',
    'p_unknown',
  ];

  it('identical signal + same bucket → same key', () => {
    const s = cashFlowNeg();
    expect(buildPriorityProseCacheKey(s, 'p_improved')).toBe(
      buildPriorityProseCacheKey(s, 'p_improved')
    );
  });

  it('identical signal + different buckets → different keys', () => {
    const s = cashFlowNeg();
    expect(buildPriorityProseCacheKey(s, 'p_improved')).not.toBe(
      buildPriorityProseCacheKey(s, 'p_worsened')
    );
  });

  it('all five buckets produce distinct keys for the same signal', () => {
    const s = cashFlowNeg();
    const keys = new Set(allBuckets.map((b) => buildPriorityProseCacheKey(s, b)));
    expect(keys.size).toBe(allBuckets.length);
  });

  it('bucket dimension applies to every SignalType (steady_state included)', () => {
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
    for (const t of types) {
      const s: Signal = { type: t, severity: 'warning', weight: 1 };
      expect(buildPriorityProseCacheKey(s, 'p_none')).not.toBe(
        buildPriorityProseCacheKey(s, 'p_improved')
      );
    }
  });

  it('bucket token is appended at end of key (not prefixed)', () => {
    const s = cashFlowNeg();
    expect(buildPriorityProseCacheKey(s, 'p_improved')).toMatch(/p_improved$/);
    expect(buildPriorityProseCacheKey(s, 'p_none')).toMatch(/p_none$/);
  });
});

// ─── Structural separator (SEP regression guard) ────────────────────────────

describe('buildPriorityProseCacheKey — separator structure', () => {
  it('separates key parts with ASCII Unit Separator (0x1f)', () => {
    // cashFlowNeg() defaults: type=cash_flow_negative, severity=critical,
    // metricValue=14091 (→ floored to 14000), troughMonth='2026-06'.
    // Bucket appended at end. Five parts total.
    const key = buildPriorityProseCacheKey(cashFlowNeg(), 'p_none');
    const parts = key.split('\x1f');

    // Positive: exact part-by-part match against current key construction.
    expect(parts).toEqual([
      'cash_flow_negative',
      'critical',
      'm14000',
      't2026-06',
      'p_none',
    ]);

    // Negative regression guard: an empty SEP would collapse the key into
    // a single concatenated string, so split('\x1f').length would be 1.
    // This explicit length assertion fails fast if SEP ever regresses to ''.
    expect(parts.length).toBe(5);
  });
});

// ─── Prompt-version invalidation regression ──────────────────────────────────

describe('AI_PROSE_PROMPT_VERSION — invalidation contract', () => {
  it('is exposed for use in the unique constraint (workspace_id, cache_key, prompt_version)', () => {
    // This value is what gets paired with the cache key on every write.
    // Bumping it invalidates all prior cached prose without colliding,
    // because the unique constraint includes prompt_version.
    expect(typeof AI_PROSE_PROMPT_VERSION).toBe('string');
    expect(AI_PROSE_PROMPT_VERSION.length).toBeGreaterThan(0);
  });
});
