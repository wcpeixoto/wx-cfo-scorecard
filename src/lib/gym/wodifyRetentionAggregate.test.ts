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
  tenureBandActiveTotals,
  cohortActiveTotals,
  cohortLapsedTotals,
  MAX_EXACT_DAYS,
  SENTINEL_NULL_DATE,
  type RawWodifyClient,
  type TenureBandHistogram,
} from './wodifyRetentionAggregate';
import { WATCH_FLOOR_DAYS, computeAttendanceHealth, computeSilentChurn } from './silentChurn';
// PR2: the SPA-side bucket derivation is now a shipped module; this test imports it
// (rather than re-declaring the rule) so the PARITY proof below covers the function
// that actually ships. See src/lib/gym/retentionAggregateView.ts.
import { deriveBuckets } from './retentionAggregateView';
import {
  TENURE_BANDS,
  UNKNOWN_TENURE_ID,
  computeChurnRiskByTenure,
  computeChurnRiskByTenureFromAggregate,
} from './churnRiskByTenure';
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
// through both the locked classifier and the server aggregate and compare. The
// fixture keeps its 3-way status (it feeds the locked classifyMember); on the raw
// side paused/ended both map to 'Inactive' — the only non-active value Wodify
// actually returns (vocab gate, 2026-06-09). membershipStart rides as
// member_since (the proven /clients field), so the SAME fixture also drives the
// tenure parity below.
function memberToRawRow(m: GymMember): RawWodifyClient {
  const statusWord = m.status === 'active' ? 'Active' : 'Inactive';
  return {
    client_status: statusWord,
    last_attendance: m.lastCheckIn,
    member_since: m.membershipStart,
  };
}

// Bin-wise merge of every tenure band (incl. the unknown-tenure bucket) — used to
// prove the bands PARTITION the global histogram, which is what makes Σ band
// silent === the global silent count at every threshold.
function mergeTenureBands(tenure: TenureBandHistogram) {
  const countsByDaysAbsent: Record<string, number> = {};
  let overflow365Plus = 0;
  let unknownRecency = 0;
  for (const band of Object.values(tenure.bands)) {
    for (const [k, v] of Object.entries(band.countsByDaysAbsent)) {
      countsByDaysAbsent[k] = (countsByDaysAbsent[k] ?? 0) + v;
    }
    overflow365Plus += band.overflow365Plus;
    unknownRecency += band.unknownRecency;
  }
  return { countsByDaysAbsent, overflow365Plus, unknownRecency };
}

describe('normalizeStatus (fail-closed taxonomy, binary §6 rescope)', () => {
  it('maps exact Active (case-insensitive) → active, without broadening', () => {
    expect(normalizeStatus('Active')).toBe('active');
    expect(normalizeStatus('active')).toBe('active');
    expect(normalizeStatus('ACTIVE')).toBe('active');
    // Active VARIANTS fail closed to unknown — never guessed active (which would
    // inflate the paying-member count). `^active$` is intentionally exact.
    expect(normalizeStatus('Active - Comp')).toBeNull();
  });

  it('maps exact Inactive (case-insensitive) → inactive, without broadening', () => {
    expect(normalizeStatus('Inactive')).toBe('inactive');
    expect(normalizeStatus('inactive')).toBe('inactive');
    expect(normalizeStatus('INACTIVE')).toBe('inactive');
    // Anchored like ^active$: a variant fails closed to unknown, never guessed.
    expect(normalizeStatus('Inactive - Archived')).toBeNull();
  });

  it('routes the formerly-mapped paused/ended vocabulary → null (proven vocabulary only)', () => {
    // The binary rescope: Wodify returns exactly Active/Inactive (vocab gate,
    // 957 records, coverage-complete), so the speculative paused/ended word maps
    // are gone. None of these are statuses Wodify actually returns — if one ever
    // appears it must surface in unknownStatus, never be silently bucketed.
    expect(normalizeStatus('Paused')).toBeNull();
    expect(normalizeStatus('Frozen')).toBeNull();
    expect(normalizeStatus('On Hold')).toBeNull();
    expect(normalizeStatus('Ended')).toBeNull();
    expect(normalizeStatus('Cancelled')).toBeNull();
    expect(normalizeStatus('Suspended')).toBeNull();
  });

  it('routes PRESENT-but-unrecognized statuses → null (unknown bucket, never guessed)', () => {
    // §6 fix B, preserved through the rescope: an unrecognized value is
    // unclassified data — unknown is the honest bucket.
    expect(normalizeStatus('Trial')).toBeNull();
    expect(normalizeStatus('Prospect')).toBeNull();
    expect(normalizeStatus('Lead')).toBeNull();
  });

  it('routes MISSING / blank / non-string status → null (distinct cause, same bucket)', () => {
    // Same null result as present-but-unrecognized, but a DIFFERENT root cause (no
    // value at all vs. an unmapped value). Kept separate so a regression in one
    // path cannot hide behind the other.
    expect(normalizeStatus('')).toBeNull();
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
    { client_status: 'Inactive', last_attendance: '2020-01-01' }, // census, excluded from binning
    { client_status: 'INACTIVE', last_attendance: '2020-01-01' }, // case-insensitive → census, excluded
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

  it('counts active/inactive census, surfaces dataQuality', () => {
    expect(agg.activeTotal).toBe(10);
    expect(agg.inactiveTotal).toBe(2); // the two Inactive rows
    expect(agg.dataQuality.unknownStatus).toBe(1);
    expect(agg.dataQuality.futureLastCheckIn).toBe(1);
    expect(agg.dataQuality.clientsScanned).toBe(13);
    expect(agg.dataQuality.pagesFetched).toBe(1);
    expect(agg.diagnostics.wodifyAtRiskCount).toBe(1);
  });

  it('census conserves: activeTotal + inactiveTotal + unknownStatus === clientsScanned', () => {
    expect(
      agg.activeTotal + agg.inactiveTotal + agg.dataQuality.unknownStatus,
    ).toBe(agg.dataQuality.clientsScanned);
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

describe('Member Movement census (binary active/inactive, §6 rescope)', () => {
  it('counts exact Active/Inactive; everything else → unknownStatus (proven vocabulary only)', () => {
    const rows: RawWodifyClient[] = [
      { client_status: 'Active', last_attendance: '2026-06-05' },
      { client_status: 'Active', last_attendance: '2026-06-01' },
      { client_status: 'Inactive' },
      { client_status: 'inactive' }, // case-insensitive
      { client_status: 'Paused' }, // formerly paused — now unknownStatus (not a proven status)
      { client_status: 'Frozen' }, // formerly paused — now unknownStatus
      { client_status: 'Ended' }, // formerly ended — now unknownStatus
      { client_status: 'Cancelled' }, // formerly ended — now unknownStatus
      { client_status: 'Trial' }, // present-but-unrecognized → unknownStatus
      { client_status: '' }, // missing/blank → unknownStatus
      { client_status: undefined }, // missing → unknownStatus
    ];
    const a = computeRetentionAggregate(rows, OPTS);
    expect(a.activeTotal).toBe(2); // active path untouched by unrecognized rows
    expect(a.inactiveTotal).toBe(2); // Inactive + inactive only
    expect(a.dataQuality.unknownStatus).toBe(7); // Paused/Frozen/Ended/Cancelled/Trial/''/undefined
    expect(a.dataQuality.clientsScanned).toBe(11);
    // Three-way census partition === clients scanned (no row dropped or double-counted).
    expect(a.activeTotal + a.inactiveTotal + a.dataQuality.unknownStatus).toBe(
      a.dataQuality.clientsScanned,
    );
  });

  it('inactive members are excluded from the active recency histogram', () => {
    // An inactive member with an ancient check-in must NOT land in any active bin.
    const a = computeRetentionAggregate(
      [
        { client_status: 'Active', last_attendance: '2026-06-05' }, // day 0
        { client_status: 'Inactive', last_attendance: '2020-01-01' },
        { client_status: 'Inactive', last_attendance: '2019-01-01' },
      ],
      OPTS,
    );
    expect(a.activeTotal).toBe(1);
    expect(a.inactiveTotal).toBe(2);
    const binSum = Object.values(a.daysAbsentHistogram.countsByDaysAbsent).reduce(
      (x, y) => x + y,
      0,
    );
    expect(binSum + a.daysAbsentHistogram.overflow365Plus).toBe(1); // only the active row
  });

  it('AH/SC parity regression: non-active rows never perturb activeTotal or the histogram', () => {
    // The rescope is regression-clean by construction for Attendance Health /
    // Silent Churn: the /^active$/i matcher and the active-only binning are
    // untouched, so adding ANY non-active rows (the proven Inactive value, the
    // retired paused/ended words, junk) must leave activeTotal, the histogram,
    // and the active-unknown count byte-identical to the active-rows-only run.
    const activeRows: RawWodifyClient[] = [
      { client_status: 'Active', last_attendance: '2026-06-05' }, // 0
      { client_status: 'Active', last_attendance: '2026-05-28' }, // 8
      { client_status: 'Active', last_attendance: '2026-05-15' }, // 21
      { client_status: 'Active', last_attendance: '2024-06-05' }, // overflow
      { client_status: 'Active', last_attendance: '1900-01-01' }, // sentinel → unknown
    ];
    const nonActiveRows: RawWodifyClient[] = [
      { client_status: 'Inactive', last_attendance: '2026-06-05' },
      { client_status: 'Paused', last_attendance: '2026-06-05' },
      { client_status: 'Ended', last_attendance: '2026-06-05' },
      { client_status: 'Trial', last_attendance: '2026-06-05' },
      { client_status: '' },
    ];
    const activeOnly = computeRetentionAggregate(activeRows, OPTS);
    const mixed = computeRetentionAggregate([...activeRows, ...nonActiveRows], OPTS);
    expect(mixed.activeTotal).toBe(activeOnly.activeTotal);
    expect(mixed.daysAbsentHistogram).toEqual(activeOnly.daysAbsentHistogram);
    expect(mixed.unknown).toBe(activeOnly.unknown);
    // And the census partition still conserves on the mixed set.
    expect(mixed.activeTotal + mixed.inactiveTotal + mixed.dataQuality.unknownStatus).toBe(
      mixed.dataQuality.clientsScanned,
    );
  });
});

describe('tenure-band histogram (§6 aggregate extension)', () => {
  // asOf 2026-06-05. One member per placement case, ACTIVE unless noted.
  const rows: RawWodifyClient[] = [
    // lt3m (35d tenure), checked in today (day 0)
    { client_status: 'Active', member_since: '2026-05-01', last_attendance: '2026-06-05' },
    // 3to6m (124d), silent at the default threshold (day 21)
    { client_status: 'Active', member_since: '2026-02-01', last_attendance: '2026-05-15' },
    // 6to12m (247d), sentinel check-in → unknown RECENCY inside a known band
    { client_status: 'Active', member_since: '2025-10-01', last_attendance: '1900-01-01' },
    // 1to2y (520d), gone 730d → overflow
    { client_status: 'Active', member_since: '2025-01-01', last_attendance: '2024-06-05' },
    // 1to2y (369d), FUTURE check-in → day-0 bin in THIS band + diagnostic
    // (Reviewer fold-in: proves the future→day-0 rule is identical per-band vs global)
    { client_status: 'Active', member_since: '2025-06-01', last_attendance: '2026-06-10' },
    // 2yplus, watch floor (day 8)
    { client_status: 'Active', member_since: '2020-01-01', last_attendance: '2026-05-28' },
    // unknown TENURE: member_since missing / sentinel / invalid / after asOf
    { client_status: 'Active', last_attendance: '2026-06-04' }, // missing → day 1
    { client_status: 'Active', member_since: '1900-01-01', last_attendance: '2026-06-03' }, // sentinel → day 2
    { client_status: 'Active', member_since: 'not-a-date', last_attendance: '2026-06-02' }, // invalid → day 3
    { client_status: 'Active', member_since: '2026-07-01', last_attendance: '2026-06-01' }, // future start → day 4
    // non-active rows must not touch any tenure band
    { client_status: 'Inactive', member_since: '2020-01-01', last_attendance: '2020-01-01' },
    { client_status: 'Trial', member_since: '2020-01-01', last_attendance: '2026-06-05' },
  ];
  const agg = computeRetentionAggregate(rows, OPTS);
  const bands = agg.tenureBandHistogram.bands;

  it('persists the bandEdges contract (id + minDays, in band order, no labels)', () => {
    expect(agg.tenureBandHistogram.bandEdges).toEqual(
      TENURE_BANDS.map(({ id, minDays }) => ({ id, minDays })),
    );
  });

  it('always carries every band key (empty bands emit zero counts, never vanish)', () => {
    expect(Object.keys(bands).sort()).toEqual(
      [...TENURE_BANDS.map((b) => b.id), UNKNOWN_TENURE_ID].sort(),
    );
  });

  it('bins each active member into the band their member_since tenure selects', () => {
    expect(bands.lt3m).toEqual({ countsByDaysAbsent: { '0': 1 }, overflow365Plus: 0, unknownRecency: 0 });
    expect(bands['3to6m']).toEqual({ countsByDaysAbsent: { '21': 1 }, overflow365Plus: 0, unknownRecency: 0 });
    expect(bands['6to12m']).toEqual({ countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 1 });
    expect(bands['2yplus']).toEqual({ countsByDaysAbsent: { '8': 1 }, overflow365Plus: 0, unknownRecency: 0 });
  });

  it('bins a FUTURE check-in at day 0 inside its own tenure band, same rule as the global histogram', () => {
    // 1to2y holds the overflow member AND the future-check-in member: the future
    // date lands in this band's day-0 bin (Healthy-compatible), is counted once
    // in the global diagnostic, and the global day-0 bin sees the same member —
    // per-band and global future handling are one rule, not two.
    expect(bands['1to2y']).toEqual({
      countsByDaysAbsent: { '0': 1 },
      overflow365Plus: 1,
      unknownRecency: 0,
    });
    expect(agg.dataQuality.futureLastCheckIn).toBe(1);
    expect(agg.daysAbsentHistogram.countsByDaysAbsent['0']).toBe(2); // lt3m today + 1to2y future
  });

  it('routes missing / sentinel / invalid / after-asOf member_since into the unknown-tenure bucket (#439, never dropped)', () => {
    // The 1900-01-01 member_since is a WIRE-level sentinel: sliceUsableDate nulls
    // it before any tenure math, so it can never masquerade as a ~46-year tenure.
    expect(bands[UNKNOWN_TENURE_ID]).toEqual({
      countsByDaysAbsent: { '1': 1, '2': 1, '3': 1, '4': 1 },
      overflow365Plus: 0,
      unknownRecency: 0,
    });
  });

  it('PARTITION invariant: merging the bands reproduces the global histogram + unknown', () => {
    const merged = mergeTenureBands(agg.tenureBandHistogram);
    expect(merged.countsByDaysAbsent).toEqual(agg.daysAbsentHistogram.countsByDaysAbsent);
    expect(merged.overflow365Plus).toBe(agg.daysAbsentHistogram.overflow365Plus);
    expect(merged.unknownRecency).toBe(agg.unknown);
  });

  it('Σ per-band active totals === activeTotal (non-active rows touch no band)', () => {
    const totals = tenureBandActiveTotals(agg.tenureBandHistogram);
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    expect(sum).toBe(agg.activeTotal);
    expect(agg.activeTotal).toBe(10);
    expect(totals).toEqual({
      lt3m: 1,
      '3to6m': 1,
      '6to12m': 1,
      '1to2y': 2,
      '2yplus': 1,
      [UNKNOWN_TENURE_ID]: 4,
    });
  });
});

describe('tenure parity with the locked sample compute (computeChurnRiskByTenure)', () => {
  // Same FIXTURE_TODAY anchor as the Attendance Health parity above; member_since
  // rides through memberToRawRow, so the identical fixture drives both paths.
  const asOfStr = '2026-06-02';
  const fixtureOpts = {
    asOf: asOfStr,
    fetchedAt: '2026-06-02T12:00:00Z',
    pagesFetched: 1,
    reachedPageCap: false,
  };
  const agg = computeRetentionAggregate(SAMPLE_GYM_MEMBERS.map(memberToRawRow), fixtureOpts);

  it('adapter result equals the sample compute at every threshold (bands, rates, hero)', () => {
    for (const T of [1, 8, 21, 90, 365, 500]) {
      const live = computeChurnRiskByTenureFromAggregate(agg.tenureBandHistogram, T);
      const sample = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, T, FIXTURE_TODAY);
      expect(live).toEqual(sample);
    }
  });

  it('anti-drift on the live path: Σ band silent + unknown-tenure silent === the live Silent Churn count', () => {
    for (const T of [1, 8, 21, 90, 365, 500]) {
      const live = computeChurnRiskByTenureFromAggregate(agg.tenureBandHistogram, T);
      const summedSilent =
        live.bands.reduce((sum, b) => sum + b.silent, 0) + live.unknownTenure.silent;
      // The live Silent Churn card derives its count from the SAME snapshot via
      // deriveBuckets — and both equal the locked classifier on this fixture.
      expect(summedSilent).toBe(deriveBuckets(agg, T).silent);
      expect(summedSilent).toBe(computeSilentChurn(SAMPLE_GYM_MEMBERS, T, FIXTURE_TODAY).count);
    }
  });

  it('parity holds on DIRTY data (invalid + after-asOf starts route to unknown tenure on both paths)', () => {
    // NOTE: a 1900-01-01 member_since is deliberately NOT in this parity fixture.
    // It is a WIRE-level sentinel the server nulls before tenure math (proven in
    // the binning suite above); the GymMember model never carries it, and the
    // sample compute would parse it as a real ancient date — there is no honest
    // GymMember analog to compare against.
    const dirty: GymMember[] = [
      ...SAMPLE_GYM_MEMBERS,
      { id: 'x1', displayName: 'X1', status: 'active', monthlyDues: 100, membershipStart: 'not-a-date', lastCheckIn: '2026-05-19' }, // watch @21, unknown tenure
      { id: 'x2', displayName: 'X2', status: 'active', monthlyDues: 100, membershipStart: '2027-01-01', lastCheckIn: '2025-01-01' }, // silent, future start → unknown tenure
      { id: 'x3', displayName: 'X3', status: 'active', monthlyDues: 100, membershipStart: '2026-05-30', lastCheckIn: '' }, // lt3m, unknown recency
    ];
    const dirtyAgg = computeRetentionAggregate(dirty.map(memberToRawRow), fixtureOpts);
    for (const T of [1, 21, 365]) {
      expect(computeChurnRiskByTenureFromAggregate(dirtyAgg.tenureBandHistogram, T)).toEqual(
        computeChurnRiskByTenure(dirty, T, FIXTURE_TODAY),
      );
    }
  });

  it('hero tie-break matches the sample rule (rate tie → larger atRisk wins)', () => {
    // lt3m: 1 of 1 silent (rate 1.0, atRisk 1) vs 1to2y: 2 of 2 silent (rate 1.0,
    // atRisk 2) → the hero is 1to2y on both paths.
    const tie: GymMember[] = [
      { id: 't1', displayName: 'T1', status: 'active', monthlyDues: 100, membershipStart: '2026-05-20', lastCheckIn: '2026-04-01' },
      { id: 't2', displayName: 'T2', status: 'active', monthlyDues: 100, membershipStart: '2025-01-01', lastCheckIn: '2026-04-01' },
      { id: 't3', displayName: 'T3', status: 'active', monthlyDues: 100, membershipStart: '2025-01-01', lastCheckIn: '2026-04-01' },
    ];
    const tieAgg = computeRetentionAggregate(tie.map(memberToRawRow), fixtureOpts);
    const live = computeChurnRiskByTenureFromAggregate(tieAgg.tenureBandHistogram, 21);
    const sample = computeChurnRiskByTenure(tie, 21, FIXTURE_TODAY);
    expect(live.heroBandId).toBe('1to2y');
    expect(live).toEqual(sample);
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

  it('also holds with unknown + future + non-active members present', () => {
    // The fixture members keep their 3-way status (the locked classifier consumes
    // it); memberToRawRow maps paused/ended → 'Inactive' (the proven vocabulary),
    // so both layers exclude the same members and parity must still hold.
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
      inactiveTotal: 0,
      daysAbsentHistogram: {
        maxExactDays: 364,
        countsByDaysAbsent: { '4': 1 },
        overflow365Plus: 0,
      },
      // §6 aggregate extension: per-band counts only (no labels, no dates). The
      // single row has no member_since, so it bins under unknown tenure.
      tenureBandHistogram: {
        bandEdges: [
          { id: 'lt3m', minDays: 0 },
          { id: '3to6m', minDays: 90 },
          { id: '6to12m', minDays: 180 },
          { id: '1to2y', minDays: 365 },
          { id: '2yplus', minDays: 730 },
        ],
        bands: {
          lt3m: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
          '3to6m': { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
          '6to12m': { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
          '1to2y': { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
          '2yplus': { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
          unknownTenure: { countsByDaysAbsent: { '4': 1 }, overflow365Plus: 0, unknownRecency: 0 },
        },
      },
      // §9 rev.3 cohort extension: per-cohort active recency + lapsed, counts only.
      // The single row has no date_of_birth, so it bins under the unknown cohort.
      cohortHistogram: {
        cohortEdges: [
          { id: 'kids3to6', minAge: 1, maxAge: 6 },
          { id: 'kids7to9', minAge: 7, maxAge: 9 },
          { id: 'teens10to15', minAge: 10, maxAge: 15 },
          { id: 'adults16plus', minAge: 16, maxAge: 120 },
        ],
        cohorts: {
          kids3to6: { active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 }, lapsed: 0 },
          kids7to9: { active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 }, lapsed: 0 },
          teens10to15: { active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 }, lapsed: 0 },
          adults16plus: { active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 }, lapsed: 0 },
          unknownCohort: { active: { countsByDaysAbsent: { '4': 1 }, overflow365Plus: 0, unknownRecency: 0 }, lapsed: 0 },
        },
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

describe('cohort histogram (Cohort Retention Card — Read 1 + Read 2)', () => {
  const rawRow = (
    client_status: string,
    date_of_birth: string,
    last_attendance: string,
  ): RawWodifyClient => ({
    client_status,
    date_of_birth,
    last_attendance,
    member_since: '2024-01-01',
  });

  // OPTS.asOf = 2026-06-05. Ages: 2021-01-01→5 (kids3to6), 2017-01-01→9 (kids7to9),
  // 1996-01-01→30 + 1986-01-01→40 (adults16plus).
  const rows: RawWodifyClient[] = [
    rawRow('Active', '2021-01-01', '2026-06-04'), // kids3to6, healthy
    rawRow('Active', '2017-01-01', '2026-04-01'), // kids7to9, silent
    rawRow('Active', '1996-01-01', '2026-05-20'), // adults16plus, watch
    rawRow('Active', '', '2026-06-01'), // missing DOB → unknown cohort, active
    rawRow('Inactive', '2021-01-01', '2026-01-01'), // kids3to6, lapsed
    rawRow('Inactive', '1986-01-01', '2026-01-01'), // adults16plus, lapsed
    rawRow('Inactive', SENTINEL_NULL_DATE, '2026-01-01'), // 1900-01-01 → unknown cohort, lapsed
    rawRow('Trial', '1996-01-01', '2026-06-01'), // unknown STATUS → excluded from every bucket
  ];

  const agg = computeRetentionAggregate(rows, OPTS);

  it('partitions ACTIVE members across cohorts: Σ cohort-active === activeTotal', () => {
    const totals = cohortActiveTotals(agg.cohortHistogram);
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    expect(agg.activeTotal).toBe(4); // 4 Active rows; the Trial row is unknown-status
    expect(sum).toBe(agg.activeTotal);
  });

  it('holds Member Movement parity: Σ cohort-lapsed (incl. unknownCohort) === inactiveTotal', () => {
    const lapsed = cohortLapsedTotals(agg.cohortHistogram);
    const sum = Object.values(lapsed).reduce((a, b) => a + b, 0);
    expect(agg.inactiveTotal).toBe(3);
    expect(sum).toBe(agg.inactiveTotal);
  });

  it('routes the right members to each cohort (active + lapsed)', () => {
    const active = cohortActiveTotals(agg.cohortHistogram);
    expect(active.kids3to6).toBe(1);
    expect(active.kids7to9).toBe(1);
    expect(active.adults16plus).toBe(1);
    expect(active.unknownCohort).toBe(1); // missing-DOB active member
    const lapsed = cohortLapsedTotals(agg.cohortHistogram);
    expect(lapsed.kids3to6).toBe(1);
    expect(lapsed.adults16plus).toBe(1);
    expect(lapsed.unknownCohort).toBe(1); // the 1900-01-01 sentinel DOB
  });

  it('routes a >120 outlier age to the unknown cohort, never Adults', () => {
    const outlier = computeRetentionAggregate(
      [rawRow('Active', '1850-01-01', '2026-06-04')], // age ~176 > 120 ceiling
      OPTS,
    );
    const active = cohortActiveTotals(outlier.cohortHistogram);
    expect(active.unknownCohort).toBe(1);
    expect(active.adults16plus).toBe(0);
  });

  it('cohort and tenure partitions both cover exactly the active members', () => {
    const cohortSum = Object.values(cohortActiveTotals(agg.cohortHistogram)).reduce((a, b) => a + b, 0);
    const tenureSum = Object.values(tenureBandActiveTotals(agg.tenureBandHistogram)).reduce((a, b) => a + b, 0);
    expect(cohortSum).toBe(agg.activeTotal);
    expect(tenureSum).toBe(agg.activeTotal);
    expect(cohortSum).toBe(tenureSum);
  });

  it('exposes the cohortEdges contract for this build', () => {
    expect(agg.cohortHistogram.cohortEdges).toEqual([
      { id: 'kids3to6', minAge: 1, maxAge: 6 },
      { id: 'kids7to9', minAge: 7, maxAge: 9 },
      { id: 'teens10to15', minAge: 10, maxAge: 15 },
      { id: 'adults16plus', minAge: 16, maxAge: 120 },
    ]);
  });
});
