// Monthly Attack Plan source export — PURE builder (no React, no I/O, no Date).
//
// Serializes ALREADY-COMPUTED scorecard data into one ChatGPT-readable JSON object. It reuses the
// dashboard's source-of-truth outputs and NEVER re-implements dashboard math:
//   - financial actuals + comparisons + runway + expense categories ← DashboardModel (computeDashboardModel)
//   - dashboard signals (KPI cards, category movers, trajectory lights, suggested margins,
//     uncategorized warning) ← DashboardModel — the Big Picture tiles' own computed reads, reused verbatim
//   - financial levers (money left, payroll efficiency, cost spikes) ← computeEfficiencyOpportunities +
//     computeWhatNeedsAttention results, drilled from Dashboard — the recommended-action values, verbatim
//   - forecast (projection) ← scenarioProjection (composed ScenarioPoint[] with month-end endingCashBalance)
//     + scenarioRunOutMonth — the SAME forward series the Forecast page renders, NOT the naive
//     model.cashFlowForecastSeries trend (which carries no ending balance). Both prop-drilled from Dashboard.
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
// `Date.now()`/`new Date()`), keeping it deterministic and unit-testable. generated_at is the single
// point-in-time snapshot timestamp: for a synchronous export the dashboard-state read and the file
// write happen at the same instant.
//
// A top-level `scope` declares which domains this export is DESIGNED to cover, so an empty
// `missing_or_unavailable` can't be misread as whole-dashboard completeness. A `warnings` array
// flags when blocks anchor to different as-of periods.

import type {
  DashboardModel,
  KpiTimeframeComparison,
  MonthlyRollup,
  ScenarioPoint,
} from '../data/contract';
import type { RetentionMonth } from '../gym/memberRetentionSeries';
import { realRetentionMonths } from '../gym/memberRetentionSeries';
import type { RetentionAggregateSnapshot } from '../gym/fetchRetentionAggregate';
import { deriveBuckets } from '../gym/retentionAggregateView';
import type { EfficiencyOpportunitiesResult } from '../kpis/efficiencyOpportunities';
import type { WhatNeedsAttentionResult } from '../kpis/digHere';

export const MONTHLY_SOURCE_SCHEMA_VERSION = '0.1';
const DEFAULT_BUSINESS_NAME = 'Gracie Sports';

export type FinancialBasis = 'operating' | 'total';

export type MonthlySourceExportInputs = {
  model: DashboardModel;
  financialTxnCount: number; // baseTxns.length — the financial live/empty gate
  currentCalendarMonth: string; // 'YYYY-MM' injected from getCurrentCalendarMonthToken()
  financialBasis: FinancialBasis; // profitabilityCashFlowMode
  // Composed forward projection the owner sees on the Forecast page (ScenarioPoint[] with month-end
  // endingCashBalance), prop-drilled from Dashboard.scenarioProjection. The builder serializes THIS —
  // not the naive model.cashFlowForecastSeries trend. Empty [] ⇒ forecast not available.
  scenarioProjection: ScenarioPoint[];
  // First projected month whose month-end cash falls below $0 (Dashboard.todayRunOutNegativeCashMonth),
  // or null if it never does within the horizon. A $0 crossing — reserve-independent.
  scenarioRunOutMonth: string | null;
  // Recoverable-dollar levers — the dashboard's OWN already-computed recommended-action values, drilled
  // in from Dashboard (computeEfficiencyOpportunities + computeWhatNeedsAttention). Reused verbatim, not
  // recomputed here; emitted only when financialLive (they are financial-derived).
  efficiencyResult: EfficiencyOpportunitiesResult;
  whatNeedsAttention: WhatNeedsAttentionResult;
  retentionRates: RetentionMonth[] | null; // fetchMemberRetentionRates() → null when not seeded
  snapshot: RetentionAggregateSnapshot | null; // fetchLatestRetentionAggregate() → null on error/unseeded
  thresholdDays: number; // useRetentionSettings().silentChurnThresholdDays
  generatedAt: string; // ISO 8601, injected — point-in-time snapshot (state-read == file-write)
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
// Exported so the Export card can gate its "Financial: Live" status on the SAME complete-month
// condition the builder uses — the two can never disagree with the exported usable_for_attack_plan.
export function latestCompleteMonth(rollups: MonthlyRollup[], currentCalendarMonth: string): string | null {
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

// Explicit shape (not a widened Record) so a window can't be assigned to a metric key, or vice versa.
type FinancialComparisons = {
  revenue: MetricComparison;
  expenses: MetricComparison;
  net_cash_flow: MetricComparison;
  savings_rate: MetricComparison;
  ttm_window: { start: string; end: string };
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
    scenarioProjection,
    scenarioRunOutMonth,
    efficiencyResult,
    whatNeedsAttention,
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
  let financialComparisons: FinancialComparisons | undefined;
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

    // TTM window bounds for the `ttm` scalars. Prefer the model's authoritative window — it describes
    // the exact (real-now-anchored) TTM value the export already reports. Fall back to a trailing-12
    // ending at the scorecard month when the model doesn't carry the bounds. Pure integer math (no Date).
    const ttmStart = ttmEntry?.currentStartMonth;
    const ttmEnd = ttmEntry?.currentEndMonth;
    const ttmWindow =
      ttmStart && ttmEnd
        ? { start: ttmStart, end: ttmEnd }
        : { start: shiftMonth(scorecardMonth, -11), end: scorecardMonth };

    financialComparisons = {
      revenue: metricComparison(rollupByMonth, ttmEntry, scorecardMonth, 'revenue'),
      expenses: metricComparison(rollupByMonth, ttmEntry, scorecardMonth, 'expenses'),
      net_cash_flow: metricComparison(rollupByMonth, ttmEntry, scorecardMonth, 'netCashFlow'),
      savings_rate: metricComparison(rollupByMonth, ttmEntry, scorecardMonth, 'savingsRate'),
      ttm_window: ttmWindow,
    };

    const rw = model.runway;
    runway = {
      // Trailing-operating-burn runway: self-funded (net_burn 0) whenever operating cash-positive. This
      // is a DIFFERENT basis from forecast.scenario_run_out_month (a forward cash projection that
      // includes owner draws). Both are correct on their own basis — labeled, deliberately NOT reconciled.
      basis: 'trailing_operating',
      basis_note:
        'Self-funded trailing-operating burn (net_burn 0 when operating cash-positive). Differs by ' +
        'design from forecast.scenario_run_out_month — a forward projection including owner draws. ' +
        'Different bases; do not reconcile.',
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

  // ---- DASHBOARD SIGNALS (Big Picture read-outs; financial-derived) ----
  // The dashboard's OWN already-computed Big Picture signals — KPI deltas, category movers, trajectory
  // lights, suggested margins, and the uncategorized-txn warning — reused VERBATIM off DashboardModel,
  // never recomputed here. Gated on the SAME financialLive condition as the financial blocks (they are
  // all financial-derived). When not live, all five are omitted and ONE code is recorded, so the domain
  // reconciles 1:1 with `missing_or_unavailable`. uncategorized_warning may be present-but-null when
  // live (no warning) — a null field, NOT a missing domain, so it never pushes a code.
  let kpiCards: Record<string, unknown>[] | undefined;
  let categoryMovers: Record<string, unknown>[] | undefined;
  let trajectorySignals: Record<string, unknown>[] | undefined;
  let suggestedMargins: Record<string, unknown> | undefined;
  let uncategorizedWarning: Record<string, unknown> | null | undefined;
  if (financialLive) {
    kpiCards = model.kpiCards.map((c) => ({
      id: c.id,
      label: c.label,
      value: c.value,
      previous_value: c.previousValue,
      delta_percent: c.deltaPercent,
      trend: c.trend, // sign of the change (arrow glyph)
      sentiment: c.sentiment, // favorability; may invert vs trend for lower-is-better metrics
      format: c.format,
    }));
    // sparkline intentionally dropped — an intra-category series is noise for the attack plan.
    categoryMovers = model.movers.map((m) => ({
      category: m.category,
      current: m.current,
      previous: m.previous,
      delta: m.delta,
      delta_percent: m.deltaPercent,
      priority_score: m.priorityScore,
    }));
    trajectorySignals = model.trajectorySignals.map((t) => ({
      id: t.id,
      label: t.label,
      timeframe: t.timeframe,
      current_start_month: t.currentStartMonth,
      current_end_month: t.currentEndMonth,
      previous_start_month: t.previousStartMonth,
      previous_end_month: t.previousEndMonth,
      current_month_count: t.currentMonthCount,
      previous_month_count: t.previousMonthCount,
      current_net_cash_flow: t.currentNetCashFlow,
      previous_net_cash_flow: t.previousNetCashFlow,
      delta: t.delta,
      percent_change: t.percentChange,
      direction: t.direction,
      light: t.light, // green/red/neutral status glyph
      has_sufficient_history: t.hasSufficientHistory,
    }));
    suggestedMargins = {
      revenue_margin: model.suggestedRevenueMargin,
      expense_margin: model.suggestedExpenseMargin,
      justification: model.suggestedMarginJustification,
    };
    // Present-but-null when live and no warning is active. Never pushes a missing code.
    uncategorizedWarning = model.uncategorizedWarning
      ? {
          count: model.uncategorizedWarning.count,
          absolute_amount: model.uncategorizedWarning.absoluteAmount,
        }
      : null;
  } else {
    missing.push('dashboard_signals:not_live');
  }

  // ---- FINANCIAL LEVERS (recommended actions; financial-derived) ----
  // The dashboard's OWN recoverable-dollar levers, reused VERBATIM off the drilled results — never
  // recomputed here. money_left + payroll_efficiency come from computeEfficiencyOpportunities; cost_spikes
  // from computeWhatNeedsAttention. Render-only geometry (bar widths, window details, chart series,
  // sparklines) is dropped. Gated on the SAME financialLive condition as the financial blocks, so the
  // one domain reconciles 1:1 with `missing_or_unavailable`. cost_spikes.no_data=true is a
  // present-but-empty state (insufficient baseline history), NOT a missing domain.
  let moneyLeft: Record<string, unknown> | undefined;
  let payrollEfficiency: Record<string, unknown> | undefined;
  let costSpikes: Record<string, unknown> | undefined;
  if (financialLive) {
    moneyLeft = {
      window_label: efficiencyResult.windowLabel,
      total_extra_per_month: efficiencyResult.totalExtraPerMonth,
      benchmark_revenue_qualified: efficiencyResult.benchmarkRevenueQualified,
      rows: efficiencyResult.rows.map((r) => ({
        category: r.category,
        today_pct: r.todayPct,
        best_pct: r.bestPct,
        extra_per_month: r.extraPerMonth,
        best_period_label: r.bestPeriodLabel,
      })),
    };
    payrollEfficiency = {
      payroll_today_pct: efficiencyResult.payrollTodayPct,
      payroll_best_pct: efficiencyResult.payrollBestPct,
      payroll_best_window_label: efficiencyResult.payrollBestWindowLabel,
      payroll_extra_per_month: efficiencyResult.payrollExtraPerMonth,
    };
    costSpikes = {
      current_month: whatNeedsAttention.currentMonth,
      baseline_months: whatNeedsAttention.baselineMonths,
      no_data: whatNeedsAttention.noData,
      rows: whatNeedsAttention.rows.map((r) => ({
        category_name: r.categoryName,
        bucket: r.bucket,
        current_spend: r.currentSpend,
        expected_spend: r.expectedSpend,
        delta: r.delta,
        current_ratio: r.currentRatio,
        baseline_ratio: r.baselineRatio,
        current_avg_spend: r.currentAvgSpend,
        baseline_avg_spend: r.baselineAvgSpend,
        current_revenue: r.currentRevenue,
      })),
    };
  } else {
    missing.push('financial_levers:not_live');
  }

  // ---- FORECAST (optional; projection, never mixed with actuals) ----
  // Serializes the composed scenario projection the owner sees on the Forecast page — a forward
  // CASH-FLOW projection carrying a real month-end endingCashBalance — NOT the naive
  // model.cashFlowForecastSeries trend (which has no ending balance). scenario_run_out_month is the
  // first projected month cash crosses below $0 and is reserve-independent. reserve_target is the RAW
  // runway reserve (the same value the forecast decision signals consume), carried here so a reader can
  // compare the projected balance against the reserve floor without leaving the forecast block.
  const forecastAvailable = scenarioProjection.length > 0;
  let forecast: Record<string, unknown> | undefined;
  if (forecastAvailable) {
    forecast = {
      basis: 'projection',
      note:
        'Forward cash-flow projection (composed scenario), not actual results. projected_cash_balance ' +
        'is month-end cash after that month’s net flow.',
      scenario_run_out_month: scenarioRunOutMonth,
      run_out_note:
        'First projected month whose month-end cash falls below $0 (includes owner draws); ' +
        'null = cash stays above $0 across the projected horizon. Independent of reserve_target.',
      reserve_target: model.runway.reserveTarget,
      series: scenarioProjection.map((p) => ({
        month: p.month,
        projected_cash_in: p.cashIn,
        projected_cash_out: p.cashOut,
        projected_net_cash_flow: p.netCashFlow,
        projected_cash_balance: p.endingCashBalance,
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
      // active_total = KNOWN base (healthy + watch + high_risk), mirroring the Retention page's
      // Attendance Health surface (GymPage knownActive = healthy + watch + silent, which EXCLUDES
      // unknown-recency profiles). Do NOT use buckets.activeTotal here — its integrity invariant is
      // healthy+watch+silent+unknown, so it over-counts non-member/no-check-in profiles (the export
      // named the dashboard surface, so it must match it). deriveBuckets is left untouched (shared
      // with the live card); the exclusion happens only in this projection.
      active_total: buckets.healthy + buckets.watch + buckets.silent,
      healthy: buckets.healthy,
      watch: buckets.watch,
      high_risk: buckets.silent,
      unknown: buckets.unknown,
      active_base_note:
        'active_total counts known-recency profiles only (healthy + watch + high_risk). ' +
        'unknown-recency profiles are reported separately in `unknown` and are excluded from ' +
        'active_total and all rates — mirroring the Retention page default.',
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
    dashboard_signals: financialLive
      ? {
          source: 'model',
          basis: 'derived_signal',
          note:
            "The dashboard's own computed Big Picture signals (KPI deltas, category movers, trajectory " +
            'lights, suggested margins), reused verbatim — NOT recomputed by the export. Definitions: ' +
            'kpi_cards.sentiment = favorability of the change (may invert vs trend for lower-is-better ' +
            'metrics like expenses; up=favorable, down=unfavorable); trajectory_signals.light = ' +
            'green/red/neutral status glyph; suggested_margins are the model’s target revenue/expense ' +
            'margins with a text justification. uncategorized_warning may be null when live (no warning).',
        }
      : { source: 'not_live' },
    financial_levers: financialLive
      ? {
          source: 'model',
          basis: 'derived_signal',
          note:
            "The dashboard's own computed recommended-action levers, reused verbatim — NOT recomputed " +
            'by the export. money_left = $/mo recoverable per category vs its own best 3-month window ' +
            '(total_extra_per_month sums the visible rows); payroll_efficiency = payroll % of revenue ' +
            'today vs its best window plus the $/mo excess; cost_spikes = categories overspending vs ' +
            'their trailing baseline. cost_spikes.no_data=true means insufficient baseline history (a ' +
            'present-but-empty state, not a missing domain).',
        }
      : { source: 'not_live' },
    forecast: forecastAvailable
      ? {
          source: 'model',
          basis: 'projection',
          // The forecast's own last projected month — describes the projection horizon, not the
          // actuals anchor (which can differ from the last forecast row).
          latest_month: scenarioProjection[scenarioProjection.length - 1].month,
        }
      : { source: 'not_available' },
    retention_rates: retentionLive
      ? { source: 'live', latest_month: realRetention[realRetention.length - 1].periodMonth }
      : { source: 'not_live' },
    retention_snapshot: snapshotProvenance,
  };

  // ---- SCOPE (what this export is DESIGNED to cover) ----
  // Declared so a reader can't mistake `missing_or_unavailable: []` for whole-dashboard
  // completeness. Big Picture analytics (Money Left on the Table, payroll efficiency,
  // sustainability, cost spikes) and any per-member / per-transaction detail are intentionally
  // OUT of scope — their absence is NOT a "missing" gap. `absent_domains` reconciles 1:1 with the
  // in-scope codes in `missing_or_unavailable`.
  const domainPresence: Record<string, boolean> = {
    financial_actuals: financialLive,
    dashboard_signals: financialLive,
    financial_levers: financialLive,
    forecast: forecastAvailable,
    membership_retention: retentionLive,
    attendance_snapshot: Boolean(snapshot),
  };
  const coveredDomains = Object.keys(domainPresence);
  const scope = {
    covered_domains: coveredDomains,
    present_domains: coveredDomains.filter((d) => domainPresence[d]),
    absent_domains: coveredDomains.filter((d) => !domainPresence[d]),
    note:
      'Aggregate scorecard export. Only covered_domains are included. Big Picture analytics ' +
      '(Money Left on the Table, payroll efficiency, sustainability, cost spikes) and any ' +
      'per-member or per-transaction detail are intentionally out of scope — their absence is ' +
      'NOT recorded in missing_or_unavailable.',
  };

  // ---- AS-OF anchors + divergence warning ----
  // Each block reflects its own as-of: financial/retention anchor on a whole MONTH (last complete
  // month), attendance on a DAY (as-of now). When these fall in different months a reader must not
  // cross-compare them as same-period — and it explains a live cash-balance vs. monthly-actuals
  // drift as a point-in-time snapshot, not a bug.
  const lastRetentionMonth = retentionLive
    ? realRetention[realRetention.length - 1].periodMonth
    : null;
  const asOf: Record<string, string | null> = {
    financial: financialLive ? scorecardMonth : null, // 'YYYY-MM'
    // Same monthly anchor as financial — so a reader does not cross-compare these dashboard-derived
    // signals with the day-anchored attendance snapshot. Not added to the divergence check below
    // because it always equals the financial month (no new period token).
    dashboard_signals: financialLive ? scorecardMonth : null, // 'YYYY-MM'
    financial_levers: financialLive ? scorecardMonth : null, // 'YYYY-MM' — shares the financial anchor
    retention_rates: lastRetentionMonth, // 'YYYY-MM'
    attendance_snapshot: snapshot ? snapshot.asOf : null, // 'YYYY-MM-DD'
  };
  const periodAnchors: [string, string][] = [];
  if (financialLive && scorecardMonth) periodAnchors.push(['financial', scorecardMonth]);
  if (lastRetentionMonth) periodAnchors.push(['retention_rates', lastRetentionMonth]);
  if (snapshot) periodAnchors.push(['attendance_snapshot', snapshot.asOf.slice(0, 7)]);
  const distinctPeriods = new Set(periodAnchors.map(([, token]) => token));
  const warnings: string[] = [];
  if (distinctPeriods.size > 1) {
    warnings.push(
      `as_of_divergence: blocks anchor to different periods (${periodAnchors
        .map(([domain, token]) => `${domain}=${token}`)
        .join(', ')}). Each block reflects its own as-of; do not cross-compare as same-period. ` +
        'Point-in-time export.',
    );
  }

  return {
    schema_version: MONTHLY_SOURCE_SCHEMA_VERSION,
    generated_at: generatedAt,
    business: businessName,
    scorecard_month: resolvedScorecardMonth,
    planning_month: planningMonth,
    usable_for_attack_plan: usableForAttackPlan,
    scope,
    as_of: asOf,
    warnings,
    provenance,
    ...(financialMonthly ? { financial_monthly: financialMonthly } : {}),
    ...(financialComparisons ? { financial_comparisons: financialComparisons } : {}),
    ...(runway ? { runway } : {}),
    ...(topExpenseCategories ? { top_expense_categories: topExpenseCategories } : {}),
    ...(kpiCards ? { kpi_cards: kpiCards } : {}),
    ...(categoryMovers ? { category_movers: categoryMovers } : {}),
    ...(trajectorySignals ? { trajectory_signals: trajectorySignals } : {}),
    ...(suggestedMargins ? { suggested_margins: suggestedMargins } : {}),
    // uncategorized_warning is present-but-null when live with no active warning — include the key
    // (value null) whenever the block is live; omit only when dashboard_signals itself is not live.
    ...(uncategorizedWarning !== undefined ? { uncategorized_warning: uncategorizedWarning } : {}),
    ...(moneyLeft ? { money_left: moneyLeft } : {}),
    ...(payrollEfficiency ? { payroll_efficiency: payrollEfficiency } : {}),
    ...(costSpikes ? { cost_spikes: costSpikes } : {}),
    ...(forecast ? { forecast } : {}),
    ...(membershipRetentionMonthly ? { membership_retention_monthly: membershipRetentionMonthly } : {}),
    ...(attendanceSnapshot ? { attendance_snapshot: attendanceSnapshot } : {}),
    missing_or_unavailable: missing,
  };
}
