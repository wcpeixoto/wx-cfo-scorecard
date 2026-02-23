import { useCallback, useEffect, useMemo, useState } from 'react';
import { APP_TITLE, SHEET_CSV_FALLBACK_URL, SHEET_CSV_URL, STORAGE_KEYS } from '../config';
import ExpenseDonut from '../components/ExpenseDonut';
import DigHereHighlights from '../components/DigHereHighlights';
import KpiCards from '../components/KpiCards';
import MoversList from '../components/MoversList';
import TopPayeesTable from '../components/TopPayeesTable';
import TrendLineChart from '../components/TrendLineChart';
import TrajectoryPanel from '../components/TrajectoryPanel';
import { computeLinearTrendLine, computeProgressiveMovingAverage } from '../lib/charts/movingAverage';
import { buildDataSet, splitActualsAndProjections } from '../lib/data/normalize';
import { fetchSheetCsv } from '../lib/data/fetchCsv';
import { buildPrePhase4DebugReport, computeDashboardModel, projectScenario, toMonthLabel } from '../lib/kpis/compute';
import type { CashFlowMode, DataSet, KpiCard, KpiComparisonTimeframe, ScenarioInput, TrendPoint } from '../lib/data/contract';

type TabId =
  | 'big-picture'
  | 'money-left'
  | 'dig-here'
  | 'trends'
  | 'what-if'
  | 'settings';

type NavItem = {
  id: TabId;
  label: string;
  shortLabel: string;
};

type DataViewMode = 'actuals' | 'all';
type KpiFrameOption = { value: KpiComparisonTimeframe; label: string };

const NAV_ITEMS: NavItem[] = [
  { id: 'big-picture', label: 'Big Picture', shortLabel: 'Big Picture' },
  { id: 'money-left', label: 'Money Left on the Table', shortLabel: 'MLOT' },
  { id: 'dig-here', label: 'Dig Here', shortLabel: 'Dig Here' },
  { id: 'trends', label: 'Trends', shortLabel: 'Trends' },
  { id: 'what-if', label: 'What-If Scenarios', shortLabel: 'What-If' },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings' },
];

const DEFAULT_SCENARIO: ScenarioInput = {
  revenueGrowthPct: 4,
  expenseReductionPct: 3,
  months: 12,
};
const KPI_FRAME_OPTIONS: KpiFrameOption[] = [
  { value: 'thisMonth', label: 'Month' },
  { value: 'last3Months', label: '3M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'ttm', label: 'TTM' },
  { value: 'last24Months', label: '24M' },
  { value: 'last36Months', label: '36M' },
];
const EPSILON = 0.00001;
type TrendTimeframeOption = 6 | 12 | 24 | 36 | 'all';
const TREND_TIMEFRAMES: TrendTimeframeOption[] = [6, 12, 24, 36, 'all'];
const HIGHLIGHT_MIN_ABS_DELTA = 25;

type DigHereHighlight = {
  category: string;
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
};

type DigHereFocusContext = 'category-shifts' | 'month-drilldown' | null;
type DigHereNavigationOptions = {
  category?: string;
  month?: string | null;
  focusContext?: DigHereFocusContext;
};

function parseTabId(value: string | null): TabId | null {
  switch (value) {
    case 'big-picture':
    case 'money-left':
    case 'dig-here':
    case 'trends':
    case 'what-if':
    case 'settings':
      return value;
    default:
      return null;
  }
}

function parseDataViewMode(value: string | null): DataViewMode | null {
  if (value === 'actuals' || value === 'all') return value;
  return null;
}

function parseMonthToken(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function parseDigHereFocusContext(value: string | null): DigHereFocusContext {
  if (value === 'category-shifts' || value === 'month-drilldown') return value;
  return null;
}

function parseCashFlowMode(value: string | null): CashFlowMode | null {
  if (value === 'operating' || value === 'total') return value;
  return null;
}

function adaptiveMaWindowByTimeframe(timeframe: TrendTimeframeOption): number {
  if (timeframe === 'all') return 12;
  if (timeframe <= 6) return 3;
  if (timeframe <= 24) return 6;
  return 12;
}

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  return date.toLocaleString();
}

function isCapitalDistributionCategory(category: string): boolean {
  const normalized = category
    .toLowerCase()
    .replace(/[^a-z0-9: ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return false;
  if (normalized === 'capital distribution') return true;
  return normalized
    .split(':')
    .map((segment) => segment.trim())
    .some((segment) => segment === 'capital distribution');
}

function inMonthRange(month: string, startMonth: string | null, endMonth: string | null): boolean {
  if (!startMonth || !endMonth) return false;
  return month >= startMonth && month <= endMonth;
}

function toDeltaPercent(current: number, previous: number): number | null {
  if (Math.abs(previous) <= EPSILON) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function getStoredCsvUrl(): string {
  if (typeof window === 'undefined') return SHEET_CSV_URL;
  try {
    return window.localStorage.getItem(STORAGE_KEYS.csvUrl) ?? SHEET_CSV_URL;
  } catch {
    return SHEET_CSV_URL;
  }
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('big-picture');
  const [csvUrl, setCsvUrl] = useState(getStoredCsvUrl);
  const [draftCsvUrl, setDraftCsvUrl] = useState(getStoredCsvUrl);
  const [query, setQuery] = useState('');
  const [digHereFocusMonth, setDigHereFocusMonth] = useState<string | null>(null);
  const [digHereFocusContext, setDigHereFocusContext] = useState<DigHereFocusContext>(null);
  const [dataSet, setDataSet] = useState<DataSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scenarioInput, setScenarioInput] = useState<ScenarioInput>(DEFAULT_SCENARIO);
  const [dataViewMode, setDataViewMode] = useState<DataViewMode>('actuals');
  const [kpiTimeframe, setKpiTimeframe] = useState<KpiComparisonTimeframe>('ttm');
  const [cashFlowMode, setCashFlowMode] = useState<CashFlowMode>('operating');

  const runSync = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { records, sourceUrl } = await fetchSheetCsv(csvUrl, SHEET_CSV_FALLBACK_URL);
      const normalized = buildDataSet(records, sourceUrl);
      setDataSet(normalized);
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Could not sync CSV data.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [csvUrl]);

  useEffect(() => {
    void runSync();
  }, [runSync]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncStateFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = parseTabId(params.get('tab'));
      const view = parseDataViewMode(params.get('view'));
      const cashFlow = parseCashFlowMode(params.get('cf'));
      const nextQuery = params.get('q');
      const month = parseMonthToken(params.get('month'));
      const focusContext = parseDigHereFocusContext(params.get('focus'));

      setActiveTab(tab ?? 'big-picture');
      setDataViewMode(view ?? 'actuals');
      setCashFlowMode(cashFlow ?? 'operating');
      setQuery(nextQuery ?? '');
      setDigHereFocusMonth(month);
      setDigHereFocusContext(focusContext);
    };

    syncStateFromUrl();
    window.addEventListener('popstate', syncStateFromUrl);
    return () => window.removeEventListener('popstate', syncStateFromUrl);
  }, []);

  const dataSplit = useMemo(
    () => splitActualsAndProjections(dataSet?.txns ?? []),
    [dataSet?.txns]
  );

  const baseTxns = useMemo(
    () => (dataViewMode === 'all' ? [...dataSplit.actuals, ...dataSplit.projections] : dataSplit.actuals),
    [dataSplit.actuals, dataSplit.projections, dataViewMode]
  );

  const filteredTxns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return baseTxns;

    return baseTxns.filter((txn) => {
      const joined = [txn.payee, txn.category, txn.memo, txn.account]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return joined.includes(needle);
    });
  }, [baseTxns, query]);

  const model = useMemo(
    () => computeDashboardModel(filteredTxns, { cashFlowMode }),
    [filteredTxns, cashFlowMode]
  );

  const digHereTxns = useMemo(() => {
    if (!digHereFocusMonth) return filteredTxns;
    return filteredTxns.filter((txn) => txn.month === digHereFocusMonth);
  }, [digHereFocusMonth, filteredTxns]);

  const digHereModel = useMemo(
    () => computeDashboardModel(digHereTxns, { cashFlowMode }),
    [digHereTxns, cashFlowMode]
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const debug = buildPrePhase4DebugReport(model.monthlyRollups, filteredTxns);

    const trendValidationRows = TREND_TIMEFRAMES.flatMap((timeframe) => {
      const scopedTrend = timeframe === 'all' ? model.trend : model.trend.slice(-timeframe);
      const metrics: Array<'income' | 'expense' | 'net'> = ['income', 'expense', 'net'];

      return metrics.map((metric) => {
        const values = scopedTrend.map((point) => point[metric]);
        if (metric === 'net') {
          const linear = computeLinearTrendLine(values);
          const slopeSign =
            linear.slopePerMonth > EPSILON ? 'up' : linear.slopePerMonth < -EPSILON ? 'down' : 'flat';
          return {
            timeframe: timeframe === 'all' ? 'all' : `${timeframe}m`,
            metric,
            trendType: 'linear',
            trendWindow: 'n/a',
            visibleMonths: values.length,
            trendLength: linear.values.length,
            firstExists: values.length > 0 ? Number.isFinite(linear.values[0]) : false,
            lastExists: values.length > 0 ? Number.isFinite(linear.values[linear.values.length - 1]) : false,
            slopePerMonth: Number(linear.slopePerMonth.toFixed(2)),
            slopeSign,
          };
        }

        const window = adaptiveMaWindowByTimeframe(timeframe);
        const ma = computeProgressiveMovingAverage(values, window);
        return {
          timeframe: timeframe === 'all' ? 'all' : `${timeframe}m`,
          metric,
          trendType: 'ma',
          trendWindow: window,
          visibleMonths: values.length,
          trendLength: ma.length,
          firstExists: values.length > 0 ? Number.isFinite(ma[0]) : false,
          lastExists: values.length > 0 ? Number.isFinite(ma[ma.length - 1]) : false,
          slopePerMonth: 'n/a',
          slopeSign: 'n/a',
        };
      });
    });

    const runEdgeCase = (label: string, txnsForCase: typeof filteredTxns, caseCashFlowMode: CashFlowMode) => {
      try {
        const caseModel = computeDashboardModel(txnsForCase, { cashFlowMode: caseCashFlowMode });
        const caseDebug = buildPrePhase4DebugReport(caseModel.monthlyRollups, txnsForCase);
        return {
          case: label,
          status: 'ok',
          months: caseModel.monthlyRollups.length,
          latestMonth: caseModel.latestMonth || 'n/a',
          latestUsesMaxDate: caseDebug.latestMonthUsesMaxDate,
          thisMonthRevenue: caseDebug.windowRows.find((row) => row.timeframe === 'thisMonth')?.revenue ?? 0,
          ttmNet: caseDebug.windowRows.find((row) => row.timeframe === 'last12Months')?.netCashFlow ?? 0,
        };
      } catch (caseError) {
        return {
          case: label,
          status: 'error',
          message: caseError instanceof Error ? caseError.message : 'unknown error',
        };
      }
    };

    const oppositeCashFlowMode: CashFlowMode = cashFlowMode === 'operating' ? 'total' : 'operating';
    const edgeCaseRows = [
      runEdgeCase('Short history (1 month)', filteredTxns.slice(-1), cashFlowMode),
      runEdgeCase('Short history (2 months)', filteredTxns.slice(-2), cashFlowMode),
      runEdgeCase('All dates window', filteredTxns, cashFlowMode),
      {
        case: 'Rapid timeframe switch simulation',
        status: 'ok',
        simulatedTimeframes: TREND_TIMEFRAMES.map((item) => (item === 'all' ? 'all' : `${item}m`)).join(', '),
      },
      runEdgeCase('Search filter applied (live state)', filteredTxns, cashFlowMode),
      runEdgeCase(`Cash Flow toggled (${oppositeCashFlowMode})`, filteredTxns, oppositeCashFlowMode),
    ];

    const matchedCapitalDistribution = filteredTxns.filter(
      (txn) => txn.type === 'expense' && isCapitalDistributionCategory(txn.category)
    );
    const matchedExpenseTotal = matchedCapitalDistribution.reduce((sum, txn) => sum + txn.amount, 0);

    const failureReasons: string[] = [];

    if (!debug.latestMonthUsesMaxDate) {
      failureReasons.push('Latest month in rollups does not match max month from transactions.');
    }

    debug.windowRows.forEach((row) => {
      if (row.monthCount > 0 && (row.startMonth === 'n/a' || row.endMonth === 'n/a')) {
        failureReasons.push(`Timeframe ${row.timeframe} has months but missing start/end month labels.`);
      }
      if (![row.revenue, row.expenses, row.netCashFlow, row.savingsRate].every((value) => Number.isFinite(value))) {
        failureReasons.push(`Timeframe ${row.timeframe} has non-finite KPI totals.`);
      }
    });

    debug.comparisonRows.forEach((row) => {
      const metricSnapshots = [row.revenue, row.expenses, row.netCashFlow, row.savingsRate];
      metricSnapshots.forEach((metric, index) => {
        const metricName = ['revenue', 'expenses', 'netCashFlow', 'savingsRate'][index];
        if (!Number.isFinite(metric.current) || !Number.isFinite(metric.previous) || !Number.isFinite(metric.delta)) {
          failureReasons.push(`Comparison ${row.timeframe} has non-finite ${metricName} values.`);
        }
        if (metric.previous === 0 && metric.percentChange !== null) {
          failureReasons.push(`Comparison ${row.timeframe} has percentChange for ${metricName} while previous is 0.`);
        }
      });
    });

    trendValidationRows.forEach((row) => {
      if (row.trendLength !== row.visibleMonths) {
        failureReasons.push(
          `Trend ${row.metric} ${row.timeframe} length mismatch (${row.trendLength} vs ${row.visibleMonths}).`
        );
      }
      if (row.visibleMonths > 0 && (!row.firstExists || !row.lastExists)) {
        failureReasons.push(`Trend ${row.metric} ${row.timeframe} is missing first/last point.`);
      }
      if (row.metric === 'net' && row.trendType !== 'linear') {
        failureReasons.push(`Net trend for ${row.timeframe} is not linear.`);
      }
    });

    const edgeCaseFailures = edgeCaseRows.filter((row) => row.status === 'error');
    edgeCaseFailures.forEach((row) => {
      failureReasons.push(`Edge case failed: ${row.case}`);
    });

    debug.trajectoryRows.forEach((row) => {
      if (!row.hasSufficientHistory && row.light !== 'neutral') {
        failureReasons.push(`Trajectory ${row.id} should be neutral when history is insufficient.`);
      }
      if (row.percentChange !== null && !Number.isFinite(row.percentChange)) {
        failureReasons.push(`Trajectory ${row.id} has non-finite percent change.`);
      }
      if (![row.currentNetCashFlow, row.previousNetCashFlow, row.delta].every((value) => Number.isFinite(value))) {
        failureReasons.push(`Trajectory ${row.id} has non-finite net cash-flow values.`);
      }
    });

    const debugVerdict = failureReasons.length === 0 ? 'OK' : 'FAIL';
    const debugSummaryRow = {
      verdict: debugVerdict,
      checksRun:
        debug.windowRows.length +
        debug.comparisonRows.length +
        trendValidationRows.length +
        edgeCaseRows.length +
        1,
      failureCount: failureReasons.length,
      latestMonthUsesMaxDate: debug.latestMonthUsesMaxDate,
      windowRows: debug.windowRows.length,
      comparisonRows: debug.comparisonRows.length,
      trendRows: trendValidationRows.length,
      edgeCases: edgeCaseRows.length,
    };

    console.groupCollapsed('[Pre-Phase 4 Debug Report]');
    if (debugVerdict === 'OK') {
      console.info('[Debug Verdict] OK');
    } else {
      console.error('[Debug Verdict] FAIL');
    }
    console.table([debugSummaryRow]);
    if (failureReasons.length > 0) {
      console.warn('Failure reasons');
      failureReasons.forEach((reason) => console.warn(`- ${reason}`));
    }
    console.info('Context', {
      cashFlowMode,
      searchQuery: query,
      dataViewMode,
      rowCount: filteredTxns.length,
      latestMonthFromRollups: debug.latestMonthFromRollups || 'n/a',
      maxMonthFromTxns: debug.maxMonthFromTxns || 'n/a',
      latestMonthUsesMaxDate: debug.latestMonthUsesMaxDate,
    });
    console.table(debug.windowRows);
    console.table(debug.comparisonRows);
    console.table(debug.trajectoryRows);
    console.table(trendValidationRows);
    console.table(edgeCaseRows);
    console.info('Capital Distribution Match (current filtered scope)', {
      matchedRows: matchedCapitalDistribution.length,
      matchedExpenseTotal,
    });
    console.groupEnd();
  }, [cashFlowMode, dataViewMode, filteredTxns, model.monthlyRollups, model.trend, query]);

  const scenarioProjection = useMemo(() => projectScenario(model, scenarioInput), [model, scenarioInput]);
  const scenarioTrend = useMemo<TrendPoint[]>(
    () =>
      scenarioProjection.map((point) => ({
        month: point.month,
        income: point.projectedIncome,
        expense: point.projectedExpense,
        net: point.projectedNet,
      })),
    [scenarioProjection]
  );

  const latestRollup = model.monthlyRollups[model.monthlyRollups.length - 1] ?? null;
  const previousRollup = model.monthlyRollups[model.monthlyRollups.length - 2] ?? null;
  const selectedKpiComparison = model.kpiComparisonByTimeframe[kpiTimeframe];
  const selectedHeaderComparisonLabel = model.kpiHeaderLabelByTimeframe[kpiTimeframe] ?? 'Comparison unavailable';
  const selectedKpiFrameLabel = KPI_FRAME_OPTIONS.find((option) => option.value === kpiTimeframe)?.label ?? 'TTM';
  const digHereFocusMonthLabel = digHereFocusMonth ? toMonthLabel(digHereFocusMonth) : null;
  const digHereFocusSummary = useMemo(() => {
    if (digHereFocusContext === 'category-shifts') return 'Focused from Dig Here Highlights';
    if (digHereFocusContext === 'month-drilldown') return 'Focused from Monthly Net Cash Flow';
    return null;
  }, [digHereFocusContext]);

  const digHereHighlights = useMemo<DigHereHighlight[]>(() => {
    if (!selectedKpiComparison) return [];
    if (!selectedKpiComparison.currentEndMonth || !selectedKpiComparison.currentStartMonth) return [];

    const includeCategory = (category: string) =>
      cashFlowMode === 'total' || !isCapitalDistributionCategory(category);

    const currentTotals = new Map<string, number>();
    const previousTotals = new Map<string, number>();

    filteredTxns.forEach((txn) => {
      if (txn.type !== 'expense') return;
      if (!includeCategory(txn.category)) return;

      if (
        inMonthRange(
          txn.month,
          selectedKpiComparison.currentStartMonth,
          selectedKpiComparison.currentEndMonth
        )
      ) {
        currentTotals.set(txn.category, (currentTotals.get(txn.category) ?? 0) + txn.amount);
      }

      if (
        inMonthRange(
          txn.month,
          selectedKpiComparison.previousStartMonth,
          selectedKpiComparison.previousEndMonth
        )
      ) {
        previousTotals.set(txn.category, (previousTotals.get(txn.category) ?? 0) + txn.amount);
      }
    });

    const categories = new Set<string>([...currentTotals.keys(), ...previousTotals.keys()]);
    const highlights = [...categories].map<DigHereHighlight>((category) => {
      const current = currentTotals.get(category) ?? 0;
      const previous = previousTotals.get(category) ?? 0;
      const delta = current - previous;
      return {
        category,
        current,
        previous,
        delta,
        deltaPercent: toDeltaPercent(current, previous),
      };
    });

    return highlights
      .filter((item) => Math.abs(item.delta) >= HIGHLIGHT_MIN_ABS_DELTA)
      .sort((a, b) => {
        const aNegativePriority = a.delta > EPSILON ? 1 : 0;
        const bNegativePriority = b.delta > EPSILON ? 1 : 0;
        if (aNegativePriority !== bNegativePriority) {
          return bNegativePriority - aNegativePriority;
        }
        return Math.abs(b.delta) - Math.abs(a.delta);
      })
      .slice(0, 5);
  }, [cashFlowMode, filteredTxns, selectedKpiComparison]);

  const selectedKpiCards = useMemo<KpiCard[]>(() => {
    if (!selectedKpiComparison) return model.kpiCards;

    const metricToCard = (
      id: KpiCard['id'],
      label: string,
      metric: { current: number; previous: number; percentChange: number | null }
    ): KpiCard => {
      const delta = metric.current - metric.previous;
      return {
        id,
        label,
        value: metric.current,
        previousValue: metric.previous,
        deltaPercent: metric.percentChange,
        trend: Math.abs(delta) <= EPSILON ? 'flat' : delta > 0 ? 'up' : 'down',
        format: id === 'savingsRate' ? 'percent' : 'currency',
      };
    };

    return [
      metricToCard('income', 'Revenue', selectedKpiComparison.revenue),
      metricToCard('expense', 'Expenses', selectedKpiComparison.expenses),
      metricToCard('net', 'Net Cash Flow', selectedKpiComparison.netCashFlow),
      metricToCard('savingsRate', 'Savings Rate', selectedKpiComparison.savingsRate),
    ];
  }, [selectedKpiComparison, model.kpiCards]);

  const sustainability = useMemo(
    () => [
      {
        label: 'Revenue Momentum',
        value: selectedKpiCards.find((card) => card.id === 'income')?.trend === 'up' ? 'Getting Better' : 'Getting Worse',
      },
      {
        label: 'Cost Discipline',
        value: selectedKpiCards.find((card) => card.id === 'expense')?.trend === 'down' ? 'Getting Better' : 'Needs Attention',
      },
      {
        label: 'Net Cash Position',
        value: (latestRollup?.netCashFlow ?? 0) >= 0 ? 'Healthy' : 'Negative',
      },
      {
        label: 'Consistency',
        value: model.monthlyRollups.length >= 6 ? 'Long-term Visible' : 'Need More History',
      },
    ],
    [latestRollup?.netCashFlow, selectedKpiCards, model.monthlyRollups.length]
  );

  const writeDashboardUrlState = useCallback(
    (
      next: {
        tab: TabId;
        view: DataViewMode;
        cashFlow: CashFlowMode;
        queryText?: string;
        month?: string | null;
        focusContext?: DigHereFocusContext;
      },
      mode: 'push' | 'replace' = 'push'
    ) => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next.tab);
      url.searchParams.set('view', next.view);
      url.searchParams.set('cf', next.cashFlow);

      if (next.queryText?.trim()) {
        url.searchParams.set('q', next.queryText.trim());
      } else {
        url.searchParams.delete('q');
      }

      if (next.month) {
        url.searchParams.set('month', next.month);
      } else {
        url.searchParams.delete('month');
      }

      if (next.focusContext) {
        url.searchParams.set('focus', next.focusContext);
      } else {
        url.searchParams.delete('focus');
      }

      if (mode === 'replace') {
        window.history.replaceState({}, '', url);
      } else {
        window.history.pushState({}, '', url);
      }
    },
    []
  );

  const navigateToDigHere = useCallback(
    (options?: DigHereNavigationOptions) => {
      const nextQuery = options?.category?.trim() ?? query.trim();
      const focusMonth =
        options?.month ??
        selectedKpiComparison?.currentEndMonth ??
        model.latestMonth ??
        null;
      const focusContext = options?.focusContext ?? 'category-shifts';

      writeDashboardUrlState(
        {
          tab: activeTab,
          view: dataViewMode,
          cashFlow: cashFlowMode,
          queryText: query,
          month: digHereFocusMonth,
          focusContext: digHereFocusContext,
        },
        'replace'
      );

      setActiveTab('dig-here');
      setQuery(nextQuery);
      setDigHereFocusMonth(focusMonth);
      setDigHereFocusContext(focusContext);

      writeDashboardUrlState({
        tab: 'dig-here',
        view: dataViewMode,
        cashFlow: cashFlowMode,
        queryText: nextQuery,
        month: focusMonth,
        focusContext,
      });
    },
    [
      activeTab,
      cashFlowMode,
      dataViewMode,
      digHereFocusContext,
      digHereFocusMonth,
      model.latestMonth,
      query,
      selectedKpiComparison?.currentEndMonth,
      writeDashboardUrlState,
    ]
  );

  const clearDigHereFocus = useCallback(() => {
    setQuery('');
    setDigHereFocusMonth(null);
    setDigHereFocusContext(null);
    writeDashboardUrlState({
      tab: 'dig-here',
      view: dataViewMode,
      cashFlow: cashFlowMode,
      month: null,
      focusContext: null,
    });
  }, [cashFlowMode, dataViewMode, writeDashboardUrlState]);

  function handleSaveCsvUrl() {
    const nextUrl = draftCsvUrl.trim();
    setCsvUrl(nextUrl);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEYS.csvUrl, nextUrl);
      } catch {
        // Ignore storage failures and continue with in-memory URL.
      }
    }
  }

  function handleResetCsvUrl() {
    setDraftCsvUrl(SHEET_CSV_URL);
    setCsvUrl(SHEET_CSV_URL);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEYS.csvUrl, SHEET_CSV_URL);
      } catch {
        // Ignore storage failures and continue with in-memory URL.
      }
    }
  }

  return (
    <div className="finance-app">
      <aside className="left-nav glass-panel">
        <div className="brand-wrap">
          <div className="brand-badge" aria-hidden="true">
            GS
          </div>
          <div>
            <h1>{APP_TITLE}</h1>
            <p>Personal CFO Scorecard</p>
          </div>
        </div>

        <nav aria-label="Main navigation">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={activeTab === item.id ? 'nav-item is-active' : 'nav-item'}
                  onClick={() => setActiveTab(item.id)}
                >
                  <span>{item.shortLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <button type="button" className="sync-btn" onClick={() => void runSync()} disabled={loading}>
          {loading ? 'Syncing...' : 'Sync now'}
        </button>

        <p className="meta-note">Last sync: {formatTimestamp(dataSet?.fetchedAtIso ?? null)}</p>
      </aside>

      <section className="main-zone">
        <header className="top-bar glass-panel">
          <div>
            <h2>
              {model.latestMonth ? toMonthLabel(model.latestMonth) : 'No Data Yet'}
            </h2>
            <p>
              {selectedHeaderComparisonLabel}
            </p>
          </div>

          <div className="top-controls">
            <div className="kpi-timeframe-toggle" role="group" aria-label="KPI timeframe selector">
              {KPI_FRAME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={kpiTimeframe === option.value ? 'is-active' : ''}
                  onClick={() => setKpiTimeframe(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search payee, category, memo..."
              aria-label="Search transactions"
            />
            <div className="view-toggle" role="group" aria-label="Data view mode">
              <button
                type="button"
                className={dataViewMode === 'actuals' ? 'is-active' : ''}
                onClick={() => setDataViewMode('actuals')}
              >
                Actuals
              </button>
              <button
                type="button"
                className={dataViewMode === 'all' ? 'is-active' : ''}
                onClick={() => setDataViewMode('all')}
              >
                Actuals + Projections
              </button>
            </div>
            <p className="data-count-note">
              Actuals: {dataSplit.actuals.length.toLocaleString()} rows • Projections:{' '}
              {dataSplit.projections.length.toLocaleString()} rows
            </p>
          </div>
        </header>

        {error && <p className="error-banner">{error}</p>}

        {activeTab === 'big-picture' && (
          <>
            <KpiCards cards={selectedKpiCards} />
            <TrajectoryPanel signals={model.trajectorySignals} />
            <DigHereHighlights
              items={digHereHighlights}
              timeframeLabel={`${selectedKpiFrameLabel} comparison`}
              onTitleClick={() => navigateToDigHere()}
              onItemClick={(item) =>
                navigateToDigHere({
                  category: item.category,
                  focusContext: 'category-shifts',
                })
              }
            />

            <TrendLineChart
              data={model.trend}
              metric="net"
              title="Monthly Net Cash Flow"
              enableTimeframeControl
              showCashFlowToggle
              cashFlowMode={cashFlowMode}
              onCashFlowModeChange={setCashFlowMode}
              onMonthPointClick={(month) =>
                navigateToDigHere({
                  month,
                  focusContext: 'month-drilldown',
                })
              }
            />

            <div className="two-col-grid">
              <article className="card preview-card">
                <div className="card-head">
                  <h3>Money Left on the Table</h3>
                  <p className="subtle">Recoverable opportunity this month</p>
                </div>
                <p className="hero-number">{formatCurrency(model.opportunityTotal)}</p>
                <ul className="opportunity-list">
                  {model.opportunities.slice(0, 5).map((item) => (
                    <li key={item.title}>
                      <span>{item.title}</span>
                      <strong>{formatCurrency(item.savings)}</strong>
                    </li>
                  ))}
                </ul>
              </article>

              <TopPayeesTable payees={model.topPayees} />
            </div>

            <div className="two-col-grid">
              <article className="card summary-card">
                <div className="card-head">
                  <h3>Summary of Results</h3>
                  <p className="subtle">Narrative snapshot from this period</p>
                </div>

                <ul className="summary-list">
                  {model.summaryBullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </article>

              <article className="card summary-card">
                <div className="card-head">
                  <h3>Sustainability</h3>
                  <p className="subtle">Health checks in one glance</p>
                </div>
                <ul className="status-list">
                  {sustainability.map((item) => (
                    <li key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </>
        )}

        {activeTab === 'money-left' && (
          <div className="tab-grid">
            <article className="card">
              <div className="card-head">
                <h3>Money Left on the Table</h3>
                <p className="subtle">Potential savings from category overruns vs baseline</p>
              </div>
              <p className="hero-number">{formatCurrency(model.opportunityTotal)}</p>

              <ul className="opportunity-list">
                {model.opportunities.map((item) => (
                  <li key={item.title}>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.hint}</p>
                    </div>
                    <span>{formatCurrency(item.savings)}</span>
                  </li>
                ))}
              </ul>
            </article>

            <ExpenseDonut slices={model.expenseSlices} />
          </div>
        )}

        {activeTab === 'dig-here' && (
          <div className="stack-grid">
            {(digHereFocusSummary || digHereFocusMonthLabel) && (
              <article className="card dig-here-focus-card">
                <p>
                  {digHereFocusSummary ? `${digHereFocusSummary}` : 'Dig Here focus'}
                  {digHereFocusMonthLabel ? ` • ${digHereFocusMonthLabel}` : ''}
                  {query.trim() ? ` • "${query.trim()}"` : ''}
                </p>
                <button type="button" onClick={clearDigHereFocus}>
                  Clear focus
                </button>
              </article>
            )}
            <div className="tab-grid">
              <MoversList movers={digHereModel.movers} title="Dig Here Actions" />
              <TopPayeesTable payees={digHereModel.topPayees} />
            </div>
          </div>
        )}

        {activeTab === 'trends' && (
          <div className="stack-grid">
            <TrendLineChart data={model.trend} metric="income" title="Revenue Trend" />
            <TrendLineChart data={model.trend} metric="expense" title="Expense Trend" />

            <article className="card table-card">
              <div className="card-head">
                <h3>Monthly Rollups</h3>
                <p className="subtle">Canonical monthly dataset: revenue, expenses, net cash flow, savings rate and transaction count</p>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Revenue</th>
                    <th>Expenses</th>
                    <th>Net Cash Flow</th>
                    <th>Savings Rate</th>
                    <th>Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {model.monthlyRollups.map((rollup) => (
                    <tr key={rollup.month}>
                      <td>{toMonthLabel(rollup.month)}</td>
                      <td>{formatCurrency(rollup.revenue)}</td>
                      <td>{formatCurrency(rollup.expenses)}</td>
                      <td>{formatCurrency(rollup.netCashFlow)}</td>
                      <td>{rollup.savingsRate.toFixed(1)}%</td>
                      <td>{rollup.transactionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>
        )}

        {activeTab === 'what-if' && (
          <div className="stack-grid">
            <article className="card scenario-card">
              <div className="card-head">
                <h3>What-If Scenario</h3>
                <p className="subtle">Adjust assumptions and project the next 12 months</p>
              </div>

              <div className="slider-grid">
                <label>
                  Revenue growth ({scenarioInput.revenueGrowthPct.toFixed(1)}%)
                  <input
                    type="range"
                    min={-10}
                    max={20}
                    step={0.5}
                    value={scenarioInput.revenueGrowthPct}
                    onChange={(event) =>
                      setScenarioInput((prev) => ({
                        ...prev,
                        revenueGrowthPct: Number.parseFloat(event.target.value),
                      }))
                    }
                  />
                </label>

                <label>
                  Expense reduction ({scenarioInput.expenseReductionPct.toFixed(1)}%)
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={0.5}
                    value={scenarioInput.expenseReductionPct}
                    onChange={(event) =>
                      setScenarioInput((prev) => ({
                        ...prev,
                        expenseReductionPct: Number.parseFloat(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
            </article>

            <TrendLineChart data={scenarioTrend} metric="net" title="Projected Monthly Net (12 Months)" />

            <article className="card table-card">
              <div className="card-head">
                <h3>Projection Table</h3>
                <p className="subtle">Scenario output using trailing 3-month baseline</p>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Projected Income</th>
                    <th>Projected Expense</th>
                    <th>Projected Net</th>
                    <th>Cumulative Net</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioProjection.map((row) => (
                    <tr key={row.month}>
                      <td>{toMonthLabel(row.month)}</td>
                      <td>{formatCurrency(row.projectedIncome)}</td>
                      <td>{formatCurrency(row.projectedExpense)}</td>
                      <td>{formatCurrency(row.projectedNet)}</td>
                      <td>{formatCurrency(row.cumulativeNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>
        )}

        {activeTab === 'settings' && (
          <article className="card settings-card">
            <div className="card-head">
              <h3>Data Source Settings</h3>
              <p className="subtle">Google Sheets CSV endpoint used by this dashboard</p>
            </div>

            <label className="settings-field">
              CSV URL
              <input
                type="url"
                value={draftCsvUrl}
                onChange={(event) => setDraftCsvUrl(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=0"
              />
            </label>

            <div className="settings-actions">
              <button type="button" onClick={handleSaveCsvUrl}>
                Save source URL
              </button>
              <button type="button" onClick={handleResetCsvUrl} className="ghost-btn">
                Reset to default
              </button>
              <button type="button" onClick={() => void runSync()} className="ghost-btn" disabled={loading}>
                {loading ? 'Syncing...' : 'Sync now'}
              </button>
            </div>

            <div className="settings-meta">
              <p>
                Active source: <code>{dataSet?.sourceUrl ?? csvUrl}</code>
              </p>
              <p>
                Last refresh: <strong>{formatTimestamp(dataSet?.fetchedAtIso ?? null)}</strong>
              </p>
            </div>
          </article>
        )}
      </section>

      <aside className="right-panel">
        <section className="right-hero">
          <p className="eyebrow">Current Net</p>
          <h3>{latestRollup ? formatCurrency(latestRollup.netCashFlow) : '$0'}</h3>
          <p>
            {latestRollup
              ? `for ${toMonthLabel(latestRollup.month)} (${latestRollup.transactionCount.toLocaleString()} transactions)`
              : 'Waiting for data'}
          </p>

          <div className="delta-chip">
            <span>{(latestRollup?.netCashFlow ?? 0) >= (previousRollup?.netCashFlow ?? 0) ? '▲' : '▼'}</span>
            <span>
              vs previous {previousRollup ? formatCurrency(previousRollup.netCashFlow) : 'n/a'}
            </span>
          </div>
        </section>

        <section className="right-card">
          <h4>Quick Health</h4>
          <div className="mini-metrics">
            <p>
              Revenue <strong>{formatCurrency(latestRollup?.revenue ?? 0)}</strong>
            </p>
            <p>
              Expense <strong>{formatCurrency(latestRollup?.expenses ?? 0)}</strong>
            </p>
            <p>
              Savings Rate <strong>{(latestRollup?.savingsRate ?? 0).toFixed(1)}%</strong>
            </p>
            <p>
              Opportunity <strong>{formatCurrency(model.opportunityTotal)}</strong>
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}
