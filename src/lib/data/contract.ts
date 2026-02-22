export type TxnType = 'income' | 'expense';

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
  tags?: string[];
  rawAmount: number;
};

export type CsvRecord = Record<string, string>;

export type DataSet = {
  txns: Txn[];
  fetchedAtIso: string;
  sourceUrl: string;
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
  | 'last3Months'
  | 'ytd'
  | 'ttm'
  | 'last24Months'
  | 'last36Months';

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

export type Mover = {
  category: string;
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
};

export type OpportunityItem = {
  title: string;
  savings: number;
  hint: string;
};

export type DashboardModel = {
  latestMonth: string;
  previousMonth: string | null;
  monthlyRollups: MonthlyRollup[];
  kpiAggregationByTimeframe: KpiAggregationMap;
  kpiComparisonByTimeframe: KpiComparisonMap;
  kpiCards: KpiCard[];
  trend: TrendPoint[];
  expenseSlices: ExpenseSlice[];
  topPayees: PayeeTotal[];
  movers: Mover[];
  opportunityTotal: number;
  opportunities: OpportunityItem[];
  summaryBullets: string[];
  digHerePreview: OpportunityItem[];
};

export type ScenarioInput = {
  revenueGrowthPct: number;
  expenseReductionPct: number;
  months: number;
};

export type ScenarioPoint = {
  month: string;
  projectedIncome: number;
  projectedExpense: number;
  projectedNet: number;
  cumulativeNet: number;
};
