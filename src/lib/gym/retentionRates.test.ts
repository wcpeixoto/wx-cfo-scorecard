import { describe, expect, it } from 'vitest';
import { buildRetentionRateView } from './retentionRates';

// The shared known-base rate contract. Rates are ALWAYS over the attendance-known
// base; there is no full-base facet any more (recency-unknown is never a denominator).
// Self-check numbers come from the live snapshot (as_of 2026-06-11): attendance-known
// base 255 = active 408 − 153 unknown; at-risk 111; silent 76.

describe('buildRetentionRateView', () => {
  it('bases the known facet on the attendance-known denominator (AH at-risk 111/255)', () => {
    const v = buildRetentionRateView(111, 255, 153, 'attendance-known actives');
    expect(v.knownBase).toEqual({ count: 111, base: 255, rate: 111 / 255 });
    expect(v.unknown).toEqual({ count: 153, label: 'attendance-known actives' });
  });

  it('exposes no full-base facet (the include-in-rates capability is gone)', () => {
    const v = buildRetentionRateView(76, 255, 153, 'x');
    expect(v).not.toHaveProperty('fullBase');
    // Held-out count is disclosed, but never folded into a denominator.
    expect(v.unknown.count).toBe(153);
    expect(v.knownBase.base).toBe(255);
  });

  it('the silent share is the known rate only: 30% (76/255)', () => {
    const v = buildRetentionRateView(76, 255, 153, 'attendance-known actives');
    expect(Math.round(v.knownBase.rate! * 100)).toBe(30);
  });

  it('null rate when the base is 0 (render an em dash, never 0%)', () => {
    const v = buildRetentionRateView(0, 0, 0, 'x');
    expect(v.knownBase.rate).toBeNull();
  });

  it('the unknown count never affects the known-base numerator or denominator', () => {
    const withUnknown = buildRetentionRateView(40, 200, 153, 'x');
    const withoutUnknown = buildRetentionRateView(40, 200, 0, 'x');
    // Same known base + numerator regardless of how many unknowns are held out.
    expect(withUnknown.knownBase).toEqual(withoutUnknown.knownBase);
  });
});
