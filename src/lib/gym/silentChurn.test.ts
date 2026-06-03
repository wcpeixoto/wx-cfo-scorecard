import { describe, expect, it } from 'vitest';
import { FIXTURE_TODAY, SAMPLE_GYM_MEMBERS, type GymMember } from './memberFixture';
import {
  WATCH_FLOOR_DAYS,
  classifyMember,
  computeAttendanceHealth,
  computeSilentChurn,
  resolveSilentChurnThresholdDays,
} from './silentChurn';

// These lock the shared-classifier contract: the two Retention cards (Silent
// Churn + Attendance Health) read from one classifyMember, so they can never
// disagree about who is active, who is at-risk, or who has a bad date.

const ACTIVE_TOTAL = SAMPLE_GYM_MEMBERS.filter((m) => m.status === 'active').length;

describe('classifyMember', () => {
  it('excludes non-active members from every bucket (returns null)', () => {
    const paused = SAMPLE_GYM_MEMBERS.find((m) => m.status === 'paused')!;
    const ended = SAMPLE_GYM_MEMBERS.find((m) => m.status === 'ended')!;
    expect(classifyMember(paused, 21, FIXTURE_TODAY)).toBeNull();
    expect(classifyMember(ended, 21, FIXTURE_TODAY)).toBeNull();
  });

  it('buckets an active member as unknown (never Healthy) when lastCheckIn is unparseable', () => {
    const bad: GymMember = {
      id: 'bad',
      displayName: 'Bad Date',
      status: 'active',
      monthlyDues: 100,
      membershipStart: '2024-01-01',
      lastCheckIn: 'not-a-date',
    };
    expect(classifyMember(bad, 21, FIXTURE_TODAY)).toEqual({ bucket: 'unknown', daysAbsent: null });
  });

  it('cuts Healthy / Watch / Silent at the resolved threshold and the watch floor', () => {
    const make = (lastCheckIn: string): GymMember => ({
      id: 'x',
      displayName: 'X',
      status: 'active',
      monthlyDues: 100,
      membershipStart: '2024-01-01',
      lastCheckIn,
    });
    // asOf = 2026-06-02
    expect(classifyMember(make('2026-06-02'), 21, FIXTURE_TODAY)).toMatchObject({ bucket: 'healthy', daysAbsent: 0 });
    expect(classifyMember(make('2026-05-26'), 21, FIXTURE_TODAY)).toMatchObject({ bucket: 'healthy', daysAbsent: 7 });
    // synthetic 8-day member — the Watch floor — WITHOUT perturbing the shipped fixture
    expect(classifyMember(make('2026-05-25'), 21, FIXTURE_TODAY)).toMatchObject({ bucket: 'watch', daysAbsent: WATCH_FLOOR_DAYS });
    expect(classifyMember(make('2026-05-13'), 21, FIXTURE_TODAY)).toMatchObject({ bucket: 'watch', daysAbsent: 20 });
    expect(classifyMember(make('2026-05-12'), 21, FIXTURE_TODAY)).toMatchObject({ bucket: 'silent', daysAbsent: 21 });
  });

  it('leaves the Watch band empty by construction when threshold <= WATCH_FLOOR_DAYS', () => {
    const make = (lastCheckIn: string): GymMember => ({
      id: 'x',
      displayName: 'X',
      status: 'active',
      monthlyDues: 100,
      membershipStart: '2024-01-01',
      lastCheckIn,
    });
    // T = 8: a 7-day member is Healthy, an 8-day member is already Silent — no Watch.
    expect(classifyMember(make('2026-05-26'), 8, FIXTURE_TODAY)).toMatchObject({ bucket: 'healthy', daysAbsent: 7 });
    expect(classifyMember(make('2026-05-25'), 8, FIXTURE_TODAY)).toMatchObject({ bucket: 'silent', daysAbsent: 8 });
  });
});

describe('computeAttendanceHealth', () => {
  it('matches the verified fixture buckets at the default threshold (T=21)', () => {
    const r = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY);
    expect(r).toMatchObject({ thresholdDays: 21, healthy: 9, watch: 5, silent: 6, unknown: 0, activeTotal: 20 });
  });

  it('shifts buckets when the threshold drops (T=14)', () => {
    const r = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, 14, FIXTURE_TODAY);
    expect(r).toMatchObject({ thresholdDays: 14, healthy: 9, watch: 2, silent: 9, unknown: 0, activeTotal: 20 });
  });

  it('uses the RESOLVED threshold for the cut (raw 500 clamps to 365, raw 0 falls back to 21)', () => {
    const clamped = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, 500, FIXTURE_TODAY);
    expect(clamped.thresholdDays).toBe(365);
    expect(clamped).toEqual(computeAttendanceHealth(SAMPLE_GYM_MEMBERS, 365, FIXTURE_TODAY));

    const fallback = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, 0, FIXTURE_TODAY);
    expect(fallback.thresholdDays).toBe(resolveSilentChurnThresholdDays(0)); // 21
    expect(fallback).toEqual(computeAttendanceHealth(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY));
  });

  it('keeps the integrity invariant H + W + S + unknown === active total across a threshold sweep', () => {
    for (let t = 1; t <= 365; t++) {
      const r = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, t, FIXTURE_TODAY);
      expect(r.healthy + r.watch + r.silent + r.unknown).toBe(r.activeTotal);
      expect(r.activeTotal).toBe(ACTIVE_TOTAL);
    }
  });

  it('counts an active member with a bad date as unknown — never Healthy', () => {
    const withBad: GymMember[] = [
      ...SAMPLE_GYM_MEMBERS,
      {
        id: 'bad',
        displayName: 'Bad Date',
        status: 'active',
        monthlyDues: 100,
        membershipStart: '2024-01-01',
        lastCheckIn: '',
      },
    ];
    const base = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY);
    const r = computeAttendanceHealth(withBad, 21, FIXTURE_TODAY);
    expect(r.unknown).toBe(1);
    expect(r.healthy).toBe(base.healthy); // the bad-date member did NOT inflate Healthy
    expect(r.activeTotal).toBe(base.activeTotal + 1);
  });
});

describe('Silent Churn and Attendance Health agree', () => {
  it('Attendance Health silent count === Silent Churn count at every threshold', () => {
    for (const t of [1, 8, 14, 21, 30, 90, 365, 500]) {
      const health = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, t, FIXTURE_TODAY);
      const churn = computeSilentChurn(SAMPLE_GYM_MEMBERS, t, FIXTURE_TODAY);
      expect(health.silent).toBe(churn.count);
      expect(health.thresholdDays).toBe(churn.thresholdDays);
    }
  });
});
