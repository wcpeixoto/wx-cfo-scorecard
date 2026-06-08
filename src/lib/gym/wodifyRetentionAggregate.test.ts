// Network-free tests for the Wodify Retention aggregate (RETENTION_FINISH_PLAN.md
// §6). No live Wodify call — every test feeds in-memory raw rows. The load-bearing
// test is PARITY: the threshold-free histogram must reconstruct the locked
// computeAttendanceHealth buckets at any owner threshold, so the server can stay
// PII-free and the SPA still derives Healthy/Watch/Silent without another fetch.

import { describe, it, expect } from 'vitest';
import {
  normalizeStatus,
  sliceUsableDate,
  pickLastCheckIn,
  normalizeClient,
  computeRetentionAggregate,
  MAX_EXACT_DAYS,
  SENTINEL_NULL_DATE,
  type RawWodifyClient,
} from './wodifyRetentionAggregate';
import { WATCH_FLOOR_DAYS, computeAttendanceHealth } from './silentChurn';
// PR2: the SPA-side bucket derivation is now a shipped module; this test imports it
// (rather than re-declaring the rule) so the PARITY proof below covers the function
// that actually ships. See src/lib/gym/retentionAggregateView.ts.
import { deriveBuckets } from './retentionAggregateView';
import { SAMPLE_GYM_MEMBERS, FIXTURE_TODAY, type GymMember } from './memberFixture';

const OPTS = {
  asOf: '2026-06-05',
  fetchedAt: '2026-06-05T12:00:00Z',
  pagesFetched: 1,
  reachedPageCap: false,
};

// deriveBuckets is imported from ./retentionAggregateView (above): the SPA-side
// re-derivation now ships, and the parity + payload tests below exercise the
// shipped function directly.

// Map a sample GymMember to the raw /clients shape so we can run the SAME fixture
// through both the locked classifier and the server aggregate and compare.
function memberToRawRow(m: GymMember): RawWodifyClient {
  const statusWord = { active: 'Active', paused: 'Paused', ended: 'Ended' }[m.status];
  return { client_status: statusWord, last_attendance: m.lastCheckIn };
}

describe('normalizeStatus', () => {
  it('maps active / paused / ended; missing or unmappable → null', () => {
    expect(normalizeStatus('Active')).toBe('active');
    expect(normalizeStatus('active')).toBe('active');
    expect(normalizeStatus('Paused')).toBe('paused');
    expect(normalizeStatus('Frozen')).toBe('paused');
    expect(normalizeStatus('On Hold')).toBe('paused');
    expect(normalizeStatus('Cancelled')).toBe('ended'); // present but unrecognized → ended
    expect(normalizeStatus('Ended')).toBe('ended');
    expect(normalizeStatus('')).toBeNull(); // empty → unmappable
    expect(normalizeStatus('   ')).toBeNull();
    expect(normalizeStatus(undefined)).toBeNull();
    expect(normalizeStatus(null)).toBeNull();
    expect(normalizeStatus(42)).toBeNull();
  });
});

describe('sliceUsableDate (ISO slicing + sentinel + invalid)', () => {
  it('slices the leading YYYY-MM-DD off an ISO timestamp', () => {
    expect(sliceUsableDate('2026-06-01T07:00:00Z')).toBe('2026-06-01');
    expect(sliceUsableDate('2026-06-01')).toBe('2026-06-01');
  });
  it('treats the 1900-01-01 sentinel as no date (null)', () => {
    expect(sliceUsableDate('1900-01-01')).toBeNull();
    expect(sliceUsableDate(`${SENTINEL_NULL_DATE}T00:00:00Z`)).toBeNull();
  });
  it('rejects unparseable / non-date / missing values', () => {
    expect(sliceUsableDate('N/A')).toBeNull();
    expect(sliceUsableDate('2026-13-40')).toBeNull(); // invalid calendar
    expect(sliceUsableDate('')).toBeNull();
    expect(sliceUsableDate(null)).toBeNull();
    expect(sliceUsableDate(undefined)).toBeNull();
    expect(sliceUsableDate(12345)).toBeNull();
  });
});

describe('pickLastCheckIn (most-recent usable of the two fields)', () => {
  it('returns the later of last_attendance and last_class_sign_in', () => {
    expect(pickLastCheckIn('2026-05-15', '2026-06-04T09:00:00Z')).toBe('2026-06-04');
    expect(pickLastCheckIn('2026-06-04T09:00:00Z', '2026-05-15')).toBe('2026-06-04');
  });
  it('falls back to whichever single field is usable', () => {
    expect(pickLastCheckIn('N/A', '2026-03-09')).toBe('2026-03-09');
    expect(pickLastCheckIn('2026-03-09', null)).toBe('2026-03-09');
  });
  it('returns "" when neither field is usable (→ unknown bucket)', () => {
    expect(pickLastCheckIn('1900-01-01', null)).toBe('');
    expect(pickLastCheckIn('N/A', '')).toBe('');
    expect(pickLastCheckIn(undefined, undefined)).toBe('');
  });
});

describe('normalizeClient', () => {
  it('captures is_at_risk strictly (only boolean true)', () => {
    expect(normalizeClient({ client_status: 'Active', is_at_risk: true }).isAtRisk).toBe(true);
    expect(normalizeClient({ client_status: 'Active', is_at_risk: 'true' }).isAtRisk).toBe(false);
    expect(normalizeClient({ client_status: 'Active' }).isAtRisk).toBe(false);
  });
});

describe('computeRetentionAggregate — binning, sentinel, future, overflow', () => {
  // asOf 2026-06-05. Day diffs are exact whole local days.
  const rows: RawWodifyClient[] = [
    { client_status: 'Active', last_attendance: '2026-06-05' }, // 0  → healthy bin
    { client_status: 'Active', last_attendance: '2026-06-04', is_at_risk: true }, // 1
    { client_status: 'Active', last_attendance: '2026-05-29' }, // 7  → healthy edge (< 8)
    { client_status: 'Active', last_attendance: '2026-05-28' }, // 8  → watch floor
    { client_status: 'Active', last_attendance: '2026-05-15' }, // 21 → silent @ default
    { client_status: 'Active', last_attendance: '2025-06-05' }, // 365 → overflow
    { client_status: 'Active', last_attendance: '2024-06-05' }, // 730 → overflow
    { client_status: 'Active', last_attendance: '1900-01-01' }, // sentinel → unknown
    { client_status: 'Active', last_attendance: '2026-06-10' }, // future (-5) → day 0 + diag
    { client_status: 'Active', last_attendance: '2026-05-15', last_class_sign_in: '2026-06-04T09:00:00Z' }, // 1 (latest)
    { client_status: 'Paused', last_attendance: '2020-01-01' }, // excluded
    { client_status: 'Cancelled', last_attendance: '2020-01-01' }, // → ended, excluded
    { client_status: '', last_attendance: '2026-06-04' }, // unmappable status
  ];
  const agg = computeRetentionAggregate(rows, OPTS);

  it('bins exact days, rolls >= 365 into overflow, sentinel → unknown', () => {
    expect(agg.daysAbsentHistogram.countsByDaysAbsent).toEqual({
      '0': 2, // today + future(binned at 0)
      '1': 2, // yesterday + two-dates(latest)
      '7': 1,
      '8': 1,
      '21': 1,
    });
    expect(agg.daysAbsentHistogram.overflow365Plus).toBe(2);
    expect(agg.daysAbsentHistogram.maxExactDays).toBe(MAX_EXACT_DAYS);
    expect(agg.unknown).toBe(1); // sentinel member, active but no usable date
  });

  it('counts active total, excludes paused/ended, surfaces dataQuality', () => {
    expect(agg.activeTotal).toBe(10);
    expect(agg.dataQuality.unknownStatus).toBe(1);
    expect(agg.dataQuality.futureLastCheckIn).toBe(1);
    expect(agg.dataQuality.clientsScanned).toBe(13);
    expect(agg.dataQuality.pagesFetched).toBe(1);
    expect(agg.diagnostics.wodifyAtRiskCount).toBe(1);
  });

  it('conserves: activeTotal === sum(bins) + overflow + unknown', () => {
    const binSum = Object.values(agg.daysAbsentHistogram.countsByDaysAbsent).reduce(
      (a, b) => a + b,
      0,
    );
    expect(agg.activeTotal).toBe(
      binSum + agg.daysAbsentHistogram.overflow365Plus + agg.unknown,
    );
  });

  it('future date is on the Healthy day-0 path AND counted as a diagnostic', () => {
    // It lives in bin "0" (healthy for any T>=1), not a separate bucket.
    expect(agg.daysAbsentHistogram.countsByDaysAbsent['0']).toBe(2);
    expect(agg.dataQuality.futureLastCheckIn).toBe(1);
    // At any threshold it derives as Healthy, never Silent.
    for (const T of [1, 21, 365]) {
      const d = deriveBuckets(agg, T);
      expect(d.healthy).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('threshold derivation from the histogram (no refetch)', () => {
  const rows: RawWodifyClient[] = [
    { client_status: 'Active', last_attendance: '2026-06-05' }, // 0  healthy
    { client_status: 'Active', last_attendance: '2026-05-29' }, // 7  healthy (<8)
    { client_status: 'Active', last_attendance: '2026-05-28' }, // 8  watch floor
    { client_status: 'Active', last_attendance: '2026-05-15' }, // 21 silent@21
    { client_status: 'Active', last_attendance: '1900-01-01' }, // unknown (sentinel)
  ];
  const agg = computeRetentionAggregate(rows, OPTS);

  it('threshold 1: everyone absent >= 1 day is Silent, watch empty (T <= floor)', () => {
    const d = deriveBuckets(agg, 1);
    expect(d).toMatchObject({ healthy: 1, watch: 0, silent: 3, unknown: 1 });
  });

  it('threshold 21: Healthy<8, Watch 8..20, Silent>=21, sentinel stays unknown', () => {
    const d = deriveBuckets(agg, 21);
    expect(d).toMatchObject({ healthy: 2, watch: 1, silent: 1, unknown: 1 });
  });

  it('threshold 365: nobody Silent below a year; sentinel is unknown, NOT Silent', () => {
    const d = deriveBuckets(agg, 365);
    expect(d.silent).toBe(0);
    expect(d.unknown).toBe(1);
  });

  it('WATCH_FLOOR_DAYS = 8 is preserved: day 7 Healthy, day 8 Watch at T=21', () => {
    expect(WATCH_FLOOR_DAYS).toBe(8);
    const d = deriveBuckets(agg, 21);
    expect(d.healthy).toBe(2); // day 0 and day 7
    expect(d.watch).toBe(1); // day 8
  });
});

describe('parity with the locked classifier (computeAttendanceHealth)', () => {
  // FIXTURE_TODAY is 2026-06-02 (== new Date(2026,5,2)); the sample dates are all
  // valid and in the past, so this exercises the realistic happy path.
  const asOfStr = '2026-06-02';
  const rows = SAMPLE_GYM_MEMBERS.map(memberToRawRow);
  const agg = computeRetentionAggregate(rows, {
    asOf: asOfStr,
    fetchedAt: '2026-06-02T12:00:00Z',
    pagesFetched: 1,
    reachedPageCap: false,
  });

  it('reconstructs Healthy/Watch/Silent/unknown for the sample at T = 1, 21, 365', () => {
    for (const T of [1, 21, 365]) {
      const classifier = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, T, FIXTURE_TODAY);
      const derived = deriveBuckets(agg, T);
      expect(derived.activeTotal).toBe(classifier.activeTotal);
      expect(derived.healthy).toBe(classifier.healthy);
      expect(derived.watch).toBe(classifier.watch);
      expect(derived.silent).toBe(classifier.silent);
      expect(derived.unknown).toBe(classifier.unknown);
    }
  });

  it('Silent derived from the histogram equals the classifier silent count (== computeSilentChurn count)', () => {
    const classifier = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY);
    expect(deriveBuckets(agg, 21).silent).toBe(classifier.silent);
  });

  it('also holds with unknown + future + paused/ended members present', () => {
    const mixed: GymMember[] = [
      { id: 'a', displayName: 'A', status: 'active', monthlyDues: 100, membershipStart: '2024-01-01', lastCheckIn: '2026-06-02' }, // healthy
      { id: 'b', displayName: 'B', status: 'active', monthlyDues: 100, membershipStart: '2024-01-01', lastCheckIn: '2026-05-01' }, // silent@21
      { id: 'c', displayName: 'C', status: 'active', monthlyDues: 100, membershipStart: '2024-01-01', lastCheckIn: '' }, // unknown
      { id: 'd', displayName: 'D', status: 'active', monthlyDues: 100, membershipStart: '2024-01-01', lastCheckIn: '2026-06-20' }, // future → healthy
      { id: 'e', displayName: 'E', status: 'paused', monthlyDues: 0, membershipStart: '2024-01-01', lastCheckIn: '2026-01-01' }, // excluded
      { id: 'f', displayName: 'F', status: 'ended', monthlyDues: 0, membershipStart: '2024-01-01', lastCheckIn: '2026-01-01' }, // excluded
    ];
    const mixedAgg = computeRetentionAggregate(mixed.map(memberToRawRow), {
      asOf: asOfStr,
      fetchedAt: '2026-06-02T12:00:00Z',
      pagesFetched: 1,
      reachedPageCap: false,
    });
    const classifier = computeAttendanceHealth(mixed, 21, FIXTURE_TODAY);
    const derived = deriveBuckets(mixedAgg, 21);
    expect(derived).toMatchObject({
      activeTotal: classifier.activeTotal,
      healthy: classifier.healthy,
      watch: classifier.watch,
      silent: classifier.silent,
      unknown: classifier.unknown,
    });
  });
});

describe('payload shape (non-PII contract)', () => {
  const agg = computeRetentionAggregate(
    [{ client_status: 'Active', last_attendance: '2026-06-01' }],
    OPTS,
  );

  it('matches the §6.6 object shape with no member-level fields', () => {
    expect(agg).toEqual({
      source: 'wodify',
      asOf: '2026-06-05',
      fetchedAt: '2026-06-05T12:00:00Z',
      activeTotal: 1,
      daysAbsentHistogram: {
        maxExactDays: 364,
        countsByDaysAbsent: { '4': 1 },
        overflow365Plus: 0,
      },
      unknown: 0,
      silentChurn: { monthlyDuesAtRisk: null, missingMonthlyDues: true },
      diagnostics: { wodifyAtRiskCount: 0 },
      dataQuality: {
        unknownStatus: 0,
        futureLastCheckIn: 0,
        pagesFetched: 1,
        reachedPageCap: false,
        clientsScanned: 1,
      },
    });
  });

  it('propagates reachedPageCap into dataQuality (partial-snapshot signal, never silent)', () => {
    expect(agg.dataQuality.reachedPageCap).toBe(false); // default complete-fetch path
    const partial = computeRetentionAggregate(
      [{ client_status: 'Active', last_attendance: '2026-06-01' }],
      { ...OPTS, reachedPageCap: true },
    );
    expect(partial.dataQuality.reachedPageCap).toBe(true);
  });

  it('dues are never fabricated: null + missing flag, never 0', () => {
    expect(agg.silentChurn.monthlyDuesAtRisk).toBeNull();
    expect(agg.silentChurn.missingMonthlyDues).toBe(true);
  });

  it('throws on a malformed asOf without echoing any row', () => {
    expect(() => computeRetentionAggregate([], { ...OPTS, asOf: 'not-a-date' })).toThrow(
      /asOf/,
    );
  });
});
