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

const BASE: MonthlySourceExportInputs = {
  model: model(),
  financialTxnCount: 0,
  currentCalendarMonth: '2026-07',
  financialBasis: 'operating',
  scenarioProjection: [],
  scenarioRunOutMonth: null,
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
    expect(out.attendance_snapshot.active_total).toBe(expected.activeTotal);
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
    expect(out.scope.present_domains).toEqual(['financial_actuals', 'membership_retention']);
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

  it('10. generated_at is the injected value; builder is deterministic', () => {
    const input = fullLive();
    const a = buildMonthlySourceExport(input) as any;
    const b = buildMonthlySourceExport(input) as any;
    expect(a.generated_at).toBe('2026-07-06T14:00:00Z');
    expect(a).toEqual(b); // no Date.now()/new Date() → identical output for identical input
  });
});
