// Unit + parity tests for the shipped SPA-side bucket derivation (PR2,
// RETENTION_FINISH_PLAN.md §6). The companion wodifyRetentionAggregate.test.ts
// proves parity by running the SAME fixture through the server aggregate and the
// locked classifier; this file pins the precedence rule directly, with explicit
// coverage of the T <= WATCH_FLOOR_DAYS case where a naive set of independent
// range predicates (silent = d>=T, healthy = d<FLOOR) would DOUBLE-COUNT.

import { describe, it, expect } from 'vitest';
import { deriveBuckets, type DerivableAggregate } from './retentionAggregateView';
import {
  computeRetentionAggregate,
  type RawWodifyClient,
} from './wodifyRetentionAggregate';
import { computeAttendanceHealth } from './silentChurn';
import type { GymMember } from './memberFixture';

// A rich hand-built histogram spanning the watch floor (8), with bins on both
// sides, an overflow bucket and unknowns. Independently-known totals below.
const RICH: DerivableAggregate = {
  daysAbsentHistogram: {
    countsByDaysAbsent: { '0': 3, '5': 2, '6': 1, '7': 4, '8': 2, '14': 1, '21': 5, '40': 2 },
    overflow365Plus: 3,
  },
  unknown: 4,
};
const BIN_SUM = 3 + 2 + 1 + 4 + 2 + 1 + 5 + 2; // 20
const TOTAL = BIN_SUM + RICH.daysAbsentHistogram.overflow365Plus + RICH.unknown; // 27

describe('deriveBuckets — conservation holds at EVERY threshold (incl. 1..7)', () => {
  it('healthy + watch + silent + unknown === activeTotal === input total, for T 1..40', () => {
    for (let T = 1; T <= 40; T += 1) {
      const r = deriveBuckets(RICH, T);
      // The bug this guards: at T <= 7 a member at day d (7 >= d >= T) is Silent by
      // precedence; a naive `healthy = d < FLOOR` would ALSO count it Healthy, so the
      // sum would exceed the input total. Conservation === TOTAL catches that.
      expect(r.healthy + r.watch + r.silent + r.unknown).toBe(TOTAL);
      expect(r.activeTotal).toBe(TOTAL);
      expect(r.healthy).toBeGreaterThanOrEqual(0);
      expect(r.watch).toBeGreaterThanOrEqual(0);
      expect(r.silent).toBeGreaterThanOrEqual(0);
    }
  });

  it('also conserves at the clamp ceiling T = 365', () => {
    const r = deriveBuckets(RICH, 365);
    expect(r.healthy + r.watch + r.silent + r.unknown).toBe(TOTAL);
  });
});

describe('deriveBuckets — precedence across the watch floor (the T <= 7 regression)', () => {
  // Expected buckets computed by hand from RICH using classifyMember precedence
  // (silent if d>=T FIRST, then watch if d>=8, else healthy). Watch is empty
  // whenever T <= 8 (the band [8, T) is empty), and days 5/6/7 are SILENT — never
  // also Healthy — at low thresholds.
  const cases: Array<[number, { healthy: number; watch: number; silent: number }]> = [
    // T=5: healthy = {0}=3; silent = {5,6,7,8,14,21,40}=17 +3 overflow =20; watch=0.
    [5, { healthy: 3, watch: 0, silent: 20 }],
    // T=6: healthy = {0,5}=5; silent = {6,7,8,14,21,40}=15 +3 =18; watch=0.
    [6, { healthy: 5, watch: 0, silent: 18 }],
    // T=7: healthy = {0,5,6}=6; silent = {7,8,14,21,40}=14 +3 =17; watch=0.
    [7, { healthy: 6, watch: 0, silent: 17 }],
    // T=8: healthy = {0,5,6,7}=10; silent = {8,14,21,40}=10 +3 =13; watch=0 (floor==T).
    [8, { healthy: 10, watch: 0, silent: 13 }],
    // T=9: watch opens — {8}=2; healthy = {0,5,6,7}=10; silent = {14,21,40}=8 +3 =11.
    [9, { healthy: 10, watch: 2, silent: 11 }],
    // T=21: watch = {8,14}=3; healthy = {0,5,6,7}=10; silent = {21,40}=7 +3 =10.
    [21, { healthy: 10, watch: 3, silent: 10 }],
  ];

  for (const [T, expected] of cases) {
    it(`T=${T}: days below the floor never double-count`, () => {
      const r = deriveBuckets(RICH, T);
      expect(r).toMatchObject({ ...expected, unknown: 4 });
      expect(r.thresholdDays).toBe(T);
    });
  }
});

describe('deriveBuckets — overflow is Silent for any threshold', () => {
  const overflowOnly: DerivableAggregate = {
    daysAbsentHistogram: { countsByDaysAbsent: {}, overflow365Plus: 3 },
    unknown: 0,
  };
  it('the >= 365 overflow bucket counts Silent at T=1 and T=365', () => {
    for (const T of [1, 365]) {
      const r = deriveBuckets(overflowOnly, T);
      expect(r).toMatchObject({ healthy: 0, watch: 0, silent: 3, unknown: 0, activeTotal: 3 });
    }
  });
});

describe('deriveBuckets — unknown stays its own bucket', () => {
  it('unknown is carried through and counted in activeTotal, never folded into Healthy', () => {
    const agg: DerivableAggregate = {
      daysAbsentHistogram: { countsByDaysAbsent: { '0': 2 }, overflow365Plus: 0 },
      unknown: 5,
    };
    const r = deriveBuckets(agg, 21);
    expect(r).toMatchObject({ healthy: 2, watch: 0, silent: 0, unknown: 5, activeTotal: 7 });
  });
});

describe('deriveBuckets — resolves the raw threshold like the store/classifier', () => {
  it('clamps out-of-range raw values (0 -> 21 default, 1000 -> 365)', () => {
    expect(deriveBuckets(RICH, 0).thresholdDays).toBe(21);
    expect(deriveBuckets(RICH, 1000).thresholdDays).toBe(365);
  });
});

// ---- Parity vs the locked classifier on the SAME synthesized members ----------
// asOf is fixed so each member's daysAbsent is exactly `d` whole local days.
const AS_OF = '2026-06-30';
const asOfDate = () => new Date(2026, 5, 30);

function ymdMinus(days: number): string {
  const base = new Date(2026, 5, 30);
  base.setDate(base.getDate() - days);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function mk(id: string, status: GymMember['status'], lastCheckIn: string): GymMember {
  return { id, displayName: id, status, monthlyDues: 100, membershipStart: '2024-01-01', lastCheckIn };
}

function memberToRawRow(m: GymMember): RawWodifyClient {
  const statusWord = { active: 'Active', paused: 'Paused', ended: 'Ended' }[m.status];
  return { client_status: statusWord, last_attendance: m.lastCheckIn };
}

describe('deriveBuckets — parity with computeAttendanceHealth across the boundary', () => {
  const members: GymMember[] = [
    mk('m0', 'active', ymdMinus(0)),
    mk('m3', 'active', ymdMinus(3)),
    mk('m6', 'active', ymdMinus(6)),
    mk('m7', 'active', ymdMinus(7)),
    mk('m8', 'active', ymdMinus(8)),
    mk('m9', 'active', ymdMinus(9)),
    mk('m20', 'active', ymdMinus(20)),
    mk('m21', 'active', ymdMinus(21)),
    mk('mOverflow', 'active', ymdMinus(500)),
    mk('mUnknown', 'active', ''),
    mk('mPaused', 'paused', ymdMinus(2)),
    mk('mEnded', 'ended', ymdMinus(2)),
  ];
  const agg = computeRetentionAggregate(members.map(memberToRawRow), {
    asOf: AS_OF,
    fetchedAt: `${AS_OF}T12:00:00Z`,
    pagesFetched: 1,
    reachedPageCap: false,
  });

  it('matches the locked classifier field-by-field, including T = 1..10', () => {
    for (const T of [1, 2, 3, 5, 6, 7, 8, 9, 10, 21, 365]) {
      const classifier = computeAttendanceHealth(members, T, asOfDate());
      const derived = deriveBuckets(agg, T);
      expect(derived.healthy).toBe(classifier.healthy);
      expect(derived.watch).toBe(classifier.watch);
      expect(derived.silent).toBe(classifier.silent);
      expect(derived.unknown).toBe(classifier.unknown);
      expect(derived.activeTotal).toBe(classifier.activeTotal);
    }
  });
});
