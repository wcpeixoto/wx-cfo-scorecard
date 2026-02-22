import type {
  CashFlowMode,
  DashboardModel,
  ExpenseSlice,
  KpiAggregate,
  KpiAggregationMap,
  KpiComparisonMap,
  KpiComparisonTimeframe,
  KpiCard,
  KpiHeaderLabelMap,
  KpiMetricComparison,
  KpiTimeframe,
  KpiTimeframeComparison,
  MonthlyRollup,
  Mover,
  OpportunityItem,
  PayeeTotal,
  ScenarioInput,
  ScenarioPoint,
  TrendDirection,
  TrendPoint,
  Txn,
} from '../data/contract';

const EPSILON = 0.00001;
const EXPENSE_COLORS = ['#76a8ff', '#5e84f1', '#4f6fdd', '#3f58c1', '#2f479f', '#243b82', '#1b2f67'];
const KPI_TIMEFRAMES: KpiTimeframe[] = [
  'thisMonth',
  'lastMonth',
  'last3Months',
  'ytd',
  'last12Months',
  'last24Months',
  'last36Months',
  'allDates',
];
const KPI_COMPARISON_TIMEFRAMES: KpiComparisonTimeframe[] = [
  'thisMonth',
  'last3Months',
  'ytd',
  'ttm',
  'last24Months',
  'last36Months',
];

function trendFromDelta(delta: number): TrendDirection {
  if (Math.abs(delta) <= EPSILON) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

function pctDelta(current: number, previous: number): number | null {
  if (Math.abs(previous) <= EPSILON) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sortMonths(a: string, b: string): number {
  return a.localeCompare(b);
}

function parseMonthParts(month: string): { year: number; month: number } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const monthNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null;
  }
  return { year, month: monthNumber };
}

function monthLabel(month: string): string {
  const [yearText, monthText] = month.split('-');
  const year = Number.parseInt(yearText, 10);
  const monthIndex = Number.parseInt(monthText, 10) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return month;
  }

  const date = new Date(Date.UTC(year, monthIndex, 1));
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function monthLabelStable(month: string): string {
  const parsed = parseMonthParts(month);
  if (!parsed) return month;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatMonthRangeStable(startMonth: string | null, endMonth: string | null): string {
  if (!startMonth || !endMonth) return 'n/a';
  if (startMonth === endMonth) return monthLabelStable(startMonth);
  return `${monthLabelStable(startMonth)} – ${monthLabelStable(endMonth)}`;
}

function addMonths(month: string, offset: number): string {
  const [yearText, monthText] = month.split('-');
  const year = Number.parseInt(yearText, 10);
  const monthIndex = Number.parseInt(monthText, 10) - 1;

  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

function isCapitalDistribution(category: string): boolean {
  return category.trim().toLowerCase() === 'capital distribution';
}

type InternalMonthlyRollup = MonthlyRollup & {
  capitalDistribution: number;
};

export function computeMonthlyRollups(txns: Txn[], cashFlowMode: CashFlowMode = 'operating'): MonthlyRollup[] {
  const monthMap = new Map<string, InternalMonthlyRollup>();

  txns.forEach((txn) => {
    if (!monthMap.has(txn.month)) {
      monthMap.set(txn.month, {
        month: txn.month,
        revenue: 0,
        expenses: 0,
        netCashFlow: 0,
        savingsRate: 0,
        transactionCount: 0,
        capitalDistribution: 0,
      });
    }

    const rollup = monthMap.get(txn.month);
    if (!rollup) return;

    if (txn.type === 'income') {
      rollup.revenue += txn.amount;
    } else {
      rollup.expenses += txn.amount;
      if (isCapitalDistribution(txn.category)) {
        rollup.capitalDistribution += txn.amount;
      }
    }

    const effectiveExpenses =
      cashFlowMode === 'operating'
        ? rollup.expenses - rollup.capitalDistribution
        : rollup.expenses;
    rollup.netCashFlow = rollup.revenue - effectiveExpenses;
    rollup.transactionCount += 1;
  });

  return [...monthMap.values()]
    .sort((a, b) => sortMonths(a.month, b.month))
    .map((rollup) => ({
      month: rollup.month,
      revenue: round2(rollup.revenue),
      expenses: round2(rollup.expenses),
      netCashFlow: round2(rollup.netCashFlow),
      savingsRate: round2(rollup.revenue > EPSILON ? (rollup.netCashFlow / rollup.revenue) * 100 : 0),
      transactionCount: rollup.transactionCount,
    }));
}

type RollupSummary = Omit<KpiAggregate, 'timeframe'>;

function summarizeRollups(rollups: MonthlyRollup[]): RollupSummary {
  if (rollups.length === 0) {
    return {
      startMonth: null,
      endMonth: null,
      monthCount: 0,
      transactionCount: 0,
      revenue: 0,
      expenses: 0,
      netCashFlow: 0,
      savingsRate: 0,
    };
  }

  const revenue = rollups.reduce((sum, rollup) => sum + rollup.revenue, 0);
  const expenses = rollups.reduce((sum, rollup) => sum + rollup.expenses, 0);
  const netCashFlow = revenue - expenses;
  const transactionCount = rollups.reduce((sum, rollup) => sum + rollup.transactionCount, 0);

  return {
    startMonth: rollups[0].month,
    endMonth: rollups[rollups.length - 1].month,
    monthCount: rollups.length,
    transactionCount,
    revenue: round2(revenue),
    expenses: round2(expenses),
    netCashFlow: round2(netCashFlow),
    savingsRate: round2(revenue > EPSILON ? (netCashFlow / revenue) * 100 : 0),
  };
}

function selectTrailingRollups(monthlyRollups: MonthlyRollup[], count: number): MonthlyRollup[] {
  if (count <= 0) return [];
  return monthlyRollups.slice(-count);
}

function selectPriorTrailingBlock(monthlyRollups: MonthlyRollup[], count: number): MonthlyRollup[] {
  if (count <= 0) return [];
  if (monthlyRollups.length < count * 2) return [];

  const endExclusive = monthlyRollups.length - count;
  const start = endExclusive - count;
  return monthlyRollups.slice(start, endExclusive);
}

function selectYtdRollupsForYear(monthlyRollups: MonthlyRollup[], year: number, throughMonth: number): MonthlyRollup[] {
  return monthlyRollups.filter((rollup) => {
    const parsed = parseMonthParts(rollup.month);
    if (!parsed) return false;
    return parsed.year === year && parsed.month <= throughMonth;
  });
}

function selectRollupsForTimeframe(monthlyRollups: MonthlyRollup[], timeframe: KpiTimeframe): MonthlyRollup[] {
  if (monthlyRollups.length === 0) return [];

  if (timeframe === 'allDates') return monthlyRollups;
  if (timeframe === 'thisMonth') return selectTrailingRollups(monthlyRollups, 1);
  if (timeframe === 'lastMonth') return monthlyRollups.length > 1 ? [monthlyRollups[monthlyRollups.length - 2]] : [];
  if (timeframe === 'last3Months') return selectTrailingRollups(monthlyRollups, 3);
  if (timeframe === 'last12Months') return selectTrailingRollups(monthlyRollups, 12);
  if (timeframe === 'last24Months') return selectTrailingRollups(monthlyRollups, 24);
  if (timeframe === 'last36Months') return selectTrailingRollups(monthlyRollups, 36);

  const latest = monthlyRollups[monthlyRollups.length - 1];
  const parsedLatest = parseMonthParts(latest.month);
  if (!parsedLatest) return selectTrailingRollups(monthlyRollups, 1);
  return selectYtdRollupsForYear(monthlyRollups, parsedLatest.year, parsedLatest.month);
}

function aggregateRollups(timeframe: KpiTimeframe, rollups: MonthlyRollup[]): KpiAggregate {
  const summary = summarizeRollups(rollups);
  return {
    timeframe,
    ...summary,
  };
}

export function computeKpiAggregations(monthlyRollups: MonthlyRollup[]): KpiAggregationMap {
  return KPI_TIMEFRAMES.reduce<KpiAggregationMap>((result, timeframe) => {
    result[timeframe] = aggregateRollups(timeframe, selectRollupsForTimeframe(monthlyRollups, timeframe));
    return result;
  }, {} as KpiAggregationMap);
}

function selectComparisonBlocks(
  monthlyRollups: MonthlyRollup[],
  timeframe: KpiComparisonTimeframe
): { current: MonthlyRollup[]; previous: MonthlyRollup[] } {
  if (monthlyRollups.length === 0) {
    return { current: [], previous: [] };
  }

  if (timeframe === 'thisMonth') {
    return {
      current: selectTrailingRollups(monthlyRollups, 1),
      previous: selectPriorTrailingBlock(monthlyRollups, 1),
    };
  }

  if (timeframe === 'last3Months') {
    return {
      current: selectTrailingRollups(monthlyRollups, 3),
      previous: selectPriorTrailingBlock(monthlyRollups, 3),
    };
  }

  if (timeframe === 'ttm') {
    return {
      current: selectTrailingRollups(monthlyRollups, 12),
      previous: selectPriorTrailingBlock(monthlyRollups, 12),
    };
  }

  if (timeframe === 'last24Months') {
    return {
      current: selectTrailingRollups(monthlyRollups, 24),
      previous: selectPriorTrailingBlock(monthlyRollups, 24),
    };
  }

  if (timeframe === 'last36Months') {
    return {
      current: selectTrailingRollups(monthlyRollups, 36),
      previous: selectPriorTrailingBlock(monthlyRollups, 36),
    };
  }

  const latest = monthlyRollups[monthlyRollups.length - 1];
  const parsedLatest = parseMonthParts(latest.month);
  if (!parsedLatest) {
    return {
      current: selectTrailingRollups(monthlyRollups, 1),
      previous: selectPriorTrailingBlock(monthlyRollups, 1),
    };
  }

  return {
    current: selectYtdRollupsForYear(monthlyRollups, parsedLatest.year, parsedLatest.month),
    previous: selectYtdRollupsForYear(monthlyRollups, parsedLatest.year - 1, parsedLatest.month),
  };
}

function compareMetric(current: number, previous: number): KpiMetricComparison {
  return {
    current: round2(current),
    previous: round2(previous),
    delta: round2(current - previous),
    percentChange: pctDelta(current, previous),
  };
}

function buildTimeframeComparison(
  timeframe: KpiComparisonTimeframe,
  currentSummary: RollupSummary,
  previousSummary: RollupSummary
): KpiTimeframeComparison {
  return {
    timeframe,
    currentStartMonth: currentSummary.startMonth,
    currentEndMonth: currentSummary.endMonth,
    previousStartMonth: previousSummary.startMonth,
    previousEndMonth: previousSummary.endMonth,
    currentMonthCount: currentSummary.monthCount,
    previousMonthCount: previousSummary.monthCount,
    revenue: compareMetric(currentSummary.revenue, previousSummary.revenue),
    expenses: compareMetric(currentSummary.expenses, previousSummary.expenses),
    netCashFlow: compareMetric(currentSummary.netCashFlow, previousSummary.netCashFlow),
    savingsRate: compareMetric(currentSummary.savingsRate, previousSummary.savingsRate),
  };
}

export function computeKpiComparisons(monthlyRollups: MonthlyRollup[]): KpiComparisonMap {
  return KPI_COMPARISON_TIMEFRAMES.reduce<KpiComparisonMap>((result, timeframe) => {
    const blocks = selectComparisonBlocks(monthlyRollups, timeframe);
    const currentSummary = summarizeRollups(blocks.current);
    const previousSummary = summarizeRollups(blocks.previous);
    result[timeframe] = buildTimeframeComparison(timeframe, currentSummary, previousSummary);
    return result;
  }, {} as KpiComparisonMap);
}

export function computeKpiHeaderLabels(comparisons: KpiComparisonMap): KpiHeaderLabelMap {
  return KPI_COMPARISON_TIMEFRAMES.reduce<KpiHeaderLabelMap>((result, timeframe) => {
    const item = comparisons[timeframe];
    const currentRange = formatMonthRangeStable(item.currentStartMonth, item.currentEndMonth);
    const previousRange = formatMonthRangeStable(item.previousStartMonth, item.previousEndMonth);

    if (timeframe === 'thisMonth') {
      result[timeframe] = `${currentRange} · vs ${previousRange}`;
      return result;
    }

    if (timeframe === 'last3Months') {
      result[timeframe] = `${currentRange} · vs ${previousRange}`;
      return result;
    }

    if (timeframe === 'ytd') {
      const currentEnd = item.currentEndMonth ? monthLabelStable(item.currentEndMonth) : 'n/a';
      const previousEnd = item.previousEndMonth ? monthLabelStable(item.previousEndMonth) : 'n/a';
      result[timeframe] = `YTD through ${currentEnd} · vs YTD through ${previousEnd}`;
      return result;
    }

    if (timeframe === 'ttm') {
      const currentEnd = item.currentEndMonth ? monthLabelStable(item.currentEndMonth) : 'n/a';
      result[timeframe] = `TTM through ${currentEnd} · vs prior TTM`;
      return result;
    }

    result[timeframe] = `${currentRange} · vs ${previousRange}`;
    return result;
  }, {} as KpiHeaderLabelMap);
}

function buildKpis(current: KpiAggregate, previous: KpiAggregate): KpiCard[] {
  const prevRevenue = previous.revenue;
  const prevExpenses = previous.expenses;
  const prevNetCashFlow = previous.netCashFlow;
  const prevSavingsRate = previous.savingsRate;

  const cards: KpiCard[] = [
    {
      id: 'income',
      label: 'Revenue',
      value: round2(current.revenue),
      previousValue: round2(prevRevenue),
      deltaPercent: pctDelta(current.revenue, prevRevenue),
      trend: trendFromDelta(current.revenue - prevRevenue),
      format: 'currency',
    },
    {
      id: 'expense',
      label: 'Expenses',
      value: round2(current.expenses),
      previousValue: round2(prevExpenses),
      deltaPercent: pctDelta(current.expenses, prevExpenses),
      trend: trendFromDelta(current.expenses - prevExpenses),
      format: 'currency',
    },
    {
      id: 'net',
      label: 'Net Cash Flow',
      value: round2(current.netCashFlow),
      previousValue: round2(prevNetCashFlow),
      deltaPercent: pctDelta(current.netCashFlow, prevNetCashFlow),
      trend: trendFromDelta(current.netCashFlow - prevNetCashFlow),
      format: 'currency',
    },
    {
      id: 'savingsRate',
      label: 'Savings Rate',
      value: round2(current.savingsRate),
      previousValue: round2(prevSavingsRate),
      deltaPercent: pctDelta(current.savingsRate, prevSavingsRate),
      trend: trendFromDelta(current.savingsRate - prevSavingsRate),
      format: 'percent',
    },
  ];

  return cards;
}

function categoryTotals(txns: Txn[]): Map<string, number> {
  const totals = new Map<string, number>();
  txns.forEach((txn) => {
    if (txn.type !== 'expense') return;
    const current = totals.get(txn.category) ?? 0;
    totals.set(txn.category, current + txn.amount);
  });
  return totals;
}

function buildExpenseSlices(latestMonthTxns: Txn[]): ExpenseSlice[] {
  const totals = categoryTotals(latestMonthTxns);
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 7);
  const totalExpense = top.reduce((sum, entry) => sum + entry[1], 0);

  return top.map(([name, value], index) => ({
    name,
    value: round2(value),
    share: totalExpense > EPSILON ? value / totalExpense : 0,
    color: EXPENSE_COLORS[index % EXPENSE_COLORS.length],
  }));
}

function buildTopPayees(latestMonthTxns: Txn[]): PayeeTotal[] {
  const map = new Map<string, PayeeTotal>();

  latestMonthTxns.forEach((txn) => {
    if (txn.type !== 'expense') return;
    const payee = txn.payee?.trim() || 'Unknown';

    if (!map.has(payee)) {
      map.set(payee, { payee, amount: 0, transactionCount: 0 });
    }

    const current = map.get(payee);
    if (!current) return;

    current.amount += txn.amount;
    current.transactionCount += 1;
  });

  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
    .map((item) => ({ ...item, amount: round2(item.amount) }));
}

function buildMovers(currentMonthTxns: Txn[], previousMonthTxns: Txn[]): Mover[] {
  const currentTotals = categoryTotals(currentMonthTxns);
  const previousTotals = categoryTotals(previousMonthTxns);

  const categories = new Set<string>([...currentTotals.keys(), ...previousTotals.keys()]);
  const movers: Mover[] = [];

  categories.forEach((category) => {
    const current = round2(currentTotals.get(category) ?? 0);
    const previous = round2(previousTotals.get(category) ?? 0);
    const delta = round2(current - previous);

    movers.push({
      category,
      current,
      previous,
      delta,
      deltaPercent: pctDelta(current, previous),
    });
  });

  return movers
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);
}

function baselineForCategory(monthlyRollups: MonthlyRollup[], txns: Txn[], category: string, excludeMonth: string): number {
  const months = monthlyRollups.map((rollup) => rollup.month).filter((month) => month < excludeMonth);
  const recentMonths = months.slice(-3);
  if (recentMonths.length === 0) return 0;

  const monthSet = new Set(recentMonths);
  let total = 0;

  txns.forEach((txn) => {
    if (txn.type !== 'expense') return;
    if (txn.category !== category) return;
    if (!monthSet.has(txn.month)) return;
    total += txn.amount;
  });

  return total / recentMonths.length;
}

function buildOpportunities(latestMonthTxns: Txn[], monthlyRollups: MonthlyRollup[], allTxns: Txn[]): OpportunityItem[] {
  const latestMonth = latestMonthTxns[0]?.month;
  if (!latestMonth) return [];

  const totals = categoryTotals(latestMonthTxns);
  const candidates: OpportunityItem[] = [];

  totals.forEach((currentTotal, category) => {
    const baseline = baselineForCategory(monthlyRollups, allTxns, category, latestMonth);
    const overrun = currentTotal - baseline;

    if (overrun > 50) {
      candidates.push({
        title: `Control ${category}`,
        savings: round2(overrun),
        hint: `Current month is ${round2(overrun)} above recent baseline.`,
      });
    }
  });

  if (candidates.length === 0) {
    const fallbackSavings = round2((latestMonthTxns
      .filter((txn) => txn.type === 'expense')
      .reduce((sum, txn) => sum + txn.amount, 0) * 0.03) || 0);

    return [
      {
        title: 'Tighten discretionary spend',
        savings: fallbackSavings,
        hint: 'A 3% trim in discretionary categories is a reasonable first target.',
      },
    ];
  }

  return candidates.sort((a, b) => b.savings - a.savings).slice(0, 8);
}

function buildSummary(latest: MonthlyRollup, previous: MonthlyRollup | null, opportunities: OpportunityItem[], txCount: number): string[] {
  const bullets: string[] = [];
  const netDirection = previous ? latest.netCashFlow - previous.netCashFlow : latest.netCashFlow;

  bullets.push(
    `Processed ${txCount.toLocaleString()} transactions through ${monthLabel(latest.month)} with net ${latest.netCashFlow >= 0 ? 'positive' : 'negative'} cash flow.`
  );

  if (previous) {
    bullets.push(
      `Revenue moved ${latest.revenue >= previous.revenue ? 'up' : 'down'} ${Math.abs(round2(latest.revenue - previous.revenue)).toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      })} versus ${monthLabel(previous.month)}.`
    );
  }

  bullets.push(
    `Net cash trend is ${netDirection >= 0 ? 'improving' : 'softening'} and top action could recover ${opportunities
      .slice(0, 1)
      .reduce((sum, item) => sum + item.savings, 0)
      .toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}.`
  );

  return bullets;
}

export function computeDashboardModel(txns: Txn[], options?: { cashFlowMode?: CashFlowMode }): DashboardModel {
  const cashFlowMode = options?.cashFlowMode ?? 'operating';
  const monthlyRollups = computeMonthlyRollups(txns, cashFlowMode);

  if (monthlyRollups.length === 0) {
    const emptyAggregations = computeKpiAggregations([]);
    const emptyComparisons = computeKpiComparisons([]);
    const emptyHeaderLabels = computeKpiHeaderLabels(emptyComparisons);
    return {
      latestMonth: '',
      previousMonth: null,
      monthlyRollups: [],
      kpiAggregationByTimeframe: emptyAggregations,
      kpiComparisonByTimeframe: emptyComparisons,
      kpiHeaderLabelByTimeframe: emptyHeaderLabels,
      kpiCards: [],
      trend: [],
      expenseSlices: [],
      topPayees: [],
      movers: [],
      opportunityTotal: 0,
      opportunities: [],
      summaryBullets: [],
      digHerePreview: [],
    };
  }

  const latest = monthlyRollups[monthlyRollups.length - 1];
  const previous = monthlyRollups.length > 1 ? monthlyRollups[monthlyRollups.length - 2] : null;
  const kpiAggregationByTimeframe = computeKpiAggregations(monthlyRollups);
  const kpiComparisonByTimeframe = computeKpiComparisons(monthlyRollups);
  const kpiHeaderLabelByTimeframe = computeKpiHeaderLabels(kpiComparisonByTimeframe);

  const latestMonthTxns = txns.filter((txn) => txn.month === latest.month);
  const previousMonthTxns = previous ? txns.filter((txn) => txn.month === previous.month) : [];

  const opportunities = buildOpportunities(latestMonthTxns, monthlyRollups, txns);
  const opportunityTotal = round2(opportunities.reduce((sum, item) => sum + item.savings, 0));

  return {
    latestMonth: latest.month,
    previousMonth: previous?.month ?? null,
    monthlyRollups,
    kpiAggregationByTimeframe,
    kpiComparisonByTimeframe,
    kpiHeaderLabelByTimeframe,
    kpiCards: buildKpis(kpiAggregationByTimeframe.thisMonth, kpiAggregationByTimeframe.lastMonth),
    trend: monthlyRollups.map<TrendPoint>((rollup) => ({
      month: rollup.month,
      income: rollup.revenue,
      expense: rollup.expenses,
      net: rollup.netCashFlow,
    })),
    expenseSlices: buildExpenseSlices(latestMonthTxns),
    topPayees: buildTopPayees(latestMonthTxns),
    movers: buildMovers(latestMonthTxns, previousMonthTxns),
    opportunityTotal,
    opportunities,
    summaryBullets: buildSummary(latest, previous, opportunities, txns.length),
    digHerePreview: opportunities.slice(0, 4),
  };
}

export function projectScenario(model: DashboardModel, input: ScenarioInput): ScenarioPoint[] {
  if (!model.latestMonth || model.monthlyRollups.length === 0) {
    return [];
  }

  const baselineMonths = model.monthlyRollups.slice(-3);
  const baselineRevenue =
    baselineMonths.reduce((sum, month) => sum + month.revenue, 0) /
    Math.max(baselineMonths.length, 1);
  const baselineExpense =
    baselineMonths.reduce((sum, month) => sum + month.expenses, 0) /
    Math.max(baselineMonths.length, 1);

  const growthFactor = 1 + input.revenueGrowthPct / 100;
  const expenseFactor = 1 - input.expenseReductionPct / 100;

  const projections: ScenarioPoint[] = [];
  let cumulativeNet = 0;

  for (let index = 1; index <= input.months; index += 1) {
    const month = addMonths(model.latestMonth, index);
    const projectedIncome = round2(baselineRevenue * growthFactor ** index);
    const projectedExpense = round2(baselineExpense * expenseFactor ** index);
    const projectedNet = round2(projectedIncome - projectedExpense);
    cumulativeNet = round2(cumulativeNet + projectedNet);

    projections.push({
      month,
      projectedIncome,
      projectedExpense,
      projectedNet,
      cumulativeNet,
    });
  }

  return projections;
}

export function toMonthLabel(month: string): string {
  return monthLabel(month);
}
