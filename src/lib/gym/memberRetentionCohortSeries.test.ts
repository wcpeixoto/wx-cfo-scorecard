import { describe, expect, it } from 'vitest';

import type { CohortRetentionRow } from './fetchMemberRetentionByCohort';
import { buildCohortOverlay } from './memberRetentionCohortSeries';
import { churnPctOf } from './memberRetentionSeries';

// Helpers — published (non-suppressed) and suppressed cohort rows.
function pub(
  periodMonth: string,
  cohortBand: string,
  returning: number,
  lost: number,
  gained = 0,
): CohortRetentionRow {
  return {
    periodMonth,
    cohortBand,
    newMembers: gained,
    returningMembers: returning,
    lostMembers: lost,
    suppressed: false,
  };
}

function suppressed(periodMonth: string, cohortBand: string): CohortRetentionRow {
  return {
    periodMonth,
    cohortBand,
    newMembers: null,
    returningMembers: null,
    lostMembers: null,
    suppressed: true,
  };
}

describe('buildCohortOverlay — axis projection', () => {
  const axis = ['2025-07', '2025-08', '2025-09'];
  const rows: CohortRetentionRow[] = [
    pub('2025-07', 'youth3to15', 40, 4, 5),
    pub('2025-07', 'adults16plus', 100, 10, 8),
    pub('2025-08', 'youth3to15', 42, 3, 2),
    pub('2025-08', 'adults16plus', 102, 12, 6),
    pub('2025-09', 'youth3to15', 41, 5, 3),
    pub('2025-09', 'adults16plus', 99, 9, 7),
    // A band the overlay must IGNORE (unknown-age, excluded from segment lines).
    pub('2025-07', 'unknownCohort', 0, 0, 0),
  ];

  it('aligns each band 1:1 to the axis months, in order', () => {
    const o = buildCohortOverlay(axis, rows);
    expect(o.youth).toHaveLength(3);
    expect(o.adults).toHaveLength(3);
    expect(o.youth.map((p) => p?.periodMonth)).toEqual(['2025-07', '2025-08', '2025-09']);
    expect(o.adults.map((p) => p?.periodMonth)).toEqual(['2025-07', '2025-08', '2025-09']);
  });

  it('derives priorMembers = returning + lost and a count-based retentionPct', () => {
    const o = buildCohortOverlay(axis, rows);
    const youthJul = o.youth[0]!;
    expect(youthJul.priorMembers).toBe(44); // 40 + 4
    expect(youthJul.retentionPct).toBe(90.9); // 40/44 = 0.9090… → 90.9
    expect(youthJul.returningMembers).toBe(40);
    expect(youthJul.lostMembers).toBe(4);
    expect(youthJul.currentMembers).toBe(45); // returning + new = 40 + 5
  });

  it('churnPctOf reads the mapped point directly (priorMembers := returning + lost)', () => {
    const o = buildCohortOverlay(axis, rows);
    const adultsJul = o.adults[0]!;
    expect(churnPctOf(adultsJul)).toBe(9.1); // 10 / 110 → 9.0909… → 9.1
  });

  it('ignores bands other than youth3to15 / adults16plus', () => {
    // unknownCohort is present in rows but must not appear in either output array.
    const o = buildCohortOverlay(['2025-07'], rows);
    expect(o.youth[0]?.periodMonth).toBe('2025-07');
    expect(o.adults[0]?.periodMonth).toBe('2025-07');
    // Only two arrays exist on the overlay; there is no place for unknownCohort to land.
    expect(Object.keys(buildCohortOverlay(['2025-07'], rows))).toEqual(['youth', 'adults']);
  });
});

describe('buildCohortOverlay — gaps (null, never 0, never interpolated)', () => {
  it('suppressed row → null gap', () => {
    const rows = [suppressed('2025-11', 'youth3to15'), pub('2025-11', 'adults16plus', 90, 8)];
    const o = buildCohortOverlay(['2025-11'], rows);
    expect(o.youth[0]).toBeNull();
    expect(o.adults[0]).not.toBeNull();
  });

  it('missing row → null gap', () => {
    // adults has no row for 2025-12 at all.
    const rows = [pub('2025-12', 'youth3to15', 50, 2)];
    const o = buildCohortOverlay(['2025-12'], rows);
    expect(o.youth[0]).not.toBeNull();
    expect(o.adults[0]).toBeNull();
  });

  it('a gap month between two published months stays null (no bridge)', () => {
    const axis = ['2025-07', '2025-08', '2025-09'];
    const rows = [
      pub('2025-07', 'youth3to15', 40, 4),
      suppressed('2025-08', 'youth3to15'),
      pub('2025-09', 'youth3to15', 41, 5),
    ];
    const o = buildCohortOverlay(axis, rows);
    expect(o.youth.map((p) => (p === null ? null : p.periodMonth))).toEqual([
      '2025-07',
      null,
      '2025-09',
    ]);
  });

  it('seed/absent month at the head of the axis is a leading null gap', () => {
    // The All axis already excludes the seed boundary, but if a cohort row is simply absent for the
    // earliest axis month it must read as a gap, not 0.
    const rows = [pub('2025-08', 'youth3to15', 42, 3), pub('2025-08', 'adults16plus', 100, 10)];
    const o = buildCohortOverlay(['2025-07', '2025-08'], rows);
    expect(o.youth[0]).toBeNull();
    expect(o.adults[0]).toBeNull();
    expect(o.youth[1]).not.toBeNull();
  });
});

describe('buildCohortOverlay — denominator guard', () => {
  it('returning + lost === 0 → null (no 0/0)', () => {
    const rows = [pub('2025-07', 'youth3to15', 0, 0, 3)];
    const o = buildCohortOverlay(['2025-07'], rows);
    expect(o.youth[0]).toBeNull();
  });

  it('lost === 0 with returning > 0 → 100% retention (not a gap)', () => {
    const rows = [pub('2025-07', 'adults16plus', 50, 0)];
    const o = buildCohortOverlay(['2025-07'], rows);
    expect(o.adults[0]?.retentionPct).toBe(100);
    expect(churnPctOf(o.adults[0]!)).toBe(0);
  });
});

describe('buildCohortOverlay — empty inputs', () => {
  it('empty axis → empty arrays', () => {
    const o = buildCohortOverlay([], [pub('2025-07', 'youth3to15', 40, 4)]);
    expect(o.youth).toEqual([]);
    expect(o.adults).toEqual([]);
  });

  it('no rows → all-null arrays aligned to the axis (overlay renders as gaps)', () => {
    const o = buildCohortOverlay(['2025-07', '2025-08'], []);
    expect(o.youth).toEqual([null, null]);
    expect(o.adults).toEqual([null, null]);
  });
});
