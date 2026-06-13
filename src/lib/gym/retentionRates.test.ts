import { describe, expect, it } from 'vitest';
import { buildRetentionRateView, pickRateFacet } from './retentionRates';

// The shared known-base rate contract (Option B). Self-check numbers come from the
// live snapshot (as_of 2026-06-11): attendance-known base 255 = active 408 − 153
// unknown; at-risk 111; silent 76.

describe('buildRetentionRateView', () => {
  it('bases the known facet on the attendance-known denominator (AH at-risk 111/255)', () => {
    const v = buildRetentionRateView(111, 255, 153, 'attendance-known actives');
    expect(v.knownBase).toEqual({ count: 111, base: 255, rate: 111 / 255 });
    expect(v.fullBase).toEqual({ count: 111, base: 408, rate: 111 / 408 });
    expect(v.unknown).toEqual({
      count: 153,
      label: 'attendance-known actives',
      affordance: 'include',
    });
  });

  it('rebases the silent share: 30% known (76/255) vs 19% full (76/408)', () => {
    const v = buildRetentionRateView(76, 255, 153, 'attendance-known actives');
    expect(Math.round(v.knownBase.rate! * 100)).toBe(30);
    expect(Math.round(v.fullBase.rate! * 100)).toBe(19);
  });

  it('pickRateFacet defaults OFF to the known base, ON to the full base', () => {
    const v = buildRetentionRateView(76, 255, 153, 'x');
    expect(pickRateFacet(v, false)).toBe(v.knownBase);
    expect(pickRateFacet(v, true)).toBe(v.fullBase);
  });

  it('null rate when the base is 0 (render an em dash, never 0%)', () => {
    const v = buildRetentionRateView(0, 0, 0, 'x');
    expect(v.knownBase.rate).toBeNull();
    expect(v.fullBase.rate).toBeNull();
  });

  it('the numerator (count) is IDENTICAL across both facets — the toggle never reclassifies', () => {
    const v = buildRetentionRateView(76, 255, 153, 'x');
    expect(v.knownBase.count).toBe(76);
    expect(v.fullBase.count).toBe(76);
  });

  it('with zero unknown, known base === full base (clean-data no-op)', () => {
    const v = buildRetentionRateView(40, 200, 0, 'x');
    expect(v.knownBase).toEqual(v.fullBase);
  });
});
