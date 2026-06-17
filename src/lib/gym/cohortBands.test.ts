import { describe, it, expect } from 'vitest';
import { COHORT_BANDS, UNKNOWN_COHORT_ID, ageYearsAsOf, cohortForAge } from './cohortBands';

describe('cohortForAge (inclusive [minAge, maxAge] windows, §2 boundaries)', () => {
  it('routes boundary ages to the right cohort', () => {
    expect(cohortForAge(1)?.id).toBe('kids3to6'); // under-3 folded into the youngest band
    expect(cohortForAge(6)?.id).toBe('kids3to6');
    expect(cohortForAge(7)?.id).toBe('kids7to9');
    expect(cohortForAge(9)?.id).toBe('kids7to9');
    expect(cohortForAge(10)?.id).toBe('teens10to15');
    expect(cohortForAge(15)?.id).toBe('teens10to15');
    expect(cohortForAge(16)?.id).toBe('adults16plus');
    expect(cohortForAge(120)?.id).toBe('adults16plus');
  });

  it('routes sentinel / outlier ages to null (→ unknown cohort), never Kids or Adults', () => {
    expect(cohortForAge(0)).toBeNull(); // age 0 is a sentinel, never silently Kids
    expect(cohortForAge(-5)).toBeNull();
    expect(cohortForAge(121)).toBeNull(); // just above the 120 data-sanity ceiling
    expect(cohortForAge(126)).toBeNull(); // the live 1900-01-01-derived outlier age
    expect(cohortForAge(Number.NaN)).toBeNull();
    expect(cohortForAge(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('bands are non-overlapping, ascending, and start at age 1', () => {
    expect(COHORT_BANDS[0].minAge).toBe(1);
    for (let i = 1; i < COHORT_BANDS.length; i++) {
      expect(COHORT_BANDS[i].minAge).toBe(COHORT_BANDS[i - 1].maxAge + 1);
    }
    expect(UNKNOWN_COHORT_ID).toBe('unknownCohort');
  });
});

describe('ageYearsAsOf (birthday-accurate whole years)', () => {
  it('computes whole-year age as-of the reference day', () => {
    expect(ageYearsAsOf('2010-01-01', '2026-06-17')).toBe(16); // birthday already passed
    expect(ageYearsAsOf('2010-06-17', '2026-06-17')).toBe(16); // birthday is today
    expect(ageYearsAsOf('2010-06-18', '2026-06-17')).toBe(15); // day before birthday
    expect(ageYearsAsOf('2010-12-31', '2026-06-17')).toBe(15); // birthday later this year
  });

  it('handles leap-day births without drift', () => {
    expect(ageYearsAsOf('2008-02-29', '2026-02-28')).toBe(17); // day before the "birthday"
    expect(ageYearsAsOf('2008-02-29', '2026-03-01')).toBe(18);
  });

  it('returns null on an empty / unparseable date (→ unknown cohort upstream)', () => {
    expect(ageYearsAsOf('', '2026-06-17')).toBeNull();
    expect(ageYearsAsOf('not-a-date', '2026-06-17')).toBeNull();
    expect(ageYearsAsOf('2010-06-17', '')).toBeNull();
  });
});
