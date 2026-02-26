import type {
  CashFlowForecastModelNotes,
  CashFlowForecastPoint,
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
  TrajectorySignal,
  TrajectorySignalId,
  TrendDirection,
  TrendPoint,
  Txn,
} from '../data/contract';

const EPSILON = 0.00001;
const EXPENSE_COLORS = ['#76a8ff', '#5e84f1', '#4f6fdd', '#3f58c1', '#2f479f', '#243b82', '#1b2f67'];
export const KPI_TIMEFRAMES: KpiTimeframe[] = [
  'thisMonth',
  'lastMonth',
  'last3Months',
  'ytd',
  'last12Months',
  'last24Months',
  'last36Months',
  'allDates',
];
export const KPI_COMPARISON_TIMEFRAMES: KpiComparisonTimeframe[] = [
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

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageMonthOverMonthDelta(values: number[]): number {
  if (values.length < 2) return 0;
  let totalDelta = 0;
  for (let index = 1; index < values.length; index += 1) {
    totalDelta += values[index] - values[index - 1];
  }
  return totalDelta / (values.length - 1);
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

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function autocorrelation(values: number[], lag: number): number {
  if (values.length <= lag || lag <= 0) return 0;
  const mean = average(values);
  let numerator = 0;
  let denominator = 0;

  for (let index = lag; index < values.length; index += 1) {
    numerator += (values[index] - mean) * (values[index - lag] - mean);
  }
  for (let index = 0; index < values.length; index += 1) {
    denominator += (values[index] - mean) ** 2;
  }

  if (Math.abs(denominator) <= EPSILON) return 0;
  return numerator / denominator;
}

type LinearRegressionResult = {
  slope: number;
  intercept: number;
  rSquared: number;
};

function linearRegression(values: number[]): LinearRegressionResult {
  if (values.length === 0) {
    return { slope: 0, intercept: 0, rSquared: 0 };
  }

  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = average(values);
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < n; index += 1) {
    const xDelta = index - xMean;
    numerator += xDelta * (values[index] - yMean);
    denominator += xDelta * xDelta;
  }

  const slope = Math.abs(denominator) <= EPSILON ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  const fitted = values.map((_, index) => intercept + slope * index);
  const ssRes = values.reduce((sum, value, index) => sum + (value - fitted[index]) ** 2, 0);
  const ssTot = values.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const rSquared = Math.abs(ssTot) <= EPSILON ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, rSquared };
}

type TrendModel = {
  method: 'linear-trend' | 'rolling-average';
  slope: number;
  rSquared: number;
  rollingWindow: number;
  fitAtIndex: (index: number) => number;
  projectAtOffset: (offset: number) => number;
};

function buildTrendModel(values: number[]): TrendModel {
  const rollingWindow = Math.max(1, Math.min(3, values.length));
  const rollingBaseline = average(values.slice(-rollingWindow));
  const regression = linearRegression(values);
  const valueRange =
    values.length > 0 ? Math.max(...values) - Math.min(...values) : 0;
  const minSlopeThreshold = Math.max(valueRange * 0.03, Math.abs(rollingBaseline) * 0.005, 1);
  const hasConfidentTrend =
    values.length >= 6 &&
    regression.rSquared >= 0.35 &&
    Math.abs(regression.slope) >= minSlopeThreshold;

  if (hasConfidentTrend) {
    return {
      method: 'linear-trend',
      slope: regression.slope,
      rSquared: regression.rSquared,
      rollingWindow,
      fitAtIndex: (index) => regression.intercept + regression.slope * index,
      projectAtOffset: (offset) => regression.intercept + regression.slope * (values.length - 1 + offset),
    };
  }

  return {
    method: 'rolling-average',
    slope: averageMonthOverMonthDelta(values.slice(-Math.max(2, Math.min(6, values.length)))),
    rSquared: regression.rSquared,
    rollingWindow,
    fitAtIndex: () => rollingBaseline,
    projectAtOffset: () => rollingBaseline,
  };
}

type SeasonalityDetection = {
  isConfident: boolean;
  adjustmentsByMonth: number[];
  seasonalStrength: number;
  autocorrelation12: number;
  uniqueMonths: number;
  reason: string;
};

function detectExpenseSeasonality(monthlyRollups: MonthlyRollup[], expenseTrendModel: TrendModel): SeasonalityDetection {
  const monthNumbers = monthlyRollups.map((rollup) => parseMonthParts(rollup.month)?.month ?? 0);
  const expenseValues = monthlyRollups.map((rollup) => rollup.expenses);
  const groups = new Map<number, number[]>();

  for (let index = 0; index < monthlyRollups.length; index += 1) {
    const monthNumber = monthNumbers[index];
    if (monthNumber < 1 || monthNumber > 12) continue;
    const residual = expenseValues[index] - expenseTrendModel.fitAtIndex(index);
    const current = groups.get(monthNumber) ?? [];
    current.push(residual);
    groups.set(monthNumber, current);
  }

  const adjustmentsByMonth = new Array(13).fill(0);
  let weightedSum = 0;
  let weightedCount = 0;
  groups.forEach((values, monthNumber) => {
    const adjustment = average(values);
    adjustmentsByMonth[monthNumber] = adjustment;
    weightedSum += adjustment * values.length;
    weightedCount += values.length;
  });

  const centeredOffset = weightedCount > 0 ? weightedSum / weightedCount : 0;
  groups.forEach((_, monthNumber) => {
    adjustmentsByMonth[monthNumber] -= centeredOffset;
  });

  const adjustedResiduals = expenseValues.map((value, index) => {
    const monthNumber = monthNumbers[index];
    const seasonal = monthNumber >= 1 && monthNumber <= 12 ? adjustmentsByMonth[monthNumber] : 0;
    return value - expenseTrendModel.fitAtIndex(index) - seasonal;
  });

  const uniqueMonths = groups.size;
  const seasonalValues = [...groups.keys()].map((monthNumber) => adjustmentsByMonth[monthNumber]);
  const seasonalStrength =
    standardDeviation(adjustedResiduals) <= EPSILON
      ? 0
      : standardDeviation(seasonalValues) / standardDeviation(adjustedResiduals);
  const autocorrelation12 = autocorrelation(expenseValues, 12);
  const hasEnoughHistory = monthlyRollups.length >= 18;
  const hasCoverage = uniqueMonths >= 10;
  const hasSignal = seasonalStrength >= 0.45 || autocorrelation12 >= 0.35;
  const isConfident = hasEnoughHistory && hasCoverage && hasSignal;

  let reason = 'no recurring pattern detected';
  if (!hasEnoughHistory) {
    reason = 'insufficient history for seasonality detection';
  } else if (!hasCoverage) {
    reason = 'insufficient month-of-year coverage';
  } else if (!hasSignal) {
    reason = 'recurring pattern confidence is low';
  }

  return {
    isConfident,
    adjustmentsByMonth,
    seasonalStrength,
    autocorrelation12,
    uniqueMonths,
    reason,
  };
}

type CashFlowForecastBuildResult = {
  series: CashFlowForecastPoint[];
  modelNotes: CashFlowForecastModelNotes;
};

type SuggestedMarginRecommendation = {
  suggestedRevenueMargin: number;
  suggestedExpenseMargin: number;
  suggestedMarginJustification: string;
};

function formatSignedPercent(value: number): string {
  if (value > 0) return `+${value}%`;
  return `${value}%`;
}

function mapRevenueVolatilityToMargin(volatilityScore: number): number {
  if (volatilityScore < 0.08) return 0;
  if (volatilityScore < 0.14) return -5;
  if (volatilityScore < 0.2) return -10;
  if (volatilityScore < 0.28) return -15;
  if (volatilityScore < 0.36) return -20;
  if (volatilityScore < 0.46) return -25;
  if (volatilityScore < 0.58) return -30;
  if (volatilityScore < 0.72) return -35;
  return -40;
}

function mapExpenseVolatilityToMargin(volatilityScore: number): number {
  if (volatilityScore < 0.08) return 0;
  if (volatilityScore < 0.14) return 5;
  if (volatilityScore < 0.2) return 10;
  if (volatilityScore < 0.28) return 15;
  return 20;
}

function computeVolatilityScore(values: number[]): number {
  if (values.length < 2) return 0;

  const meanAbs = average(values.map((value) => Math.abs(value)));
  const coefficientOfVariation = meanAbs <= EPSILON ? 0 : standardDeviation(values) / meanAbs;
  const monthOverMonthChanges: number[] = [];

  for (let index = 1; index < values.length; index += 1) {
    const previousAbs = Math.abs(values[index - 1]);
    if (previousAbs <= EPSILON) continue;
    monthOverMonthChanges.push(Math.abs(values[index] - values[index - 1]) / previousAbs);
  }

  const averageChangeMagnitude = monthOverMonthChanges.length > 0 ? average(monthOverMonthChanges) : 0;
  return coefficientOfVariation * 0.6 + averageChangeMagnitude * 0.4;
}

function suggestForecastMargins(monthlyRollups: MonthlyRollup[]): SuggestedMarginRecommendation {
  const window = monthlyRollups.slice(-Math.min(12, monthlyRollups.length));
  const monthCount = window.length;

  if (monthCount < 6) {
    const monthLabel = monthCount === 1 ? 'month' : 'months';
    return {
      suggestedRevenueMargin: 0,
      suggestedExpenseMargin: 0,
      suggestedMarginJustification: `Suggested margins default to 0% for revenue and 0% for expenses because only ${monthCount} actual ${monthLabel} are available, which is not enough history for a stable volatility estimate.`,
    };
  }

  const revenueVolatility = computeVolatilityScore(window.map((rollup) => rollup.revenue));
  const expenseVolatility = computeVolatilityScore(window.map((rollup) => rollup.expenses));
  const suggestedRevenueMargin = mapRevenueVolatilityToMargin(revenueVolatility);
  const suggestedExpenseMargin = mapExpenseVolatilityToMargin(expenseVolatility);

  return {
    suggestedRevenueMargin,
    suggestedExpenseMargin,
    suggestedMarginJustification: `Using the last ${monthCount} actual months, revenue volatility is ${(revenueVolatility * 100).toFixed(
      1
    )}% and expense volatility is ${(expenseVolatility * 100).toFixed(1)}%. Suggested safety margins are ${formatSignedPercent(
      suggestedRevenueMargin
    )} for revenue and ${formatSignedPercent(suggestedExpenseMargin)} for expenses.`,
  };
}

function buildCashFlowForecastSeries(monthlyRollups: MonthlyRollup[], projectionMonths = 12): CashFlowForecastBuildResult {
  if (monthlyRollups.length === 0) {
    return {
      series: [],
      modelNotes: {
        revenue: 'Revenue forecast unavailable (no historical months).',
        expenses: 'Expenses forecast unavailable (no historical months).',
      },
    };
  }

  const actualRows: CashFlowForecastPoint[] = monthlyRollups.map((rollup) => ({
    month: rollup.month,
    revenue: rollup.revenue,
    expenses: rollup.expenses,
    netCashFlow: rollup.netCashFlow,
    status: 'actual',
  }));

  const revenueValues = monthlyRollups.map((rollup) => rollup.revenue);
  const expenseValues = monthlyRollups.map((rollup) => rollup.expenses);
  const revenueTrendModel = buildTrendModel(revenueValues);
  const expenseTrendModel = buildTrendModel(expenseValues);
  const expenseSeasonality = detectExpenseSeasonality(monthlyRollups, expenseTrendModel);
  const latestMonth = monthlyRollups[monthlyRollups.length - 1].month;

  const projectedRows: CashFlowForecastPoint[] = [];
  for (let index = 1; index <= projectionMonths; index += 1) {
    const month = addMonths(latestMonth, index);
    const monthNumber = parseMonthParts(month)?.month ?? 0;
    const projectedRevenue = round2(Math.max(revenueTrendModel.projectAtOffset(index), 0));
    const seasonalExpenseAdjustment =
      expenseSeasonality.isConfident && monthNumber >= 1 && monthNumber <= 12
        ? expenseSeasonality.adjustmentsByMonth[monthNumber]
        : 0;
    const projectedExpenses = round2(
      Math.max(expenseTrendModel.projectAtOffset(index) + seasonalExpenseAdjustment, 0)
    );
    projectedRows.push({
      month,
      revenue: projectedRevenue,
      expenses: projectedExpenses,
      netCashFlow: round2(projectedRevenue - projectedExpenses),
      status: 'projected',
    });
  }

  const revenueModelNote =
    revenueTrendModel.method === 'linear-trend'
      ? `Revenue uses linear trend (R²=${revenueTrendModel.rSquared.toFixed(2)}, slope=${round2(
          revenueTrendModel.slope
        ).toLocaleString()}/month).`
      : `Revenue uses rolling average (${revenueTrendModel.rollingWindow}-month window); trend confidence is low (R²=${revenueTrendModel.rSquared.toFixed(
          2
        )}).`;

  const expenseTrendNote =
    expenseTrendModel.method === 'linear-trend'
      ? `trend base = linear (R²=${expenseTrendModel.rSquared.toFixed(2)}, slope=${round2(
          expenseTrendModel.slope
        ).toLocaleString()}/month)`
      : `trend base = rolling average (${expenseTrendModel.rollingWindow}-month window)`;

  const expenseModelNote = expenseSeasonality.isConfident
    ? `Expenses uses ${expenseTrendNote} + recurring monthly pattern (strength=${expenseSeasonality.seasonalStrength.toFixed(
        2
      )}, autocorr12=${expenseSeasonality.autocorrelation12.toFixed(2)}).`
    : `Expenses uses ${expenseTrendNote}; fallback applied (${expenseSeasonality.reason}).`;

  return {
    series: [...actualRows, ...projectedRows],
    modelNotes: {
      revenue: revenueModelNote,
      expenses: expenseModelNote,
    },
  };
}

function normalizeCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9: ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCapitalDistribution(category: string): boolean {
  const normalized = normalizeCategory(category);
  if (!normalized) return false;

  if (normalized === 'capital distribution') return true;

  const segments = normalized.split(':').map((segment) => segment.trim()).filter(Boolean);
  return segments.some((segment) => segment === 'capital distribution');
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
      result[timeframe] = `Last 12 Months through ${currentEnd} vs prior 12 Months`;
      return result;
    }

    result[timeframe] = `${currentRange} · vs ${previousRange}`;
    return result;
  }, {} as KpiHeaderLabelMap);
}

type TrajectorySignalConfig = {
  id: TrajectorySignalId;
  label: string;
  timeframe: KpiComparisonTimeframe;
};

const TRAJECTORY_SIGNALS: TrajectorySignalConfig[] = [
  { id: 'monthlyTrend', label: 'Monthly Trend', timeframe: 'thisMonth' },
  { id: 'shortTermTrend', label: 'Short-Term Trend', timeframe: 'last3Months' },
  { id: 'longTermTrend', label: 'Long-Term Trend', timeframe: 'ttm' },
];

export function computeTrajectorySignals(comparisons: KpiComparisonMap): TrajectorySignal[] {
  return TRAJECTORY_SIGNALS.map((signal) => {
    const source = comparisons[signal.timeframe];
    const net = source?.netCashFlow;

    const hasSufficientHistory =
      Boolean(source) &&
      (source.currentMonthCount ?? 0) > 0 &&
      (source.previousMonthCount ?? 0) > 0;

    const currentNetCashFlow = net?.current ?? 0;
    const previousNetCashFlow = net?.previous ?? 0;
    const delta = net?.delta ?? 0;
    const percentChange = hasSufficientHistory ? net?.percentChange ?? null : null;

    const direction: TrendDirection = hasSufficientHistory ? trendFromDelta(delta) : 'flat';
    const light: 'green' | 'red' | 'neutral' =
      !hasSufficientHistory ? 'neutral' : direction === 'up' ? 'green' : direction === 'down' ? 'red' : 'neutral';

    return {
      id: signal.id,
      label: signal.label,
      timeframe: signal.timeframe,
      currentStartMonth: source?.currentStartMonth ?? null,
      currentEndMonth: source?.currentEndMonth ?? null,
      previousStartMonth: source?.previousStartMonth ?? null,
      previousEndMonth: source?.previousEndMonth ?? null,
      currentMonthCount: source?.currentMonthCount ?? 0,
      previousMonthCount: source?.previousMonthCount ?? 0,
      currentNetCashFlow: round2(currentNetCashFlow),
      previousNetCashFlow: round2(previousNetCashFlow),
      delta: round2(delta),
      percentChange,
      direction,
      light,
      hasSufficientHistory,
    };
  });
}

type DebugMetricSnapshot = {
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
};

export type TimeframeDebugWindowRow = {
  timeframe: KpiTimeframe;
  startMonth: string;
  endMonth: string;
  monthCount: number;
  revenue: number;
  expenses: number;
  netCashFlow: number;
  savingsRate: number;
};

export type TimeframeDebugComparisonRow = {
  timeframe: KpiTimeframe;
  rule: string;
  currentStartMonth: string;
  currentEndMonth: string;
  currentMonthCount: number;
  previousStartMonth: string;
  previousEndMonth: string;
  previousMonthCount: number;
  revenue: DebugMetricSnapshot;
  expenses: DebugMetricSnapshot;
  netCashFlow: DebugMetricSnapshot;
  savingsRate: DebugMetricSnapshot;
};

export type PrePhase4DebugReport = {
  latestMonthFromRollups: string;
  maxMonthFromTxns: string;
  latestMonthUsesMaxDate: boolean;
  windowRows: TimeframeDebugWindowRow[];
  comparisonRows: TimeframeDebugComparisonRow[];
  trajectoryRows: Array<{
    id: TrajectorySignalId;
    label: string;
    timeframe: KpiComparisonTimeframe;
    currentRange: string;
    previousRange: string;
    currentNetCashFlow: number;
    previousNetCashFlow: number;
    delta: number;
    percentChange: number | null;
    direction: TrendDirection;
    light: 'green' | 'red' | 'neutral';
    hasSufficientHistory: boolean;
  }>;
};

function toDebugMonth(value: string | null): string {
  if (!value) return 'n/a';
  return monthLabelStable(value);
}

function toDebugMetricSnapshot(current: number, previous: number): DebugMetricSnapshot {
  return {
    current: round2(current),
    previous: round2(previous),
    delta: round2(current - previous),
    percentChange: pctDelta(current, previous),
  };
}

function selectDebugComparisonForTimeframe(
  monthlyRollups: MonthlyRollup[],
  timeframe: KpiTimeframe
): { rule: string; current: MonthlyRollup[]; previous: MonthlyRollup[] } {
  if (timeframe === 'thisMonth') {
    return {
      rule: 'This Month vs Last Month',
      current: selectTrailingRollups(monthlyRollups, 1),
      previous: selectPriorTrailingBlock(monthlyRollups, 1),
    };
  }

  if (timeframe === 'lastMonth') {
    return {
      rule: 'Last Month vs Month Before Last',
      current: monthlyRollups.length > 1 ? [monthlyRollups[monthlyRollups.length - 2]] : [],
      previous: monthlyRollups.length > 2 ? [monthlyRollups[monthlyRollups.length - 3]] : [],
    };
  }

  if (timeframe === 'last3Months') {
    return {
      rule: 'Rolling 3M vs Prior 3M Block',
      current: selectTrailingRollups(monthlyRollups, 3),
      previous: selectPriorTrailingBlock(monthlyRollups, 3),
    };
  }

  if (timeframe === 'ytd') {
    const latest = monthlyRollups[monthlyRollups.length - 1];
    const parsedLatest = latest ? parseMonthParts(latest.month) : null;
    if (!parsedLatest) {
      return {
        rule: 'YTD vs Prior-Year YTD',
        current: [],
        previous: [],
      };
    }
    return {
      rule: 'YTD vs Prior-Year YTD',
      current: selectYtdRollupsForYear(monthlyRollups, parsedLatest.year, parsedLatest.month),
      previous: selectYtdRollupsForYear(monthlyRollups, parsedLatest.year - 1, parsedLatest.month),
    };
  }

  if (timeframe === 'last12Months') {
    return {
      rule: 'Last 12 Months vs Prior 12-Month Block',
      current: selectTrailingRollups(monthlyRollups, 12),
      previous: selectPriorTrailingBlock(monthlyRollups, 12),
    };
  }

  if (timeframe === 'last24Months') {
    return {
      rule: 'Rolling 24M vs Prior 24M Block',
      current: selectTrailingRollups(monthlyRollups, 24),
      previous: selectPriorTrailingBlock(monthlyRollups, 24),
    };
  }

  if (timeframe === 'last36Months') {
    return {
      rule: 'Rolling 36M vs Prior 36M Block',
      current: selectTrailingRollups(monthlyRollups, 36),
      previous: selectPriorTrailingBlock(monthlyRollups, 36),
    };
  }

  const allDatesCurrent = monthlyRollups;
  const allDatesCount = allDatesCurrent.length;
  const allDatesPrevious =
    allDatesCount > 0 && monthlyRollups.length >= allDatesCount * 2
      ? monthlyRollups.slice(monthlyRollups.length - allDatesCount * 2, monthlyRollups.length - allDatesCount)
      : [];

  return {
    rule: 'All Dates vs Prior Equal-Length Block',
    current: allDatesCurrent,
    previous: allDatesPrevious,
  };
}

export function buildPrePhase4DebugReport(monthlyRollups: MonthlyRollup[], txns: Txn[]): PrePhase4DebugReport {
  const maxMonthFromTxns = txns.reduce((latest, txn) => {
    if (!latest) return txn.month;
    return txn.month > latest ? txn.month : latest;
  }, '');
  const latestMonthFromRollups = monthlyRollups[monthlyRollups.length - 1]?.month ?? '';

  const windowRows = KPI_TIMEFRAMES.map<TimeframeDebugWindowRow>((timeframe) => {
    const selected = selectRollupsForTimeframe(monthlyRollups, timeframe);
    const summary = summarizeRollups(selected);
    return {
      timeframe,
      startMonth: toDebugMonth(summary.startMonth),
      endMonth: toDebugMonth(summary.endMonth),
      monthCount: summary.monthCount,
      revenue: summary.revenue,
      expenses: summary.expenses,
      netCashFlow: summary.netCashFlow,
      savingsRate: summary.savingsRate,
    };
  });

  const comparisonRows = KPI_TIMEFRAMES.map<TimeframeDebugComparisonRow>((timeframe) => {
    const blocks = selectDebugComparisonForTimeframe(monthlyRollups, timeframe);
    const current = summarizeRollups(blocks.current);
    const previous = summarizeRollups(blocks.previous);
    return {
      timeframe,
      rule: blocks.rule,
      currentStartMonth: toDebugMonth(current.startMonth),
      currentEndMonth: toDebugMonth(current.endMonth),
      currentMonthCount: current.monthCount,
      previousStartMonth: toDebugMonth(previous.startMonth),
      previousEndMonth: toDebugMonth(previous.endMonth),
      previousMonthCount: previous.monthCount,
      revenue: toDebugMetricSnapshot(current.revenue, previous.revenue),
      expenses: toDebugMetricSnapshot(current.expenses, previous.expenses),
      netCashFlow: toDebugMetricSnapshot(current.netCashFlow, previous.netCashFlow),
      savingsRate: toDebugMetricSnapshot(current.savingsRate, previous.savingsRate),
    };
  });

  const comparisonMap = computeKpiComparisons(monthlyRollups);
  const trajectoryRows = computeTrajectorySignals(comparisonMap).map((signal) => ({
    id: signal.id,
    label: signal.label,
    timeframe: signal.timeframe,
    currentRange: formatMonthRangeStable(signal.currentStartMonth, signal.currentEndMonth),
    previousRange: formatMonthRangeStable(signal.previousStartMonth, signal.previousEndMonth),
    currentNetCashFlow: signal.currentNetCashFlow,
    previousNetCashFlow: signal.previousNetCashFlow,
    delta: signal.delta,
    percentChange: signal.percentChange,
    direction: signal.direction,
    light: signal.light,
    hasSufficientHistory: signal.hasSufficientHistory,
  }));

  return {
    latestMonthFromRollups,
    maxMonthFromTxns,
    latestMonthUsesMaxDate: !maxMonthFromTxns || latestMonthFromRollups === maxMonthFromTxns,
    windowRows,
    comparisonRows,
    trajectoryRows,
  };
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
    const emptyTrajectory = computeTrajectorySignals(emptyComparisons);
    return {
      latestMonth: '',
      previousMonth: null,
      monthlyRollups: [],
      kpiAggregationByTimeframe: emptyAggregations,
      kpiComparisonByTimeframe: emptyComparisons,
      kpiHeaderLabelByTimeframe: emptyHeaderLabels,
      trajectorySignals: emptyTrajectory,
      kpiCards: [],
      trend: [],
      cashFlowForecastSeries: [],
      cashFlowForecastModelNotes: {
        revenue: 'Revenue forecast unavailable (no historical months).',
        expenses: 'Expenses forecast unavailable (no historical months).',
      },
      suggestedRevenueMargin: 0,
      suggestedExpenseMargin: 0,
      suggestedMarginJustification:
        'Suggested margins default to 0% for revenue and 0% for expenses because there are no actual months available yet.',
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
  const trajectorySignals = computeTrajectorySignals(kpiComparisonByTimeframe);

  const latestMonthTxns = txns.filter((txn) => txn.month === latest.month);
  const previousMonthTxns = previous ? txns.filter((txn) => txn.month === previous.month) : [];

  const opportunities = buildOpportunities(latestMonthTxns, monthlyRollups, txns);
  const opportunityTotal = round2(opportunities.reduce((sum, item) => sum + item.savings, 0));
  // Precompute up to 36 projected months so UI horizon controls can expand
  // from 30-day equivalents through 3 years without recalculating the model.
  const cashFlowForecast = buildCashFlowForecastSeries(monthlyRollups, 36);
  const suggestedMargins = suggestForecastMargins(monthlyRollups);

  return {
    latestMonth: latest.month,
    previousMonth: previous?.month ?? null,
    monthlyRollups,
    kpiAggregationByTimeframe,
    kpiComparisonByTimeframe,
    kpiHeaderLabelByTimeframe,
    trajectorySignals,
    kpiCards: buildKpis(kpiAggregationByTimeframe.thisMonth, kpiAggregationByTimeframe.lastMonth),
    trend: monthlyRollups.map<TrendPoint>((rollup) => ({
      month: rollup.month,
      income: rollup.revenue,
      expense: rollup.expenses,
      net: rollup.netCashFlow,
    })),
    cashFlowForecastSeries: cashFlowForecast.series,
    cashFlowForecastModelNotes: cashFlowForecast.modelNotes,
    suggestedRevenueMargin: suggestedMargins.suggestedRevenueMargin,
    suggestedExpenseMargin: suggestedMargins.suggestedExpenseMargin,
    suggestedMarginJustification: suggestedMargins.suggestedMarginJustification,
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
