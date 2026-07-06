// Monthly Attack Plan source export — PURE builder (no React, no I/O, no Date).
//
// Serializes ALREADY-COMPUTED scorecard data into one ChatGPT-readable JSON object. It reuses the
// dashboard's source-of-truth outputs and NEVER re-implements dashboard math:
//   - financial actuals + comparisons + runway + expense categories ← DashboardModel (computeDashboardModel)
//   - forecast (projection) ← model.cashFlowForecastSeries (projected rows only)
//   - membership retention series ← fetchMemberRetentionRates rows (seed row dropped via realRetentionMonths)
//   - attendance snapshot ← deriveBuckets(snapshot, thresholdDays) (the Attendance Health card's own fn)
//
// STRICT FACTUAL/PII BOUNDARY: only aggregate numbers, category names, counts, rates, and dates are
// read. Transaction rows, payees, memos, accounts, member identities, DOBs, ages, import summaries,
// and source filenames are NEVER touched (the builder simply doesn't reference model.topPayees etc.).
// No interpretive fields (main_problem / opportunities / summaryBullets / AI prose).
//
// LIVE-VS-SAMPLE: the builder emits a domain ONLY when its caller passes live data; a null/empty input
// is omitted and recorded in `missing_or_unavailable` — sample fixtures are never serialized as real.
//
// generated_at + currentCalendarMonth are INJECTED by the click handler (this module never calls
// `Date.now()`/`new Date()`), keeping it deterministic and unit-testable.

import type {
  DashboardModel,
  KpiTimeframeComparison,
  MonthlyRollup,
} from '../data/contract';
import type { RetentionMonth } from '../gym/memberRetentionSeries';
import { realRetentionMonths } from '../gym/memberRetentionSeries';
import type { RetentionAggregateSnapshot } from '../gym/fetchRetentionAggregate';
import { deriveBuckets } from '../gym/retentionAggregateView';

export const MONTHLY_SOURCE_SCHEMA_VERSION = '0.1';
const DEFAULT_BUSINESS_NAME = 'Gracie Sports';

export type FinancialBasis = 'operating' | 'total';

export type MonthlySourceExportInputs = {
  model: DashboardModel;
  financialTxnCount: number; // baseTxns.length — the financial live/empty gate
  currentCalendarMonth: string; // 'YYYY-MM' injected from getCurrentCalendarMonthToken()
  financialBasis: FinancialBasis; // profitabilityCashFlowMode
  retentionRates: RetentionMonth[] | null; // fetchMemberRetentionRates() → null when not seeded
  snapshot: RetentionAggregateSnapshot | null; // fetchLatestRetentionAggregate() → null on error/unseeded
  thresholdDays: number; // useRetentionSettings().silentChurnThresholdDays
  generatedAt: string; // ISO 8601, injected
  businessName?: string;
};

// 'YYYY-MM' shifted by whole months — pure integer arithmetic (no Date).
function shiftMonth(periodMonth: string, deltaMonths: number): string {
  const [y, m] = periodMonth.split('-').map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, '0')}`;
}

// The latest rollup month strictly BEFORE the current calendar month = latest COMPLETE month.
// null when no complete month has data yet (only the partial current month present, or empty).
function latestCompleteMonth(rollups: MonthlyRollup[], currentCalendarMonth: string): string | null {
  const complete = rollups
    .map((r) => r.month)
    .filter((month) => month < currentCalendarMonth)
    .sort();
  return complete.length > 0 ? complete[complete.length - 1] : null;
}

type MetricComparison = {
  this_month: number | null;
  prior_month: number | null;
  yoy_same_month: number | null;
  ttm: number | null;
};

// this/prior/yoy are SELECTED from the SoT monthly rollups (scorecard month and its −1 / −12
// neighbours) — a faithful reuse of already-computed monthly values that stays correct even when
// imports lag (the pre-anchored kpiComparison maps anchor on the real current calendar month, so
// they cannot describe a lagged scorecard month). TTM reuses the model's own computed TTM entry.
function metricComparison(
  rollupByMonth: Map<string, MonthlyRollup>,
  ttmEntry: KpiTimeframeComparison | undefined,
  scorecardMonth: string,
  key: 'revenue' | 'expenses' | 'netCashFlow' | 'savingsRate',
): MetricComparison {
  const cur = rollupByMonth.get(scorecardMonth);
  const prior = rollupByMonth.get(shiftMonth(scorecardMonth, -1));
  const yoy = rollupByMonth.get(shiftMonth(scorecardMonth, -12));
  return {
    this_month: cur ? cur[key] : null,
    prior_month: prior ? prior[key] : null,
    // Monthly YoY savings-rate is intentionally omitted (not a meaningful monthly comparison); the
    // TTM savings rate is still carried below.
    yoy_same_month: key === 'savingsRate' ? null : yoy ? yoy[key] : null,
    ttm: ttmEntry ? ttmEntry[key].current : null,
  };
}

export function buildMonthlySourceExport(inputs: MonthlySourceExportInputs): Record<string, unknown> {
  const {
    model,
    financialTxnCount,
    currentCalendarMonth,
    financialBasis,
    retentionRates,
    snapshot,
    thresholdDays,
    generatedAt,
    businessName = DEFAULT_BUSINESS_NAME,
  } = inputs;

  const missing: string[] = [];

  // ---- FINANCIAL (required) ----
  const scorecardMonth = latestCompleteMonth(model.monthlyRollups, currentCalendarMonth);
  const financialLive = financialTxnCount > 0 && scorecardMonth !== null;

  // scorecard_month always resolves to something sane for the filename/meta, even when financial is
  // missing (fall back to the last complete calendar month).
  const resolvedScorecardMonth = scorecardMonth ?? shiftMonth(currentCalendarMonth, -1);
  const planningMonth = shiftMonth(resolvedScorecardMonth, 1);

  let financialMonthly: Record<string, unknown>[] | undefined;
  let financialComparisons: Record<string, MetricComparison> | undefined;
  let runway: Record<string, unknown> | undefined;
  let topExpenseCategories: Record<string, unknown>[] | undefined;

  if (financialLive && scorecardMonth) {
    const rollupByMonth = new Map(model.monthlyRollups.map((r) => [r.month, r]));
    const ttmEntry = model.kpiComparisonByTimeframe?.ttm;

    financialMonthly = model.monthlyRollups
      .filter((r) => r.month <= scorecardMonth)
      .map((r) => ({
        month: r.month,
        revenue: r.revenue,
        expenses: r.expenses,
        net_cash_flow: r.netCashFlow,
        savings_rate: r.savingsRate,
        transaction_count: r.transactionCount,
      }));

    financialComparisons = {
      revenue: metricComparison(rollupByMonth, ttmEntry, scorecardMonth, 'revenue'),
      expenses: metricComparison(rollupByMonth, ttmEntry, scorecardMonth, 'expenses'),
      net_cash_flow: metricComparison(rollupByMonth, ttmEntry, scorecardMonth, 'netCashFlow'),
      savings_rate: metricComparison(rollupByMonth, ttmEntry, scorecardMonth, 'savingsRate'),
    };

    const rw = model.runway;
    runway = {
      status: rw.status,
      months: rw.months,
      net_burn: rw.netBurn,
      gross_burn: rw.grossBurn,
      current_cash_balance: rw.currentCashBalance,
      reserve_target: rw.reserveTarget,
      percent_funded: rw.percentFunded,
    };

    topExpenseCategories = model.expenseSlices.map((s) => ({
      name: s.name,
      value: s.value,
      share: s.share,
    }));
  } else {
    missing.push(financialTxnCount > 0 ? 'financial:no_complete_month' : 'financial:no_import');
  }

  // ---- FORECAST (optional; projection, never mixed with actuals) ----
  const projectedRows = model.cashFlowForecastSeries.filter((p) => p.status === 'projected');
  const forecastAvailable = projectedRows.length > 0;
  let forecast: Record<string, unknown> | undefined;
  if (forecastAvailable) {
    forecast = {
      basis: 'projection',
      note: 'Forecast values are projections from the CFO Scorecard model, not actual results.',
      series: projectedRows.map((p) => ({
        month: p.month,
        projected_revenue: p.revenue,
        projected_expenses: p.expenses,
        projected_net_cash_flow: p.netCashFlow,
      })),
    };
  } else {
    missing.push('forecast:not_available');
  }

  // ---- MEMBERSHIP RETENTION (required) ----
  const realRetention = retentionRates ? realRetentionMonths(retentionRates) : [];
  const retentionLive = realRetention.length > 0;
  let membershipRetentionMonthly: Record<string, unknown>[] | undefined;
  if (retentionLive) {
    membershipRetentionMonthly = realRetention.map((r) => ({
      month: r.periodMonth,
      active_members: r.currentMembers,
      prior_members: r.priorMembers,
      returning_members: r.returningMembers,
      new_members: r.newMembers,
      lost_members: r.lostMembers,
      retention_rate: r.retentionRate, // 0..1 — the report's own returning/prior
    }));
  } else {
    missing.push('retention_rates:not_live');
  }

  // ---- ATTENDANCE SNAPSHOT (optional; reuse deriveBuckets, never fabricate dues) ----
  let attendanceSnapshot: Record<string, unknown> | undefined;
  let snapshotProvenance: Record<string, unknown> = { source: 'not_live' };
  if (snapshot) {
    const buckets = deriveBuckets(snapshot, thresholdDays);
    attendanceSnapshot = {
      as_of: snapshot.asOf,
      threshold_days: buckets.thresholdDays,
      active_total: buckets.activeTotal,
      healthy: buckets.healthy,
      watch: buckets.watch,
      high_risk: buckets.silent,
      unknown: buckets.unknown,
      // Honest FLOOR from the dues slice; null (never $0) when the slice is absent.
      silent_monthly_dues_at_risk: snapshot.dues?.totalMonthly ?? null,
    };
    snapshotProvenance = {
      source: 'live',
      as_of: snapshot.asOf,
      silent_churn_threshold_days: buckets.thresholdDays,
    };
  } else {
    missing.push('retention_snapshot:not_live');
  }

  // Required domains for a usable Attack Plan file: financial + membership retention.
  const usableForAttackPlan = financialLive && retentionLive;

  const provenance: Record<string, unknown> = {
    financial: financialLive
      ? { source: 'live', latest_month: scorecardMonth, basis: financialBasis }
      : { source: 'missing' },
    forecast: forecastAvailable
      ? { source: 'model', basis: 'projection', latest_month: scorecardMonth ?? null }
      : { source: 'not_available' },
    retention_rates: retentionLive
      ? { source: 'live', latest_month: realRetention[realRetention.length - 1].periodMonth }
      : { source: 'not_live' },
    retention_snapshot: snapshotProvenance,
  };

  return {
    schema_version: MONTHLY_SOURCE_SCHEMA_VERSION,
    generated_at: generatedAt,
    business: businessName,
    scorecard_month: resolvedScorecardMonth,
    planning_month: planningMonth,
    usable_for_attack_plan: usableForAttackPlan,
    provenance,
    ...(financialMonthly ? { financial_monthly: financialMonthly } : {}),
    ...(financialComparisons ? { financial_comparisons: financialComparisons } : {}),
    ...(runway ? { runway } : {}),
    ...(topExpenseCategories ? { top_expense_categories: topExpenseCategories } : {}),
    ...(forecast ? { forecast } : {}),
    ...(membershipRetentionMonthly ? { membership_retention_monthly: membershipRetentionMonthly } : {}),
    ...(attendanceSnapshot ? { attendance_snapshot: attendanceSnapshot } : {}),
    missing_or_unavailable: missing,
  };
}
