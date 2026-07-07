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

function snap(
  counts: Record<string, number>,
  over?: { overflow?: number; unknown?: number; asOf?: string; dues?: { totalMonthly: number } | null },
): RetentionAggregateSnapshot {
  return {
    asOf: over?.asOf ?? '2026-06-28',
    unknown: over?.unknown ?? 0,
    daysAbsentHistogram: { countsByDaysAbsent: counts, overflow365Plus: over?.overflow ?? 0 },
    dues: over?.dues ?? null,
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

const BASE: MonthlySourceExportInputs = {
  model: model(),
  financialTxnCount: 0,
  currentCalendarMonth: '2026-07',
  financialBasis: 'operating',
  scenarioProjection: [],
  scenarioRunOutMonth: null,
  efficiencyResult: emptyEfficiency(),
  whatNeedsAttention: emptyWhatNeedsAttention(),
  retentionRates: null,
  snapshot: null,
  thresholdDays: 21,
  generatedAt: '2026-07-06T14:00:00Z',
};

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
    retentionRates: [
      retMonth('2025-06', { isSeedBoundary: true }), // seed — must be dropped
      retMonth('2025-07'),
      retMonth('2026-06', { retentionRate: 0.93 }),
    ],
    snapshot: snap({ '2': 120, '10': 41 }, { overflow: 5, unknown: 8, dues: { totalMonthly: 2400 } }),
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
      'forecast',
      'membership_retention',
      'attendance_snapshot',
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
    // dashboard_signals + financial_levers ride on financialLive (true here), so they stay present.
    expect(out.scope.present_domains).toEqual([
      'financial_actuals',
      'dashboard_signals',
      'financial_levers',
      'membership_retention',
    ]);
    expect(out.scope.absent_domains).toEqual(['forecast', 'attendance_snapshot']);
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
      dashboard_signals: '2026-06', // shares the financial month — never a new divergence token
      financial_levers: '2026-06', // ditto
      retention_rates: '2026-06',
      attendance_snapshot: '2026-07-06',
    });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/as_of_divergence/);
    expect(out.warnings[0]).toContain('financial=2026-06');
    expect(out.warnings[0]).toContain('attendance_snapshot=2026-07');
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

  it('10. generated_at is the injected value; builder is deterministic', () => {
    const input = fullLive();
    const a = buildMonthlySourceExport(input) as any;
    const b = buildMonthlySourceExport(input) as any;
    expect(a.generated_at).toBe('2026-07-06T14:00:00Z');
    expect(a).toEqual(b); // no Date.now()/new Date() → identical output for identical input
  });
});
