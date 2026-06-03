import { describe, expect, it } from 'vitest';
import { FIXTURE_TODAY, SAMPLE_GYM_MEMBERS, type GymMember } from './memberFixture';
import {
  computeAttendanceHealth,
  computeSilentChurn,
  resolveSilentChurnThresholdDays,
} from './silentChurn';
import { TENURE_BANDS, computeChurnRiskByTenure } from './churnRiskByTenure';

// Churn Risk by Tenure re-partitions the SAME active/at-risk population as the
// Silent Churn and Attendance Health cards (it reuses classifyMember), this time
// sliced by tenure band. These tests lock (1) the verified fixture bands, (2) the
// integrity invariant that no active member is dropped, and (3) the anti-drift
// cross-check that the silent slices still sum to the Silent Churn count.

const ACTIVE_TOTAL = SAMPLE_GYM_MEMBERS.filter((m) => m.status === 'active').length;

// Convenience: look a band up by id within a result.
function band(result: ReturnType<typeof computeChurnRiskByTenure>, id: string) {
  const found = result.bands.find((b) => b.id === id);
  if (!found) throw new Error(`band ${id} missing from result`);
  return found;
}

describe('computeChurnRiskByTenure', () => {
  it('returns one band per TENURE_BANDS entry, in band order', () => {
    const r = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY);
    expect(r.bands.map((b) => b.id)).toEqual(TENURE_BANDS.map((b) => b.id));
  });

  it('matches the verified fixture bands at the default threshold (T=21)', () => {
    const r = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY);
    expect(r.thresholdDays).toBe(21);
    expect(r.activeTotal).toBe(20);

    // Every active member in the sample is >= 1 year tenured, so the three
    // shortest bands are empty by data (not a bug) and report a null rate.
    for (const id of ['lt3m', '3to6m', '6to12m']) {
      expect(band(r, id)).toMatchObject({ activeTotal: 0, watch: 0, silent: 0, atRisk: 0, riskRate: null });
    }

    // 1–2 yr: 7 active (2 watch + 2 silent at risk).
    expect(band(r, '1to2y')).toMatchObject({ activeTotal: 7, watch: 2, silent: 2, atRisk: 4 });
    expect(band(r, '1to2y').riskRate).toBeCloseTo(4 / 7, 10);

    // 2 yr+: 13 active (3 watch + 4 silent at risk).
    expect(band(r, '2yplus')).toMatchObject({ activeTotal: 13, watch: 3, silent: 4, atRisk: 7 });
    expect(band(r, '2yplus').riskRate).toBeCloseTo(7 / 13, 10);
  });

  it('picks the highest-risk-rate band as the hero (1–2 yr edges out 2 yr+ at T=21)', () => {
    const r = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY);
    expect(r.heroBandId).toBe('1to2y');
    // The hero genuinely has the higher rate, not just the higher count.
    expect(band(r, '1to2y').riskRate!).toBeGreaterThan(band(r, '2yplus').riskRate!);
    expect(band(r, '1to2y').atRisk).toBeLessThan(band(r, '2yplus').atRisk);
  });

  it('never picks an empty band as the hero, and reports null hero when there are no active members', () => {
    const r = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY);
    expect(band(r, r.heroBandId!).activeTotal).toBeGreaterThan(0);

    const noneActive = SAMPLE_GYM_MEMBERS.filter((m) => m.status !== 'active');
    const empty = computeChurnRiskByTenure(noneActive, 21, FIXTURE_TODAY);
    expect(empty.activeTotal).toBe(0);
    expect(empty.heroBandId).toBeNull();
    expect(empty.bands.every((b) => b.riskRate === null)).toBe(true);
  });

  it('uses the RESOLVED threshold for the risk split (raw 500 → 365, raw 0 → 21)', () => {
    const clamped = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 500, FIXTURE_TODAY);
    expect(clamped.thresholdDays).toBe(365);
    expect(clamped).toEqual(computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 365, FIXTURE_TODAY));

    const fallback = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 0, FIXTURE_TODAY);
    expect(fallback.thresholdDays).toBe(resolveSilentChurnThresholdDays(0)); // 21
    expect(fallback).toEqual(computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY));
  });
});

describe('integrity invariant', () => {
  it('Σ band active totals === total active members, across a threshold sweep', () => {
    // Tenure-band membership is threshold-independent; the risk split inside each
    // band moves with the threshold, but no active member may be dropped.
    for (let t = 1; t <= 365; t++) {
      const r = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, t, FIXTURE_TODAY);
      const summed = r.bands.reduce((sum, b) => sum + b.activeTotal, 0);
      expect(summed).toBe(r.activeTotal);
      expect(r.activeTotal).toBe(ACTIVE_TOTAL);
      // atRisk is always watch + silent, and never exceeds the band's active total.
      for (const b of r.bands) {
        expect(b.atRisk).toBe(b.watch + b.silent);
        expect(b.atRisk).toBeLessThanOrEqual(b.activeTotal);
      }
    }
  });

  it('leaves an active member with an unparseable membershipStart unbanded (not in fixture)', () => {
    const withBadStart: GymMember[] = [
      ...SAMPLE_GYM_MEMBERS,
      {
        id: 'bad-start',
        displayName: 'No Start',
        status: 'active',
        monthlyDues: 100,
        membershipStart: 'not-a-date',
        lastCheckIn: '2026-06-02',
      },
    ];
    const r = computeChurnRiskByTenure(withBadStart, 21, FIXTURE_TODAY);
    // The bad-start member is excluded from every band, so the totals are unchanged.
    expect(r.activeTotal).toBe(ACTIVE_TOTAL);
    expect(r.bands.reduce((sum, b) => sum + b.activeTotal, 0)).toBe(ACTIVE_TOTAL);
  });
});

describe('cross-check with Silent Churn / Attendance Health (anti-drift guard)', () => {
  it('Σ band silent === computeSilentChurn count at every threshold', () => {
    for (const t of [1, 8, 14, 21, 30, 90, 365, 500]) {
      const tenure = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, t, FIXTURE_TODAY);
      const churn = computeSilentChurn(SAMPLE_GYM_MEMBERS, t, FIXTURE_TODAY);
      const summedSilent = tenure.bands.reduce((sum, b) => sum + b.silent, 0);
      expect(summedSilent).toBe(churn.count);
      expect(tenure.thresholdDays).toBe(churn.thresholdDays);
    }
  });

  it('Σ band watch === Attendance Health watch count at every threshold', () => {
    for (const t of [1, 8, 14, 21, 30, 90, 365, 500]) {
      const tenure = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, t, FIXTURE_TODAY);
      const health = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, t, FIXTURE_TODAY);
      const summedWatch = tenure.bands.reduce((sum, b) => sum + b.watch, 0);
      const summedAtRisk = tenure.bands.reduce((sum, b) => sum + b.atRisk, 0);
      expect(summedWatch).toBe(health.watch);
      expect(summedAtRisk).toBe(health.watch + health.silent);
    }
  });
});
