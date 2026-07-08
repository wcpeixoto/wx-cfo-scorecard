import { describe, expect, it } from 'vitest';

import {
  buildMonthlySourceExport,
  latestCompleteMonth,
  type MonthlySourceExportInputs,
} from './buildMonthlySourceExport';
import type { DashboardModel, ScenarioPoint } from '../data/contract';
import type { RetentionMonth } from '../gym/memberRetentionSeries';
import type { RetentionAggregateSnapshot } from '../gym/fetchRetentionAggregate';
import { deriveBuckets } from '../gym/retentionAggregateView';
import type { CohortHistogram, TenureBandHistogram } from '../gym/wodifyRetentionAggregate';
import { TENURE_BANDS, UNKNOWN_TENURE_ID } from '../gym/tenureBands';
import {
  SAMPLE_COHORT_HISTOGRAM,
  computeChurnRiskByCohortFromAggregate,
} from '../gym/churnRiskByCohort';
import { computeChurnRiskByTenureFromAggregate } from '../gym/churnRiskByTenure';
import type { BeltRetentionRow } from '../gym/fetchMemberRetentionByBelt';
import type { CohortRetentionRow } from '../gym/fetchMemberRetentionByCohort';

// ---- minimal SoT-shaped fixtures (only the fields the builder reads) ----
function rollup(
  month: string,
  revenue: number,
  expenses: number,
  extra?: { net?: number; savings?: number; tx?: number },
) {
  return {
    month,
    revenue,
    expenses,
    netCashFlow: extra?.net ?? revenue - expenses,
    savingsRate: extra?.savings ?? 0,
    transactionCount: extra?.tx ?? 0,
  };
}

function ttmEntry(revenue: number, expenses: number, net: number, savings: number) {
  const mc = (current: number) => ({ current, previous: 0, delta: 0, percentChange: null });
  return { revenue: mc(revenue), expenses: mc(expenses), netCashFlow: mc(net), savingsRate: mc(savings) };
}

function model(over: Partial<Record<string, unknown>> = {}): DashboardModel {
  const base = {
    monthlyRollups: [],
    kpiComparisonByTimeframe: { ttm: ttmEntry(0, 0, 0, 0) },
    runway: {
      status: 'ok',
      months: 12,
      netBurn: 100,
      grossBurn: 200,
      currentCashBalance: 5000,
      reserveTarget: 10000,
      percentFunded: 0.5,
    },
    expenseSlices: [{ name: 'Rent', value: 1000, share: 0.4, color: '#111' }],
    cashFlowForecastSeries: [],
    topPayees: [],
    // Dashboard-signal fields (required on DashboardModel; safe empties so any financial-live fixture
    // that doesn't override them still serializes without crashing). fullLive() sets real values.
    kpiCards: [],
    movers: [],
    trajectorySignals: [],
    suggestedRevenueMargin: 0,
    suggestedExpenseMargin: 0,
    suggestedMarginJustification: '',
    uncategorizedWarning: null,
  };
  return { ...base, ...over } as unknown as DashboardModel;
}

// Composed forward projection point (only the fields the builder reads matter; cashIn/cashOut mirror
// operating for the fixture). endingCashBalance is the month-end position the export surfaces.
function scenPoint(month: string, cashIn: number, cashOut: number, endingCashBalance: number): ScenarioPoint {
  return {
    month,
    operatingCashIn: cashIn,
    operatingCashOut: cashOut,
    cashIn,
    cashOut,
    netCashFlow: cashIn - cashOut,
    endingCashBalance,
  };
}

function retMonth(periodMonth: string, over: Partial<RetentionMonth> = {}): RetentionMonth {
  return {
    periodMonth,
    currentMembers: 100,
    priorMembers: 98,
    lostMembers: 4,
    newMembers: 6,
    returningMembers: 94,
    retentionRate: 0.95,
    isSeedBoundary: false,
    ...over,
  };
}

// An empty per-band recency slice (no absences, no unknowns).
function emptyRecency() {
  return { countsByDaysAbsent: {} as Record<string, number>, overflow365Plus: 0, unknownRecency: 0 };
}

// A live tenure histogram: every band + the unknown-tenure bucket present (deterministic contract),
// with one seeded band so the export's per-band risk split is non-trivial. At threshold 21 /
// WATCH_FLOOR 8 the seeded lt3m band → healthy 10 (day 2), watch 5 (day 10), silent 4 (day 30 + 1
// overflow), unknown_recency 2 ⇒ active_total 21.
function tenureHist(): TenureBandHistogram {
  const bands: Record<string, ReturnType<typeof emptyRecency>> = {};
  for (const b of TENURE_BANDS) bands[b.id] = emptyRecency();
  bands[UNKNOWN_TENURE_ID] = emptyRecency();
  bands.lt3m = { countsByDaysAbsent: { '2': 10, '10': 5, '30': 3 }, overflow365Plus: 1, unknownRecency: 2 };
  return { bandEdges: TENURE_BANDS.map(({ id, minDays }) => ({ id, minDays })), bands };
}

function snap(
  counts: Record<string, number>,
  over?: {
    overflow?: number;
    unknown?: number;
    asOf?: string;
    dues?: { totalMonthly: number } | null;
    // `undefined` ⇒ default live histogram; explicit `null` ⇒ per-field absent (pre-migration / mismatch).
    tenure?: TenureBandHistogram | null;
    cohortHist?: CohortHistogram | null;
  },
): RetentionAggregateSnapshot {
  return {
    asOf: over?.asOf ?? '2026-06-28',
    unknown: over?.unknown ?? 0,
    daysAbsentHistogram: { countsByDaysAbsent: counts, overflow365Plus: over?.overflow ?? 0 },
    dues: over?.dues ?? null,
    tenureBands: over?.tenure === undefined ? tenureHist() : over.tenure,
    cohorts: over?.cohortHist === undefined ? SAMPLE_COHORT_HISTOGRAM : over.cohortHist,
  } as unknown as RetentionAggregateSnapshot;
}

// Financial-lever results (drilled from Dashboard). Empty variants for BASE; fullLive() sets real values.
function emptyEfficiency() {
  return {
    windowLabel: '',
    rows: [],
    totalExtraPerMonth: 0,
    payrollExtraPerMonth: null,
    payrollTodayPct: null,
    payrollBestPct: null,
    payrollBestWindowLabel: null,
    payrollRollingSeries: [],
    benchmarkRevenueQualified: false,
  } as unknown as MonthlySourceExportInputs['efficiencyResult'];
}
function emptyWhatNeedsAttention() {
  return {
    currentMonth: '',
    baselineMonths: '',
    noData: true,
    rows: [],
  } as unknown as MonthlySourceExportInputs['whatNeedsAttention'];
}
// Degenerate owner-distribution status (margin unset / no data) — the neutral zero/null result.
function degenerateOwnerStatus(): MonthlySourceExportInputs['ownerDistributionStatus'] {
  return { status: 'on_target', targetAmount: 0, actualAmount: 0, windowStart: null, windowEnd: null };
}

// Live belt series ending at 2026-06 (max period == financial/retention month ⇒ no divergence in fullLive).
function beltRows(): BeltRetentionRow[] {
  return [
    { periodMonth: '2026-05', segment: 'adults', beltBand: 'White', activeCount: 40, lostCount: 3 },
    { periodMonth: '2026-06', segment: 'adults', beltBand: 'White', activeCount: 42, lostCount: 2 },
    { periodMonth: '2026-06', segment: 'kids', beltBand: 'Gray', activeCount: 25, lostCount: 1 },
  ];
}
// Live cohort-rate series ending at 2026-06, mixing a normal row and a SUPPRESSED row (all-null counts).
function cohortRateRows(): CohortRetentionRow[] {
  return [
    { periodMonth: '2026-05', cohortBand: 'adults16plus', newMembers: 5, returningMembers: 90, lostMembers: 4, suppressed: false },
    { periodMonth: '2026-06', cohortBand: 'adults16plus', newMembers: 6, returningMembers: 92, lostMembers: 3, suppressed: false },
    { periodMonth: '2026-06', cohortBand: 'youth3to15', newMembers: null, returningMembers: null, lostMembers: null, suppressed: true },
  ];
}

const BASE: MonthlySourceExportInputs = {
  model: model(),
  financialTxnCount: 0,
  currentCalendarMonth: '2026-07',
  financialBasis: 'operating',
  scenarioProjection: [],
  scenarioRunOutMonth: null,
  efficiencyResult: emptyEfficiency(),
  whatNeedsAttention: emptyWhatNeedsAttention(),
  ownerDistributionStatus: degenerateOwnerStatus(),
  ownerPayProjection: [],
  ownerPayReserveFloor: 0,
  targetNetMargin: 0,
  retentionRates: null,
  snapshot: null,
  beltRetention: null,
  cohortRetention: null,
  thresholdDays: 21,
  generatedAt: '2026-07-06T14:00:00Z',
};

// 9-point owner-pay projection (satisfies computeNextOwnerDistribution's REQUIRED_SERIES_LENGTH). Cash
// sits well above the reserve floor in every 4-month window ⇒ a forecast at the first display month.
function ownerPay9(endingBalance = 50000): MonthlySourceExportInputs['ownerPayProjection'] {
  return Array.from({ length: 9 }, (_, i) =>
    scenPoint(shiftMonthToken('2026-07', i), 10000, 8000, endingBalance),
  );
}
// Local month shifter for fixtures (the builder's own shiftMonth is not exported).
function shiftMonthToken(start: string, delta: number): string {
  const [y, m] = start.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// A fully-live input: financial through 2026-06, retention series, live snapshot, projected forecast.
function fullLive(): MonthlySourceExportInputs {
  return {
    ...BASE,
    model: model({
      monthlyRollups: [
        rollup('2025-06', 8000, 6000, { savings: 0.25, tx: 40 }), // YoY partner
        rollup('2026-05', 9000, 7000, { savings: 0.22, tx: 44 }), // prior month
        rollup('2026-06', 10000, 7500, { savings: 0.25, tx: 50 }), // scorecard month
        rollup('2026-07', 3000, 2000, { savings: 0.33, tx: 12 }), // partial current — must be excluded
      ],
      kpiComparisonByTimeframe: { ttm: ttmEntry(110000, 85000, 25000, 0.23) },
      // Dashboard signals — real values for deterministic assertions.
      kpiCards: [
        {
          id: 'revenue',
          label: 'Revenue',
          value: 10000,
          previousValue: 9000,
          deltaPercent: 0.1,
          trend: 'up',
          sentiment: 'up',
          format: 'currency',
        },
      ],
      movers: [
        {
          category: 'Facilities',
          current: 1200,
          previous: 800,
          delta: 400,
          deltaPercent: 0.5,
          priorityScore: 0.9,
          sparkline: [1, 2, 3], // must NOT appear in the export
        },
      ],
      trajectorySignals: [
        {
          id: 'monthlyTrend',
          label: 'Monthly trend',
          timeframe: 'thisMonth',
          currentStartMonth: '2026-06',
          currentEndMonth: '2026-06',
          previousStartMonth: '2026-05',
          previousEndMonth: '2026-05',
          currentMonthCount: 1,
          previousMonthCount: 1,
          currentNetCashFlow: 2500,
          previousNetCashFlow: 2000,
          delta: 500,
          percentChange: 0.25,
          direction: 'up',
          light: 'green',
          hasSufficientHistory: true,
        },
      ],
      suggestedRevenueMargin: 0.6,
      suggestedExpenseMargin: 0.4,
      suggestedMarginJustification: 'Based on TTM',
      uncategorizedWarning: { count: 3, absoluteAmount: 450 },
      cashFlowForecastSeries: [
        { month: '2026-06', revenue: 10000, expenses: 7500, netCashFlow: 2500, status: 'actual' },
        { month: '2026-07', revenue: 10200, expenses: 7600, netCashFlow: 2600, status: 'projected' },
        { month: '2026-08', revenue: 10400, expenses: 7700, netCashFlow: 2700, status: 'projected' },
      ],
    }),
    financialTxnCount: 146,
    // Composed projection (future months only; must not overlap actuals through 2026-06). Cash climbs,
    // so it never runs out within the horizon.
    scenarioProjection: [
      scenPoint('2026-07', 10200, 7600, 27600),
      scenPoint('2026-08', 10400, 7700, 30300),
    ],
    scenarioRunOutMonth: null,
    // Financial levers — real values for deterministic assertions. Render-only geometry (bar widths,
    // window details, chart series, sparkline) is populated so the tests can prove it is dropped.
    efficiencyResult: {
      windowLabel: 'Apr – Jun 2026',
      rows: [
        {
          category: 'Marketing',
          bestPct: 8,
          todayPct: 12,
          extraPerMonth: 400,
          bestPeriodLabel: 'was 8% avg (Jan–Mar 2026)',
          greenWidthPct: 60, // geometry — must NOT appear
          redWidthPct: 40, // geometry — must NOT appear
          bestWindow: { label: 'Jan – Mar 2026', months: [] }, // must NOT appear
          todayWindow: { label: 'Apr – Jun 2026', months: [] }, // must NOT appear
        },
      ],
      totalExtraPerMonth: 400,
      payrollExtraPerMonth: 250,
      payrollTodayPct: 35,
      payrollBestPct: 30,
      payrollBestWindowLabel: 'Jan – Mar 2026',
      payrollRollingSeries: [{ label: 'chart-series-secret', payrollPct: 33 }], // must NOT appear
      benchmarkRevenueQualified: true,
    } as unknown as MonthlySourceExportInputs['efficiencyResult'],
    whatNeedsAttention: {
      currentMonth: 'Jun 2026',
      baselineMonths: 'Dec 2025 – May 2026',
      noData: false,
      rows: [
        {
          categoryName: 'Utilities',
          bucket: 'fixed',
          currentSpend: 800,
          expectedSpend: 500,
          delta: 300,
          currentRatio: 0.08,
          baselineRatio: 0.05,
          currentAvgSpend: 800,
          baselineAvgSpend: 500,
          currentRevenue: 10000,
          sparklineData: [1, 2, 3, 4, 5, 6], // must NOT appear
        },
      ],
    } as unknown as MonthlySourceExportInputs['whatNeedsAttention'],
    // Owner distributions — real trailing-12 status (windowEnd = scorecard month in the normal case)
    // + a 9-point projection that yields a forecast at the first display month.
    ownerDistributionStatus: {
      status: 'below_target',
      targetAmount: 30000,
      actualAmount: 20000,
      windowStart: '2025-07',
      windowEnd: '2026-06',
    },
    ownerPayProjection: ownerPay9(),
    ownerPayReserveFloor: 10000,
    targetNetMargin: 0.25,
    retentionRates: [
      retMonth('2025-06', { isSeedBoundary: true }), // seed — must be dropped
      retMonth('2025-07'),
      retMonth('2026-06', { retentionRate: 0.93 }),
    ],
    snapshot: snap({ '2': 120, '10': 41 }, { overflow: 5, unknown: 8, dues: { totalMonthly: 2400 } }),
    beltRetention: beltRows(),
    cohortRetention: cohortRateRows(),
  };
}

describe('buildMonthlySourceExport', () => {
  it('1. full live → all blocks present, usable, months derived', () => {
    const out = buildMonthlySourceExport(fullLive()) as any;
    expect(out.schema_version).toBe('0.1');
    expect(out.business).toBe('Gracie Sports');
    expect(out.scorecard_month).toBe('2026-06');
    expect(out.planning_month).toBe('2026-07');
    expect(out.usable_for_attack_plan).toBe(true);
    // financial_monthly excludes the partial current month (2026-07)
    expect(out.financial_monthly.map((m: any) => m.month)).toEqual(['2025-06', '2026-05', '2026-06']);
    expect(out.financial_comparisons.revenue).toEqual({
      this_month: 10000,
      prior_month: 9000,
      yoy_same_month: 8000,
      ttm: 110000,
    });
    expect(out.financial_comparisons.savings_rate.yoy_same_month).toBeNull(); // monthly savings YoY omitted
    expect(out.financial_comparisons.savings_rate.ttm).toBe(0.23);
    expect(out.runway.current_cash_balance).toBe(5000);
    expect(out.top_expense_categories).toEqual([{ name: 'Rent', value: 1000, share: 0.4 }]);
    expect(out.forecast.basis).toBe('projection');
    expect(out.membership_retention_monthly.map((m: any) => m.month)).toEqual(['2025-07', '2026-06']); // seed dropped
    expect(out.attendance_snapshot.as_of).toBe('2026-06-28');
    expect(out.missing_or_unavailable).toEqual([]);
  });

  it('2. PII exclusion — payees/memos/accounts never serialized', () => {
    const withPii = fullLive();
    (withPii.model as any).topPayees = [
      { payee: 'Jane Secret Payee', amount: 999, transactionCount: 3 },
    ];
    const json = JSON.stringify(buildMonthlySourceExport(withPii));
    expect(json).not.toContain('Jane Secret Payee');
    expect(json).not.toContain('"payee"');
    expect(json).not.toContain('"memo"');
    expect(json).not.toContain('"account"');
    expect(json).not.toContain('"transferAccount"');
    expect(json).not.toContain('top_payees');
    // interpretive / member-identity model fields never leak, even when populated
    (withPii.model as any).opportunities = [{ title: 'Secret Opp', savings: 100, hint: 'secret hint' }];
    (withPii.model as any).summaryBullets = ['Secret bullet'];
    (withPii.model as any).digHerePreview = [{ title: 'Dig Secret', savings: 5, hint: 'x' }];
    const json2 = JSON.stringify(buildMonthlySourceExport(withPii));
    expect(json2).not.toContain('Secret Opp');
    expect(json2).not.toContain('Secret bullet');
    expect(json2).not.toContain('Dig Secret');
    expect(json2).not.toContain('opportunities');
    expect(json2).not.toContain('summaryBullets');
    expect(json2).not.toContain('summary_bullets');
    expect(json2).not.toContain('dig_here');
    // financial-lever render-only geometry / chart series never leak
    expect(json2).not.toContain('greenWidthPct');
    expect(json2).not.toContain('redWidthPct');
    expect(json2).not.toContain('bestWindow');
    expect(json2).not.toContain('todayWindow');
    expect(json2).not.toContain('payrollRollingSeries');
    expect(json2).not.toContain('chart-series-secret');
    expect(json2).not.toContain('sparklineData');
    expect(json2).not.toContain('sparkline');
    // owner-distribution next-distribution bar geometry never leaks
    expect(json2).not.toContain('bars');
    expect(json2).not.toContain('reserveSegment');
    expect(json2).not.toContain('safeCashSegment');
    expect(json2).not.toContain('distributionSegment');
    expect(json2).not.toContain('endingCashBeforePayout');
  });

  it('3. financial missing → blocks omitted, code, unusable', () => {
    const out = buildMonthlySourceExport({
      ...fullLive(),
      financialTxnCount: 0,
    }) as any;
    expect(out.financial_monthly).toBeUndefined();
    expect(out.financial_comparisons).toBeUndefined();
    expect(out.runway).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('financial:no_import');
    expect(out.usable_for_attack_plan).toBe(false);
  });

  it('4. membership retention missing → omitted, code, unusable', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), retentionRates: null }) as any;
    expect(out.membership_retention_monthly).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('retention_rates:not_live');
    expect(out.usable_for_attack_plan).toBe(false);
  });

  it('5. attendance snapshot missing → omitted, code, usability unchanged', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), snapshot: null }) as any;
    expect(out.attendance_snapshot).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('retention_snapshot:not_live');
    expect(out.usable_for_attack_plan).toBe(true); // required domains still live
  });

  it('6. snapshot live → buckets equal deriveBuckets; dues honest (never fabricated $0)', () => {
    const input = fullLive();
    const expected = deriveBuckets(input.snapshot!, input.thresholdDays);
    const out = buildMonthlySourceExport(input) as any;
    expect(out.attendance_snapshot.high_risk).toBe(expected.silent);
    expect(out.attendance_snapshot.healthy).toBe(expected.healthy);
    expect(out.attendance_snapshot.watch).toBe(expected.watch);
    // active_total = KNOWN base (healthy+watch+high_risk), mirroring the Retention page — it EXCLUDES
    // unknown, so it is deriveBuckets.activeTotal minus unknown, and unknown is reported separately.
    expect(out.attendance_snapshot.active_total).toBe(expected.healthy + expected.watch + expected.silent);
    expect(out.attendance_snapshot.active_total).toBe(expected.activeTotal - expected.unknown);
    expect(out.attendance_snapshot.unknown).toBe(expected.unknown);
    expect(out.attendance_snapshot.threshold_days).toBe(expected.thresholdDays);
    expect(out.attendance_snapshot.silent_monthly_dues_at_risk).toBe(2400);

    // dues absent → null, never 0
    const noDues = { ...input, snapshot: snap({ '2': 10 }, { dues: null }) };
    const out2 = buildMonthlySourceExport(noDues) as any;
    expect(out2.attendance_snapshot.silent_monthly_dues_at_risk).toBeNull();
  });

  it('7. forecast available → labeled projection, kept separate from actuals', () => {
    const out = buildMonthlySourceExport(fullLive()) as any;
    expect(out.forecast.basis).toBe('projection');
    expect(out.forecast.note).toMatch(/projection/i);
    // provenance.latest_month tracks the forecast horizon (last projected month), not the actuals anchor
    expect(out.provenance.forecast.latest_month).toBe('2026-08');
    expect(out.scorecard_month).toBe('2026-06'); // ≠ forecast latest_month, proving they're decoupled
    const forecastMonths = out.forecast.series.map((s: any) => s.month);
    expect(forecastMonths).toEqual(['2026-07', '2026-08']); // composed projection months
    const actualMonths = out.financial_monthly.map((m: any) => m.month);
    // no month appears in both actuals and forecast
    expect(forecastMonths.some((m: string) => actualMonths.includes(m))).toBe(false);
  });

  it('8. forecast missing → omitted, code, usability unchanged', () => {
    const input = fullLive();
    input.scenarioProjection = []; // no composed projection ⇒ forecast unavailable
    input.scenarioRunOutMonth = null;
    const out = buildMonthlySourceExport(input) as any;
    expect(out.forecast).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('forecast:not_available');
    expect(out.usable_for_attack_plan).toBe(true);
  });

  it('9. scorecard/planning month derivation incl. December rollover', () => {
    const normal = buildMonthlySourceExport(fullLive()) as any;
    expect([normal.scorecard_month, normal.planning_month]).toEqual(['2026-06', '2026-07']);

    const dec = buildMonthlySourceExport({
      ...fullLive(),
      currentCalendarMonth: '2027-01',
      model: model({
        monthlyRollups: [rollup('2026-11', 9000, 7000), rollup('2026-12', 10000, 7500)],
        kpiComparisonByTimeframe: { ttm: ttmEntry(1, 1, 1, 1) },
        cashFlowForecastSeries: [],
      }),
    }) as any;
    expect([dec.scorecard_month, dec.planning_month]).toEqual(['2026-12', '2027-01']);
  });

  it('11. txns present but no complete month → card gate and payload agree (both not usable)', () => {
    // Only the partial current month has data — the builder's financial gate (txns>0 AND a complete
    // month exists) fails, and the Export card derives its "Financial: Live" status from the SAME
    // latestCompleteMonth() helper. They must agree: not live, not usable.
    const input: MonthlySourceExportInputs = {
      ...fullLive(),
      currentCalendarMonth: '2026-07',
      financialTxnCount: 42, // txns exist...
      model: model({
        monthlyRollups: [rollup('2026-07', 3000, 2000, { tx: 42 })], // ...but only the partial current month
        kpiComparisonByTimeframe: { ttm: ttmEntry(1, 1, 1, 1) },
        cashFlowForecastSeries: [],
      }),
    };

    // What the card gates on:
    const cardFinancialLive =
      input.financialTxnCount > 0 &&
      latestCompleteMonth(input.model.monthlyRollups, input.currentCalendarMonth) !== null;
    expect(cardFinancialLive).toBe(false);

    // What the payload reports:
    const out = buildMonthlySourceExport(input) as any;
    expect(out.usable_for_attack_plan).toBe(false);
    expect(out.missing_or_unavailable).toContain('financial:no_complete_month');
    expect(out.financial_monthly).toBeUndefined();
    expect(out.provenance.financial.source).toBe('missing');
  });

  it('12. integrity — scope declared, full-live reconciles clean', () => {
    const out = buildMonthlySourceExport(fullLive()) as any;
    expect(out.scope.covered_domains).toEqual([
      'financial_actuals',
      'dashboard_signals',
      'financial_levers',
      'owner_distributions',
      'forecast',
      'membership_retention',
      'attendance_snapshot',
      'tenure_bands',
      'cohort_recency_histogram',
      'belt_retention',
      'cohort_retention_rates',
    ]);
    expect(out.scope.present_domains).toEqual(out.scope.covered_domains); // all live
    expect(out.scope.absent_domains).toEqual([]);
    // reconciliation invariant: absent in-scope domains map 1:1 onto missing codes
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
    expect(out.warnings).toEqual([]); // all blocks anchor on 2026-06
    // out-of-scope card families are declared, never counted as "missing"
    expect(out.scope.note).toMatch(/out of scope/i);
    expect(out.scope.note).toMatch(/Money Left on the Table/);
    expect(out.scope.covered_domains).not.toContain('payroll_efficiency');
  });

  it('13. integrity — absent in-scope domains reconcile 1:1 with missing_or_unavailable', () => {
    const input = fullLive();
    input.snapshot = null; // attendance out
    input.scenarioProjection = []; // forecast out
    input.scenarioRunOutMonth = null;
    const out = buildMonthlySourceExport(input) as any;
    // dashboard_signals + financial_levers + owner_distributions ride on financialLive (true here).
    expect(out.scope.present_domains).toEqual([
      'financial_actuals',
      'dashboard_signals',
      'financial_levers',
      'owner_distributions',
      'membership_retention',
      'belt_retention',
      'cohort_retention_rates',
    ]);
    expect(out.scope.absent_domains).toEqual([
      'forecast',
      'attendance_snapshot',
      'tenure_bands',
      'cohort_recency_histogram',
    ]);
    // every covered domain is present XOR absent, and absent count === missing code count
    expect(out.scope.present_domains.length + out.scope.absent_domains.length).toBe(
      out.scope.covered_domains.length,
    );
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
    expect(out.missing_or_unavailable).toContain('forecast:not_available');
    expect(out.missing_or_unavailable).toContain('retention_snapshot:not_live');
  });

  it('14. integrity — as_of divergence warning when blocks anchor to different months', () => {
    const input = fullLive();
    // attendance snapshot moves to July while financial + retention stay on June
    input.snapshot = snap(
      { '2': 120, '10': 41 },
      { overflow: 5, unknown: 8, asOf: '2026-07-06', dues: { totalMonthly: 2400 } },
    );
    const out = buildMonthlySourceExport(input) as any;
    expect(out.as_of).toEqual({
      financial: '2026-06',
      cash: '2026-07-06', // point-in-time generated_at day — in as_of, NOT a periodAnchor
      dashboard_signals: '2026-06', // shares the financial month — never a new divergence token
      financial_levers: '2026-06', // ditto
      owner_distributions: '2026-06', // ditto (anchor is the month, not the trailing-12 window)
      retention_rates: '2026-06',
      attendance_snapshot: '2026-07-06',
      tenure_bands: '2026-07-06', // shares attendance's snapshot day — no new divergence token
      cohort_recency_histogram: '2026-07-06', // ditto
      belt_retention: '2026-06', // independent monthly series — max period row
      cohort_retention_rates: '2026-06',
    });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/as_of_divergence/);
    expect(out.warnings[0]).toContain('financial=2026-06');
    expect(out.warnings[0]).toContain('attendance_snapshot=2026-07');
  });

  it('C13. cash point-in-time note + as_of.cash day anchor; not a divergence token', () => {
    const input = fullLive();
    const out = buildMonthlySourceExport(input) as any;
    // note sits on the runway block, documents the point-in-time gap, warns against reconciling
    expect(out.runway.current_cash_balance_note).toMatch(/point-in-time/);
    expect(out.runway.current_cash_balance_note).toMatch(/do NOT reconcile/i);
    expect(out.runway.current_cash_balance_note).toMatch(/in-progress current month/);
    expect(out.runway.current_cash_balance).toBe(5000); // value itself unchanged
    // as_of.cash = the generated_at DAY (point-in-time)
    expect(out.as_of.cash).toBe(input.generatedAt.slice(0, 10));
    expect(out.as_of.cash).toBe('2026-07-06');
    // fullLive is all-aligned on 2026-06 → cash (a July day) is NOT in periodAnchors, so no warning fires
    expect(out.warnings).toEqual([]);
  });

  it('C14. not financial-live → as_of.cash null and no runway block (note absent)', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), financialTxnCount: 0 }) as any;
    expect(out.as_of.cash).toBeNull();
    expect(out.runway).toBeUndefined();
  });

  it('15. forecast carries the composed projection: ending balance, run-out, raw reserve', () => {
    const input = fullLive();
    input.scenarioRunOutMonth = '2026-08'; // cash crosses below $0 in Aug
    const out = buildMonthlySourceExport(input) as any;
    // projected_cash_balance comes straight from ScenarioPoint.endingCashBalance (the real ending
    // balance the naive cashFlowForecastSeries never carried)
    expect(out.forecast.series.map((s: any) => s.projected_cash_balance)).toEqual([27600, 30300]);
    expect(out.forecast.series[0].projected_net_cash_flow).toBe(2600); // cashIn − cashOut
    // run-out month carried through (a $0 crossing, reserve-independent)
    expect(out.forecast.scenario_run_out_month).toBe('2026-08');
    // reserve_target is the RAW runway reserve (what computeForecastDecisionSignals consumes), NOT the
    // Settings-override-aware owner-pay floor — and it agrees with the runway block's reserve.
    expect(out.forecast.reserve_target).toBe(10000);
    expect(out.forecast.reserve_target).toBe(out.runway.reserve_target);
    // runway is labeled a trailing-operating basis, deliberately distinct from the forward run-out
    expect(out.runway.basis).toBe('trailing_operating');
  });

  it('16. run-out null (cash never crosses $0) is carried honestly', () => {
    const out = buildMonthlySourceExport(fullLive()) as any; // fullLive climbs, never runs out
    expect(out.forecast.scenario_run_out_month).toBeNull();
  });

  it('17. attendance active_total mirrors the Retention known base (excludes unknown)', () => {
    const out = buildMonthlySourceExport(fullLive()) as any;
    // fullLive snapshot: {2:120, 10:41}, overflow 5, unknown 8, threshold 21, WATCH_FLOOR 8
    // → healthy 120, watch 41, high_risk(silent) 5, unknown 8. Known base = 166, not 174.
    expect(out.attendance_snapshot.active_total).toBe(166);
    expect(out.attendance_snapshot.unknown).toBe(8);
    expect(out.attendance_snapshot.active_base_note).toMatch(/excluded from active_total/i);
  });

  it('18. financial_comparisons carries a ttm_window (model bounds preferred, else derived)', () => {
    // fixture ttmEntry() carries no window → fallback: trailing-12 ending at the scorecard month
    const derived = buildMonthlySourceExport(fullLive()) as any;
    expect(derived.financial_comparisons.ttm_window).toEqual({ start: '2025-07', end: '2026-06' });

    // when the model carries an explicit TTM window, it is preferred verbatim
    const withWindow = fullLive();
    (withWindow.model as any).kpiComparisonByTimeframe = {
      ttm: {
        ...ttmEntry(110000, 85000, 25000, 0.23),
        currentStartMonth: '2025-05',
        currentEndMonth: '2026-04',
      },
    };
    const out = buildMonthlySourceExport(withWindow) as any;
    expect(out.financial_comparisons.ttm_window).toEqual({ start: '2025-05', end: '2026-04' });
  });

  it('19. dashboard signals — deterministic serialized values, sparkline dropped', () => {
    const out = buildMonthlySourceExport(fullLive()) as any;
    expect(out.kpi_cards).toEqual([
      {
        id: 'revenue',
        label: 'Revenue',
        value: 10000,
        previous_value: 9000,
        delta_percent: 0.1,
        trend: 'up',
        sentiment: 'up',
        format: 'currency',
      },
    ]);
    expect(out.category_movers).toEqual([
      {
        category: 'Facilities',
        current: 1200,
        previous: 800,
        delta: 400,
        delta_percent: 0.5,
        priority_score: 0.9,
      },
    ]);
    expect(out.category_movers[0].sparkline).toBeUndefined(); // intra-category series dropped
    expect(out.trajectory_signals).toEqual([
      {
        id: 'monthlyTrend',
        label: 'Monthly trend',
        timeframe: 'thisMonth',
        current_start_month: '2026-06',
        current_end_month: '2026-06',
        previous_start_month: '2026-05',
        previous_end_month: '2026-05',
        current_month_count: 1,
        previous_month_count: 1,
        current_net_cash_flow: 2500,
        previous_net_cash_flow: 2000,
        delta: 500,
        percent_change: 0.25,
        direction: 'up',
        light: 'green',
        has_sufficient_history: true,
      },
    ]);
    expect(out.suggested_margins).toEqual({
      revenue_margin: 0.6,
      expense_margin: 0.4,
      justification: 'Based on TTM',
    });
    expect(out.uncategorized_warning).toEqual({ count: 3, absolute_amount: 450 });
    // anchored on the financial month, and declared model-derived (not recomputed)
    expect(out.as_of.dashboard_signals).toBe('2026-06');
    expect(out.provenance.dashboard_signals.source).toBe('model');
    expect(out.provenance.dashboard_signals.basis).toBe('derived_signal');
  });

  it('20. uncategorized_warning is present-but-null when live with no active warning', () => {
    const input = fullLive();
    (input.model as any).uncategorizedWarning = null;
    const out = buildMonthlySourceExport(input) as any;
    expect(out.uncategorized_warning).toBeNull();
    expect('uncategorized_warning' in out).toBe(true); // key present, value null
    // a null warning is NOT a missing domain — no code, dashboard_signals still present
    expect(out.missing_or_unavailable).not.toContain('dashboard_signals:not_live');
    expect(out.scope.present_domains).toContain('dashboard_signals');
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('21. dashboard signals gated on financialLive — omitted + one code, reconciles 1:1', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), financialTxnCount: 0 }) as any;
    expect(out.kpi_cards).toBeUndefined();
    expect(out.category_movers).toBeUndefined();
    expect(out.trajectory_signals).toBeUndefined();
    expect(out.suggested_margins).toBeUndefined();
    expect(out.uncategorized_warning).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('dashboard_signals:not_live');
    expect(out.scope.absent_domains).toContain('dashboard_signals');
    expect(out.provenance.dashboard_signals).toEqual({ source: 'not_live' });
    expect(out.as_of.dashboard_signals).toBeNull();
    // the #544 reconciliation invariant holds with the new domain included
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('22. financial levers — deterministic serialized values, render geometry dropped', () => {
    const out = buildMonthlySourceExport(fullLive()) as any;
    expect(out.money_left).toEqual({
      window_label: 'Apr – Jun 2026',
      total_extra_per_month: 400,
      benchmark_revenue_qualified: true,
      rows: [
        {
          category: 'Marketing',
          today_pct: 12,
          best_pct: 8,
          extra_per_month: 400,
          best_period_label: 'was 8% avg (Jan–Mar 2026)',
        },
      ],
    });
    // no render geometry survived on the row
    expect(out.money_left.rows[0].greenWidthPct).toBeUndefined();
    expect(out.money_left.rows[0].bestWindow).toBeUndefined();
    expect(out.payroll_efficiency).toEqual({
      payroll_today_pct: 35,
      payroll_best_pct: 30,
      payroll_best_window_label: 'Jan – Mar 2026',
      payroll_extra_per_month: 250,
    });
    expect(out.payroll_efficiency.payrollRollingSeries).toBeUndefined();
    expect(out.cost_spikes).toEqual({
      current_month: 'Jun 2026',
      baseline_months: 'Dec 2025 – May 2026',
      no_data: false,
      rows: [
        {
          category_name: 'Utilities',
          bucket: 'fixed',
          current_spend: 800,
          expected_spend: 500,
          delta: 300,
          current_ratio: 0.08,
          baseline_ratio: 0.05,
          current_avg_spend: 800,
          baseline_avg_spend: 500,
          current_revenue: 10000,
        },
      ],
    });
    expect(out.cost_spikes.rows[0].sparklineData).toBeUndefined();
    // anchored on the financial month + declared model-derived
    expect(out.as_of.financial_levers).toBe('2026-06');
    expect(out.provenance.financial_levers.source).toBe('model');
    expect(out.provenance.financial_levers.basis).toBe('derived_signal');
  });

  it('23. cost_spikes no_data:true is a present-but-empty state, not a missing domain', () => {
    const input = fullLive();
    (input.whatNeedsAttention as any) = {
      currentMonth: 'Jun 2026',
      baselineMonths: '',
      noData: true,
      rows: [],
    };
    const out = buildMonthlySourceExport(input) as any;
    expect(out.cost_spikes.no_data).toBe(true);
    expect(out.cost_spikes.rows).toEqual([]);
    expect('cost_spikes' in out).toBe(true); // present
    expect(out.missing_or_unavailable).not.toContain('financial_levers:not_live');
    expect(out.scope.present_domains).toContain('financial_levers');
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('24. financial levers gated on financialLive — omitted + one code, reconciles 1:1', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), financialTxnCount: 0 }) as any;
    expect(out.money_left).toBeUndefined();
    expect(out.payroll_efficiency).toBeUndefined();
    expect(out.cost_spikes).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('financial_levers:not_live');
    expect(out.scope.absent_domains).toContain('financial_levers');
    expect(out.provenance.financial_levers).toEqual({ source: 'not_live' });
    expect(out.as_of.financial_levers).toBeNull();
    // #544 reconciliation holds with the new domain included
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('25. owner distributions — deterministic values; next_distribution forecast; drops bars', () => {
    const out = buildMonthlySourceExport(fullLive()) as any;
    expect(out.owner_distributions.basis).toBe('trailing_12_actual_vs_target');
    expect(out.owner_distributions.note).toMatch(/do NOT reconcile/i);
    expect(out.owner_distributions.window).toEqual({ start: '2025-07', end: '2026-06' });
    expect(out.owner_distributions.target_net_margin).toBe(0.25);
    expect(out.owner_distributions.target_configured).toBe(true);
    expect(out.owner_distributions.target_amount).toBe(30000);
    expect(out.owner_distributions.actual_amount).toBe(20000);
    expect(out.owner_distributions.status).toBe('below_target');
    // 9-point projection well above the floor → forecast at the first display month; bars dropped
    expect(out.owner_distributions.next_distribution).toEqual({
      state: 'forecast',
      month_label: 'Jul 2026',
      distribution_amount: 40000,
    });
    expect(out.owner_distributions.next_distribution.bars).toBeUndefined();
    expect(out.as_of.owner_distributions).toBe('2026-06');
    expect(out.provenance.owner_distributions.source).toBe('model');
    expect(out.provenance.owner_distributions.basis).toBe('trailing_12');
  });

  it('26. owner distributions window comes from the helper bounds, NOT scorecard_month', () => {
    // The trailing-12 slice can end on the PARTIAL current month. Prove window.end tracks the helper,
    // not the scorecard month (they must be able to differ).
    const input = fullLive();
    input.ownerDistributionStatus = {
      status: 'below_target',
      targetAmount: 30000,
      actualAmount: 20000,
      windowStart: '2025-08',
      windowEnd: '2026-07', // partial current month — later than scorecard_month
    };
    const out = buildMonthlySourceExport(input) as any;
    expect(out.owner_distributions.window).toEqual({ start: '2025-08', end: '2026-07' });
    expect(out.scorecard_month).toBe('2026-06');
    expect(out.owner_distributions.window.end).not.toBe(out.scorecard_month); // decoupled
  });

  it('27. degenerate owner status (margin unset) → target_configured:false, window:null, no code', () => {
    const input = fullLive();
    input.targetNetMargin = 0;
    input.ownerDistributionStatus = degenerateOwnerStatus();
    const out = buildMonthlySourceExport(input) as any;
    expect(out.owner_distributions.target_configured).toBe(false);
    expect(out.owner_distributions.target_net_margin).toBeNull();
    expect(out.owner_distributions.window).toBeNull();
    expect(out.owner_distributions.target_amount).toBe(0);
    expect(out.owner_distributions.status).toBe('on_target');
    // present-but-degraded — NOT a missing domain
    expect(out.missing_or_unavailable).not.toContain('owner_distributions:not_live');
    expect(out.scope.present_domains).toContain('owner_distributions');
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('28. next_distribution:unavailable when the projection has < 9 points (throw guarded)', () => {
    const input = fullLive();
    input.ownerPayProjection = ownerPay9().slice(0, 5); // only 5 points — helper would throw
    const out = buildMonthlySourceExport(input) as any;
    expect(out.owner_distributions.next_distribution).toEqual({ state: 'unavailable' });
    // still a present domain (owner status is live) — no missing code
    expect(out.missing_or_unavailable).not.toContain('owner_distributions:not_live');
  });

  it('29. next_distribution:blocked when cash sits below the reserve floor', () => {
    const input = fullLive();
    input.ownerPayProjection = ownerPay9(5000); // every month below the 10000 floor
    const out = buildMonthlySourceExport(input) as any;
    expect(out.owner_distributions.next_distribution.state).toBe('blocked');
    expect(out.owner_distributions.next_distribution.blocker).toBe('reserve_shortfall');
    expect(out.owner_distributions.next_distribution.bars).toBeUndefined();
  });

  it('30. owner distributions gated on financialLive — omitted + one code, reconciles 1:1', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), financialTxnCount: 0 }) as any;
    expect(out.owner_distributions).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('owner_distributions:not_live');
    expect(out.scope.absent_domains).toContain('owner_distributions');
    expect(out.provenance.owner_distributions).toEqual({ source: 'not_live' });
    expect(out.as_of.owner_distributions).toBeNull();
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('C1. tenure_bands + cohort_recency_histogram present & correct off a live snapshot', () => {
    const input = fullLive();
    const out = buildMonthlySourceExport(input) as any;

    // --- tenure: rows === the shared helper's per-band split (verbatim), bins dropped ---
    const tExp = computeChurnRiskByTenureFromAggregate(input.snapshot!.tenureBands!, input.thresholdDays);
    expect(out.tenure_bands.threshold_days).toBe(tExp.thresholdDays);
    expect(out.tenure_bands.band_edges).toEqual(input.snapshot!.tenureBands!.bandEdges); // verbatim {id,minDays}
    const tRows = [...tExp.bands, tExp.unknownTenure].map((b) => ({
      id: b.id,
      active_total: b.activeTotal,
      unknown_recency: b.unknownRecency,
      risk: { healthy: b.knownActiveTotal - b.watch - b.silent, watch: b.watch, silent: b.silent },
    }));
    expect(out.tenure_bands.bands).toEqual(tRows);
    // seeded band spot-check (threshold 21 / floor 8): healthy 10, watch 5, silent 4, unknown 2
    expect(out.tenure_bands.bands.find((b: any) => b.id === 'lt3m')).toEqual({
      id: 'lt3m',
      active_total: 21,
      unknown_recency: 2,
      risk: { healthy: 10, watch: 5, silent: 4 },
    });
    // the unknown-tenure bucket is surfaced as a row, never dropped
    expect(out.tenure_bands.bands.some((b: any) => b.id === UNKNOWN_TENURE_ID)).toBe(true);

    // --- cohort: rows === the shared helper's per-cohort split, lapsed carried (Read 2) ---
    const cExp = computeChurnRiskByCohortFromAggregate(input.snapshot!.cohorts!, input.thresholdDays);
    expect(out.cohort_recency_histogram.threshold_days).toBe(cExp.thresholdDays);
    expect(out.cohort_recency_histogram.cohort_edges).toEqual(input.snapshot!.cohorts!.cohortEdges);
    const cRows = [...cExp.bands, cExp.unknownCohort].map((c) => ({
      id: c.id,
      active_total: c.activeTotal,
      unknown_recency: c.unknownRecency,
      lapsed: c.lapsed,
      risk: { healthy: c.knownActiveTotal - c.watch - c.silent, watch: c.watch, silent: c.silent },
    }));
    expect(out.cohort_recency_histogram.cohorts).toEqual(cRows);
    expect(
      out.cohort_recency_histogram.cohorts.reduce((s: number, c: any) => s + c.lapsed, 0),
    ).toBe(cExp.lapsedTotal);

    // provenance + as_of; both share attendance's snapshot day ⇒ no new divergence token
    expect(out.provenance.tenure_bands).toEqual({
      source: 'model',
      basis: 'aggregate_snapshot',
      note: expect.stringMatching(/reused verbatim/i),
    });
    expect(out.provenance.cohort_recency_histogram.basis).toBe('aggregate_snapshot');
    expect(out.provenance.cohort_recency_histogram.note).toMatch(/DISTINCT from the cohort retention RATE/);
    expect(out.as_of.tenure_bands).toBe(input.snapshot!.asOf);
    expect(out.as_of.cohort_recency_histogram).toBe(input.snapshot!.asOf);
    expect(out.warnings).toEqual([]);
    expect(out.missing_or_unavailable).toEqual([]);
  });

  it('C2. tenureBands null → tenure block omitted + code; cohorts still present (per-field)', () => {
    const input = fullLive();
    input.snapshot = snap(
      { '2': 120, '10': 41 },
      { overflow: 5, unknown: 8, dues: { totalMonthly: 2400 }, tenure: null },
    );
    const out = buildMonthlySourceExport(input) as any;
    expect(out.tenure_bands).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('tenure_bands:not_live');
    expect(out.provenance.tenure_bands).toEqual({ source: 'not_live' });
    expect(out.as_of.tenure_bands).toBeNull();
    expect(out.scope.absent_domains).toContain('tenure_bands');
    // cohorts survive independently
    expect(out.cohort_recency_histogram).toBeDefined();
    expect(out.missing_or_unavailable).not.toContain('cohort_recency_histogram:not_live');
    expect(out.scope.absent_domains).not.toContain('cohort_recency_histogram');
    // attendance snapshot itself is still live (whole snapshot present)
    expect(out.attendance_snapshot).toBeDefined();
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('C3. cohorts null → cohort block omitted + code; tenure still present (symmetric)', () => {
    const input = fullLive();
    input.snapshot = snap(
      { '2': 120, '10': 41 },
      { overflow: 5, unknown: 8, dues: { totalMonthly: 2400 }, cohortHist: null },
    );
    const out = buildMonthlySourceExport(input) as any;
    expect(out.cohort_recency_histogram).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('cohort_recency_histogram:not_live');
    expect(out.provenance.cohort_recency_histogram).toEqual({ source: 'not_live' });
    expect(out.as_of.cohort_recency_histogram).toBeNull();
    expect(out.scope.absent_domains).toContain('cohort_recency_histogram');
    expect(out.tenure_bands).toBeDefined();
    expect(out.missing_or_unavailable).not.toContain('tenure_bands:not_live');
    expect(out.scope.absent_domains).not.toContain('tenure_bands');
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('C4. no snapshot → both blocks omitted + both codes (+ retention_snapshot), reconciles 1:1', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), snapshot: null }) as any;
    expect(out.tenure_bands).toBeUndefined();
    expect(out.cohort_recency_histogram).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('tenure_bands:not_live');
    expect(out.missing_or_unavailable).toContain('cohort_recency_histogram:not_live');
    expect(out.missing_or_unavailable).toContain('retention_snapshot:not_live');
    expect(out.scope.absent_domains).toEqual(
      expect.arrayContaining(['attendance_snapshot', 'tenure_bands', 'cohort_recency_histogram']),
    );
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('C5. raw per-day bins are DROPPED — decoy key/field never serialized (blocks still present)', () => {
    const input = fullLive();
    // Non-numeric decoy keys: Number(k)=NaN routes the count to `healthy`, so the COUNT still
    // aggregates — but the bin KEY and the countsByDaysAbsent structure must never be serialized.
    const decoyTenure = tenureHist();
    decoyTenure.bands.lt3m = {
      countsByDaysAbsent: { DECOY_TENURE_BIN: 3 },
      overflow365Plus: 0,
      unknownRecency: 0,
    };
    const decoyCohort = JSON.parse(JSON.stringify(SAMPLE_COHORT_HISTOGRAM)) as CohortHistogram;
    decoyCohort.cohorts.adults16plus.active.countsByDaysAbsent = { DECOY_COHORT_BIN: 5 };
    input.snapshot = snap({ '2': 10 }, { tenure: decoyTenure, cohortHist: decoyCohort });

    const json = JSON.stringify(buildMonthlySourceExport(input));
    expect(json).not.toContain('DECOY_TENURE_BIN');
    expect(json).not.toContain('DECOY_COHORT_BIN');
    expect(json).not.toContain('countsByDaysAbsent');
    expect(json).not.toContain('overflow365Plus');
    expect(json).not.toContain('unknownRecency'); // export uses snake_case unknown_recency

    // absence is the DROP, not a missing block — both blocks are present
    const out = buildMonthlySourceExport(input) as any;
    expect(out.tenure_bands).toBeDefined();
    expect(out.cohort_recency_histogram).toBeDefined();
  });

  it('C6. belt_retention + cohort_retention_rates present & correct off live series', () => {
    const input = fullLive();
    const out = buildMonthlySourceExport(input) as any;

    // belt: rows passed through verbatim (snake_cased), active/lost carried
    expect(out.belt_retention.rows).toEqual([
      { period_month: '2026-05', segment: 'adults', belt_band: 'White', active_count: 40, lost_count: 3 },
      { period_month: '2026-06', segment: 'adults', belt_band: 'White', active_count: 42, lost_count: 2 },
      { period_month: '2026-06', segment: 'kids', belt_band: 'Gray', active_count: 25, lost_count: 1 },
    ]);
    // cohort rates: rows passed through incl. the suppressed row's null triplet
    expect(out.cohort_retention_rates.rows).toEqual([
      { period_month: '2026-05', cohort_band: 'adults16plus', new_members: 5, returning_members: 90, lost_members: 4, suppressed: false },
      { period_month: '2026-06', cohort_band: 'adults16plus', new_members: 6, returning_members: 92, lost_members: 3, suppressed: false },
      { period_month: '2026-06', cohort_band: 'youth3to15', new_members: null, returning_members: null, lost_members: null, suppressed: true },
    ]);
    expect(out.cohort_retention_rates.note).toMatch(/Suppressed rows carry null counts/);

    // month anchors + provenance
    expect(out.as_of.belt_retention).toBe('2026-06');
    expect(out.as_of.cohort_retention_rates).toBe('2026-06');
    expect(out.provenance.belt_retention).toEqual({
      source: 'live',
      latest_month: '2026-06',
      note: expect.stringMatching(/No suppression/),
    });
    expect(out.provenance.cohort_retention_rates.source).toBe('live');
    expect(out.provenance.cohort_retention_rates.latest_month).toBe('2026-06');
    // no divergence — belt/cohort align on the retention month
    expect(out.warnings).toEqual([]);
    expect(out.missing_or_unavailable).toEqual([]);
  });

  it('C7. SUPPRESSION — null counts pass through verbatim, never coalesced to 0; all-suppressed still live', () => {
    const input = fullLive();
    input.cohortRetention = [
      { periodMonth: '2026-06', cohortBand: 'adults16plus', newMembers: 7, returningMembers: 88, lostMembers: 5, suppressed: false },
      { periodMonth: '2026-06', cohortBand: 'youth3to15', newMembers: null, returningMembers: null, lostMembers: null, suppressed: true },
    ];
    const out = buildMonthlySourceExport(input) as any;
    const suppressed = out.cohort_retention_rates.rows.find((r: any) => r.cohort_band === 'youth3to15');
    expect(suppressed.new_members).toBeNull();
    expect(suppressed.returning_members).toBeNull();
    expect(suppressed.lost_members).toBeNull();
    expect(suppressed.suppressed).toBe(true);
    // normal row counts intact
    const normal = out.cohort_retention_rates.rows.find((r: any) => r.cohort_band === 'adults16plus');
    expect(normal).toEqual({
      period_month: '2026-06',
      cohort_band: 'adults16plus',
      new_members: 7,
      returning_members: 88,
      lost_members: 5,
      suppressed: false,
    });
    // serialized JSON carries the null, NOT a fabricated 0
    const json = JSON.stringify(out.cohort_retention_rates);
    expect(json).toContain('"new_members":null');
    expect(json).not.toMatch(/"new_members":0\b/);

    // an ALL-suppressed series is still LIVE (block present, no not_live code)
    const allSup = fullLive();
    allSup.cohortRetention = [
      { periodMonth: '2026-06', cohortBand: 'adults16plus', newMembers: null, returningMembers: null, lostMembers: null, suppressed: true },
      { periodMonth: '2026-06', cohortBand: 'youth3to15', newMembers: null, returningMembers: null, lostMembers: null, suppressed: true },
    ];
    const out2 = buildMonthlySourceExport(allSup) as any;
    expect(out2.cohort_retention_rates).toBeDefined();
    expect(out2.cohort_retention_rates.rows).toHaveLength(2);
    expect(out2.missing_or_unavailable).not.toContain('cohort_retention_rates:not_live');
  });

  it('C8. belt null → belt block omitted + code; cohort rates still present (per-field, 1:1)', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), beltRetention: null }) as any;
    expect(out.belt_retention).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('belt_retention:not_live');
    expect(out.provenance.belt_retention).toEqual({ source: 'not_live' });
    expect(out.as_of.belt_retention).toBeNull();
    expect(out.scope.absent_domains).toContain('belt_retention');
    expect(out.cohort_retention_rates).toBeDefined();
    expect(out.scope.absent_domains).not.toContain('cohort_retention_rates');
    // optional — usability unaffected
    expect(out.usable_for_attack_plan).toBe(true);
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('C9. cohort rates null → cohort_retention_rates omitted + code; belt still present (symmetric)', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), cohortRetention: null }) as any;
    expect(out.cohort_retention_rates).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('cohort_retention_rates:not_live');
    expect(out.provenance.cohort_retention_rates).toEqual({ source: 'not_live' });
    expect(out.as_of.cohort_retention_rates).toBeNull();
    expect(out.scope.absent_domains).toContain('cohort_retention_rates');
    expect(out.belt_retention).toBeDefined();
    expect(out.usable_for_attack_plan).toBe(true);
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('C10. both null (also empty []) → both codes; usability unchanged; 1:1', () => {
    const out = buildMonthlySourceExport({ ...fullLive(), beltRetention: [], cohortRetention: null }) as any;
    expect(out.belt_retention).toBeUndefined(); // empty [] is not_live too
    expect(out.cohort_retention_rates).toBeUndefined();
    expect(out.missing_or_unavailable).toContain('belt_retention:not_live');
    expect(out.missing_or_unavailable).toContain('cohort_retention_rates:not_live');
    expect(out.usable_for_attack_plan).toBe(true);
    expect(out.scope.absent_domains.length).toBe(out.missing_or_unavailable.length);
  });

  it('C11. divergence — belt/cohort months lag the financial/retention month → warning lists them', () => {
    const input = fullLive();
    // both series end at 2026-04, older than the 2026-06 financial/retention months
    input.beltRetention = [
      { periodMonth: '2026-04', segment: 'adults', beltBand: 'White', activeCount: 38, lostCount: 2 },
    ];
    input.cohortRetention = [
      { periodMonth: '2026-04', cohortBand: 'adults16plus', newMembers: 4, returningMembers: 85, lostMembers: 3, suppressed: false },
    ];
    const out = buildMonthlySourceExport(input) as any;
    expect(out.as_of.belt_retention).toBe('2026-04');
    expect(out.as_of.cohort_retention_rates).toBe('2026-04');
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/as_of_divergence/);
    expect(out.warnings[0]).toContain('belt_retention=2026-04');
    expect(out.warnings[0]).toContain('cohort_retention_rates=2026-04');
  });

  it('C12. PII belt-and-suspenders — decoy fields on fetched rows never serialized', () => {
    const input = fullLive();
    (input.beltRetention as any) = [
      {
        periodMonth: '2026-06',
        segment: 'adults',
        beltBand: 'White',
        activeCount: 40,
        lostCount: 3,
        memberName: 'DECOY_BELT_NAME', // must NOT leak
        clientId: 'DECOY_CLIENT_ID',
      },
    ];
    (input.cohortRetention as any) = [
      {
        periodMonth: '2026-06',
        cohortBand: 'adults16plus',
        newMembers: 5,
        returningMembers: 90,
        lostMembers: 4,
        suppressed: false,
        dob: 'DECOY_DOB',
      },
    ];
    const json = JSON.stringify(buildMonthlySourceExport(input));
    expect(json).not.toContain('DECOY_BELT_NAME');
    expect(json).not.toContain('DECOY_CLIENT_ID');
    expect(json).not.toContain('DECOY_DOB');
    expect(json).not.toContain('memberName');
    expect(json).not.toContain('clientId');
  });

  it('10. generated_at is the injected value; builder is deterministic', () => {
    const input = fullLive();
    const a = buildMonthlySourceExport(input) as any;
    const b = buildMonthlySourceExport(input) as any;
    expect(a.generated_at).toBe('2026-07-06T14:00:00Z');
    expect(a).toEqual(b); // no Date.now()/new Date() → identical output for identical input
  });
});
