import type {
  CashFlowForecastModelNotes,
  CashFlowForecastPoint,
  CashFlowMode,
  DashboardModel,
  ExpenseSlice,
  ForecastCashRollup,
  ForecastDecisionSignals,
  ForecastProjectionResult,
  ForecastSeasonalityMeta,
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
  MoverGrouping,
  OpportunityItem,
  PayeeTotal,
  RunwayMetric,
  ScenarioInput,
  ScenarioPoint,
  TrajectorySignal,
  TrajectorySignalId,
  TrendDirection,
  TrendPoint,
  Txn,
} from '../data/contract';
import {
  expenseContribution,
  forecastCashInContribution,
  forecastCashOutContribution,
  includeExpenseForDigHere,
  isCapitalDistributionCategory,
  isUncategorizedCategory,
  parentCategoryName,
  revenueContribution,
  shouldExcludeFromProfitability,
} from '../cashFlow';

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
  'lastMonth',
  'last3Months',
  'ytd',
  'ttm',
  'last24Months',
  'last36Months',
  'allDates',
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
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

    if (shouldExcludeFromProfitability(txn)) return;

    const revenue = revenueContribution(txn);
    const expense = expenseContribution(txn, cashFlowMode);

    if (Math.abs(revenue) > EPSILON) {
      rollup.revenue += revenue;
    }

    if (Math.abs(expense) > EPSILON) {
      rollup.expenses += expense;
      if (txn.rawAmount < 0 && isCapitalDistributionCategory(txn.category)) {
        rollup.capitalDistribution += expense;
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
    .map((rollup) => {
      const effectiveExpenses =
        cashFlowMode === 'operating'
          ? rollup.expenses - rollup.capitalDistribution
          : rollup.expenses;

      return {
        month: rollup.month,
        revenue: round2(rollup.revenue),
        expenses: round2(effectiveExpenses),
        netCashFlow: round2(rollup.netCashFlow),
        savingsRate: round2(rollup.revenue > EPSILON ? (rollup.netCashFlow / rollup.revenue) * 100 : 0),
        transactionCount: rollup.transactionCount,
      };
    });
}

export function computeForecastCashRollups(txns: Txn[]): ForecastCashRollup[] {
  const monthMap = new Map<string, ForecastCashRollup>();

  txns.forEach((txn) => {
    if (!monthMap.has(txn.month)) {
      monthMap.set(txn.month, {
        month: txn.month,
        cashIn: 0,
        cashOut: 0,
        netCashFlow: 0,
        transactionCount: 0,
      });
    }

    const rollup = monthMap.get(txn.month);
    if (!rollup) return;

    const cashIn = forecastCashInContribution(txn);
    const cashOut = forecastCashOutContribution(txn);

    if (Math.abs(cashIn) > EPSILON) {
      rollup.cashIn += cashIn;
    }

    if (Math.abs(cashOut) > EPSILON) {
      rollup.cashOut += cashOut;
    }

    if (Math.abs(cashIn) > EPSILON || Math.abs(cashOut) > EPSILON) {
      rollup.transactionCount += 1;
    }

    rollup.netCashFlow = rollup.cashIn - rollup.cashOut;
  });

  return [...monthMap.values()]
    .sort((a, b) => sortMonths(a.month, b.month))
    .map((rollup) => ({
      month: rollup.month,
      cashIn: round2(rollup.cashIn),
      cashOut: round2(rollup.cashOut),
      netCashFlow: round2(rollup.netCashFlow),
      transactionCount: rollup.transactionCount,
    }));
}

/**
 * Build a rollup for a single month using only transactions up to (and including)
 * cutoffDate. Used to produce an apples-to-apples prior-year comparison when the
 * current month is still in progress.
 */
function computePartialMonthRollup(
  txns: Txn[],
  month: string,
  cutoffDate: string,
  cashFlowMode: CashFlowMode
): MonthlyRollup | null {
  const filtered = txns.filter((txn) => txn.month === month && txn.date <= cutoffDate);
  if (filtered.length === 0) return null;
  const rollups = computeMonthlyRollups(filtered, cashFlowMode);
  return rollups.find((r) => r.month === month) ?? null;
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
  const netCashFlow = rollups.reduce((sum, rollup) => sum + rollup.netCashFlow, 0);
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

function selectRollupsInRange(monthlyRollups: MonthlyRollup[], startMonth: string, endMonth: string): MonthlyRollup[] {
  return monthlyRollups.filter((rollup) => rollup.month >= startMonth && rollup.month <= endMonth);
}

export function computeRunwayMetric(
  monthlyRollups: MonthlyRollup[],
  currentCashBalance: number,
  anchorMonth?: string,
  reserveContextMonth?: string
): RunwayMetric {
  const normalizedCurrentCashBalance = round2(Number.isFinite(currentCashBalance) ? currentCashBalance : 0);
  const resolvedAnchor = resolveAnchorMonth(monthlyRollups, anchorMonth);
  const reserveSnapshot = computeOperatingReserveSnapshot(
    monthlyRollups,
    normalizedCurrentCashBalance,
    reserveContextMonth ?? anchorMonth ?? resolvedAnchor ?? undefined
  );

  if (normalizedCurrentCashBalance <= EPSILON) {
    return {
      status: 'no-runway',
      months: null,
      netRunwayMonths: null,
      grossRunwayMonths: null,
      burnBasisMonths: 0,
      netBurn: 0,
      grossBurn: 0,
      averageMonthlyBurn: 0,
      currentCashBalance: normalizedCurrentCashBalance,
      burnStartMonth: null,
      burnEndMonth: null,
      ...reserveSnapshot,
    };
  }

  if (!resolvedAnchor) {
    return {
      status: 'insufficient-history',
      months: null,
      netRunwayMonths: null,
      grossRunwayMonths: null,
      burnBasisMonths: 0,
      netBurn: 0,
      grossBurn: 0,
      averageMonthlyBurn: 0,
      currentCashBalance: normalizedCurrentCashBalance,
      burnStartMonth: null,
      burnEndMonth: null,
      ...reserveSnapshot,
    };
  }

  const burnWindow = selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -11), resolvedAnchor);

  if (burnWindow.length === 0) {
    return {
      status: 'insufficient-history',
      months: null,
      netRunwayMonths: null,
      grossRunwayMonths: null,
      burnBasisMonths: 0,
      netBurn: 0,
      grossBurn: 0,
      averageMonthlyBurn: 0,
      currentCashBalance: normalizedCurrentCashBalance,
      burnStartMonth: null,
      burnEndMonth: null,
      ...reserveSnapshot,
    };
  }

  const averageNetCashFlow =
    burnWindow.reduce((sum, rollup) => sum + rollup.netCashFlow, 0) / Math.max(burnWindow.length, 1);
  const averageMonthlyExpenses =
    burnWindow.reduce((sum, rollup) => sum + rollup.expenses, 0) / Math.max(burnWindow.length, 1);
  const grossBurn = round2(Math.max(averageMonthlyExpenses, 0));
  const grossRunwayMonths =
    grossBurn <= EPSILON ? null : round2(normalizedCurrentCashBalance / grossBurn);

  if (averageNetCashFlow >= -EPSILON) {
    return {
      status: 'self-funded',
      months: null,
      netRunwayMonths: null,
      grossRunwayMonths,
      burnBasisMonths: burnWindow.length,
      netBurn: 0,
      grossBurn,
      averageMonthlyBurn: 0,
      currentCashBalance: normalizedCurrentCashBalance,
      burnStartMonth: burnWindow[0]?.month ?? null,
      burnEndMonth: burnWindow[burnWindow.length - 1]?.month ?? null,
      ...reserveSnapshot,
    };
  }

  const averageMonthlyBurn = round2(Math.abs(averageNetCashFlow));
  const netRunwayMonths = averageMonthlyBurn <= EPSILON ? null : round2(normalizedCurrentCashBalance / averageMonthlyBurn);

  return {
    status: netRunwayMonths === null ? 'self-funded' : 'ok',
    months: netRunwayMonths,
    netRunwayMonths,
    grossRunwayMonths,
    burnBasisMonths: burnWindow.length,
    netBurn: averageMonthlyBurn,
    grossBurn,
    averageMonthlyBurn,
    currentCashBalance: normalizedCurrentCashBalance,
    burnStartMonth: burnWindow[0]?.month ?? null,
    burnEndMonth: burnWindow[burnWindow.length - 1]?.month ?? null,
    ...reserveSnapshot,
  };
}

function computeOperatingReserveSnapshot(
  monthlyRollups: MonthlyRollup[],
  currentCashBalance: number,
  contextMonth?: string
): Pick<RunwayMetric, 'reserveTarget' | 'percentFunded'> {
  const resolvedContextMonth = contextMonth ?? resolveAnchorMonth(monthlyRollups) ?? null;
  const parsedContext = resolvedContextMonth ? parseMonthParts(resolvedContextMonth) : null;
  if (!parsedContext) {
    return { reserveTarget: 0, percentFunded: null };
  }

  const priorCompleteRollups = monthlyRollups.filter((rollup) => rollup.month < resolvedContextMonth!);
  const reserveBasisWindow = selectTrailingRollups(priorCompleteRollups, 3);

  if (reserveBasisWindow.length === 0) {
    return { reserveTarget: 0, percentFunded: null };
  }

  const averageMonthlyExpenses =
    reserveBasisWindow.reduce((sum, rollup) => sum + rollup.expenses, 0) / reserveBasisWindow.length;
  const reserveTarget = round2(Math.max(averageMonthlyExpenses, 0));
  const percentFunded = reserveTarget > EPSILON ? round2(currentCashBalance / reserveTarget) : null;

  return { reserveTarget, percentFunded };
}

function resolveAnchorMonth(monthlyRollups: MonthlyRollup[], anchorMonth?: string): string | null {
  if (anchorMonth && /^\d{4}-\d{2}$/.test(anchorMonth)) return anchorMonth;
  return monthlyRollups[monthlyRollups.length - 1]?.month ?? null;
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

function selectRollupsForTimeframe(monthlyRollups: MonthlyRollup[], timeframe: KpiTimeframe, anchorMonth?: string): MonthlyRollup[] {
  if (monthlyRollups.length === 0) return [];

  if (timeframe === 'allDates') return monthlyRollups;
  const resolvedAnchor = resolveAnchorMonth(monthlyRollups, anchorMonth);
  if (!resolvedAnchor) return [];
  const parsedAnchor = parseMonthParts(resolvedAnchor);
  if (!parsedAnchor) return [];

  if (timeframe === 'thisMonth') return selectRollupsInRange(monthlyRollups, resolvedAnchor, resolvedAnchor);
  if (timeframe === 'lastMonth') {
    const targetMonth = addMonths(resolvedAnchor, -1);
    return selectRollupsInRange(monthlyRollups, targetMonth, targetMonth);
  }
  if (timeframe === 'last3Months') {
    return selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -2), resolvedAnchor);
  }
  if (timeframe === 'last12Months') {
    return selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -11), resolvedAnchor);
  }
  if (timeframe === 'last24Months') {
    return selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -23), resolvedAnchor);
  }
  if (timeframe === 'last36Months') {
    return selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -35), resolvedAnchor);
  }

  return selectYtdRollupsForYear(monthlyRollups, parsedAnchor.year, parsedAnchor.month);
}

function aggregateRollups(timeframe: KpiTimeframe, rollups: MonthlyRollup[]): KpiAggregate {
  const summary = summarizeRollups(rollups);
  return {
    timeframe,
    ...summary,
  };
}

export function computeKpiAggregations(monthlyRollups: MonthlyRollup[], anchorMonth?: string, thisMonthAnchor?: string): KpiAggregationMap {
  return KPI_TIMEFRAMES.reduce<KpiAggregationMap>((result, timeframe) => {
    const effectiveAnchor =
      timeframe === 'thisMonth' || timeframe === 'lastMonth' ? (thisMonthAnchor ?? anchorMonth) : anchorMonth;
    result[timeframe] = aggregateRollups(timeframe, selectRollupsForTimeframe(monthlyRollups, timeframe, effectiveAnchor));
    return result;
  }, {} as KpiAggregationMap);
}

function selectComparisonBlocks(
  monthlyRollups: MonthlyRollup[],
  timeframe: KpiComparisonTimeframe,
  anchorMonth?: string,
  thisMonthAnchor?: string
): { current: MonthlyRollup[]; previous: MonthlyRollup[] } {
  if (monthlyRollups.length === 0) {
    return { current: [], previous: [] };
  }

  const effectiveAnchorStr =
    timeframe === 'thisMonth' || timeframe === 'lastMonth' ? (thisMonthAnchor ?? anchorMonth) : anchorMonth;
  const resolvedAnchor = resolveAnchorMonth(monthlyRollups, effectiveAnchorStr);
  if (!resolvedAnchor) {
    return { current: [], previous: [] };
  }

  if (timeframe === 'thisMonth') {
    return {
      current: selectRollupsInRange(monthlyRollups, resolvedAnchor, resolvedAnchor),
      previous: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -1), addMonths(resolvedAnchor, -1)),
    };
  }

  if (timeframe === 'lastMonth') {
    return {
      current: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -1), addMonths(resolvedAnchor, -1)),
      previous: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -2), addMonths(resolvedAnchor, -2)),
    };
  }

  if (timeframe === 'last3Months') {
    return {
      current: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -2), resolvedAnchor),
      previous: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -5), addMonths(resolvedAnchor, -3)),
    };
  }

  if (timeframe === 'ttm') {
    return {
      current: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -11), resolvedAnchor),
      previous: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -23), addMonths(resolvedAnchor, -12)),
    };
  }

  if (timeframe === 'last24Months') {
    return {
      current: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -23), resolvedAnchor),
      previous: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -47), addMonths(resolvedAnchor, -24)),
    };
  }

  if (timeframe === 'last36Months') {
    return {
      current: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -35), resolvedAnchor),
      previous: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -71), addMonths(resolvedAnchor, -36)),
    };
  }

  if (timeframe === 'allDates') {
    const current = monthlyRollups;
    const count = current.length;
    const previous =
      count > 0 && monthlyRollups.length >= count * 2
        ? monthlyRollups.slice(monthlyRollups.length - count * 2, monthlyRollups.length - count)
        : [];
    return { current, previous };
  }

  const parsedAnchor = parseMonthParts(resolvedAnchor);
  if (!parsedAnchor) {
    return {
      current: selectTrailingRollups(monthlyRollups, 1),
      previous: selectPriorTrailingBlock(monthlyRollups, 1),
    };
  }

  return {
    current: selectYtdRollupsForYear(monthlyRollups, parsedAnchor.year, parsedAnchor.month),
    previous: selectYtdRollupsForYear(monthlyRollups, parsedAnchor.year - 1, parsedAnchor.month),
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

export function computeKpiComparisons(monthlyRollups: MonthlyRollup[], anchorMonth?: string, thisMonthAnchor?: string): KpiComparisonMap {
  return KPI_COMPARISON_TIMEFRAMES.reduce<KpiComparisonMap>((result, timeframe) => {
    const blocks = selectComparisonBlocks(monthlyRollups, timeframe, anchorMonth, thisMonthAnchor);
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

    if (timeframe === 'lastMonth') {
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

    if (timeframe === 'allDates') {
      result[timeframe] = `${currentRange} · vs ${previousRange}`;
      return result;
    }

    result[timeframe] = `${currentRange} · vs ${previousRange}`;
    return result;
  }, {} as KpiHeaderLabelMap);
}

/**
 * Year-over-Year comparison blocks for KPI cards.
 * thisMonth, lastMonth, last3Months compare against the same period 12 months prior.
 * All other timeframes delegate to the standard sequential logic.
 */
function selectYoYComparisonBlocks(
  monthlyRollups: MonthlyRollup[],
  timeframe: KpiComparisonTimeframe,
  anchorMonth?: string,
  thisMonthAnchor?: string,
  thisMonthPriorYearRollup?: MonthlyRollup | null
): { current: MonthlyRollup[]; previous: MonthlyRollup[] } {
  if (monthlyRollups.length === 0) {
    return { current: [], previous: [] };
  }

  const effectiveAnchorStr =
    timeframe === 'thisMonth' || timeframe === 'lastMonth' ? (thisMonthAnchor ?? anchorMonth) : anchorMonth;
  const resolvedAnchor = resolveAnchorMonth(monthlyRollups, effectiveAnchorStr);
  if (!resolvedAnchor) {
    return { current: [], previous: [] };
  }

  if (timeframe === 'thisMonth') {
    // Use a day-truncated prior-year rollup when available so we compare
    // e.g. Apr 1–3, 2026 against Apr 1–3, 2025, not all of Apr 2025.
    const previousRollups = thisMonthPriorYearRollup
      ? [thisMonthPriorYearRollup]
      : selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -12), addMonths(resolvedAnchor, -12));
    return {
      current: selectRollupsInRange(monthlyRollups, resolvedAnchor, resolvedAnchor),
      previous: previousRollups,
    };
  }

  if (timeframe === 'lastMonth') {
    const lastMonth = addMonths(resolvedAnchor, -1);
    return {
      current: selectRollupsInRange(monthlyRollups, lastMonth, lastMonth),
      previous: selectRollupsInRange(monthlyRollups, addMonths(lastMonth, -12), addMonths(lastMonth, -12)),
    };
  }

  if (timeframe === 'last3Months') {
    return {
      current: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -2), resolvedAnchor),
      previous: selectRollupsInRange(monthlyRollups, addMonths(resolvedAnchor, -14), addMonths(resolvedAnchor, -12)),
    };
  }

  // All other timeframes are already strategic (YoY-equivalent or longer):
  // ytd, ttm, last24Months, last36Months, allDates — delegate to standard logic.
  return selectComparisonBlocks(monthlyRollups, timeframe, anchorMonth, thisMonthAnchor);
}

export function computeKpiYoYComparisons(
  monthlyRollups: MonthlyRollup[],
  anchorMonth?: string,
  thisMonthAnchor?: string,
  thisMonthPriorYearRollup?: MonthlyRollup | null
): KpiComparisonMap {
  return KPI_COMPARISON_TIMEFRAMES.reduce<KpiComparisonMap>((result, timeframe) => {
    const blocks = selectYoYComparisonBlocks(monthlyRollups, timeframe, anchorMonth, thisMonthAnchor, thisMonthPriorYearRollup);
    const currentSummary = summarizeRollups(blocks.current);
    const previousSummary = summarizeRollups(blocks.previous);
    result[timeframe] = buildTimeframeComparison(timeframe, currentSummary, previousSummary);
    return result;
  }, {} as KpiComparisonMap);
}

export function computeKpiYoYHeaderLabels(comparisons: KpiComparisonMap): KpiHeaderLabelMap {
  return KPI_COMPARISON_TIMEFRAMES.reduce<KpiHeaderLabelMap>((result, timeframe) => {
    const item = comparisons[timeframe];
    const currentRange = formatMonthRangeStable(item.currentStartMonth, item.currentEndMonth);
    const previousRange = formatMonthRangeStable(item.previousStartMonth, item.previousEndMonth);
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
  { id: 'monthlyTrend', label: 'Last Month (YoY)', timeframe: 'lastMonth' },
  { id: 'shortTermTrend', label: 'Momentum (Last 3 Months)', timeframe: 'last3Months' },
  { id: 'longTermTrend', label: 'Annual Performance', timeframe: 'ttm' },
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

function categoryTotals(txns: Txn[], cashFlowMode: CashFlowMode): Map<string, number> {
  const totals = new Map<string, number>();
  txns.forEach((txn) => {
    const contribution = expenseContribution(txn, cashFlowMode);
    if (Math.abs(contribution) <= EPSILON) return;
    const current = totals.get(txn.category) ?? 0;
    totals.set(txn.category, current + contribution);
  });
  return totals;
}

function moverCategoryName(category: string, grouping: MoverGrouping): string {
  return grouping === 'categories' ? parentCategoryName(category) : category;
}

function buildUncategorizedWarning(txns: Txn[]): DashboardModel['uncategorizedWarning'] {
  const excluded = txns.filter((txn) => isUncategorizedCategory(txn.category));
  if (excluded.length === 0) return null;
  const absoluteAmount = round2(excluded.reduce((sum, txn) => sum + Math.abs(txn.rawAmount), 0));
  return {
    count: excluded.length,
    absoluteAmount,
  };
}

function categoryTotalsByGrouping(
  txns: Txn[],
  cashFlowMode: CashFlowMode,
  grouping: MoverGrouping
): Map<string, number> {
  const totals = new Map<string, number>();
  txns.forEach((txn) => {
    if (txn.type !== 'expense') return;
    if (!includeExpenseForDigHere(txn.category, cashFlowMode)) return;
    const category = moverCategoryName(txn.category, grouping);
    const current = totals.get(category) ?? 0;
    totals.set(category, current + txn.amount);
  });
  return totals;
}

export function computeExpenseSlices(txns: Txn[], cashFlowMode: CashFlowMode): { slices: ExpenseSlice[]; total: number } {
  const subTotals = categoryTotals(txns, cashFlowMode);
  const parentTotals = new Map<string, number>();
  subTotals.forEach((value, category) => {
    // Always exclude owner distributions / capital distributions from the expense breakdown
    if (isCapitalDistributionCategory(category)) return;
    const parent = parentCategoryName(category);
    parentTotals.set(parent, (parentTotals.get(parent) ?? 0) + value);
  });
  // Compute share relative to ALL categories so percentages are accurate even when truncated to top N
  const totalExpense = [...parentTotals.values()].reduce((sum, v) => sum + v, 0);
  const entries = [...parentTotals.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 7);

  return {
    slices: top.map(([name, value], index) => ({
      name,
      value: round2(value),
      share: totalExpense > EPSILON ? value / totalExpense : 0,
      color: EXPENSE_COLORS[index % EXPENSE_COLORS.length],
    })),
    total: round2(totalExpense),
  };
}

function buildExpenseSlices(txns: Txn[], cashFlowMode: CashFlowMode): ExpenseSlice[] {
  return computeExpenseSlices(txns, cashFlowMode).slices;
}

function buildTopPayees(latestMonthTxns: Txn[], cashFlowMode: CashFlowMode): PayeeTotal[] {
  const map = new Map<string, PayeeTotal>();

  latestMonthTxns.forEach((txn) => {
    const contribution = expenseContribution(txn, cashFlowMode);
    if (Math.abs(contribution) <= EPSILON) return;
    const payee = txn.payee?.trim() || 'Unknown';

    if (!map.has(payee)) {
      map.set(payee, { payee, amount: 0, transactionCount: 0 });
    }

    const current = map.get(payee);
    if (!current) return;

    current.amount += contribution;
    current.transactionCount += 1;
  });

  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
    .map((item) => ({ ...item, amount: round2(item.amount) }));
}

export function computePriorityScore(delta: number, deltaPercent: number | null, previous: number, current: number): number {
  const absDelta = Math.abs(delta);
  const magnitude = absDelta;
  const noveltyBoost = Math.abs(previous) <= EPSILON && Math.abs(current) > EPSILON ? 0.25 * absDelta : 0;
  const cappedPct = Math.min(Math.abs(deltaPercent ?? 0), 200);
  const relativeBoost = (cappedPct / 200) * 0.15 * absDelta;
  return round2(magnitude + noveltyBoost + relativeBoost);
}

function buildMovers(
  currentMonthTxns: Txn[],
  previousMonthTxns: Txn[],
  cashFlowMode: CashFlowMode,
  allRelevantTxns: Txn[] = currentMonthTxns,
  grouping: MoverGrouping = 'subcategories'
): Mover[] {
  const currentTotals = categoryTotalsByGrouping(currentMonthTxns, cashFlowMode, grouping);
  const previousTotals = categoryTotalsByGrouping(previousMonthTxns, cashFlowMode, grouping);
  const currentMonths = [...new Set(currentMonthTxns.map((txn) => txn.month))]
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .sort(sortMonths);
  const latestCurrentMonth = currentMonths[currentMonths.length - 1] ?? null;
  const sparklineWindow = Math.max(6, Math.min(Math.max(currentMonths.length, 1), 12));
  const sparklineTotalsByCategory = new Map<string, Map<string, number>>();

  if (latestCurrentMonth) {
    const sparklineMonths = Array.from({ length: sparklineWindow }, (_, index) =>
      addMonths(latestCurrentMonth, index - (sparklineWindow - 1))
    );
    const sparklineMonthSet = new Set(sparklineMonths);

    allRelevantTxns.forEach((txn) => {
      if (txn.type !== 'expense') return;
      if (!includeExpenseForDigHere(txn.category, cashFlowMode)) return;
      if (!sparklineMonthSet.has(txn.month)) return;
      const category = moverCategoryName(txn.category, grouping);

      if (!sparklineTotalsByCategory.has(category)) {
        sparklineTotalsByCategory.set(category, new Map<string, number>());
      }

      const categoryMap = sparklineTotalsByCategory.get(category);
      if (!categoryMap) return;

      categoryMap.set(txn.month, (categoryMap.get(txn.month) ?? 0) + txn.amount);
    });

    sparklineTotalsByCategory.forEach((monthMap, category) => {
      sparklineTotalsByCategory.set(
        category,
        new Map(sparklineMonths.map((month) => [month, round2(monthMap.get(month) ?? 0)]))
      );
    });
  }

  const categories = new Set<string>([...currentTotals.keys(), ...previousTotals.keys()]);
  const movers: Mover[] = [];

  categories.forEach((category) => {
    const current = round2(currentTotals.get(category) ?? 0);
    const previous = round2(previousTotals.get(category) ?? 0);
    const delta = round2(current - previous);
    const deltaPercent = pctDelta(current, previous);

    movers.push({
      category,
      current,
      previous,
      delta,
      deltaPercent,
      priorityScore: computePriorityScore(delta, deltaPercent, previous, current),
      sparkline: (() => {
        const sparklineMap = sparklineTotalsByCategory.get(category);
        if (!sparklineMap) return null;
        const series = [...sparklineMap.values()];
        return series.length >= 3 ? series : null;
      })(),
    });
  });

  return movers
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 8);
}

function baselineForCategory(monthlyRollups: MonthlyRollup[], txns: Txn[], category: string, excludeMonth: string): number {
  const months = monthlyRollups.map((rollup) => rollup.month).filter((month) => month < excludeMonth);
  const recentMonths = months.slice(-3);
  if (recentMonths.length === 0) return 0;

  const monthSet = new Set(recentMonths);
  let total = 0;

  txns.forEach((txn) => {
    if (txn.category !== category) return;
    if (!monthSet.has(txn.month)) return;
    total += expenseContribution(txn, 'operating');
  });

  return total / recentMonths.length;
}

function buildOpportunities(
  latestMonthTxns: Txn[],
  monthlyRollups: MonthlyRollup[],
  allTxns: Txn[],
  cashFlowMode: CashFlowMode
): OpportunityItem[] {
  const latestMonth = latestMonthTxns[0]?.month;
  if (!latestMonth) return [];

  const totals = categoryTotals(latestMonthTxns, cashFlowMode);
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
      .filter(
        (txn) => Math.abs(expenseContribution(txn, cashFlowMode)) > EPSILON
      )
      .reduce((sum, txn) => sum + expenseContribution(txn, cashFlowMode), 0) * 0.03) || 0);

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

export function computeDigHereInsights(
  currentTxns: Txn[],
  previousTxns: Txn[],
  cashFlowMode: CashFlowMode,
  allRelevantTxns: Txn[] = currentTxns,
  grouping: MoverGrouping = 'subcategories'
): Pick<DashboardModel, 'movers' | 'topPayees'> {
  return {
    movers: buildMovers(currentTxns, previousTxns, cashFlowMode, allRelevantTxns, grouping),
    topPayees: buildTopPayees(currentTxns, cashFlowMode),
  };
}

export function computeDashboardModel(
  txns: Txn[],
  options?: { cashFlowMode?: CashFlowMode; anchorMonth?: string; thisMonthAnchor?: string; currentCashBalance?: number }
): DashboardModel {
  const cashFlowMode = options?.cashFlowMode ?? 'operating';
  const anchorMonth = options?.anchorMonth;
  const thisMonthAnchor = options?.thisMonthAnchor;
  const currentCashBalance = options?.currentCashBalance ?? 0;
  const monthlyRollups = computeMonthlyRollups(txns, cashFlowMode);
  // Exclude the current (incomplete) calendar month so the forecast baseline
  // is always derived from fully-closed months.  Without this filter the
  // partial month drags down both the 3-month average and the latest-month
  // seed, making early projected months materially lower than reality.
  const lastCompleteMonth = thisMonthAnchor ? addMonths(thisMonthAnchor, -1) : undefined;
  const forecastCashRollups = computeForecastCashRollups(txns).filter(
    (rollup) => !lastCompleteMonth || rollup.month <= lastCompleteMonth
  );

  if (monthlyRollups.length === 0) {
    const emptyAggregations = computeKpiAggregations([], anchorMonth, thisMonthAnchor);
    const emptyComparisons = computeKpiComparisons([], anchorMonth, thisMonthAnchor);
    const emptyYoYComparisons = computeKpiYoYComparisons([], anchorMonth, thisMonthAnchor);
    const emptyHeaderLabels = computeKpiHeaderLabels(emptyComparisons);
    const emptyYoYHeaderLabels = computeKpiYoYHeaderLabels(emptyYoYComparisons);
    const emptyTrajectory = computeTrajectorySignals(emptyComparisons);
    return {
      latestMonth: '',
      previousMonth: null,
      monthlyRollups: [],
      forecastCashRollups: [],
      kpiAggregationByTimeframe: emptyAggregations,
      kpiComparisonByTimeframe: emptyComparisons,
      kpiYoYComparisonByTimeframe: emptyYoYComparisons,
      kpiHeaderLabelByTimeframe: emptyHeaderLabels,
      kpiYoYHeaderLabelByTimeframe: emptyYoYHeaderLabels,
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
      uncategorizedWarning: null,
      digHerePreview: [],
      runway: computeRunwayMetric([], currentCashBalance, anchorMonth, thisMonthAnchor),
    };
  }

  const latest = monthlyRollups[monthlyRollups.length - 1];
  const previous = monthlyRollups.length > 1 ? monthlyRollups[monthlyRollups.length - 2] : null;
  const contextMonth = resolveAnchorMonth(monthlyRollups, anchorMonth) ?? latest.month;
  const previousContextMonth = addMonths(contextMonth, -1);
  const contextCurrentTxns = txns.filter((txn) => txn.month === contextMonth);
  const contextPreviousTxns = txns.filter((txn) => txn.month === previousContextMonth);
  // For "This Month" YoY comparison, truncate the prior-year same month to the
  // same day-of-month as the last imported transaction, so we compare identical
  // elapsed fractions of the month (e.g. Apr 1–3 vs Apr 1–3) rather than a
  // partial current month against a full prior-year month.
  const currentAnchorMonth = thisMonthAnchor ?? anchorMonth ?? latest.month;
  const latestDateInCurrentMonth = txns
    .filter((txn) => txn.month === currentAnchorMonth)
    .reduce<string | null>((max, txn) => (!max || txn.date > max ? txn.date : max), null);
  let thisMonthPriorYearRollup: MonthlyRollup | null = null;
  if (latestDateInCurrentMonth) {
    const priorYearMonth = addMonths(currentAnchorMonth, -12);
    const day = latestDateInCurrentMonth.slice(8); // "DD" from "YYYY-MM-DD"
    const cutoffDate = `${priorYearMonth}-${day}`;
    thisMonthPriorYearRollup = computePartialMonthRollup(txns, priorYearMonth, cutoffDate, cashFlowMode);
  }

  const kpiAggregationByTimeframe = computeKpiAggregations(monthlyRollups, anchorMonth, thisMonthAnchor);
  const kpiComparisonByTimeframe = computeKpiComparisons(monthlyRollups, anchorMonth, thisMonthAnchor);
  const kpiYoYComparisonByTimeframe = computeKpiYoYComparisons(monthlyRollups, anchorMonth, thisMonthAnchor, thisMonthPriorYearRollup);
  const kpiHeaderLabelByTimeframe = computeKpiHeaderLabels(kpiComparisonByTimeframe);
  const kpiYoYHeaderLabelByTimeframe = computeKpiYoYHeaderLabels(kpiYoYComparisonByTimeframe);

  // Trajectory uses the last *complete* month as the anchor so no signal ever
  // includes an in-progress month:
  //  • Monthly Trend  = last complete month vs same month last year  (YoY)
  //  • Short-Term     = last 3 complete months vs prior 3 months     (momentum)
  //  • Long-Term      = TTM ending at last complete month vs prior TTM
  const prevCalendarMonth = thisMonthAnchor ? addMonths(thisMonthAnchor, -1) : (anchorMonth ?? latest.month);
  const prevAnchoredComparisons = computeKpiComparisons(monthlyRollups, prevCalendarMonth, prevCalendarMonth);
  const trajectoryComparisonMap: KpiComparisonMap = {
    ...prevAnchoredComparisons,
    lastMonth: kpiYoYComparisonByTimeframe.lastMonth, // YoY: Mar 2026 vs Mar 2025
  };
  const trajectorySignals = computeTrajectorySignals(trajectoryComparisonMap);

  const latestMonthTxns = txns.filter((txn) => txn.month === latest.month);
  const previousMonthTxns = previous ? txns.filter((txn) => txn.month === previous.month) : [];

  const opportunities = buildOpportunities(contextCurrentTxns, monthlyRollups, txns, cashFlowMode);
  const opportunityTotal = round2(opportunities.reduce((sum, item) => sum + item.savings, 0));
  const uncategorizedWarning = buildUncategorizedWarning(txns);
  const runwayAnchorMonth = anchorMonth ?? (thisMonthAnchor ? addMonths(thisMonthAnchor, -1) : latest.month);
  const runway = computeRunwayMetric(
    monthlyRollups,
    currentCashBalance,
    runwayAnchorMonth,
    thisMonthAnchor ?? anchorMonth ?? latest.month
  );
  // Precompute up to 36 projected months so UI horizon controls can expand
  // from 30-day equivalents through 3 years without recalculating the model.
  const cashFlowForecast = buildCashFlowForecastSeries(monthlyRollups, 36);
  const suggestedMargins = suggestForecastMargins(monthlyRollups);

  return {
    latestMonth: latest.month,
    previousMonth: previous?.month ?? null,
    monthlyRollups,
    forecastCashRollups,
    kpiAggregationByTimeframe,
    kpiComparisonByTimeframe,
    kpiYoYComparisonByTimeframe,
    kpiHeaderLabelByTimeframe,
    kpiYoYHeaderLabelByTimeframe,
    trajectorySignals,
    kpiCards: buildKpis(kpiAggregationByTimeframe.thisMonth, kpiAggregationByTimeframe.lastMonth),
    // Exclude the current (incomplete) calendar month from the chart so the
    // last data point is always a fully closed month.
    trend: monthlyRollups
      .filter((rollup) => rollup.month <= prevCalendarMonth)
      .map<TrendPoint>((rollup) => ({
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
    expenseSlices: buildExpenseSlices(contextCurrentTxns, cashFlowMode),
    topPayees: buildTopPayees(contextCurrentTxns, cashFlowMode),
    movers: buildMovers(contextCurrentTxns, contextPreviousTxns, cashFlowMode),
    opportunityTotal,
    opportunities,
    summaryBullets: buildSummary(latest, previous, opportunities, txns.length),
    uncategorizedWarning,
    digHerePreview: opportunities.slice(0, 4),
    runway,
  };
}

type ForecastBaseline = {
  baselineCashIn: number;
  baselineCashOut: number;
  latestCashIn: number;
  latestCashOut: number;
  fixedCashOutBase: number;
  variableCashOutBase: number;
  cashInMomentumPct: number;
  cashOutMomentumPct: number;
};

type ForecastSeasonalityTier = {
  mode: ForecastSeasonalityMeta['mode'];
  confidence: ForecastSeasonalityMeta['confidence'];
  weighting: number[];
  capMin: number;
  capMax: number;
  divergenceThresholdPct: number;
};

type SeasonalIndicesBuild = {
  meta: ForecastSeasonalityMeta;
  cashInByMonth: number[] | null;
  cashOutByMonth: number[] | null;
};

function averageCompleteYearMonthlyValue(
  completeYears: number[],
  rollupsByYear: Map<number, Map<number, ForecastCashRollup>>,
  pickValue: (rollup: ForecastCashRollup) => number
): number | null {
  if (completeYears.length < 2) return null;

  const annualMonthlyAverages = completeYears
    .map((year) => {
      const yearMonths = rollupsByYear.get(year);
      if (!yearMonths || yearMonths.size !== 12) return null;
      const values = Array.from({ length: 12 }, (_, monthIndex) => pickValue(yearMonths.get(monthIndex + 1) as ForecastCashRollup));
      return average(values);
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));

  if (annualMonthlyAverages.length < 2) return null;
  return round2(Math.max(average(annualMonthlyAverages), 0));
}

function deriveForecastBaseline(
  forecastCashRollups: ForecastCashRollup[],
  seasonalityBuild?: SeasonalIndicesBuild,
  rollupsByYear?: Map<number, Map<number, ForecastCashRollup>>
): ForecastBaseline | null {
  if (forecastCashRollups.length === 0) return null;

  const recentMonths = forecastCashRollups.slice(-Math.min(6, forecastCashRollups.length));
  const priorMonths = forecastCashRollups.length > 3 ? forecastCashRollups.slice(-6, -3) : [];
  const latestMonth = forecastCashRollups[forecastCashRollups.length - 1];
  const recentCashInValues = recentMonths.map((month) => month.cashIn);
  const trailingCashIn = round2(Math.max(average(recentCashInValues), 0));
  const trailingCashInMedian = Math.max(median(recentCashInValues), 0);
  const trailingCashInTrimFloor = trailingCashInMedian * 0.6;
  const trimmedTrailingCashIn = round2(
    Math.max(
      average(
        recentCashInValues.map((value) => (value < trailingCashInTrimFloor ? trailingCashInMedian : value))
      ),
      0
    )
  );
  const trailingCashOut = round2(Math.max(average(recentMonths.map((month) => month.cashOut)), 0));
  const completeYearsUsed = seasonalityBuild?.meta.completeYearsUsed ?? [];
  const historicalCashIn =
    rollupsByYear && completeYearsUsed.length > 0
      ? averageCompleteYearMonthlyValue(completeYearsUsed, rollupsByYear, (rollup) => rollup.cashIn)
      : null;
  const historicalCashOut =
    rollupsByYear && completeYearsUsed.length > 0
      ? averageCompleteYearMonthlyValue(completeYearsUsed, rollupsByYear, (rollup) => rollup.cashOut)
      : null;
  const baselineCashIn = round2(
    Math.max(historicalCashIn === null ? trimmedTrailingCashIn : trimmedTrailingCashIn * 0.3 + historicalCashIn * 0.7, 0)
  );
  const baselineCashOut = round2(
    Math.max(historicalCashOut === null ? trailingCashOut : trailingCashOut * 0.6 + historicalCashOut * 0.4, 0)
  );
  const priorCashIn = round2(Math.max(average(priorMonths.map((month) => month.cashIn)), 0));
  const priorCashOut = round2(Math.max(average(priorMonths.map((month) => month.cashOut)), 0));
  const fixedCashOutBase = round2(baselineCashOut * 0.68);
  const variableCashOutBase = round2(Math.max(baselineCashOut - fixedCashOutBase, 0));
  const cashInMomentumPct =
    priorCashIn > EPSILON ? clamp((baselineCashIn - priorCashIn) / priorCashIn, -0.12, 0.12) : 0;
  const cashOutMomentumPct =
    priorCashOut > EPSILON ? clamp((baselineCashOut - priorCashOut) / priorCashOut, -0.12, 0.12) : 0;

  return {
    baselineCashIn,
    baselineCashOut,
    latestCashIn: round2(Math.max(latestMonth?.cashIn ?? baselineCashIn, 0)),
    latestCashOut: round2(Math.max(latestMonth?.cashOut ?? baselineCashOut, 0)),
    fixedCashOutBase,
    variableCashOutBase,
    cashInMomentumPct,
    cashOutMomentumPct,
  };
}

function normalizeWeights(weights: number[]): number[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total) <= EPSILON) {
    return weights.map(() => 1 / weights.length);
  }
  return weights.map((value) => value / total);
}

function weightedAverage(values: number[], weights: number[]): number {
  if (values.length === 0 || weights.length === 0 || values.length !== weights.length) return 0;
  const normalizedWeights = normalizeWeights(weights);
  return values.reduce((sum, value, index) => sum + value * normalizedWeights[index], 0);
}

function getForecastSeasonalityTier(completeYearCount: number): ForecastSeasonalityTier {
  if (completeYearCount < 2) {
    return {
      mode: 'fallback',
      confidence: 'none',
      weighting: [],
      capMin: 0,
      capMax: 0,
      divergenceThresholdPct: 0,
    };
  }

  if (completeYearCount === 2) {
    return {
      mode: 'seasonal',
      confidence: 'low',
      weighting: [0.5, 0.5],
      capMin: 0.4,
      capMax: 2.2,
      divergenceThresholdPct: 20,
    };
  }

  if (completeYearCount === 3) {
    return {
      mode: 'seasonal',
      confidence: 'standard',
      weighting: [0.5, 0.3, 0.2],
      capMin: 0.5,
      capMax: 2,
      divergenceThresholdPct: 25,
    };
  }

  return {
    mode: 'seasonal',
    confidence: 'strong',
    weighting: [0.4, 0.3, 0.2, 0.1],
    capMin: 0.5,
    capMax: 2,
    divergenceThresholdPct: 25,
  };
}

function createSeasonalityMeta(
  tier: ForecastSeasonalityTier,
  completeYearsUsed: number[],
  partialYearsExcluded: number[],
  warning: ForecastSeasonalityMeta['warning'] = null
): ForecastSeasonalityMeta {
  return {
    mode: tier.mode,
    confidence: tier.confidence,
    completeYearsUsed,
    partialYearsExcluded,
    weighting: tier.weighting,
    capMin: tier.capMin,
    capMax: tier.capMax,
    divergenceThresholdPct: tier.divergenceThresholdPct,
    warning,
  };
}

function collectForecastYears(forecastCashRollups: ForecastCashRollup[]): {
  completeYears: number[];
  partialYears: number[];
  rollupsByYear: Map<number, Map<number, ForecastCashRollup>>;
} {
  const rollupsByYear = new Map<number, Map<number, ForecastCashRollup>>();

  forecastCashRollups.forEach((rollup) => {
    const parsed = parseMonthParts(rollup.month);
    if (!parsed) return;
    const yearMap = rollupsByYear.get(parsed.year) ?? new Map<number, ForecastCashRollup>();
    yearMap.set(parsed.month, rollup);
    rollupsByYear.set(parsed.year, yearMap);
  });

  const completeYears: number[] = [];
  const partialYears: number[] = [];
  [...rollupsByYear.keys()]
    .sort((a, b) => a - b)
    .forEach((year) => {
      const months = [...(rollupsByYear.get(year)?.keys() ?? [])].sort((a, b) => a - b);
      const isCompleteYear = months.length === 12 && months.every((month, index) => month === index + 1);
      if (isCompleteYear) {
        completeYears.push(year);
      } else {
        partialYears.push(year);
      }
    });

  return { completeYears, partialYears, rollupsByYear };
}

function buildSeasonalIndexByMonth(
  years: number[],
  weights: number[],
  rollupsByYear: Map<number, Map<number, ForecastCashRollup>>,
  pickValue: (rollup: ForecastCashRollup) => number,
  capMin: number,
  capMax: number
): number[] | null {
  const usableYears = years
    .map((year, index) => {
      const months = rollupsByYear.get(year);
      if (!months) return null;
      const values = Array.from({ length: 12 }, (_, monthIndex) => pickValue(months.get(monthIndex + 1) as ForecastCashRollup));
      const averageValue = average(values);
      if (averageValue <= EPSILON) return null;
      return { year, weight: weights[index], averageValue, months };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (usableYears.length < 2) return null;

  const usableWeights = normalizeWeights(usableYears.map((entry) => entry.weight));
  const indices = new Array(13).fill(1);

  for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
    const ratios = usableYears.map((entry) => {
      const rollup = entry.months.get(monthNumber);
      const value = rollup ? pickValue(rollup) : 0;
      return entry.averageValue > EPSILON ? value / entry.averageValue : 1;
    });
    const medianRatio = median(ratios);
    const lowerBound = medianRatio * 0.7;
    const upperBound = medianRatio * 1.3;
    const winsorized = ratios.map((ratio) => clamp(ratio, lowerBound, upperBound));
    indices[monthNumber] = round2(clamp(weightedAverage(winsorized, usableWeights), capMin, capMax));
  }

  return indices;
}

function buildForecastSeasonality(forecastCashRollups: ForecastCashRollup[]): SeasonalIndicesBuild {
  const { completeYears, partialYears, rollupsByYear } = collectForecastYears(forecastCashRollups);
  const tier = getForecastSeasonalityTier(completeYears.length);

  if (tier.mode === 'fallback') {
    return {
      meta: createSeasonalityMeta(tier, [], partialYears),
      cashInByMonth: null,
      cashOutByMonth: null,
    };
  }

  const completeYearsUsed = completeYears.slice(-tier.weighting.length).reverse();
  const cashInByMonth = buildSeasonalIndexByMonth(
    completeYearsUsed,
    tier.weighting,
    rollupsByYear,
    (rollup) => rollup.cashIn,
    tier.capMin,
    tier.capMax
  );
  const cashOutByMonth = buildSeasonalIndexByMonth(
    completeYearsUsed,
    tier.weighting,
    rollupsByYear,
    (rollup) => rollup.cashOut,
    tier.capMin,
    tier.capMax
  );

  if (!cashInByMonth || !cashOutByMonth) {
    const fallbackTier = getForecastSeasonalityTier(0);
    return {
      meta: createSeasonalityMeta(fallbackTier, [], partialYears),
      cashInByMonth: null,
      cashOutByMonth: null,
    };
  }

  return {
    meta: createSeasonalityMeta(tier, completeYearsUsed, partialYears),
    cashInByMonth,
    cashOutByMonth,
  };
}

function carryShareFromDays(days: number): number {
  if (!Number.isFinite(days)) return 0;
  return clamp(days / 30, 0, 0.95);
}

function buildForecastDivergenceWarning(
  month: string,
  cashInDiverged: boolean,
  cashOutDiverged: boolean,
  cashInDirection: 'above' | 'below',
  cashOutDirection: 'above' | 'below'
): ForecastSeasonalityMeta['warning'] {
  if (!cashInDiverged && !cashOutDiverged) return null;

  if (cashInDiverged && cashOutDiverged) {
    const direction = cashInDirection === cashOutDirection ? cashInDirection : 'mixed';
    return {
      month,
      metric: 'both',
      direction,
      message: 'This seasonal forecast diverges materially from recent performance. Confirm seasonality is expected.',
    };
  }

  if (cashInDiverged) {
    return {
      month,
      metric: 'cash-in',
      direction: cashInDirection,
      message:
        cashInDirection === 'below'
          ? 'This seasonal forecast is materially below recent cash-in performance. Confirm seasonality is expected.'
          : 'This seasonal forecast diverges materially from recent performance. Confirm seasonality is expected.',
    };
  }

  return {
    month,
    metric: 'cash-out',
    direction: cashOutDirection,
    message:
      cashOutDirection === 'above'
        ? 'This seasonal forecast is materially above recent cash-out performance. Confirm seasonality is expected.'
        : 'This seasonal forecast diverges materially from recent performance. Confirm seasonality is expected.',
  };
}

export function projectScenario(model: DashboardModel, input: ScenarioInput, startingCashBalance = 0): ForecastProjectionResult {
  const emptySeasonality = createSeasonalityMeta(getForecastSeasonalityTier(0), [], []);
  if (model.forecastCashRollups.length === 0) {
    return { points: [], seasonality: emptySeasonality };
  }

  const seasonalityBuild = buildForecastSeasonality(model.forecastCashRollups);
  const { rollupsByYear } = collectForecastYears(model.forecastCashRollups);
  const baseline = deriveForecastBaseline(model.forecastCashRollups, seasonalityBuild, rollupsByYear);
  if (!baseline) return { points: [], seasonality: emptySeasonality };

  const latestForecastMonth = model.forecastCashRollups[model.forecastCashRollups.length - 1]?.month;
  if (!latestForecastMonth) return { points: [], seasonality: emptySeasonality };

  const seasonalityActive =
    seasonalityBuild.meta.mode === 'seasonal' && seasonalityBuild.cashInByMonth !== null && seasonalityBuild.cashOutByMonth !== null;
  const cashInTarget = baseline.baselineCashIn * (1 + clamp(input.revenueGrowthPct / 100, -0.6, 0.6));
  const expenseChangeRatio = clamp(input.expenseChangePct / 100, -0.5, 0.5);
  const receivableCarryShare = carryShareFromDays(input.receivableDays);
  const payableCarryShare = carryShareFromDays(input.payableDays);

  const projections: ScenarioPoint[] = [];
  let seasonalityWarning: ForecastSeasonalityMeta['warning'] = null;
  let endingCashBalance = Number.isFinite(startingCashBalance) ? round2(startingCashBalance) : 0;
  let priorOperatingCashIn = baseline.latestCashIn > EPSILON ? baseline.latestCashIn : baseline.baselineCashIn;
  let priorOperatingCashOut = baseline.latestCashOut > EPSILON ? baseline.latestCashOut : baseline.baselineCashOut;
  let receivableCarryAmount = round2(priorOperatingCashIn * receivableCarryShare);
  let payableCarryAmount = round2(priorOperatingCashOut * payableCarryShare);

  for (let index = 1; index <= input.months; index += 1) {
    const month = addMonths(latestForecastMonth, index);
    const monthNumber = parseMonthParts(month)?.month ?? 1;
    let operatingCashIn = 0;
    let operatingCashOut = 0;

    if (seasonalityActive) {
      const seasonalCashInIndex = seasonalityBuild.cashInByMonth?.[monthNumber] ?? 1;
      const seasonalCashOutIndex = seasonalityBuild.cashOutByMonth?.[monthNumber] ?? 1;
      operatingCashIn = round2(Math.max(baseline.baselineCashIn * seasonalCashInIndex * (1 + clamp(input.revenueGrowthPct / 100, -0.6, 0.6)), 0));
      operatingCashOut = round2(Math.max(baseline.baselineCashOut * seasonalCashOutIndex * (1 + expenseChangeRatio), 0));

      if (!seasonalityWarning) {
        const cashInDivergencePct =
          baseline.baselineCashIn > EPSILON ? (Math.abs(operatingCashIn - baseline.baselineCashIn) / baseline.baselineCashIn) * 100 : 0;
        const cashOutDivergencePct =
          baseline.baselineCashOut > EPSILON ? (Math.abs(operatingCashOut - baseline.baselineCashOut) / baseline.baselineCashOut) * 100 : 0;
        const threshold = seasonalityBuild.meta.divergenceThresholdPct;
        const cashInDiverged = threshold > EPSILON && cashInDivergencePct > threshold;
        const cashOutDiverged = threshold > EPSILON && cashOutDivergencePct > threshold;
        seasonalityWarning = buildForecastDivergenceWarning(
          month,
          cashInDiverged,
          cashOutDiverged,
          operatingCashIn >= baseline.baselineCashIn ? 'above' : 'below',
          operatingCashOut >= baseline.baselineCashOut ? 'above' : 'below'
        );
      }
    } else {
      const momentumDecay = Math.max(0, 1 - (index - 1) * 0.18);
      const cashInMomentumAdjustment = priorOperatingCashIn * baseline.cashInMomentumPct * momentumDecay * 0.45;
      const cashInTargetPull = (cashInTarget - priorOperatingCashIn) * 0.35;
      operatingCashIn = round2(Math.max(priorOperatingCashIn + cashInMomentumAdjustment + cashInTargetPull, 0));
      const cashInScale = baseline.baselineCashIn > EPSILON ? operatingCashIn / baseline.baselineCashIn : 1;
      const targetFixedCashOut = baseline.fixedCashOutBase * (1 + expenseChangeRatio * 0.55);
      const targetVariableCashOut =
        baseline.variableCashOutBase * Math.max(cashInScale, 0) * (1 + expenseChangeRatio * 0.45);
      const targetCashOut = targetFixedCashOut + targetVariableCashOut;
      const cashOutMomentumAdjustment = priorOperatingCashOut * baseline.cashOutMomentumPct * momentumDecay * 0.35;
      const cashOutTargetPull = (targetCashOut - priorOperatingCashOut) * 0.38;
      operatingCashOut = round2(
        Math.max(priorOperatingCashOut + cashOutMomentumAdjustment + cashOutTargetPull, baseline.fixedCashOutBase * 0.5)
      );
    }

    const cashIn = round2(operatingCashIn * (1 - receivableCarryShare) + receivableCarryAmount);
    const cashOut = round2(operatingCashOut * (1 - payableCarryShare) + payableCarryAmount);
    const netCashFlow = round2(cashIn - cashOut);
    endingCashBalance = round2(endingCashBalance + netCashFlow);

    projections.push({
      month,
      operatingCashIn,
      operatingCashOut,
      cashIn,
      cashOut,
      netCashFlow,
      endingCashBalance,
    });

    priorOperatingCashIn = operatingCashIn;
    priorOperatingCashOut = operatingCashOut;
    receivableCarryAmount = round2(operatingCashIn * receivableCarryShare);
    payableCarryAmount = round2(operatingCashOut * payableCarryShare);
  }

  return {
    points: projections,
    seasonality: {
      ...seasonalityBuild.meta,
      warning: seasonalityActive ? seasonalityWarning : null,
    },
  };
}

export function computeForecastDecisionSignals(points: ScenarioPoint[], reserveTarget = 0): ForecastDecisionSignals {
  if (points.length === 0) {
    return {
      breakEvenMonth: null,
      cashTroughMonth: null,
      cashTroughBalance: null,
      reserveBreachMonth: null,
      reserveBreachEvaluated: false,
      negativeCashMonth: null,
    };
  }

  let breakEvenMonth: string | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const candidate = points[index];
    if (candidate.netCashFlow < -EPSILON) continue;
    const remainsNonNegative = points.slice(index).every((point) => point.netCashFlow >= -EPSILON);
    if (remainsNonNegative) {
      breakEvenMonth = candidate.month;
      break;
    }
  }

  const troughPoint = points.reduce<ScenarioPoint | null>((lowest, point) => {
    if (!lowest) return point;
    return point.endingCashBalance < lowest.endingCashBalance ? point : lowest;
  }, null);
  const reserveBreachMonth =
    reserveTarget > EPSILON
      ? points.find((point) => point.endingCashBalance < reserveTarget - EPSILON)?.month ?? null
      : null;
  const negativeCashMonth = points.find((point) => point.endingCashBalance < -EPSILON)?.month ?? null;

  return {
    breakEvenMonth,
    cashTroughMonth: troughPoint?.month ?? null,
    cashTroughBalance: troughPoint ? round2(troughPoint.endingCashBalance) : null,
    reserveBreachMonth,
    reserveBreachEvaluated: reserveTarget > EPSILON,
    negativeCashMonth,
  };
}

export function toMonthLabel(month: string): string {
  return monthLabel(month);
}
