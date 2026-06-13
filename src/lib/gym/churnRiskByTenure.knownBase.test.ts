import { describe, expect, it } from 'vitest';
import { computeChurnRiskByTenureFromAggregate, UNKNOWN_TENURE_ID } from './churnRiskByTenure';
import type { TenureBandHistogram } from './wodifyRetentionAggregate';

// Option B "known-base rates" — reproduce the live snapshot (as_of 2026-06-11,
// T=21) per tenure band so the canonical change table is LOCKED. Each band's
// recency is encoded as day-0 (healthy), day-8 (watch), day-21 (silent) —
// precedence-exact at T=21 — plus its unknown-RECENCY count. Known base =
// activeTotal − unknownRecency.

function band(healthy: number, watch: number, silent: number, unknownRecency: number) {
  return {
    countsByDaysAbsent: { '0': healthy, '8': watch, '21': silent },
    overflow365Plus: 0,
    unknownRecency,
  };
}

const LIVE: TenureBandHistogram = {
  bandEdges: [
    { id: 'lt3m', minDays: 0 },
    { id: '3to6m', minDays: 90 },
    { id: '6to12m', minDays: 180 },
    { id: '1to2y', minDays: 365 },
    { id: '2yplus', minDays: 730 },
  ],
  bands: {
    lt3m: band(27, 10, 7, 31),
    '3to6m': band(18, 2, 10, 30),
    '6to12m': band(28, 5, 20, 40),
    '1to2y': band(22, 6, 19, 39),
    '2yplus': band(49, 12, 20, 13),
    [UNKNOWN_TENURE_ID]: band(0, 0, 0, 0),
  },
};

describe('Churn by Tenure — known-base rates (Option B, live 2026-06-11)', () => {
  const r = computeChurnRiskByTenureFromAggregate(LIVE, 21);
  const get = (id: string) => {
    const b = r.bands.find((x) => x.id === id);
    if (!b) throw new Error(`band ${id} missing`);
    return b;
  };

  it('full-base identities are preserved (Σ silent 76, Σ active 408, Σ unknownRecency 153)', () => {
    expect(r.bands.reduce((s, b) => s + b.silent, 0)).toBe(76);
    expect(r.bands.reduce((s, b) => s + b.activeTotal, 0)).toBe(408);
    expect(r.bands.reduce((s, b) => s + b.unknownRecency, 0)).toBe(153);
  });

  it('1to2y: full base 86 / known base 47, atRisk 25 unchanged → 29% full, 53% known', () => {
    const b = get('1to2y');
    expect(b.activeTotal).toBe(86);
    expect(b.unknownRecency).toBe(39);
    expect(b.knownActiveTotal).toBe(47);
    expect(b.atRisk).toBe(25);
    expect(b.riskRate).toBeCloseTo(25 / 86, 6);
    expect(b.riskRateKnown).toBeCloseTo(25 / 47, 6);
    expect(Math.round(b.riskRate! * 100)).toBe(29);
    expect(Math.round(b.riskRateKnown! * 100)).toBe(53);
  });

  it('every band: knownActiveTotal === activeTotal − unknownRecency; atRisk identical across bases', () => {
    for (const b of r.bands) {
      expect(b.knownActiveTotal).toBe(b.activeTotal - b.unknownRecency);
      // atRisk is the numerator — one value, the same in both bases by construction.
      expect(b.atRisk).toBe(b.watch + b.silent);
    }
  });

  it('the whole change table — known-base displayed rates per band', () => {
    const pct = (id: string) => Math.round(get(id).riskRateKnown! * 100);
    expect(pct('lt3m')).toBe(39); // 17/44
    expect(pct('3to6m')).toBe(40); // 12/30
    expect(pct('6to12m')).toBe(47); // 25/53
    expect(pct('1to2y')).toBe(53); // 25/47
    expect(pct('2yplus')).toBe(40); // 32/81
  });

  it('the hero FLIPS by base: 2yplus (34% full) → 1to2y (53% known)', () => {
    expect(r.heroBandId).toBe('2yplus');
    expect(r.heroBandIdKnown).toBe('1to2y');
    expect(Math.round(get('2yplus').riskRate! * 100)).toBe(34);
  });
});
