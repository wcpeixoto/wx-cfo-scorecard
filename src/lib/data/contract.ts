export type TxnType = 'income' | 'expense';
export type CashFlowMode = 'operating' | 'total';

export type Txn = {
  id: string;
  date: string;
  month: string;
  type: TxnType;
  amount: number;
  category: string;
  payee?: string;
  memo?: string;
  account?: string;
  transferAccount?: string;
  tags?: string[];
  rawAmount: number;
  balance?: number;
};

export type CsvRecord = Record<string, string>;

export type AccountType = 'Cash' | 'Credit Card' | 'Loan' | 'Other';

export type AccountRecord = {
  id: string;
  discoveredAccountName: string;
  accountName: string;
  accountType: AccountType;
  startingBalance: number;
  includeInCashForecast: boolean;
  active: boolean;
  isUserConfigured: boolean;
};

export type DataSourceKind = 'sheet' | 'imported';

export type DataSet = {
  txns: Txn[];
  fetchedAtIso: string;
  sourceUrl: string;
  sourceKind?: DataSourceKind;
  sourceLabel?: string;
};

export type ImportedTransactionRecord = {
  fingerprint: string;
  possibleDuplicateKey: string;
  importId: string;
  sourceFileName: string;
  importedAtIso: string;
  sourceLineNumber: number;
  enteredDate?: string;
  postedDate?: string;
  transferAccount?: string;
  possibleDuplicate?: boolean;
  txn: Txn;
};

export type TransactionImportIssue = {
  kind: 'possible-duplicate' | 'parse-error';
  lineNumber: number;
  message: string;
  rowPreview: string[];
};

export type TransactionImportSummary = {
  importId: string;
  sourceFileName: string;
  importedAtIso: string;
  latestTxnMonth: string | null;
  storageScope: 'local' | 'shared';
  importMode: 'append' | 'replace-all';
  newImported: number;
  exactDuplicatesSkipped: number;
  possibleDuplicatesFlagged: number;
  parseFailures: number;
  storedTransactionCount: number;
  possibleDuplicateExamples: TransactionImportIssue[];
  parseFailureExamples: TransactionImportIssue[];
};

export type TrendDirection = 'up' | 'down' | 'flat';

export type KpiCard = {
  id: string;
  label: string;
  value: number;
  previousValue: number;
  deltaPercent: number | null;
  trend: TrendDirection;
  format: 'currency' | 'percent' | 'number';
};

export type KpiTimeframe =
  | 'thisMonth'
  | 'lastMonth'
  | 'last3Months'
  | 'ytd'
  | 'last12Months'
  | 'last24Months'
  | 'last36Months'
  | 'allDates';

export type KpiAggregate = {
  timeframe: KpiTimeframe;
  startMonth: string | null;
  endMonth: string | null;
  monthCount: number;
  transactionCount: number;
  revenue: number;
  expenses: number;
  netCashFlow: number;
  savingsRate: number;
};

export type KpiAggregationMap = Record<KpiTimeframe, KpiAggregate>;

export type KpiComparisonTimeframe =
  | 'thisMonth'
  | 'lastMonth'
  | 'last3Months'
  | 'ytd'
  | 'ttm'
  | 'last24Months'
  | 'last36Months'
  | 'allDates';

export type KpiMetricComparison = {
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
};

export type KpiTimeframeComparison = {
  timeframe: KpiComparisonTimeframe;
  currentStartMonth: string | null;
  currentEndMonth: string | null;
  previousStartMonth: string | null;
  previousEndMonth: string | null;
  currentMonthCount: number;
  previousMonthCount: number;
  revenue: KpiMetricComparison;
  expenses: KpiMetricComparison;
  netCashFlow: KpiMetricComparison;
  savingsRate: KpiMetricComparison;
};

export type KpiComparisonMap = Record<KpiComparisonTimeframe, KpiTimeframeComparison>;
export type KpiHeaderLabelMap = Record<KpiComparisonTimeframe, string>;

export type TrajectoryLight = 'green' | 'red' | 'neutral';
export type TrajectorySignalId = 'monthlyTrend' | 'shortTermTrend' | 'longTermTrend';

export type TrajectorySignal = {
  id: TrajectorySignalId;
  label: string;
  timeframe: KpiComparisonTimeframe;
  currentStartMonth: string | null;
  currentEndMonth: string | null;
  previousStartMonth: string | null;
  previousEndMonth: string | null;
  currentMonthCount: number;
  previousMonthCount: number;
  currentNetCashFlow: number;
  previousNetCashFlow: number;
  delta: number;
  percentChange: number | null;
  direction: TrendDirection;
  light: TrajectoryLight;
  hasSufficientHistory: boolean;
};

export type MonthlyRollup = {
  month: string;
  revenue: number;
  expenses: number;
  netCashFlow: number;
  savingsRate: number;
  transactionCount: number;
};

export type TrendPoint = {
  month: string;
  income: number;
  expense: number;
  net: number;
  granularity?: 'month' | 'week';
  axisLabel?: string;
  tooltipLabel?: string;
  periodStart?: string;
  periodEnd?: string;
};

export type CashFlowForecastStatus = 'actual' | 'projected';

export type CashFlowForecastPoint = {
  month: string;
  revenue: number;
  expenses: number;
  netCashFlow: number;
  status: CashFlowForecastStatus;
};

export type CashFlowForecastModelNotes = {
  revenue: string;
  expenses: string;
};

export type ExpenseSlice = {
  name: string;
  value: number;
  share: number;
  color: string;
};

export type PayeeTotal = {
  payee: string;
  amount: number;
  transactionCount: number;
};

export type MoverGrouping = 'subcategories' | 'categories';

export type Mover = {
  category: string;
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
  priorityScore: number;
  sparkline?: number[] | null;
};

export type OpportunityItem = {
  title: string;
  savings: number;
  hint: string;
};

export type ExclusionWarning = {
  count: number;
  absoluteAmount: number;
};

export type RunwayStatus = 'ok' | 'self-funded' | 'no-runway' | 'insufficient-history';

export type RunwayMetric = {
  status: RunwayStatus;
  months: number | null;
  netRunwayMonths: number | null;
  grossRunwayMonths: number | null;
  burnBasisMonths: number;
  netBurn: number;
  grossBurn: number;
  averageMonthlyBurn: number;
  currentCashBalance: number;
  burnStartMonth: string | null;
  burnEndMonth: string | null;
  /** Fixed operating reserve target currently in force from semiannual recalibration. */
  reserveTarget: number;
  /** currentCashBalance / reserveTarget as a 0–1+ ratio (null when target is unavailable). */
  percentFunded: number | null;
};

export type ForecastCashRollup = {
  month: string;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  transactionCount: number;
};

export type DashboardModel = {
  latestMonth: string;
  previousMonth: string | null;
  monthlyRollups: MonthlyRollup[];
  forecastCashRollups: ForecastCashRollup[];
  kpiAggregationByTimeframe: KpiAggregationMap;
  kpiComparisonByTimeframe: KpiComparisonMap;
  kpiYoYComparisonByTimeframe: KpiComparisonMap;
  kpiHeaderLabelByTimeframe: KpiHeaderLabelMap;
  kpiYoYHeaderLabelByTimeframe: KpiHeaderLabelMap;
  trajectorySignals: TrajectorySignal[];
  kpiCards: KpiCard[];
  trend: TrendPoint[];
  cashFlowForecastSeries: CashFlowForecastPoint[];
  cashFlowForecastModelNotes: CashFlowForecastModelNotes;
  suggestedRevenueMargin: number;
  suggestedExpenseMargin: number;
  suggestedMarginJustification: string;
  expenseSlices: ExpenseSlice[];
  topPayees: PayeeTotal[];
  movers: Mover[];
  opportunityTotal: number;
  opportunities: OpportunityItem[];
  summaryBullets: string[];
  uncategorizedWarning: ExclusionWarning | null;
  digHerePreview: OpportunityItem[];
  runway: RunwayMetric;
};

export type ForecastScenarioKey = 'base' | 'best' | 'worst' | 'custom';

export type ScenarioInput = {
  scenarioKey: ForecastScenarioKey;
  revenueGrowthPct: number;
  expenseChangePct: number;
  receivableDays: number;
  payableDays: number;
  months: number;
};

export type ScenarioPoint = {
  month: string;
  operatingCashIn: number;
  operatingCashOut: number;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  endingCashBalance: number;
};

export type ForecastDivergenceWarning = {
  month: string;
  metric: 'cash-in' | 'cash-out' | 'both';
  direction: 'above' | 'below' | 'mixed';
  message: string;
};

export type ForecastSeasonalityMeta = {
  mode: 'fallback' | 'seasonal';
  confidence: 'none' | 'low' | 'standard' | 'strong';
  completeYearsUsed: number[];
  partialYearsExcluded: number[];
  weighting: number[];
  capMin: number;
  capMax: number;
  divergenceThresholdPct: number;
  warning: ForecastDivergenceWarning | null;
};

export type ForecastProjectionResult = {
  points: ScenarioPoint[];
  seasonality: ForecastSeasonalityMeta;
};

export type ForecastDecisionSignals = {
  breakEvenMonth: string | null;
  cashTroughMonth: string | null;
  cashTroughBalance: number | null;
  reserveBreachMonth: string | null;
  reserveBreachEvaluated: boolean;
  negativeCashMonth: string | null;
};

export type ForecastEventType =
  | "renewal"
  | "promotion"
  | "seasonal_override"
  | "one_time_revenue"
  | "one_time_expense"
  | "churn_risk"
  | "staffing_change"
  | "rent_change"
  | "tax_payment"
  | "debt_payment"
  | "other";

export type ForecastEventStatus =
  | "planned"
  | "tentative"
  | "committed";

export type ForecastEventImpactMode = "fixed_amount";

export type ForecastEvent = {
  id: string;
  month: string; // YYYY-MM
  type: ForecastEventType;
  title: string;
  note?: string;
  status: ForecastEventStatus;
  impactMode: ForecastEventImpactMode;
  cashInImpact: number;   // positive dollars
  cashOutImpact: number;  // positive dollars
  enabled: boolean;
};
