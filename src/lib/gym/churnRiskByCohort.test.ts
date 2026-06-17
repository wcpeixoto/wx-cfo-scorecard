import { describe, it, expect } from 'vitest';
import {
  SAMPLE_COHORT_HISTOGRAM,
  computeChurnRiskByCohortFromAggregate,
} from './churnRiskByCohort';
import { COHORT_BANDS, UNKNOWN_COHORT_ID } from './cohortBands';
import type { CohortHistogram } from './wodifyRetentionAggregate';

const T = 21; // default resolved threshold

function emptyHist(): CohortHistogram {
  const cohorts: CohortHistogram['cohorts'] = {};
  for (const b of COHORT_BANDS) {
    cohorts[b.id] = { active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 }, lapsed: 0 };
  }
  cohorts[UNKNOWN_COHORT_ID] = {
    active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
    lapsed: 0,
  };
  return {
    cohortEdges: COHORT_BANDS.map(({ id, minAge, maxAge }) => ({ id, minAge, maxAge })),
    cohorts,
  };
}

describe('computeChurnRiskByCohortFromAggregate', () => {
  it('derives per-cohort Healthy/Watch/Silent + at-risk rate at the threshold', () => {
    const h = emptyHist();
    // 3 healthy (day 2), 2 watch (day 10), 5 silent (day 30) at T=21, floor=8.
    h.cohorts.kids3to6.active.countsByDaysAbsent = { '2': 3, '10': 2, '30': 5 };
    const r = computeChurnRiskByCohortFromAggregate(h, T);
    const kids = r.bands.find((b) => b.id === 'kids3to6')!;
    expect(kids.activeTotal).toBe(10);
    expect(kids.watch).toBe(2);
    expect(kids.silent).toBe(5);
    expect(kids.atRisk).toBe(7);
    expect(kids.riskRate).toBeCloseTo(7 / 10);
  });

  it('holds out unknown-recency from the known base (Option B default)', () => {
    const h = emptyHist();
    h.cohorts.adults16plus.active = {
      countsByDaysAbsent: { '2': 8, '30': 2 },
      overflow365Plus: 0,
      unknownRecency: 5,
    };
    const r = computeChurnRiskByCohortFromAggregate(h, T);
    const adults = r.bands.find((b) => b.id === 'adults16plus')!;
    expect(adults.activeTotal).toBe(15); // 8 + 2 + 5 unknown-recency
    expect(adults.unknownRecency).toBe(5);
    expect(adults.knownActiveTotal).toBe(10);
    expect(adults.atRisk).toBe(2);
    expect(adults.riskRate).toBeCloseTo(2 / 15);
    expect(adults.riskRateKnown).toBeCloseTo(2 / 10);
  });

  it('carries lapsed (Read 2) through and sums lapsedTotal incl. the unknown cohort', () => {
    const h = emptyHist();
    h.cohorts.kids3to6.lapsed = 4;
    h.cohorts.adults16plus.lapsed = 30;
    h.cohorts.unknownCohort.lapsed = 2;
    const r = computeChurnRiskByCohortFromAggregate(h, T);
    expect(r.bands.find((b) => b.id === 'kids3to6')!.lapsed).toBe(4);
    expect(r.unknownCohort.lapsed).toBe(2);
    expect(r.lapsedTotal).toBe(36);
  });

  it('selects the hero by the highest at-risk rate', () => {
    const h = emptyHist();
    h.cohorts.kids3to6.active = { countsByDaysAbsent: { '2': 9, '30': 1 }, overflow365Plus: 0, unknownRecency: 0 }; // 10%
    h.cohorts.teens10to15.active = { countsByDaysAbsent: { '2': 5, '30': 5 }, overflow365Plus: 0, unknownRecency: 0 }; // 50%
    const r = computeChurnRiskByCohortFromAggregate(h, T);
    expect(r.heroBandId).toBe('teens10to15');
    expect(r.heroBandIdKnown).toBe('teens10to15');
  });

  it('returns null rates + null hero when there are no active members', () => {
    const r = computeChurnRiskByCohortFromAggregate(emptyHist(), T);
    expect(r.activeTotal).toBe(0);
    expect(r.heroBandId).toBeNull();
    expect(r.bands.every((b) => b.riskRate === null)).toBe(true);
  });

  it('renders the sample histogram coherently through the SAME adapter', () => {
    const r = computeChurnRiskByCohortFromAggregate(SAMPLE_COHORT_HISTOGRAM, T);
    expect(r.bands).toHaveLength(COHORT_BANDS.length);
    expect(r.activeTotal).toBeGreaterThan(0);
    expect(r.lapsedTotal).toBeGreaterThan(0);
  });
});
