import { describe, expect, it } from 'vitest';
import { SAMPLE_GYM_MEMBERS, type GymMember } from './memberFixture';
import { computeMemberMovement } from './memberMovement';

// Member Movement is a snapshot-only card: a RAW status census plus intake by
// join half-year. It classifies no risk, so there is NO anti-drift cross-check
// here (nothing to drift against). Both facts are independent of the clock —
// census is "right now by status", intake is anchored to membershipStart — so
// these assertions need no asOf and are deterministic over the fixture.

describe('computeMemberMovement — census (raw status tally)', () => {
  it('counts active / paused / ended directly from the fixture status field', () => {
    const { census } = computeMemberMovement(SAMPLE_GYM_MEMBERS);
    expect(census.active).toBe(20);
    expect(census.paused).toBe(4);
    expect(census.ended).toBe(6);
  });

  it('census integrity: active + paused + ended === total === members.length', () => {
    const { census } = computeMemberMovement(SAMPLE_GYM_MEMBERS);
    expect(census.active + census.paused + census.ended).toBe(census.total);
    expect(census.total).toBe(SAMPLE_GYM_MEMBERS.length);
  });
});

describe('computeMemberMovement — intake by join cohort (ALL members)', () => {
  it('buckets every member by membershipStart half-year, deterministically', () => {
    const { cohorts } = computeMemberMovement(SAMPLE_GYM_MEMBERS);
    const byId = Object.fromEntries(cohorts.map((c) => [c.id, c.count]));
    expect(byId).toEqual({
      '2021-H1': 1,
      '2021-H2': 2,
      '2022-H1': 2,
      '2022-H2': 4,
      '2023-H1': 4,
      '2023-H2': 4,
      '2024-H1': 4,
      '2024-H2': 3,
      '2025-H1': 6,
    });
  });

  it('cohorts form a contiguous chronological half-year timeline (earliest join first)', () => {
    const { cohorts } = computeMemberMovement(SAMPLE_GYM_MEMBERS);
    expect(cohorts[0].id).toBe('2021-H1');
    expect(cohorts[0].label).toBe('H1 2021');
    expect(cohorts[cohorts.length - 1].id).toBe('2025-H1');
    // Each step advances exactly one half-year — no gaps, no backtracking.
    for (let i = 1; i < cohorts.length; i++) {
      const prevOrd = cohorts[i - 1].year * 2 + (cohorts[i - 1].half - 1);
      const curOrd = cohorts[i].year * 2 + (cohorts[i].half - 1);
      expect(curOrd - prevOrd).toBe(1);
    }
  });

  it('counts EVERY member regardless of status — paused/ended are not dropped from intake', () => {
    const { cohorts, totalJoined, unknownJoin } = computeMemberMovement(SAMPLE_GYM_MEMBERS);
    const summed = cohorts.reduce((sum, c) => sum + c.count, 0);
    expect(summed).toBe(totalJoined);
    expect(totalJoined + unknownJoin).toBe(SAMPLE_GYM_MEMBERS.length);
    expect(unknownJoin).toBe(0); // the fixture has clean dates
  });
});

describe('computeMemberMovement — defensive (not represented in the fixture)', () => {
  it('surfaces an unparseable membershipStart as unknownJoin, never inside a cohort', () => {
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
    const { census, cohorts, totalJoined, unknownJoin } = computeMemberMovement(withBadStart);
    // Status is known, so census still counts the member.
    expect(census.active).toBe(21);
    expect(census.total).toBe(SAMPLE_GYM_MEMBERS.length + 1);
    // The bad join date is isolated to unknownJoin; cohorts are unchanged.
    expect(unknownJoin).toBe(1);
    expect(totalJoined).toBe(SAMPLE_GYM_MEMBERS.length);
    expect(cohorts.reduce((sum, c) => sum + c.count, 0)).toBe(totalJoined);
  });
});
