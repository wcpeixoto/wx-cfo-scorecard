import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { STORAGE_KEYS } from '../config';
import { useLocation, useNavigate } from 'react-router';
import { FiRefreshCw } from 'react-icons/fi';
import { AppSidebar } from '../components/AppSidebar';
import { AppHeader } from '../components/AppHeader';
import { useSidebar } from '../context/SidebarContext';
import CashFlowForecastModule from '../components/CashFlowForecastModule';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import ProjectionTableV2 from '../components/ProjectionTableV2';
import LoadingScreen from '../components/LoadingScreen';
import DigHereHighlights from '../components/DigHereHighlights';
import CashTrendHero, { CashTrendPlaceholder } from '../components/CashTrendHero';
import KpiCards from '../components/KpiCards';
import TopCategoriesCard from '../components/TopCategoriesCard';
import PeriodDropdown from '../components/PeriodDropdown';
import TopPayeesTable from '../components/TopPayeesTable';
import TrendLineChart from '../components/TrendLineChart';
import NetCashFlowChart from '../components/NetCashFlowChart';
import { TodayPage } from '../components/TodayPage';
import { ProjectionCompareDrawer } from '../components/ProjectionCompareDrawer';
import { EfficiencyOpportunitiesCard } from '../components/EfficiencyOpportunitiesCard';
import ContractsSettingsPane from '../components/ContractsSettingsPane';
import { computeEfficiencyOpportunities } from '../lib/kpis/efficiencyOpportunities';
import { computeLinearTrendLine, computeProgressiveMovingAverage } from '../lib/charts/movingAverage';
import { discoverAccountRecords, mergeDiscoveredAccountRecords, parseStoredAccountRecords } from '../lib/accounts';
import { isCapitalDistributionCategory } from '../lib/cashFlow';
import { computeWhatNeedsAttention } from '../lib/kpis/digHere';
import { computeCashTrend } from '../lib/kpis/cashTrend';
import { computePriorYearActuals } from '../lib/kpis/priorYearActuals';
import { runDataSanityChecks } from '../lib/dataSanity';
import { clearImportedTransactions, getImportedTransactionsSnapshot, importQuickenReportCsv } from '../lib/data/importedTransactions';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  deleteSharedRenewalContract,
  getSharedAccountSettings,
  getSharedForecastEvents,
  getSharedImportBatchById,
  getSharedRenewalContracts,
  getSharedWorkspaceSettings,
  isSharedPersistenceConfigured,
  saveSharedAccountSettings,
  saveSharedForecastEvents,
  saveSharedRenewalContract,
  saveSharedRenewalEvents,
  saveSharedWorkspaceSettings,
  type WorkspaceSettings,
} from '../lib/data/sharedPersistence';
import { toISODateOnly } from '../lib/data/normalize';
import {
  buildPrePhase4DebugReport,
  computeDashboardModel,
  computeForecastDecisionSignals,
  computeDigHereInsights,
  computeExpenseSlices,
  computeKpiComparisons,
  computeMonthlyRollups,
  projectScenario,
  toMonthLabel,
} from '../lib/kpis/compute';
import { projectCategoryCadenceScenario } from '../lib/kpis/categoryCadence';
import { composeSplitConservative } from '../lib/kpis/splitConservative';
import { composeConservativeFloor } from '../lib/kpis/conservativeFloor';
import { applyEventsOverlay } from '../lib/kpis/applyEventsOverlay';
import { generateRenewalEvents } from '../lib/forecast/generateRenewalEvents';
import { expandRecurringEvents } from '../lib/forecast/expandRecurringEvents';
import type {
  AccountRecord,
  AccountType,
  CashFlowForecastStatus,
  CashFlowMode,
  DataSet,
  DashboardModel,
  ForecastEvent,
  ForecastScenarioKey,
  KpiCard,
  KpiMetricComparison,
  KpiComparisonTimeframe,
  KpiTimeframeComparison,
  MoverGrouping,
  RenewalContract,
  ScenarioInput,
  ScenarioPoint,
  TransactionImportIssue,
  TransactionImportSummary,
  TrendPoint,
  Txn,
} from '../lib/data/contract';
import { chartTokens } from '../lib/ui/chartTokens';

type TabId =
  | 'today'
  | 'big-picture'
  | 'where-to-focus'
  | 'trends'
  | 'what-if'
  | 'settings'
  | 'ui-lab';

type BigPictureFrameValue = KpiComparisonTimeframe | 'custom';
type KpiFrameOption = { value: BigPictureFrameValue; label: string };
type DigHerePeriodValue = KpiComparisonTimeframe | 'custom';
type DigHerePeriodOption = { value: DigHerePeriodValue; label: string };
type BigPictureKpiComparison = KpiTimeframeComparison & {
  currentStartDate: string | null;
  currentEndDate: string | null;
  previousStartDate: string | null;
  previousEndDate: string | null;
};
type BigPictureVisibleFrameValue = 'thisMonth' | 'lastMonth' | 'last3Months';
type BigPictureFilterFrameValue = Exclude<BigPictureFrameValue, BigPictureVisibleFrameValue>;

const TAB_TO_PATH: Record<TabId, string> = {
  today: '/',
  'big-picture': '/big-picture',
  'where-to-focus': '/focus',
  trends: '/trends',
  'what-if': '/forecast',
  settings: '/settings',
  'ui-lab': '/ui-lab',
};

function pathToTab(pathname: string): TabId {
  // HashRouter pathname is the part after the #
  const normalized = pathname.replace(/\/+$/, '') || '/';
  switch (normalized) {
    case '/':
    case '/today':
      return 'today';
    case '/big-picture':
      return 'big-picture';
    case '/focus':
    case '/where-to-focus':
    case '/money-left':
    case '/dig-here':
      return 'where-to-focus';
    case '/trends':
      return 'trends';
    case '/forecast':
    case '/what-if':
      return 'what-if';
    case '/settings':
      return 'settings';
    case '/ui-lab':
      return 'ui-lab';
    default:
      return 'today';
  }
}

const DEFAULT_SCENARIO: ScenarioInput = {
  scenarioKey: 'base',
  revenueGrowthPct: 0,
  expenseChangePct: 0,
  receivableDays: 3,
  payableDays: 3,
  months: 12,
};
const DEFAULT_CUSTOM_SCENARIO: ScenarioInput = {
  ...DEFAULT_SCENARIO,
  scenarioKey: 'custom',
};
// Presets derive their revenue/expense % from editable workspace settings
// (Settings → Rules → Forecast Scenario Assumptions). Other slider fields
// remain canonical defaults shared across scenarios.
function getForecastScenarioPresets(
  settings: Pick<
    BusinessRules,
    | 'scenarioBaseRevenueGrowthPct'
    | 'scenarioBaseExpenseChangePct'
    | 'scenarioBestRevenueGrowthPct'
    | 'scenarioBestExpenseChangePct'
    | 'scenarioWorstRevenueGrowthPct'
    | 'scenarioWorstExpenseChangePct'
  >
): Record<Exclude<ForecastScenarioKey, 'custom'>, ScenarioInput> {
  return {
    base: {
      scenarioKey: 'base',
      revenueGrowthPct: settings.scenarioBaseRevenueGrowthPct,
      expenseChangePct: settings.scenarioBaseExpenseChangePct,
      receivableDays: 3,
      payableDays: 3,
      months: 12,
    },
    best: {
      scenarioKey: 'best',
      revenueGrowthPct: settings.scenarioBestRevenueGrowthPct,
      expenseChangePct: settings.scenarioBestExpenseChangePct,
      receivableDays: 3,
      payableDays: 3,
      months: 12,
    },
    worst: {
      scenarioKey: 'worst',
      revenueGrowthPct: settings.scenarioWorstRevenueGrowthPct,
      expenseChangePct: settings.scenarioWorstExpenseChangePct,
      receivableDays: 3,
      payableDays: 3,
      months: 12,
    },
  };
}
const BIG_PICTURE_FRAME_OPTIONS: KpiFrameOption[] = [
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'last3Months', label: 'Last 3 Months' },
  { value: 'ytd', label: 'YTD' },
  { value: 'ttm', label: '12 Months' },
  { value: 'last24Months', label: '24 Months' },
  { value: 'last36Months', label: '36 Months' },
  { value: 'allDates', label: 'All Dates' },
  { value: 'custom', label: 'Custom' },
];
const BIG_PICTURE_VISIBLE_FRAME_OPTIONS: Array<KpiFrameOption & { value: BigPictureVisibleFrameValue }> = [
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'last3Months', label: 'Last 3 Months' },
];
const BIG_PICTURE_FILTER_FRAME_OPTIONS: Array<KpiFrameOption & { value: BigPictureFilterFrameValue }> = [
  { value: 'ytd', label: 'YTD' },
  { value: 'ttm', label: '12 Months' },
  { value: 'last24Months', label: '24 Months' },
  { value: 'last36Months', label: '36 Months' },
  { value: 'allDates', label: 'All Dates' },
  { value: 'custom', label: 'Custom' },
];
const DIG_HERE_PERIOD_OPTIONS: DigHerePeriodOption[] = [
  { value: 'thisMonth', label: 'Month' },
  { value: 'last3Months', label: '3M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'ttm', label: '12M' },
  { value: 'last24Months', label: '24M' },
  { value: 'last36Months', label: '36M' },
  { value: 'custom', label: 'Custom' },
];
const EPSILON = 0.00001;
type TrendTimeframeOption = 6 | 12 | 24 | 36 | 'all';
const TREND_TIMEFRAMES: TrendTimeframeOption[] = [6, 12, 24, 36, 'all'];
type TrendsMaWindow = 6 | 12 | 24;
type TrendsMaOption = { value: TrendsMaWindow; label: string };
const TRENDS_MA_OPTIONS: TrendsMaOption[] = [
  { value: 6, label: '6-Month Trend' },
  { value: 12, label: '12-Month Trend' },
  { value: 24, label: '24-Month Trend' },
];

// Illustrative fixture series for UI Lab mini-charts. Reusable by any
// future UI Lab card that needs a sparkline. Not wired to production data.
const UI_LAB_SPARKLINE_SERIES = [18, 24, 21, 30, 28, 38, 35, 46, 42, 54, 58, 66];

// Locked mini-sparkline visual spec; series data below is illustrative UI Lab fixture data.
const UI_LAB_SPARKLINE_OPTIONS: ApexOptions = {
  chart: {
    type: 'area',
    height: 70,
    fontFamily: 'Outfit, sans-serif',
    sparkline: { enabled: true },
    toolbar: { show: false },
    animations: { enabled: false },
  },
  stroke: {
    curve: 'smooth',
    width: 1,
    colors: [chartTokens.success],
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.55,
      opacityTo: 0,
      stops: [0, 100],
      colorStops: [
        { offset: 0, color: chartTokens.success, opacity: 0.55 },
        { offset: 100, color: chartTokens.successGradientEnd, opacity: 0 },
      ],
    },
  },
  dataLabels: { enabled: false },
  markers: { size: 0 },
  grid: { show: false },
  xaxis: { labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: { show: false } },
  tooltip: { enabled: false },
  legend: { show: false },
};

// UI Lab — TotalBalanceCard sparkline fixtures (TailAdmin /finance "Total Balance").
// Brand-blue sparkline, 150×70px. Illustrative — not wired to production data.
const TOTAL_BALANCE_SPARKLINE_SERIES = [42, 48, 44, 52, 50, 58, 55, 62, 60, 68, 65, 74];

const TOTAL_BALANCE_SPARKLINE_OPTIONS: ApexOptions = {
  chart: {
    type: 'area',
    height: 70,
    fontFamily: 'Outfit, sans-serif',
    sparkline: { enabled: true },
    toolbar: { show: false },
    animations: { enabled: false },
  },
  stroke: {
    curve: 'smooth',
    width: 1.5,
    colors: [chartTokens.brand],
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.45,
      opacityTo: 0,
      stops: [0, 100],
    },
  },
  colors: [chartTokens.brand],
  dataLabels: { enabled: false },
  markers: { size: 0 },
  grid: { show: false },
  xaxis: { labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: { show: false } },
  tooltip: { enabled: false },
  legend: { show: false },
};

// UI Lab — StatisticsCard chart fixtures (TailAdmin /sales "Users & Revenue Statistics").
// Local to StatisticsCard. Do not lift to a shared lib until a second consumer needs them.
const STATISTICS_CARD_CATEGORIES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const STATISTICS_CARD_SERIES = [
  { name: 'Online Sales',  data: [180, 190, 170, 160, 175, 165, 170, 200, 180, 195, 230, 210] },
  { name: 'Offline Sales', data: [110, 120, 150, 100, 140, 110, 100, 140, 100, 120, 130, 100] },
];

const STATISTICS_CARD_OPTIONS: ApexOptions = {
  chart: {
    type: 'area',
    height: 250,
    fontFamily: 'Outfit, sans-serif',
    toolbar: { show: false },
    background: 'transparent',
  },
  colors: [chartTokens.brand, chartTokens.brandSecondary],
  stroke: { curve: 'smooth', width: 2 },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.45,
      opacityTo: 0,
      stops: [0, 100],
    },
  },
  dataLabels: { enabled: false },
  markers: { size: 0 },
  legend: { show: false }, // Custom JSX legend rendered above the chart per Pattern C.
  grid: {
    // Solid grid per TailAdmin Sales spec — overrides global dashed default.
    borderColor: chartTokens.gridBorder,
    strokeDashArray: 0,
    xaxis: { lines: { show: false } },
    yaxis: { lines: { show: true } },
  },
  xaxis: {
    categories: STATISTICS_CARD_CATEGORIES,
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      style: { fontSize: '12px', fontWeight: 400, colors: chartTokens.axisTextSales },
    },
    // Crosshair styling handled by global .apexcharts-xcrosshairs in dashboard.css.
    crosshairs: { show: true },
  },
  yaxis: {
    labels: {
      style: { fontSize: '11px', fontWeight: 400, colors: chartTokens.axisTextSales },
    },
  },
  tooltip: { theme: 'light' },
};

type ForecastRangeValue = '30d' | '60d' | '90d' | '6m' | '1y' | '2y' | '3y';
type ForecastRangeOption = { value: ForecastRangeValue; label: string; months: number };
const FORECAST_RANGE_OPTIONS: ForecastRangeOption[] = [
  // Forecasts are monthly; day horizons are mapped to the nearest whole month.
  { value: '30d', label: 'Next 30 Days', months: 1 },
  { value: '60d', label: 'Next 60 Days', months: 2 },
  { value: '90d', label: 'Next 90 Days', months: 3 },
  { value: '6m', label: 'Next 6 Months', months: 6 },
  { value: '1y', label: 'Next 1 Year', months: 12 },
  { value: '2y', label: 'Next 2 Years', months: 24 },
  { value: '3y', label: 'Next 3 Years', months: 36 },
];

const DEFAULT_FORECAST_EVENTS: ForecastEvent[] = [];

type DigHereFocusContext = 'category-shifts' | 'month-drilldown' | 'custom-period' | 'period-control' | null;
type DigHereNavigationOptions = {
  category?: string;
  month?: string | null;
  startMonth?: string | null;
  endMonth?: string | null;
  focusContext?: DigHereFocusContext;
};

function parseMonthToken(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function parseDateToken(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function previousMonthToken(month: string): string | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const monthNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  const prevYear = date.getUTCFullYear();
  const prevMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${prevYear}-${prevMonth}`;
}

function addMonthsToToken(month: string, offset: number): string | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const monthNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

function addDaysToToken(date: string, offset: number): string | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const monthNumber = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(monthNumber) ||
    !Number.isFinite(day) ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const next = new Date(Date.UTC(year, monthNumber - 1, day + offset));
  const nextYear = next.getUTCFullYear();
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(next.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function inclusiveDaySpan(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function previousEquivalentDateRange(
  startDate: string | null,
  endDate: string | null
): { startDate: string; endDate: string } | null {
  if (!startDate || !endDate) return null;
  const span = inclusiveDaySpan(startDate, endDate);
  if (span <= 0) return null;

  const previousEndDate = addDaysToToken(startDate, -1);
  const previousStartDate = addDaysToToken(startDate, -span);
  if (!previousStartDate || !previousEndDate) return null;

  return { startDate: previousStartDate, endDate: previousEndDate };
}

function inclusiveMonthSpan(startMonth: string, endMonth: string): number {
  const startMatch = startMonth.match(/^(\d{4})-(\d{2})$/);
  const endMatch = endMonth.match(/^(\d{4})-(\d{2})$/);
  if (!startMatch || !endMatch) return 0;

  const startYear = Number.parseInt(startMatch[1], 10);
  const startMonthNumber = Number.parseInt(startMatch[2], 10);
  const endYear = Number.parseInt(endMatch[1], 10);
  const endMonthNumber = Number.parseInt(endMatch[2], 10);
  if (
    !Number.isFinite(startYear) ||
    !Number.isFinite(startMonthNumber) ||
    !Number.isFinite(endYear) ||
    !Number.isFinite(endMonthNumber)
  ) {
    return 0;
  }

  return (endYear - startYear) * 12 + (endMonthNumber - startMonthNumber) + 1;
}

function previousEquivalentRange(
  startMonth: string | null,
  endMonth: string | null
): { startMonth: string; endMonth: string } | null {
  if (!startMonth || !endMonth) return null;
  const span = inclusiveMonthSpan(startMonth, endMonth);
  if (span <= 0) return null;

  const previousEndMonth = addMonthsToToken(startMonth, -1);
  const previousStartMonth = addMonthsToToken(startMonth, -span);
  if (!previousStartMonth || !previousEndMonth) return null;

  return { startMonth: previousStartMonth, endMonth: previousEndMonth };
}

function parseDigHereFocusContext(value: string | null): DigHereFocusContext {
  if (value === 'category-shifts' || value === 'month-drilldown' || value === 'custom-period' || value === 'period-control') {
    return value;
  }
  return null;
}

function sameMonthRange(
  startMonth: string | null,
  endMonth: string | null,
  targetStartMonth: string | null,
  targetEndMonth: string | null
): boolean {
  return startMonth === targetStartMonth && endMonth === targetEndMonth;
}

function parseCashFlowMode(value: string | null): CashFlowMode | null {
  if (value === 'operating' || value === 'total') return value;
  return null;
}

function parseMoverGrouping(value: string | null): MoverGrouping | null {
  if (value === 'subcategories' || value === 'categories') return value;
  return null;
}

function parseForecastRangeValue(value: string): ForecastRangeValue | null {
  if (value === '30d' || value === '60d' || value === '90d' || value === '6m' || value === '1y' || value === '2y' || value === '3y') {
    return value;
  }
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

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDateRangeLabel(startDate: string | null, endDate: string | null): string {
  if (!startDate || !endDate) return 'Custom range';
  if (startDate === endDate) return formatDateLabel(startDate);
  return `${formatDateLabel(startDate)} – ${formatDateLabel(endDate)}`;
}

function daysBetweenDateTokens(startDate: string, endDate: string): number | null {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function formatRelativeUpdatedLabel(lastUpdatedDate: string | null): string {
  if (!lastUpdatedDate) return 'Updated recently';
  const today = toISODateOnly(new Date());
  if (!today) return `Updated ${formatDateLabel(lastUpdatedDate)}`;
  const dayDiff = daysBetweenDateTokens(lastUpdatedDate, today);
  if (dayDiff === null || dayDiff < 0) return `Updated ${formatDateLabel(lastUpdatedDate)}`;
  if (dayDiff === 0) return 'Updated Today';
  if (dayDiff === 1) return 'Updated 1 day ago';
  return `Updated ${dayDiff} days ago`;
}

function formatMonthRangeLabel(startMonth: string, endMonth: string): string {
  if (startMonth === endMonth) return toMonthLabel(startMonth);
  return `${toMonthLabel(startMonth)} – ${toMonthLabel(endMonth)}`;
}

function summarizeAccountNames(records: AccountRecord[], limit = 3): string {
  const names = records.map((record) => record.accountName || record.discoveredAccountName).filter(Boolean);
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} +${names.length - limit} more`;
}


function getCurrentCalendarMonthToken(): string {
  const currentDate = toISODateOnly(new Date()) ?? new Date().toISOString().slice(0, 10);
  return currentDate.slice(0, 7);
}

function getLatestTxnDate(txns: Txn[]): string | null {
  return txns.reduce<string | null>((latest, txn) => {
    if (!latest || txn.date > latest) return txn.date;
    return latest;
  }, null);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function compareMetric(current: number, previous: number): KpiMetricComparison {
  const roundedCurrent = round2(current);
  const roundedPrevious = round2(previous);
  return {
    current: roundedCurrent,
    previous: roundedPrevious,
    delta: round2(roundedCurrent - roundedPrevious),
    percentChange: Math.abs(roundedPrevious) <= EPSILON ? null : ((roundedCurrent - roundedPrevious) / Math.abs(roundedPrevious)) * 100,
  };
}

function getStoredAccountSettings(): AccountRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    return parseStoredAccountRecords(window.localStorage.getItem(STORAGE_KEYS.accountSettings));
  } catch {
    return [];
  }
}

// Business rules — previously stored in localStorage under finance_dashboard_business_rules.
// Now persisted in Supabase shared_workspace_settings (workspace_id = 'default').
// The WorkspaceSettings type is the canonical shape; BusinessRules is a local alias for clarity.
type BusinessRules = WorkspaceSettings;

const DEFAULT_BUSINESS_RULES: BusinessRules = { ...DEFAULT_WORKSPACE_SETTINGS };

// One-time migration: read legacy localStorage values into WorkspaceSettings shape.
// Returns null if no localStorage values found (caller should use Supabase defaults).
function migrateLocalStorageBusinessRules(): Partial<BusinessRules> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.businessRules);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Map old snake_case and null-able fields to the new shape.
    const migrated: Partial<BusinessRules> = {};

    if (typeof parsed.targetNetMargin === 'number') {
      migrated.targetNetMargin = parsed.targetNetMargin;
    }
    if (parsed.safetyReserveMethod === 'fixed' || parsed.safetyReserveMethod === 'monthly') {
      migrated.safetyReserveMethod = parsed.safetyReserveMethod;
    }
    if (typeof parsed.safetyReserveAmount === 'number' && parsed.safetyReserveAmount >= 0) {
      migrated.safetyReserveAmount = parsed.safetyReserveAmount;
    }
    if (typeof parsed.suppress_duplicate_warnings === 'boolean') {
      migrated.suppressDuplicateWarnings = parsed.suppress_duplicate_warnings;
    }
    if (Array.isArray(parsed.acknowledged_noncash_accounts)) {
      migrated.acknowledgedNoncashAccounts = (parsed.acknowledged_noncash_accounts as unknown[]).filter(
        (id): id is string => typeof id === 'string'
      );
    }

    const hasAnyValue = Object.keys(migrated).length > 0;
    return hasAnyValue ? migrated : null;
  } catch {
    return null;
  }
}

function clearLocalStorageBusinessRules(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEYS.businessRules);
  } catch {
    // Non-fatal.
  }
}


function DashboardSkeleton() {
  return (
    <div className="finance-app">
      <AppSidebar />
      <div className="app-main-column">
        <section className="main-zone">
          <header className="top-bar glass-panel">
            <div className="top-bar-main">
              <div className="top-bar-copy">
                <div className="skeleton-block skeleton-page-title skeleton-pulse" />
                <div className="skeleton-block skeleton-page-subtitle skeleton-pulse" />
              </div>
              <div className="skeleton-toggle-group skeleton-pulse" />
            </div>
          </header>

          <div className="kpi-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton-block skeleton-block--card skeleton-kpi-card skeleton-pulse" />
            ))}
          </div>

          <article className="card">
            <div className="skeleton-chart skeleton-pulse" />
          </article>

          <div className="two-col-grid">
            <div className="skeleton-block skeleton-block--card skeleton-medium-card skeleton-pulse" />
            <div className="skeleton-block skeleton-block--card skeleton-medium-card skeleton-pulse" />
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const bootT0Ref = useRef(performance.now());
  const bootPhaseLoggedRef = useRef<Record<string, boolean>>({});
  const sharedPersistenceEnabled = isSharedPersistenceConfigured();
  const profitabilityCashFlowMode: CashFlowMode = 'operating';
  const [isInitializing, setIsInitializing] = useState(true);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab: TabId = pathToTab(location.pathname);
  const { setMobileOpen } = useSidebar();
  const [query, setQuery] = useState('');
  const [netChartTimeframe, setNetChartTimeframe] = useState<TrendTimeframeOption>(12);
  const [digHereFocusMonth, setDigHereFocusMonth] = useState<string | null>(null);
  const [digHereStartMonth, setDigHereStartMonth] = useState<string | null>(null);
  const [digHereEndMonth, setDigHereEndMonth] = useState<string | null>(null);
  const [digHereFocusContext, setDigHereFocusContext] = useState<DigHereFocusContext>(null);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [monthPickerMode, setMonthPickerMode] = useState<'month' | 'period'>('month');
  const [monthPickerDraftMonth, setMonthPickerDraftMonth] = useState<string>('');
  const [monthPickerDraftStart, setMonthPickerDraftStart] = useState<string>('');
  const [monthPickerDraftEnd, setMonthPickerDraftEnd] = useState<string>('');
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const bigPictureFilterMenuRef = useRef<HTMLDivElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [trendsMaWindow, setTrendsMaWindow] = useState<TrendsMaWindow>(12);
const [showAllFocusCategories, setShowAllFocusCategories] = useState(false);
  const [importedDataSet, setImportedDataSet] = useState<DataSet | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [bootLoadError, setBootLoadError] = useState<string | null>(null);
  const [lastImportSummary, setLastImportSummary] = useState<TransactionImportSummary | null>(null);
  const [importExamples, setImportExamples] = useState<{
    importId: string;
    possibleDuplicateExamples: TransactionImportIssue[];
    parseFailureExamples: TransactionImportIssue[];
  } | null>(null);
  const [storedImportedTransactionCount, setStoredImportedTransactionCount] = useState(0);
  const [accountRecords, setAccountRecords] = useState<AccountRecord[]>(getStoredAccountSettings);
  const [selectedScenarioKey, setSelectedScenarioKey] = useState<ForecastScenarioKey>('base');
  // Stage 3 production wiring: opt-in switch between the locked engine,
  // category-cadence comparator, and split-conservative composition.
  // Session-only — defaults to 'engine' on every page load.
  // Forecast composer is selected by businessRules.forecastPosture
  // (Settings → Forecast style). Reality → Conservative Floor;
  // Recovery → Split Conservative. See sub-phase 2c.1.
  const [customScenarioInput, setCustomScenarioInput] = useState<ScenarioInput>(DEFAULT_CUSTOM_SCENARIO);
  const [kpiTimeframe, setKpiTimeframe] = useState<BigPictureFrameValue>('lastMonth');
  const [netCashFlowChartMode, setNetCashFlowChartMode] = useState<CashFlowMode>('operating');
  const [digHereMoverGrouping, setDigHereMoverGrouping] = useState<MoverGrouping>('subcategories');
  const [forecastRange, setForecastRange] = useState<ForecastRangeValue>('90d');
  const [forecastEvents, setForecastEvents] = useState<ForecastEvent[]>(DEFAULT_FORECAST_EVENTS);
  // UI Lab — StatisticsCard tab demo state. Local-only, not persisted.
  const [uiLabStatsTab, setUiLabStatsTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  // Phase 5.1 — Renewal contracts loaded from Supabase. No UI consumes
  // this state in Branch 4; Branch 5 wires it to the operator-facing
  // contract management screen. Mutation handlers below keep the local
  // mirror in sync with remote during create/update/delete.
  const [forecastContracts, setForecastContracts] = useState<RenewalContract[]>([]);
  // Loop-guard: a single "completed" flag, set only after a
  // regeneration pass reaches the end without being cancelled. This
  // is the second-attempt fix for a React 18 strict-mode bug where a
  // ref set eagerly before any await would be flipped on the first
  // (cancelled) invocation and then block the strict-mode-spawned
  // second invocation forever.
  //
  // Strict-mode behavior with this guard:
  //   1. Mount A: completed=false → start work; cleanup_A captured.
  //   2. Cleanup A: cancelled_A = true. The completed ref is NOT
  //      touched, because cleanup-set-completed would defeat the
  //      whole point: we only mark completed when work actually
  //      finished without cancellation.
  //   3. Mount B: completed=false → start a fresh independent run.
  //      Run A's IIFE eventually resumes, sees cancelled, returns
  //      without setting completed. Run B continues to completion,
  //      sets completed = true on success.
  //
  // No in-flight guard is used. We considered one and rejected it:
  // it created a livelock where mount B was blocked by mount A's
  // not-yet-released in-flight slot, and the slot only cleared in
  // A's `finally` after B had already early-returned. With a stable
  // dep array (sharedPersistenceEnabled doesn't toggle mid-session)
  // and an idempotent persistence layer (saveSharedRenewalEvents
  // upserts by deterministic id and source-scopes its stale-delete
  // per Branch 2), letting both strict-mode mounts kick off work is
  // safe — duplicate writes converge on the same row state.
  //
  // If saveSharedRenewalEvents ever stops being idempotent, or if
  // sharedPersistenceEnabled becomes session-toggleable, revisit
  // this pattern — the completed-only guard would no longer be
  // sufficient against re-entrancy.
  const renewalRegenerationCompletedRef = useRef(false);
  const [activeSection, setActiveSection] = useState<'data' | 'accounts' | 'rules' | 'contracts'>('data');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [isBigPictureFilterOpen, setIsBigPictureFilterOpen] = useState(false);
  const preserveAccountSettingsOnImportClearRef = useRef(false);
  const sharedAccountSettingsSyncArmedRef = useRef(false);
  const projectionTableRef = useRef<HTMLDivElement>(null);
  // Temporary DEV-only fallback flag — append ?oldProjectionTable=1 to the URL (or hash,
  // e.g. #/forecast?oldProjectionTable=1) to render the old projection table instead of V2.
  // V2 is the default. Remove this flag and the conditional after V2 is fully validated.
  const useOldProjectionTable = import.meta.env.DEV && (() => {
    const hash = window.location.hash;
    const hashQueryIdx = hash.indexOf('?');
    const hashSearch = hashQueryIdx >= 0 ? hash.slice(hashQueryIdx) : '';
    return (
      new URLSearchParams(window.location.search).has('oldProjectionTable') ||
      new URLSearchParams(hashSearch).has('oldProjectionTable')
    );
  })();
  const [sharedAccountSettingsReady, setSharedAccountSettingsReady] = useState(!sharedPersistenceEnabled);
  const [sharedAccountSettingsHasRemoteData, setSharedAccountSettingsHasRemoteData] = useState(false);
  const [businessRules, setBusinessRules] = useState<BusinessRules>(() => ({ ...DEFAULT_BUSINESS_RULES }));
  const forecastScenarioPresets = useMemo(
    () => getForecastScenarioPresets(businessRules),
    [
      businessRules.scenarioBaseRevenueGrowthPct,
      businessRules.scenarioBaseExpenseChangePct,
      businessRules.scenarioBestRevenueGrowthPct,
      businessRules.scenarioBestExpenseChangePct,
      businessRules.scenarioWorstRevenueGrowthPct,
      businessRules.scenarioWorstExpenseChangePct,
    ]
  );
  const scenarioInput = useMemo(
    () => (selectedScenarioKey === 'custom' ? customScenarioInput : forecastScenarioPresets[selectedScenarioKey]),
    [customScenarioInput, selectedScenarioKey, forecastScenarioPresets]
  );

  const updateCustomScenario = useCallback(
    (patch: Partial<ScenarioInput>) => {
      const baseScenario =
        selectedScenarioKey === 'custom' ? customScenarioInput : { ...forecastScenarioPresets[selectedScenarioKey], scenarioKey: 'custom' as const };
      const nextCustomScenario: ScenarioInput = {
        ...baseScenario,
        ...patch,
        scenarioKey: 'custom',
      };
      setCustomScenarioInput(nextCustomScenario);
      setSelectedScenarioKey('custom');
    },
    [customScenarioInput, selectedScenarioKey, forecastScenarioPresets]
  );

  const updateBusinessRules = useCallback((patch: Partial<BusinessRules>) => {
    setBusinessRules((prev) => {
      const next = { ...prev, ...patch };
      void saveSharedWorkspaceSettings(next);
      return next;
    });
  }, []);

  const loadImportedState = useCallback(async () => {
    try {
      const idbT0 = performance.now();
      const snapshot = await getImportedTransactionsSnapshot();
      if (import.meta.env.DEV && !bootPhaseLoggedRef.current.idb) {
        bootPhaseLoggedRef.current.idb = true;
        console.log('[BOOT] IndexedDB total:', Math.round(performance.now() - idbT0), 'ms');
      }
      setImportedDataSet(snapshot.dataSet);
      setLastImportSummary(snapshot.lastImportSummary);
      setStoredImportedTransactionCount(snapshot.transactionCount);
    } catch (importStateError) {
      const message = importStateError instanceof Error ? importStateError.message : 'Could not load imported transactions.';
      setBootLoadError(message);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  useEffect(() => {
    void loadImportedState();
  }, [loadImportedState]);

  // Lazy-load JSONB example arrays for the Settings → Data Imported Data
  // panel. Excluded from the boot projection in getSharedImportedStoreSnapshot
  // to reduce egress; fetched on demand here when the operator opens the panel.
  // Local-mode summaries already carry the example arrays directly, so the
  // Supabase fetch is skipped entirely in that mode.
  useEffect(() => {
    if (activeTab !== 'settings' || activeSection !== 'data') return;
    if (!lastImportSummary?.importId) return;

    if (lastImportSummary.storageScope === 'local') {
      setImportExamples(null);
      return;
    }

    // Reset stale examples synchronously before fetching so the prior
    // batch's examples never render against the new batch's metadata.
    setImportExamples(null);

    const targetImportId = lastImportSummary.importId;
    let cancelled = false;
    getSharedImportBatchById(targetImportId)
      .then((full) => {
        if (cancelled || !full) return;
        setImportExamples({
          importId: targetImportId,
          possibleDuplicateExamples: full.possibleDuplicateExamples ?? [],
          parseFailureExamples: full.parseFailureExamples ?? [],
        });
      })
      .catch(() => {
        // Fail-soft: examples remain empty, counters still render correctly.
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, activeSection, lastImportSummary?.importId, lastImportSummary?.storageScope]);

  // [BOOT] App mount baseline
  useEffect(() => {
    if (import.meta.env.DEV && !bootPhaseLoggedRef.current.mount) {
      bootPhaseLoggedRef.current.mount = true;
      console.log('[BOOT] App mounted: 0ms (baseline)');
    }
  }, []);

  // Fade out loading screen 300ms after data is ready, then unmount it
  useEffect(() => {
    if (!isInitializing) {
      const timer = setTimeout(() => setShowLoadingScreen(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isInitializing]);

  // [BOOT] Total boot time — fires once after skeleton → real dashboard transition
  useEffect(() => {
    if (!isInitializing && !bootPhaseLoggedRef.current.total) {
      bootPhaseLoggedRef.current.total = true;
      if (import.meta.env.DEV) {
        console.log('[BOOT] Total boot time:', Math.round(performance.now() - bootT0Ref.current), 'ms');
      }
    }
  }, [isInitializing]);

  useEffect(() => {
    if (!sharedPersistenceEnabled) return;

    let cancelled = false;

    const loadSharedSettings = async () => {
      try {
        const remoteSettings = await getSharedAccountSettings();
        if (cancelled) return;

        if (remoteSettings && remoteSettings.length > 0) {
          setSharedAccountSettingsHasRemoteData(true);
          setAccountRecords(remoteSettings);
          if (typeof window !== 'undefined') {
            try {
              window.localStorage.setItem(STORAGE_KEYS.accountSettings, JSON.stringify(remoteSettings));
            } catch {
              // Ignore local cache write failures.
            }
          }
        } else {
          setSharedAccountSettingsHasRemoteData(false);
          // Keep localStorage-loaded records as fallback.
          // Do NOT wipe state — empty remote does not mean empty local.
        }
      } catch (sharedSettingsError) {
        console.warn('Shared account settings unavailable, using browser-local settings.', sharedSettingsError);
      } finally {
        if (!cancelled) {
          setSharedAccountSettingsReady(true);
        }
      }
    };

    void loadSharedSettings();

    return () => {
      cancelled = true;
    };
  }, [sharedPersistenceEnabled]);

  // Load workspace settings from Supabase on mount.
  // If no row exists yet and localStorage has legacy values, migrate them.
  // If neither exists, insert the default row.
  useEffect(() => {
    if (!sharedPersistenceEnabled) return;

    let cancelled = false;

    const loadWorkspaceSettings = async () => {
      try {
        const remote = await getSharedWorkspaceSettings();

        if (cancelled) return;

        if (remote !== null) {
          // Row exists — use it, ensure any stale localStorage is gone.
          setBusinessRules(remote);
          clearLocalStorageBusinessRules();
        } else {
          // No row yet — check for localStorage migration.
          const legacyValues = migrateLocalStorageBusinessRules();
          const initial: BusinessRules = legacyValues
            ? { ...DEFAULT_BUSINESS_RULES, ...legacyValues }
            : { ...DEFAULT_BUSINESS_RULES };

          if (!cancelled) setBusinessRules(initial);

          // Write the resolved settings to Supabase (creates the row).
          await saveSharedWorkspaceSettings(initial);
          clearLocalStorageBusinessRules();
        }
      } catch (workspaceSettingsError) {
        // Non-fatal: in-memory defaults remain correct.
        console.warn('[workspace-settings] Load failed, using defaults.', workspaceSettingsError);
      }
    };

    void loadWorkspaceSettings();

    return () => {
      cancelled = true;
    };
  }, [sharedPersistenceEnabled]);

  // Phase 5.1 — Combined renewal contracts + forecast events bootstrap.
  //
  // Replaces the standalone forecast_events load effect. On first load
  // (and only first load) we:
  //   1. Fetch renewal_contracts from Supabase.
  //   2. For each contract, regenerate its renewal forecast_events using
  //      the pure generator. `today` is injected here so the generator
  //      stays I/O-free; the horizon is captured via closure at first
  //      run and pinned for the session (horizon changes do not
  //      trigger regeneration in Branch 4).
  //   3. Save the regenerated rows via saveSharedRenewalEvents — Branch
  //      2 scopes the stale-delete to non-overridden renewal rows for
  //      this contract only, so manual events, other contracts' rows,
  //      and operator overrides are all preserved.
  //   4. Refetch the unified forecast_events list and install it. The
  //      existing overlay path picks up the new rows without any
  //      compute or overlay change.
  //
  // Loop-guard: completed-only ref. See the ref declaration above
  // for the strict-mode rationale and the explicit assumptions
  // (idempotent persistence + stable dep) that make a single flag
  // sufficient.
  //
  // The effect reads sharedPersistenceEnabled (in deps) and
  // forecastRangeMonths (closure-pinned, intentionally omitted from
  // deps). It writes forecastContracts and forecastEvents, neither
  // of which is a dep — so a write cannot re-trigger the effect.
  useEffect(() => {
    if (!sharedPersistenceEnabled) return;
    if (renewalRegenerationCompletedRef.current) return;

    let cancelled = false;
    // Pin "today" and the horizon at load time. The pure generator
    // never constructs a Date — that's why `today` is supplied here at
    // the integration boundary. Horizon stays fixed for this session.
    const todayAtLoad = new Date();
    const horizonAtLoad = forecastRangeMonths;

    (async () => {
      let contracts: RenewalContract[] = [];
      try {
        const remoteContracts = await getSharedRenewalContracts();
        if (cancelled) return;
        contracts = remoteContracts ?? [];
        setForecastContracts(contracts);
      } catch (contractsErr) {
        // Non-fatal: continue to refetch forecast_events below so
        // existing manual-event behavior doesn't regress.
        console.warn('[renewal-contracts] Load failed; skipping regeneration.', contractsErr);
      }

      for (const contract of contracts) {
        if (cancelled) return;
        try {
          const events = generateRenewalEvents(contract, horizonAtLoad, todayAtLoad);
          await saveSharedRenewalEvents(contract.id, events);
        } catch (regenErr) {
          // Per-contract failures are non-fatal so a single bad
          // contract doesn't block other contracts or the refetch.
          console.warn(`[renewal-events] Regenerate failed for contract ${contract.id}:`, regenErr);
        }
      }

      try {
        const events = await getSharedForecastEvents();
        if (cancelled) return;
        if (events !== null) setForecastEvents(events);
      } catch (err) {
        // Non-fatal: in-memory empty default remains correct.
        console.warn('[forecast-events] Load failed, using empty defaults.', err);
      }

      // Mark the pass as completed only if it reached this point
      // without being cancelled. A cancelled run (strict-mode
      // cleanup, unmount, etc.) returns early above and never reaches
      // this line — the completed flag stays false and a healthy
      // follow-up run (e.g., strict-mode's second mount) can start
      // a fresh pass.
      if (!cancelled) {
        renewalRegenerationCompletedRef.current = true;
      }
    })();

    return () => {
      // Cleanup intentionally only sets cancelled. It does NOT touch
      // the completed ref — that would erase the whole point of the
      // pattern, since cancelled runs by definition didn't complete.
      cancelled = true;
    };
    // forecastRangeMonths is intentionally omitted from deps.
    //
    // Why pin the horizon at load time:
    // (1) Stability — re-running regeneration every time the user
    //     toggles the horizon button would cause repeated DB writes
    //     and a brief UI flicker for a feature that doesn't need it.
    // (2) Correctness — saveSharedRenewalEvents stale-deletes
    //     non-overridden renewal rows for a contract. If the user
    //     shrinks the horizon mid-session, re-running regen would
    //     drop renewal rows past the new horizon — including ones
    //     the chart is still showing in scrolled/expanded views.
    // (3) Idempotency under double-mount — React 18 strict-mode
    //     re-invokes effects in dev. The completed-only ref above
    //     handles this: a cancelled first run never sets completed,
    //     so strict-mode's second mount can start a fresh pass and
    //     converge on the same end state. Pinning the horizon makes
    //     that convergence guarantee transitive: even if the guard
    //     were lifted, the dep array would still not provoke a
    //     refire from horizon changes. (See the ref-declaration
    //     comment for why we don't use an in-flight guard.)
    //
    // Tradeoff: a user who loads with horizon=90d and then expands
    // to 3 years won't see renewal events past month 3 until the
    // next page load. Acceptable for Branch 4; Branch 5 may revisit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedPersistenceEnabled]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const cashFlow = parseCashFlowMode(params.get('cf'));
    const nextQuery = params.get('q');
    const month = parseMonthToken(params.get('month'));
    const startMonth = parseMonthToken(params.get('start'));
    const endMonth = parseMonthToken(params.get('end'));
    const focusContext = parseDigHereFocusContext(params.get('focus'));
    const moverGrouping = parseMoverGrouping(params.get('mg'));

    const validRange = startMonth && endMonth && startMonth <= endMonth;

    setNetCashFlowChartMode(cashFlow ?? 'operating');
    setQuery(nextQuery ?? '');
    setDigHereFocusMonth(validRange ? null : month);
    setDigHereStartMonth(validRange ? startMonth : null);
    setDigHereEndMonth(validRange ? endMonth : null);
    setDigHereFocusContext(focusContext);
    setDigHereMoverGrouping(moverGrouping ?? 'subcategories');
  }, [location.search]);

  const activeDataSet = importedDataSet;
  const baseTxns = useMemo(() => activeDataSet?.txns ?? [], [activeDataSet?.txns]);
  const hasImportedData = Boolean(importedDataSet && importedDataSet.txns.length > 0);
  const currentCalendarMonth = useMemo(() => getCurrentCalendarMonthToken(), []);
  const previousCalendarMonth = useMemo(() => previousMonthToken(currentCalendarMonth), [currentCalendarMonth]);
  const twoMonthsAgo = useMemo(
    () => (previousCalendarMonth ? previousMonthToken(previousCalendarMonth) : null),
    [previousCalendarMonth]
  );
  const latestAvailableTxnDate = useMemo(() => getLatestTxnDate(baseTxns), [baseTxns]);
  const lastUpdatedDate = useMemo(() => {
    if (latestAvailableTxnDate) return latestAvailableTxnDate;
    if (lastImportSummary?.importedAtIso) return toISODateOnly(lastImportSummary.importedAtIso);
    if (activeDataSet?.fetchedAtIso) return toISODateOnly(activeDataSet.fetchedAtIso);
    return null;
  }, [activeDataSet?.fetchedAtIso, lastImportSummary?.importedAtIso, latestAvailableTxnDate]);
  const lastUpdatedLabel = useMemo(
    () => formatRelativeUpdatedLabel(lastUpdatedDate),
    [lastUpdatedDate]
  );
  const discoveredAccountRecords = useMemo(() => discoverAccountRecords(baseTxns), [baseTxns]);

  const accountBalanceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const txn of baseTxns) {
      const key = (txn.account ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + txn.rawAmount);
    }
    return map;
  }, [baseTxns]);

  useEffect(() => {
    if (sharedPersistenceEnabled && !sharedAccountSettingsReady) return;

    setAccountRecords((previous) => {
      if (preserveAccountSettingsOnImportClearRef.current) {
        preserveAccountSettingsOnImportClearRef.current = false;
        return previous;
      }

      const merged = mergeDiscoveredAccountRecords(discoveredAccountRecords, previous);
      const previousSerialized = JSON.stringify(previous);
      const mergedSerialized = JSON.stringify(merged);
      return previousSerialized === mergedSerialized ? previous : merged;
    });
  }, [discoveredAccountRecords, sharedAccountSettingsReady, sharedPersistenceEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Don't persist until shared settings have been resolved, to avoid
    // overwriting localStorage with a transient intermediate state.
    if (sharedPersistenceEnabled && !sharedAccountSettingsReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.accountSettings, JSON.stringify(accountRecords));
    } catch {
      // Ignore storage failures and continue with in-memory settings.
    }
    if (sharedPersistenceEnabled && sharedAccountSettingsReady && (sharedAccountSettingsHasRemoteData || sharedAccountSettingsSyncArmedRef.current)) {
      void saveSharedAccountSettings(accountRecords)
        .then(() => {
          sharedAccountSettingsSyncArmedRef.current = false;
          setSharedAccountSettingsHasRemoteData(true);
        })
        .catch((sharedSettingsError) => {
          console.warn('Could not sync shared account settings.', sharedSettingsError);
        });
    }
  }, [accountRecords, sharedAccountSettingsHasRemoteData, sharedAccountSettingsReady, sharedPersistenceEnabled]);

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

  const availableMonths = useMemo(
    () =>
      [...new Set(baseTxns.map((txn) => txn.month))]
        .filter((month) => /^\d{4}-\d{2}$/.test(month))
        .sort((a, b) => b.localeCompare(a)),
    [baseTxns]
  );
  const availableDates = useMemo(
    () =>
      [...new Set(baseTxns.map((txn) => txn.date))]
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort((a, b) => a.localeCompare(b)),
    [baseTxns]
  );
  const earliestAvailableDate = availableDates[0] ?? '';
  const latestAvailableDate = availableDates[availableDates.length - 1] ?? '';
  const latestMonthDateRange = useMemo(() => {
    const latestMonth = availableMonths[0];
    if (!latestMonth) return null;
    const monthDates = availableDates.filter((date) => date.startsWith(`${latestMonth}-`));
    if (monthDates.length === 0) return null;
    return {
      startDate: monthDates[0],
      endDate: monthDates[monthDates.length - 1],
    };
  }, [availableDates, availableMonths]);

  useEffect(() => {
    if (customStartDate && customEndDate) return;
    if (!latestMonthDateRange) return;
    setCustomStartDate((current) => current || latestMonthDateRange.startDate);
    setCustomEndDate((current) => current || latestMonthDateRange.endDate);
  }, [customEndDate, customStartDate, latestMonthDateRange]);
  // Sum startingBalance + cumulative net change for every account included in the cash forecast.
  // This is the same formula already shown in Settings → Current Balance column.
  const currentCashBalance = useMemo(() => {
    const includedRecords = accountRecords.filter((r) => r.includeInCashForecast && r.active);
    if (includedRecords.length === 0) return 0;
    return includedRecords.reduce(
      (sum, record) => sum + record.startingBalance + (accountBalanceMap.get(record.id) ?? 0),
      0
    );
  }, [accountRecords, accountBalanceMap]);
  const activeCashAccountRecords = useMemo(
    () => accountRecords.filter((record) => record.active && record.accountType === 'Cash'),
    [accountRecords]
  );
  const includedCashForecastAccounts = useMemo(
    () => activeCashAccountRecords.filter((record) => record.includeInCashForecast),
    [activeCashAccountRecords]
  );
  // True when at least one included account has a non-zero starting balance, meaning
  // the absolute cash position is meaningful (not just cumulative net change from 0).
  const hasCurrentCashBalance = useMemo(
    () => accountRecords.some((r) => r.includeInCashForecast && r.active && Math.abs(r.startingBalance) > EPSILON),
    [accountRecords]
  );
  const forecastWindowStartLabel = useMemo(
    () => (earliestAvailableDate ? formatDateLabel(earliestAvailableDate) : 'the start of the loaded data window'),
    [earliestAvailableDate]
  );
  const forecastWindowLabel = useMemo(() => {
    if (!earliestAvailableDate || !latestAvailableDate) return 'the loaded data window';
    return formatDateRangeLabel(earliestAvailableDate, latestAvailableDate);
  }, [earliestAvailableDate, latestAvailableDate]);
  const includedForecastAccounts = useMemo(
    () => accountRecords.filter((record) => record.active && record.includeInCashForecast),
    [accountRecords]
  );
  const includedForecastAccountsMissingStartingBalance = useMemo(
    () => includedForecastAccounts.filter((record) => Math.abs(record.startingBalance) <= EPSILON),
    [includedForecastAccounts]
  );
  const includedNonCashForecastAccounts = useMemo(
    () => includedForecastAccounts.filter((record) => record.accountType !== 'Cash'),
    [includedForecastAccounts]
  );
  const forecastCashAnchorAccounts = useMemo(() => {
    if (includedNonCashForecastAccounts.length > 0 || includedCashForecastAccounts.length === 0) {
      return activeCashAccountRecords;
    }
    return includedCashForecastAccounts;
  }, [activeCashAccountRecords, includedCashForecastAccounts, includedNonCashForecastAccounts]);
  const forecastCashAnchorAccountIds = useMemo(
    () => new Set(forecastCashAnchorAccounts.map((record) => record.id)),
    [forecastCashAnchorAccounts]
  );
  const forecastCashAnchorUsesFallback = useMemo(
    () => includedNonCashForecastAccounts.length > 0 || includedCashForecastAccounts.length === 0,
    [includedCashForecastAccounts.length, includedNonCashForecastAccounts.length]
  );
  const forecastCurrentCashBalance = useMemo(() => {
    if (forecastCashAnchorAccounts.length === 0) return 0;
    return forecastCashAnchorAccounts.reduce(
      (sum, record) => sum + record.startingBalance + (accountBalanceMap.get(record.id) ?? 0),
      0
    );
  }, [accountBalanceMap, forecastCashAnchorAccounts]);
  const forecastCashAnchorAccountsMissingStartingBalance = useMemo(
    () => forecastCashAnchorAccounts.filter((record) => Math.abs(record.startingBalance) <= EPSILON),
    [forecastCashAnchorAccounts]
  );
  const hasForecastCurrentCashBalance = useMemo(
    () => forecastCashAnchorAccounts.some((record) => Math.abs(record.startingBalance) > EPSILON),
    [forecastCashAnchorAccounts]
  );
  const includedCashAccountCount = useMemo(
    () => includedForecastAccounts.filter((record) => record.accountType === 'Cash').length,
    [includedForecastAccounts]
  );
  const forecastFoundationWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (forecastCashAnchorAccounts.length === 0) {
      warnings.push('No active Cash accounts are available for the forecast starting balance yet.');
      return warnings;
    }
    if (includedForecastAccounts.length === 0) {
      warnings.push('No accounts are currently marked In Forecast, so the forecast is falling back to active Cash accounts only.');
    }
    if (!hasForecastCurrentCashBalance) {
      warnings.push(
        `Forecast cash anchor accounts all have a $0 starting balance, so forecast can only show cumulative change instead of absolute cash in bank.`
      );
    }
    if (forecastCashAnchorAccountsMissingStartingBalance.length > 0) {
      warnings.push(
        `${summarizeAccountNames(forecastCashAnchorAccountsMissingStartingBalance)} still need a starting balance as of ${forecastWindowStartLabel}.`
      );
    }
    if (includedNonCashForecastAccounts.length > 0) {
      warnings.push(
        `${summarizeAccountNames(includedNonCashForecastAccounts)} are included in forecast even though their account type is not Cash. Double-check that they should contribute to cash balance.`
      );
    }
    if (forecastCashAnchorUsesFallback && forecastCashAnchorAccounts.length > 0) {
      warnings.push('Forecast engine uses active Cash accounts only for its starting cash anchor; non-cash forecast accounts are ignored.');
    }
    return warnings;
  }, [
    forecastCashAnchorAccounts.length,
    forecastCashAnchorAccountsMissingStartingBalance,
    forecastCashAnchorUsesFallback,
    forecastWindowStartLabel,
    hasForecastCurrentCashBalance,
    includedForecastAccounts,
    includedNonCashForecastAccounts,
  ]);

  const model = useMemo(
    () => {
      const kpiT0 = performance.now();
      const result = computeDashboardModel(filteredTxns, {
        cashFlowMode: profitabilityCashFlowMode,
        anchorMonth: previousCalendarMonth ?? undefined,
        thisMonthAnchor: currentCalendarMonth,
        currentCashBalance,
      });
      if (import.meta.env.DEV && !bootPhaseLoggedRef.current.kpi && filteredTxns.length > 0) {
        bootPhaseLoggedRef.current.kpi = true;
        console.log('[BOOT] KPI compute:', Math.round(performance.now() - kpiT0), 'ms');
      }
      return result;
    },
    [currentCalendarMonth, currentCashBalance, filteredTxns, previousCalendarMonth, profitabilityCashFlowMode]
  );
  const efficiencyResult = useMemo(
    () => computeEfficiencyOpportunities(model, filteredTxns),
    [model, filteredTxns]
  );
  const netCashFlowChartModel = useMemo(
    () =>
      computeDashboardModel(filteredTxns, {
        cashFlowMode: netCashFlowChartMode,
        anchorMonth: previousCalendarMonth ?? undefined,
        thisMonthAnchor: currentCalendarMonth,
        currentCashBalance,
      }),
    [currentCalendarMonth, currentCashBalance, filteredTxns, netCashFlowChartMode, previousCalendarMonth]
  );
  const trendsRangeLabel = useMemo(() => {
    const sliced = model.trend.slice(-trendsMaWindow);
    if (sliced.length === 0) return '';
    const start = toMonthLabel(sliced[0].month);
    const end = toMonthLabel(sliced[sliced.length - 1].month);
    return start === end ? start : `${start} – ${end}`;
  }, [model.trend, trendsMaWindow]);

  const customPreviousDateRange = useMemo(
    () => previousEquivalentDateRange(parseDateToken(customStartDate), parseDateToken(customEndDate)),
    [customEndDate, customStartDate]
  );
  const customCurrentTxns = useMemo(() => {
    if (kpiTimeframe !== 'custom') return [];
    const startDate = parseDateToken(customStartDate);
    const endDate = parseDateToken(customEndDate);
    if (!startDate || !endDate || startDate > endDate) return [];
    return filteredTxns.filter((txn) => txn.date >= startDate && txn.date <= endDate);
  }, [customEndDate, customStartDate, filteredTxns, kpiTimeframe]);
  const customPreviousTxns = useMemo(() => {
    if (kpiTimeframe !== 'custom' || !customPreviousDateRange) return [];
    return filteredTxns.filter(
      (txn) => txn.date >= customPreviousDateRange.startDate && txn.date <= customPreviousDateRange.endDate
    );
  }, [customPreviousDateRange, filteredTxns, kpiTimeframe]);
  const customCurrentModel = useMemo(
    () =>
      kpiTimeframe === 'custom'
        ? computeDashboardModel(customCurrentTxns, {
            cashFlowMode: profitabilityCashFlowMode,
            anchorMonth: previousCalendarMonth ?? undefined,
            thisMonthAnchor: currentCalendarMonth,
            currentCashBalance,
          })
        : null,
    [currentCalendarMonth, currentCashBalance, customCurrentTxns, kpiTimeframe, previousCalendarMonth, profitabilityCashFlowMode]
  );
  const customPreviousModel = useMemo(
    () =>
      kpiTimeframe === 'custom'
        ? computeDashboardModel(customPreviousTxns, {
            cashFlowMode: profitabilityCashFlowMode,
            anchorMonth: previousCalendarMonth ?? undefined,
            thisMonthAnchor: currentCalendarMonth,
            currentCashBalance,
          })
        : null,
    [currentCalendarMonth, currentCashBalance, customPreviousTxns, kpiTimeframe, previousCalendarMonth, profitabilityCashFlowMode]
  );
  const selectedKpiComparison = useMemo<BigPictureKpiComparison | null>(() => {
    if (kpiTimeframe !== 'custom') {
      const comparison = model.kpiYoYComparisonByTimeframe[kpiTimeframe];
      return comparison
        ? {
            ...comparison,
            currentStartDate: null,
            currentEndDate: null,
            previousStartDate: null,
            previousEndDate: null,
          }
        : null;
    }

    const startDate = parseDateToken(customStartDate);
    const endDate = parseDateToken(customEndDate);
    if (!startDate || !endDate || startDate > endDate) return null;

    const currentSummary = customCurrentModel?.kpiAggregationByTimeframe.allDates;
    const previousSummary = customPreviousModel?.kpiAggregationByTimeframe.allDates;

    return {
      timeframe: 'ttm',
      currentStartMonth: currentSummary?.startMonth ?? startDate.slice(0, 7),
      currentEndMonth: currentSummary?.endMonth ?? endDate.slice(0, 7),
      previousStartMonth: previousSummary?.startMonth ?? customPreviousDateRange?.startDate.slice(0, 7) ?? null,
      previousEndMonth: previousSummary?.endMonth ?? customPreviousDateRange?.endDate.slice(0, 7) ?? null,
      currentMonthCount: currentSummary?.monthCount ?? 0,
      previousMonthCount: previousSummary?.monthCount ?? 0,
      revenue: compareMetric(
        currentSummary?.revenue ?? 0,
        previousSummary?.revenue ?? 0
      ),
      expenses: compareMetric(
        currentSummary?.expenses ?? 0,
        previousSummary?.expenses ?? 0
      ),
      netCashFlow: compareMetric(
        currentSummary?.netCashFlow ?? 0,
        previousSummary?.netCashFlow ?? 0
      ),
      savingsRate: compareMetric(
        currentSummary?.savingsRate ?? 0,
        previousSummary?.savingsRate ?? 0
      ),
      currentStartDate: startDate,
      currentEndDate: endDate,
      previousStartDate: customPreviousDateRange?.startDate ?? null,
      previousEndDate: customPreviousDateRange?.endDate ?? null,
    };
  }, [
    customCurrentModel,
    customEndDate,
    customPreviousDateRange,
    customPreviousModel,
    customStartDate,
    kpiTimeframe,
    model.kpiYoYComparisonByTimeframe,
  ]);
  const selectedHeaderComparisonLabel = useMemo(() => {
    if (kpiTimeframe !== 'custom') {
      return model.kpiYoYHeaderLabelByTimeframe[kpiTimeframe] ?? 'Comparison unavailable';
    }

    const startDate = parseDateToken(customStartDate);
    const endDate = parseDateToken(customEndDate);
    if (!startDate || !endDate || startDate > endDate) return 'Choose a valid custom date range';

    const currentRangeLabel = formatDateRangeLabel(startDate, endDate);
    if (!customPreviousDateRange) {
      return `${currentRangeLabel} · comparison unavailable`;
    }

    return `${currentRangeLabel} · vs ${formatDateRangeLabel(
      customPreviousDateRange.startDate,
      customPreviousDateRange.endDate
    )}`;
  }, [
    customEndDate,
    customPreviousDateRange,
    customStartDate,
    kpiTimeframe,
    model.kpiYoYHeaderLabelByTimeframe,
  ]);
  const selectedKpiFrameLabel = BIG_PICTURE_FRAME_OPTIONS.find((option) => option.value === kpiTimeframe)?.label ?? '12M';
  const digHerePresetComparisons = useMemo(() => {
    const monthlyRollups = computeMonthlyRollups(baseTxns, profitabilityCashFlowMode);
    return computeKpiComparisons(monthlyRollups, previousCalendarMonth ?? undefined, currentCalendarMonth);
  }, [baseTxns, currentCalendarMonth, previousCalendarMonth, profitabilityCashFlowMode]);

  const defaultDigHereRange = useMemo(() => {
    const ttm = digHerePresetComparisons.ttm;
    return {
      startMonth: ttm?.currentStartMonth ?? null,
      endMonth: ttm?.currentEndMonth ?? null,
    };
  }, [digHerePresetComparisons]);

  const activeDigHereMonth = digHereFocusMonth;
  const activeDigHereStartMonth =
    !digHereFocusMonth && activeTab === 'where-to-focus'
      ? digHereStartMonth ?? defaultDigHereRange.startMonth
      : digHereStartMonth;
  const activeDigHereEndMonth =
    !digHereFocusMonth && activeTab === 'where-to-focus'
      ? digHereEndMonth ?? defaultDigHereRange.endMonth
      : digHereEndMonth;

  const selectedDigHerePeriod = useMemo<DigHerePeriodValue>(() => {
    if (activeDigHereMonth) {
      return 'thisMonth';
    }

    if (!activeDigHereStartMonth || !activeDigHereEndMonth) {
      return 'ttm';
    }

    const standardPeriods: KpiComparisonTimeframe[] = [
      'last3Months',
      'ytd',
      'ttm',
      'last24Months',
      'last36Months',
    ];

    for (const period of standardPeriods) {
      const comparison = digHerePresetComparisons[period];
      if (
        sameMonthRange(
          activeDigHereStartMonth,
          activeDigHereEndMonth,
          comparison?.currentStartMonth ?? null,
          comparison?.currentEndMonth ?? null
        )
      ) {
        return period;
      }
    }

    return 'custom';
  }, [activeDigHereEndMonth, activeDigHereMonth, activeDigHereStartMonth, digHerePresetComparisons]);

  const digHereCurrentTxns = useMemo(() => {
    if (activeDigHereStartMonth && activeDigHereEndMonth) {
      return filteredTxns.filter((txn) => txn.month >= activeDigHereStartMonth && txn.month <= activeDigHereEndMonth);
    }
    if (!activeDigHereMonth) return filteredTxns;
    return filteredTxns.filter((txn) => txn.month === activeDigHereMonth);
  }, [activeDigHereEndMonth, activeDigHereMonth, activeDigHereStartMonth, filteredTxns]);

  const digHerePreviousTxns = useMemo(() => {
    if (activeDigHereStartMonth && activeDigHereEndMonth) {
      const previousRange = previousEquivalentRange(activeDigHereStartMonth, activeDigHereEndMonth);
      if (!previousRange) return [];
      return filteredTxns.filter(
        (txn) => txn.month >= previousRange.startMonth && txn.month <= previousRange.endMonth
      );
    }
    if (!activeDigHereMonth) return [];
    const previousMonth = previousMonthToken(activeDigHereMonth);
    if (!previousMonth) return [];
    return filteredTxns.filter((txn) => txn.month === previousMonth);
  }, [activeDigHereEndMonth, activeDigHereMonth, activeDigHereStartMonth, filteredTxns]);

  const digHereInsights = useMemo(
    () =>
      computeDigHereInsights(
        digHereCurrentTxns,
        digHerePreviousTxns,
        profitabilityCashFlowMode,
        filteredTxns,
        digHereMoverGrouping
      ),
    [digHereCurrentTxns, digHereMoverGrouping, digHerePreviousTxns, filteredTxns, profitabilityCashFlowMode]
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
        const caseModel = computeDashboardModel(txnsForCase, {
          cashFlowMode: caseCashFlowMode,
          currentCashBalance,
        });
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

    const oppositeCashFlowMode: CashFlowMode = netCashFlowChartMode === 'operating' ? 'total' : 'operating';
    const edgeCaseRows = [
      runEdgeCase('Short history (1 month)', filteredTxns.slice(-1), profitabilityCashFlowMode),
      runEdgeCase('Short history (2 months)', filteredTxns.slice(-2), profitabilityCashFlowMode),
      runEdgeCase('All dates window', filteredTxns, profitabilityCashFlowMode),
      {
        case: 'Rapid timeframe switch simulation',
        status: 'ok',
        simulatedTimeframes: TREND_TIMEFRAMES.map((item) => (item === 'all' ? 'all' : `${item}m`)).join(', '),
      },
      runEdgeCase('Search filter applied (live state)', filteredTxns, profitabilityCashFlowMode),
      runEdgeCase(`Chart Cash Flow toggled (${oppositeCashFlowMode})`, filteredTxns, oppositeCashFlowMode),
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
      profitabilityCashFlowMode,
      netCashFlowChartMode,
      searchQuery: query,
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
    const recentActualForecastRows = model.cashFlowForecastSeries
      .filter((row) => row.status === 'actual')
      .slice(-3);
    const initialProjectedForecastRows = model.cashFlowForecastSeries
      .filter((row) => row.status === 'projected')
      .slice(0, 3);
    console.info('Future Cash Flow Forecast Verification', {
      totalRows: model.cashFlowForecastSeries.length,
      actualRows: model.cashFlowForecastSeries.filter((row) => row.status === 'actual').length,
      projectedRows: model.cashFlowForecastSeries.filter((row) => row.status === 'projected').length,
    });
    console.info('Future Cash Flow Forecast Model Notes', model.cashFlowForecastModelNotes);
    console.table([...recentActualForecastRows, ...initialProjectedForecastRows]);
    console.info('Capital Distribution Match (current filtered scope)', {
      matchedRows: matchedCapitalDistribution.length,
      matchedExpenseTotal,
    });

    const sanity = runDataSanityChecks(filteredTxns, model.monthlyRollups, profitabilityCashFlowMode);
    const sanityLog = sanity.verdict === 'OK' ? console.info : console.error;
    sanityLog(`[Data Sanity] ${sanity.verdict} — ${sanity.passCount} passed, ${sanity.failCount} failed`);
    console.table(sanity.checks.map((c) => ({
      id: c.id,
      severity: c.severity,
      passed: c.passed ? '✓' : '✗',
      message: c.message,
    })));
    if (sanity.checks.some((c) => !c.passed && c.detail)) {
      sanity.checks.filter((c) => !c.passed && c.detail).forEach((c) => {
        console.warn(`[Data Sanity] ${c.id}:\n${c.detail}`);
      });
    }
    console.groupEnd();
  }, [
    filteredTxns,
    model.cashFlowForecastModelNotes,
    model.cashFlowForecastSeries,
    model.monthlyRollups,
    model.trend,
    netCashFlowChartMode,
    profitabilityCashFlowMode,
    query,
  ]);

  useEffect(() => {
    setMobileOpen(false);
  }, [activeTab, setMobileOpen]);

  const forecastRangeMonths = useMemo(
    () => FORECAST_RANGE_OPTIONS.find((option) => option.value === forecastRange)?.months ?? 3,
    [forecastRange]
  );

  // Phase 5.1 — RenewalContract mutation handlers. Wired here for
  // Branch 5 to consume; no UI binds them in Branch 4. Each handler
  // mirrors the load-time pattern: update local mirror, persist the
  // contract, regenerate this contract's renewal events, then refetch
  // the unified forecast_events list so the overlay sees the change.
  //
  // Refetch (not local merge) is the canonical path. It costs slightly
  // more network than a local merge would, but it's the only path that
  // respects the source-aware delete scoping in saveSharedRenewalEvents
  // and the operator-override survival rules in Branch 2 — without
  // re-implementing them here.
  //
  // Horizon is read at handler-fire time (not pinned). Initial-load
  // pins for stability; mutations are operator-driven and should use
  // the live horizon.
  //
  // Known limitation (Branch 5 to address): handleDeleteRenewalContract
  // calls saveSharedRenewalEvents(contractId, []) which only deletes
  // is_override = false rows. Operator-overridden renewal rows survive
  // contract deletion as orphaned forecast_events with a now-dangling
  // contract_id. This is intentional — the operator's edit is a
  // product decision the system should not silently undo — but the
  // operator-facing UI in Branch 5 needs to surface and clean these.
  // (Defined here, after forecastRangeMonths, because the handler
  // useCallback dep arrays reference it.)
  const refetchForecastEvents = useCallback(async () => {
    try {
      const events = await getSharedForecastEvents();
      if (events !== null) setForecastEvents(events);
    } catch (err) {
      console.warn('[forecast-events] Refetch after mutation failed:', err);
    }
  }, []);

  const handleCreateRenewalContract = useCallback(
    async (contract: RenewalContract) => {
      setForecastContracts((prev) => [...prev, contract]);
      try {
        await saveSharedRenewalContract(contract);
        const events = generateRenewalEvents(contract, forecastRangeMonths, new Date());
        await saveSharedRenewalEvents(contract.id, events);
      } catch (err) {
        console.warn(`[renewal-contracts] Create failed for ${contract.id}:`, err);
      }
      await refetchForecastEvents();
    },
    [forecastRangeMonths, refetchForecastEvents]
  );

  const handleUpdateRenewalContract = useCallback(
    async (contract: RenewalContract) => {
      setForecastContracts((prev) => prev.map((c) => (c.id === contract.id ? contract : c)));
      try {
        await saveSharedRenewalContract(contract);
        const events = generateRenewalEvents(contract, forecastRangeMonths, new Date());
        await saveSharedRenewalEvents(contract.id, events);
      } catch (err) {
        console.warn(`[renewal-contracts] Update failed for ${contract.id}:`, err);
      }
      await refetchForecastEvents();
    },
    [forecastRangeMonths, refetchForecastEvents]
  );

  const handleDeleteRenewalContract = useCallback(
    async (contractId: string) => {
      setForecastContracts((prev) => prev.filter((c) => c.id !== contractId));
      try {
        await deleteSharedRenewalContract(contractId);
        // Clears non-overridden renewal rows for this contract.
        // Overrides survive (see comment block above).
        await saveSharedRenewalEvents(contractId, []);
      } catch (err) {
        console.warn(`[renewal-contracts] Delete failed for ${contractId}:`, err);
      }
      await refetchForecastEvents();
    },
    [refetchForecastEvents]
  );

  // Re-expand monthly/yearly manual recurring events to the current horizon
  // so growing the forecast window picks up additional occurrences that
  // weren't pre-generated at the time the event was created. Storage stays
  // sparse; this is a view-time fan-out only.
  const expandedForecastEvents = useMemo(
    () => expandRecurringEvents(forecastEvents, forecastRangeMonths),
    [forecastEvents, forecastRangeMonths]
  );

  const forecastProjection = useMemo(
    () => {
      const fcT0 = performance.now();
      const scenarioWithMonths = {
        ...scenarioInput,
        months: Math.max(scenarioInput.months, forecastRangeMonths),
      };
      // Both Engine and Cadence projections are computed as composer inputs.
      // Known Events are intentionally excluded from composer inputs (events=[])
      // — see composeSplitConservative / composeConservativeFloor policy notes
      // for the symmetric one-sided-event rationale.
      //
      // Cadence is hardcoded to a 12-month horizon (HORIZON_MONTHS in
      // categoryCadence.ts); composers throw on length mismatch by design
      // ("Caller responsibility to handle horizons beyond Cadence's reach").
      // Compose at 12 months and, for selectors longer than 12 months,
      // extend at the caller layer (see below). Composer files are unchanged.
      const COMPOSER_MONTHS_CAP = 12;
      const composerInput = {
        ...scenarioWithMonths,
        months: Math.min(scenarioWithMonths.months, COMPOSER_MONTHS_CAP),
      };
      const engineProj = projectScenario(
        model,
        composerInput,
        forecastCurrentCashBalance,
        []
      );
      const cadenceProj = projectCategoryCadenceScenario(
        model,
        composerInput,
        filteredTxns,
        forecastCurrentCashBalance,
        []
      );
      // Reality (default) → Conservative Floor; Recovery → Split Conservative.
      // Defensive fallback: any unexpected posture value routes to Reality.
      const composed =
        businessRules.forecastPosture === 'recovery'
          ? composeSplitConservative(engineProj, cadenceProj, forecastCurrentCashBalance)
          : composeConservativeFloor(engineProj, cadenceProj, forecastCurrentCashBalance);

      // 2Y/3Y horizons extend the 12-month composed historical-pattern
      // forecast by repeating the monthly pattern (flat, month-of-year
      // aligned) and walking the running balance forward. Composer
      // inputs remain capped at 12 months because Cadence does not
      // extrapolate beyond its window. This is the caller-layer
      // extension policy locked in 2c.1.
      const requestedMonths = scenarioWithMonths.months;
      let result = composed;
      if (requestedMonths > composed.points.length && composed.points.length > 0) {
        // Build month-of-year lookup ("01"–"12") from composed Year 1.
        const sourceByMonthOfYear = new Map<string, ScenarioPoint>();
        for (const p of composed.points) {
          const moy = p.month.slice(5, 7);
          if (!sourceByMonthOfYear.has(moy)) sourceByMonthOfYear.set(moy, p);
        }
        const firstMonth = composed.points[0].month;
        const extended: ScenarioPoint[] = [];
        let prevBalance = forecastCurrentCashBalance;
        for (let i = 0; i < requestedMonths; i += 1) {
          if (i < composed.points.length) {
            const p = composed.points[i];
            extended.push(p);
            prevBalance = p.endingCashBalance;
            continue;
          }
          const monthToken = addMonthsToToken(firstMonth, i) ?? composed.points[i % composed.points.length].month;
          const sourceMoy = monthToken.slice(5, 7);
          const source = sourceByMonthOfYear.get(sourceMoy);
          if (!source) {
            // Defensive: should not happen because Year 1 always covers all 12 month-of-year keys
            // when composed.points.length === 12. Skip extension if it does.
            break;
          }
          const endingCashBalance = prevBalance + source.netCashFlow;
          extended.push({
            month: monthToken,
            operatingCashIn: source.operatingCashIn,
            operatingCashOut: source.operatingCashOut,
            cashIn: source.cashIn,
            cashOut: source.cashOut,
            netCashFlow: source.netCashFlow,
            endingCashBalance,
          });
          prevBalance = endingCashBalance;
        }
        result = { points: extended, seasonality: composed.seasonality };
      }
      // Post-composition Known Events overlay. Engine, Cadence, Reality
      // composer, and Recovery composer remain event-free; the overlay
      // sits OUTSIDE all of them and applies once to the final
      // posture-aware horizon. When forecastEvents is empty, the helper
      // returns its input unchanged so math is byte-for-byte identical.
      result = { points: applyEventsOverlay(result.points, expandedForecastEvents), seasonality: result.seasonality };
      if (import.meta.env.DEV && !bootPhaseLoggedRef.current.forecast && model.monthlyRollups.length > 0) {
        bootPhaseLoggedRef.current.forecast = true;
        console.log('[BOOT] Forecast compute:', Math.round(performance.now() - fcT0), 'ms');
      }
      return result;
    },
    [filteredTxns, forecastCurrentCashBalance, businessRules.forecastPosture, expandedForecastEvents, forecastRangeMonths, model, scenarioInput]
  );
  const scenarioProjection = useMemo(() => forecastProjection.points, [forecastProjection.points]);
  const forecastSeasonality = useMemo(() => forecastProjection.seasonality, [forecastProjection.seasonality]);
  const visibleScenarioProjection = useMemo(
    () => scenarioProjection.slice(0, forecastRangeMonths),
    [forecastRangeMonths, scenarioProjection]
  );
  const forecastDecisionSignals = useMemo(
    () => computeForecastDecisionSignals(scenarioProjection, model.runway.reserveTarget),
    [model.runway.reserveTarget, scenarioProjection]
  );
  const cashFlowForecastTrend = useMemo<TrendPoint[]>(
    () =>
      visibleScenarioProjection.map((point) => ({
        month: point.month,
        income: point.cashIn,
        expense: point.cashOut,
        net: point.netCashFlow,
      })),
    [visibleScenarioProjection]
  );
  const currentForecastYear = new Date().getFullYear();
  const priorYearActuals = useMemo(
    () => computePriorYearActuals(baseTxns, currentForecastYear),
    [baseTxns, currentForecastYear]
  );
  const [projectionActiveYears, setProjectionActiveYears] = useState<number[]>([]);
  const [compareDrawerYear, setCompareDrawerYear] = useState<number | null>(null);

  // Phase 4.11b: pill set = default 3 + any active years injected outside the default 3
  const pillYears = useMemo(() => {
    const defaultYears = [...priorYearActuals.detectedYears]
      .filter(y => y < currentForecastYear)
      .sort((a, b) => b - a)
      .slice(0, 3);
    const injected = projectionActiveYears.filter(
      y => y < currentForecastYear && !defaultYears.includes(y)
    );
    return [...new Set([...injected, ...defaultYears])].sort((a, b) => b - a);
  }, [priorYearActuals.detectedYears, currentForecastYear, projectionActiveYears]);

  const latestRollup = model.monthlyRollups[model.monthlyRollups.length - 1] ?? null;
  const previousRollup = model.monthlyRollups[model.monthlyRollups.length - 2] ?? null;
  const selectedBigPictureTitle = useMemo(() => {
    if (kpiTimeframe === 'custom') return 'Custom Range';
    if (kpiTimeframe === 'thisMonth') return toMonthLabel(currentCalendarMonth);
    if (kpiTimeframe === 'lastMonth' && previousCalendarMonth) return toMonthLabel(previousCalendarMonth);
    return BIG_PICTURE_FRAME_OPTIONS.find((option) => option.value === kpiTimeframe)?.label ?? 'Big Picture';
  }, [currentCalendarMonth, kpiTimeframe, previousCalendarMonth]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const timeframeTabLabels = BIG_PICTURE_FRAME_OPTIONS.map((option) => option.label);
    const labelsToCheck = [
      ...timeframeTabLabels,
      ...Object.values(model.kpiHeaderLabelByTimeframe),
      selectedHeaderComparisonLabel,
      `${selectedKpiFrameLabel} comparison`,
    ];
    const containsTTM = labelsToCheck.some((label) => /\bTTM\b/i.test(label));
    console.info('TTM label verification', { timeframeTabLabels, containsTTM });
  }, [model.kpiHeaderLabelByTimeframe, selectedHeaderComparisonLabel, selectedKpiFrameLabel]);

  const digHereHeaderLabel = useMemo(() => {
    if (selectedDigHerePeriod === 'thisMonth' && activeDigHereMonth) {
      const previousMonth = previousMonthToken(activeDigHereMonth);
      return previousMonth
        ? `${toMonthLabel(activeDigHereMonth)} · vs ${toMonthLabel(previousMonth)}`
        : `${toMonthLabel(activeDigHereMonth)} · comparison unavailable`;
    }

    const previousRange = previousEquivalentRange(activeDigHereStartMonth, activeDigHereEndMonth);
    if (
      activeDigHereStartMonth &&
      activeDigHereEndMonth &&
      previousRange &&
      (digHereFocusContext === 'category-shifts' || digHereFocusContext === 'custom-period')
    ) {
      const currentRange =
        activeDigHereStartMonth === activeDigHereEndMonth
          ? toMonthLabel(activeDigHereStartMonth)
          : `${toMonthLabel(activeDigHereStartMonth)} – ${toMonthLabel(activeDigHereEndMonth)}`;
      const previousRangeLabel =
        previousRange.startMonth === previousRange.endMonth
          ? toMonthLabel(previousRange.startMonth)
          : `${toMonthLabel(previousRange.startMonth)} – ${toMonthLabel(previousRange.endMonth)}`;
      return `${currentRange} · vs ${previousRangeLabel}`;
    }

    if (selectedDigHerePeriod !== 'custom' && selectedDigHerePeriod !== 'thisMonth') {
      const comparison = digHerePresetComparisons[selectedDigHerePeriod];
      const currentStartMonth = comparison?.currentStartMonth ?? null;
      const currentEndMonth = comparison?.currentEndMonth ?? null;
      const previousStartMonth = comparison?.previousStartMonth ?? null;
      const previousEndMonth = comparison?.previousEndMonth ?? null;

      if (selectedDigHerePeriod === 'ytd') {
        if (currentEndMonth && previousEndMonth) {
          return `YTD through ${toMonthLabel(currentEndMonth)} · vs YTD through ${toMonthLabel(previousEndMonth)}`;
        }
        if (currentEndMonth) {
          return `YTD through ${toMonthLabel(currentEndMonth)} · comparison unavailable`;
        }
        return 'YTD · comparison unavailable';
      }

      if (selectedDigHerePeriod === 'ttm') {
        if (currentEndMonth) {
          return `Last 12 Months through ${toMonthLabel(currentEndMonth)} vs prior 12 Months`;
        }
        return 'Last 12 Months vs prior period';
      }

      if (currentStartMonth && currentEndMonth && previousStartMonth && previousEndMonth) {
        const currentRange =
          currentStartMonth === currentEndMonth
            ? toMonthLabel(currentStartMonth)
            : `${toMonthLabel(currentStartMonth)} – ${toMonthLabel(currentEndMonth)}`;
        const previousRangeLabel =
          previousStartMonth === previousEndMonth
            ? toMonthLabel(previousStartMonth)
            : `${toMonthLabel(previousStartMonth)} – ${toMonthLabel(previousEndMonth)}`;
        return `${currentRange} · vs ${previousRangeLabel}`;
      }

      if (currentStartMonth && currentEndMonth) {
        const currentRange =
          currentStartMonth === currentEndMonth
            ? toMonthLabel(currentStartMonth)
            : `${toMonthLabel(currentStartMonth)} – ${toMonthLabel(currentEndMonth)}`;
        return `${currentRange} · comparison unavailable`;
      }

      return 'Comparison unavailable';
    }

    if (activeDigHereStartMonth && activeDigHereEndMonth && previousRange) {
      const currentRange =
        activeDigHereStartMonth === activeDigHereEndMonth
          ? toMonthLabel(activeDigHereStartMonth)
          : `${toMonthLabel(activeDigHereStartMonth)} – ${toMonthLabel(activeDigHereEndMonth)}`;
      const previousRangeLabel =
        previousRange.startMonth === previousRange.endMonth
          ? toMonthLabel(previousRange.startMonth)
          : `${toMonthLabel(previousRange.startMonth)} – ${toMonthLabel(previousRange.endMonth)}`;
      return `${currentRange} · vs ${previousRangeLabel}`;
    }

    return 'Last 12 Months vs prior period';
  }, [
    activeDigHereEndMonth,
    activeDigHereMonth,
    activeDigHereStartMonth,
    digHereFocusContext,
    digHerePresetComparisons,
    selectedDigHerePeriod,
  ]);

  const whatNeedsAttention = useMemo(
    () => computeWhatNeedsAttention(filteredTxns),
    [filteredTxns]
  );
  const cashTrendResult = useMemo(
    () => computeCashTrend(model.monthlyRollups),
    [model.monthlyRollups]
  );

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
      metricToCard('savingsRate', 'Profit Margin', selectedKpiComparison.savingsRate),
    ];
  }, [selectedKpiComparison, model.kpiCards]);

  const kpiExpenseBreakdown = useMemo(() => {
    const startMonth = selectedKpiComparison?.currentStartMonth;
    const endMonth = selectedKpiComparison?.currentEndMonth;
    if (!startMonth || !endMonth) {
      return computeExpenseSlices([], profitabilityCashFlowMode);
    }
    const periodTxns = filteredTxns.filter((txn) => txn.month >= startMonth && txn.month <= endMonth);
    return computeExpenseSlices(periodTxns, profitabilityCashFlowMode);
  }, [selectedKpiComparison, filteredTxns, profitabilityCashFlowMode]);

  const kpiVsLabel = useMemo<string>(() => {
    const labels: Record<BigPictureFrameValue, string> = {
      thisMonth:    'vs same month last year',
      lastMonth:    'vs same month last year',
      last3Months:  'vs same 3 months last year',
      ytd:          'vs prior YTD',
      ttm:          'vs prior 12 months',
      last24Months: 'vs prior 24 months',
      last36Months: 'vs prior 36 months',
      allDates:     'vs prior period',
      custom:       'vs prior period',
    };
    return labels[kpiTimeframe];
  }, [kpiTimeframe]);


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


  useEffect(() => {
    if (!isMonthPickerOpen) return;

    const preferredMonth = activeDigHereMonth ?? availableMonths[0] ?? '';
    const preferredStart =
      activeDigHereStartMonth ??
      availableMonths[availableMonths.length - 1] ??
      availableMonths[0] ??
      '';
    const preferredEnd = activeDigHereEndMonth ?? preferredMonth;

    setMonthPickerDraftMonth(preferredMonth);
    setMonthPickerDraftStart(preferredStart);
    setMonthPickerDraftEnd(preferredEnd);
    if (activeDigHereStartMonth && activeDigHereEndMonth) {
      setMonthPickerMode('period');
    }
  }, [activeDigHereEndMonth, activeDigHereMonth, activeDigHereStartMonth, availableMonths, isMonthPickerOpen]);

  useEffect(() => {
    if (!isMonthPickerOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!monthPickerRef.current?.contains(event.target as Node)) {
        setIsMonthPickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMonthPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMonthPickerOpen]);

  useEffect(() => {
    if (!isBigPictureFilterOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const inMenu = bigPictureFilterMenuRef.current?.contains(event.target as Node);
      if (!inMenu) {
        setIsBigPictureFilterOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBigPictureFilterOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isBigPictureFilterOpen]);

  const writeDashboardUrlState = useCallback(
    (
      next: {
        tab: TabId;
        cashFlow: CashFlowMode;
        queryText?: string;
        month?: string | null;
        startMonth?: string | null;
        endMonth?: string | null;
        focusContext?: DigHereFocusContext;
        moverGrouping?: MoverGrouping;
      },
      mode: 'push' | 'replace' = 'push'
    ) => {
      const params = new URLSearchParams();
      if (next.cashFlow !== 'operating') params.set('cf', next.cashFlow);
      if (next.queryText?.trim()) params.set('q', next.queryText.trim());
      if (next.month) params.set('month', next.month);
      if (next.startMonth) params.set('start', next.startMonth);
      if (next.endMonth) params.set('end', next.endMonth);
      if (next.focusContext) params.set('focus', next.focusContext);
      if (next.moverGrouping && next.moverGrouping !== 'subcategories') {
        params.set('mg', next.moverGrouping);
      }

      const path = TAB_TO_PATH[next.tab] ?? '/';
      const searchString = params.toString();
      const search = searchString ? `?${searchString}` : '';
      navigate({ pathname: path, search }, { replace: mode === 'replace' });
    },
    [navigate]
  );

  const navigateToTab = useCallback(
    (nextTab: TabId) => {
      setMobileOpen(false);

      const isFreshDigHereEntry = nextTab === 'where-to-focus';

      setDigHereFocusMonth(isFreshDigHereEntry ? null : digHereFocusMonth);
      setDigHereStartMonth(isFreshDigHereEntry ? null : digHereStartMonth);
      setDigHereEndMonth(isFreshDigHereEntry ? null : digHereEndMonth);
      setDigHereFocusContext(isFreshDigHereEntry ? null : digHereFocusContext);

      writeDashboardUrlState({
        tab: nextTab,
        cashFlow: netCashFlowChartMode,
        queryText: query,
        month: null,
        startMonth: null,
        endMonth: null,
        focusContext: null,
        moverGrouping: digHereMoverGrouping,
      });
    },
    [
      netCashFlowChartMode,
      digHereEndMonth,
      digHereFocusContext,
      digHereFocusMonth,
      digHereStartMonth,
      digHereMoverGrouping,
      query,
      writeDashboardUrlState,
    ]
  );

  const navigateToDigHere = useCallback(
    (options?: DigHereNavigationOptions) => {
      const nextQuery = options?.category?.trim() ?? query.trim();
      const hasCustomRange = Boolean(
        options?.startMonth &&
          options?.endMonth &&
          options.startMonth <= options.endMonth
      );
      const focusMonth = hasCustomRange
        ? null
        : options?.month ??
          selectedKpiComparison?.currentEndMonth ??
          model.latestMonth ??
          null;
      const startMonth = hasCustomRange ? options?.startMonth ?? null : null;
      const endMonth = hasCustomRange ? options?.endMonth ?? null : null;
      const focusContext =
        options?.focusContext ?? (hasCustomRange ? 'custom-period' : 'category-shifts');

      writeDashboardUrlState(
        {
          tab: activeTab,
          cashFlow: netCashFlowChartMode,
          queryText: query,
          month: digHereFocusMonth,
          startMonth: digHereStartMonth,
          endMonth: digHereEndMonth,
          focusContext: digHereFocusContext,
          moverGrouping: digHereMoverGrouping,
        },
        'replace'
      );

      setQuery(nextQuery);
      setDigHereFocusMonth(focusMonth);
      setDigHereStartMonth(startMonth);
      setDigHereEndMonth(endMonth);
      setDigHereFocusContext(focusContext);

      writeDashboardUrlState({
        tab: 'where-to-focus',
        cashFlow: netCashFlowChartMode,
        queryText: nextQuery,
        month: focusMonth,
        startMonth,
        endMonth,
        focusContext,
        moverGrouping: digHereMoverGrouping,
      });
    },
    [
      activeTab,
      netCashFlowChartMode,
      digHereFocusContext,
      digHereEndMonth,
      digHereFocusMonth,
      digHereStartMonth,
      model.latestMonth,
      digHereMoverGrouping,
      query,
      selectedKpiComparison?.currentEndMonth,
      writeDashboardUrlState,
    ]
  );

  const resetDigHereFocus = useCallback(() => {
    setDigHereFocusMonth(null);
    setDigHereStartMonth(null);
    setDigHereEndMonth(null);
    setDigHereFocusContext(null);
    writeDashboardUrlState({
      tab: 'where-to-focus',
      cashFlow: netCashFlowChartMode,
      month: null,
      startMonth: null,
      endMonth: null,
      focusContext: null,
      moverGrouping: digHereMoverGrouping,
    });
  }, [digHereMoverGrouping, netCashFlowChartMode, writeDashboardUrlState]);

  const applyDigHerePeriod = useCallback(
    (period: DigHerePeriodValue) => {
      if (period === 'custom') {
        setIsMonthPickerOpen((current) => !current);
        return;
      }

      if (period === 'thisMonth') {
        const month = model.kpiComparisonByTimeframe.thisMonth.currentEndMonth ?? model.latestMonth ?? null;
        if (!month) return;
        navigateToDigHere({
          month,
          focusContext: 'period-control',
        });
        setIsMonthPickerOpen(false);
        return;
      }

      const comparison = model.kpiComparisonByTimeframe[period];
      const startMonth = comparison?.currentStartMonth ?? null;
      const endMonth = comparison?.currentEndMonth ?? null;
      if (!startMonth || !endMonth) return;

      navigateToDigHere({
        startMonth,
        endMonth,
        focusContext: 'period-control',
      });
      setIsMonthPickerOpen(false);
    },
    [model.kpiComparisonByTimeframe, model.latestMonth, navigateToDigHere]
  );

  const applyMonthChoice = useCallback(() => {
    if (!monthPickerDraftMonth) return;
    navigateToDigHere({
      month: monthPickerDraftMonth,
      focusContext: 'period-control',
    });
    setIsMonthPickerOpen(false);
  }, [monthPickerDraftMonth, navigateToDigHere]);

  const applyPeriodChoice = useCallback(() => {
    if (!monthPickerDraftStart || !monthPickerDraftEnd) return;
    const startMonth =
      monthPickerDraftStart <= monthPickerDraftEnd
        ? monthPickerDraftStart
        : monthPickerDraftEnd;
    const endMonth =
      monthPickerDraftStart <= monthPickerDraftEnd
        ? monthPickerDraftEnd
        : monthPickerDraftStart;

    navigateToDigHere({
      startMonth,
      endMonth,
      focusContext: 'custom-period',
    });
    setIsMonthPickerOpen(false);
  }, [monthPickerDraftEnd, monthPickerDraftStart, navigateToDigHere]);

  const handleDigHereMoverGroupingChange = useCallback(
    (nextGrouping: MoverGrouping) => {
      setDigHereMoverGrouping(nextGrouping);
      writeDashboardUrlState(
        {
          tab: 'where-to-focus',
          cashFlow: netCashFlowChartMode,
          queryText: query,
          month: digHereFocusMonth,
          startMonth: digHereStartMonth,
          endMonth: digHereEndMonth,
          focusContext: digHereFocusContext,
          moverGrouping: nextGrouping,
        },
        'push'
      );
    },
    [
      netCashFlowChartMode,
      digHereEndMonth,
      digHereFocusContext,
      digHereFocusMonth,
      digHereStartMonth,
      query,
      writeDashboardUrlState,
    ]
  );

  const handleImportCsvSelection = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      setImportLoading(true);
      setImportError(null);
      try {
        const summary = await importQuickenReportCsv(file);
        setLastImportSummary(summary);
        await loadImportedState();
      } catch (importCsvError) {
        const message = importCsvError instanceof Error ? importCsvError.message : 'Could not import CSV file.';
        setImportError(message);
      } finally {
        setImportLoading(false);
      }
    },
    [loadImportedState]
  );

  const handleClearImportedData = useCallback(async () => {
    setImportLoading(true);
    setImportError(null);
    preserveAccountSettingsOnImportClearRef.current = true;

    try {
      const preservedAccountRecords = accountRecords;
      await clearImportedTransactions();
      setImportedDataSet(null);
      setLastImportSummary(null);
      setStoredImportedTransactionCount(0);
      await loadImportedState();
      setAccountRecords(preservedAccountRecords);
    } catch (clearError) {
      preserveAccountSettingsOnImportClearRef.current = false;
      const message = clearError instanceof Error ? clearError.message : 'Could not clear imported transactions.';
      setImportError(message);
    } finally {
      setImportLoading(false);
    }
  }, [accountRecords, loadImportedState]);

  const handleAccountRecordChange = useCallback(
    <K extends keyof Pick<AccountRecord, 'accountName' | 'accountType' | 'startingBalance' | 'includeInCashForecast' | 'active'>>(
      accountId: string,
      field: K,
      value: AccountRecord[K]
    ) => {
      if (sharedPersistenceEnabled) {
        sharedAccountSettingsSyncArmedRef.current = true;
      }
      // Reset non-cash acknowledgement when forecast inclusion is disabled or account type changes to Cash.
      if (
        (field === 'includeInCashForecast' && value === false) ||
        (field === 'accountType' && value === 'Cash')
      ) {
        setBusinessRules((prev) => {
          const next = {
            ...prev,
            acknowledgedNoncashAccounts: prev.acknowledgedNoncashAccounts.filter((id) => id !== accountId),
          };
          void saveSharedWorkspaceSettings(next);
          return next;
        });
      }
      setAccountRecords((previous) =>
        previous.map((record) =>
          record.id === accountId
            ? {
                ...record,
                [field]: value,
                isUserConfigured: true,
              }
            : record
        )
      );
    },
    [sharedPersistenceEnabled]
  );

  const importDescription = sharedPersistenceEnabled
    ? 'Import Quicken-style report CSVs into shared storage. Each shared import replaces the current shared dataset and becomes the only active analysis source.'
    : 'Import Quicken-style report CSVs directly into browser-local storage. Imported transactions are the only active analysis source.';
  const clearImportedDataLabel = sharedPersistenceEnabled ? 'Clear shared imported data' : 'Clear local imported data';
  const sourcePrecedenceLabel = sharedPersistenceEnabled ? 'Shared imported dataset only' : 'Browser-local imported dataset only';
  const importedSourceStatus = importedDataSet
    ? lastImportSummary?.storageScope === 'shared'
      ? 'Yes, shared imported transactions are driving analysis.'
      : 'Yes, browser-local imported transactions are driving analysis.'
    : sharedPersistenceEnabled
      ? 'No shared imported dataset is available. Import a Quicken CSV to begin.'
      : 'No browser-local imported dataset is available. Import a Quicken CSV to begin.';
  const importModeLabel = lastImportSummary?.importMode === 'replace-all' ? 'Replace-all shared dataset' : 'Append to local dataset';
  // Render-time fallback chain for Settings example arrays.
  // Local mode: read directly from lastImportSummary (IndexedDB carries them).
  // Shared mode: use lazy-fetched importExamples only when its importId
  // matches the current lastImportSummary; mismatched/null renders empty
  // until the lazy fetch completes — stale prior-batch data must never
  // render against new batch metadata.
  const renderedDuplicateExamples =
    lastImportSummary?.storageScope === 'local'
      ? (lastImportSummary.possibleDuplicateExamples ?? [])
      : importExamples?.importId === lastImportSummary?.importId
        ? importExamples?.possibleDuplicateExamples ?? []
        : [];
  const renderedParseFailureExamples =
    lastImportSummary?.storageScope === 'local'
      ? (lastImportSummary.parseFailureExamples ?? [])
      : importExamples?.importId === lastImportSummary?.importId
        ? importExamples?.parseFailureExamples ?? []
        : [];
  const accountSettingsSourceLabel = sharedPersistenceEnabled
    ? sharedAccountSettingsHasRemoteData
      ? 'Shared account settings'
      : 'No shared account settings saved yet; using in-memory/discovered defaults until an edit is synced.'
    : 'Browser-local account settings';

  if (showLoadingScreen) {
    return <LoadingScreen isFading={!isInitializing} />;
  }

  return (
    <div className="finance-app">
      <AppSidebar />
      <div className="app-main-column">
        <AppHeader
          query={query}
          onQueryChange={setQuery}
          updatedLabel={lastUpdatedLabel}
          onUpdatedClick={() => navigateToTab('settings')}
        />
      <section className="main-zone">
        {activeTab !== 'today' && activeTab !== 'what-if' && activeTab !== 'settings' && activeTab !== 'ui-lab' && <header className="top-bar glass-panel">
          <div className="top-bar-main">
            <div className="top-bar-copy">
              <h2>
                {activeTab === 'where-to-focus' ? 'Where to Focus' : selectedBigPictureTitle}
              </h2>
              <p className="top-bar-context">
                {activeTab === 'where-to-focus'
                  ? "The biggest opportunities to improve your cash right now — and what's driving them"
                  : selectedHeaderComparisonLabel}
              </p>
              <button
                type="button"
                className="top-bar-freshness subtle clickable top-bar-freshness-mobile"
                onClick={() => navigateToTab('settings')}
                aria-label={`${lastUpdatedLabel}. Open Settings.`}
              >
                <FiRefreshCw className="top-bar-freshness-icon" aria-hidden="true" />
                <span>{lastUpdatedLabel}</span>
              </button>
            </div>

            <div className="top-controls top-controls-timeframe">
              {activeTab === 'where-to-focus' ? null : activeTab === 'trends' ? (
                <div className="kpi-timeframe-control">
                  <div className="segmented-toggle" role="group" aria-label="Moving average window selector">
                    {TRENDS_MA_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`segmented-toggle-btn${trendsMaWindow === option.value ? ' is-active' : ''}`}
                        onClick={() => setTrendsMaWindow(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="kpi-timeframe-control">
                  <div className="segmented-toggle" role="group" aria-label="KPI timeframe selector">
                    {BIG_PICTURE_VISIBLE_FRAME_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`segmented-toggle-btn${kpiTimeframe === option.value ? ' is-active' : ''}`}
                        onClick={() => {
                          setKpiTimeframe(option.value);
                          setIsBigPictureFilterOpen(false);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                    <div className="timeframe-menu" ref={bigPictureFilterMenuRef}>
                      <button
                        type="button"
                        className="segmented-toggle-btn timeframe-trigger"
                        onClick={() => setIsBigPictureFilterOpen((current) => !current)}
                        aria-haspopup="menu"
                        aria-expanded={isBigPictureFilterOpen}
                      >
                        More ▾
                      </button>
                      {isBigPictureFilterOpen && (
                        <ul className="timeframe-list" role="menu" aria-label="Select Big Picture filter timeframe">
                          {BIG_PICTURE_FILTER_FRAME_OPTIONS.map((option) => (
                            <li key={option.value}>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={kpiTimeframe === option.value}
                                className={kpiTimeframe === option.value ? 'is-active' : ''}
                                onClick={() => {
                                  setKpiTimeframe(option.value);
                                  setIsBigPictureFilterOpen(false);
                                }}
                              >
                                {option.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  {kpiTimeframe === 'custom' && (
                    <div className="kpi-custom-range" aria-label="Custom Big Picture date range">
                      <label>
                        <span>Start</span>
                        <input
                          type="date"
                          value={customStartDate}
                          min={earliestAvailableDate || undefined}
                          max={latestAvailableDate || undefined}
                          onChange={(event) => {
                            const nextStart = event.target.value;
                            setCustomStartDate(nextStart);
                            if (customEndDate && nextStart > customEndDate) {
                              setCustomEndDate(nextStart);
                            }
                          }}
                        />
                      </label>
                      <label>
                        <span>End</span>
                        <input
                          type="date"
                          value={customEndDate}
                          min={customStartDate || earliestAvailableDate || undefined}
                          max={latestAvailableDate || undefined}
                          onChange={(event) => {
                            const nextEnd = event.target.value;
                            setCustomEndDate(nextEnd);
                            if (customStartDate && nextEnd < customStartDate) {
                              setCustomStartDate(nextEnd);
                            }
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>}

        {bootLoadError && (
          <div className="dashboard-load-error" role="alert">
            <div className="dashboard-load-error-body">
              <p className="dashboard-load-error-headline">Some recent activity may be missing.</p>
              <p className="dashboard-load-error-detail">
                The last data load didn't complete. Numbers below may be out of date.
              </p>
            </div>
            <button
              type="button"
              className="dashboard-load-error-cta"
              onClick={() => {
                setActiveSection('data');
                navigateToTab('settings');
              }}
            >
              Open Settings → Data
            </button>
          </div>
        )}

        {!hasImportedData && (
          <article className="card settings-card">
            <div className="card-head">
              <h3>Imported Transactions Required</h3>
            </div>
            <p className="empty-state">
              Import a Quicken CSV to begin.
            </p>
            <div className="settings-actions">
              <button type="button" onClick={() => importFileInputRef.current?.click()} disabled={importLoading}>
                {importLoading ? 'Importing...' : 'Import Quicken CSV'}
              </button>
              {activeTab !== 'settings' ? (
                <button type="button" className="ghost-btn" onClick={() => navigateToTab('settings')}>
                  Open Settings
                </button>
              ) : null}
            </div>
          </article>
        )}

        {hasImportedData && activeTab === 'today' && (
          <TodayPage
            model={model}
            txns={filteredTxns}
            forecastProjection={scenarioProjection}
            targetNetMargin={businessRules.targetNetMargin}
            onCompareYear={(year) => setCompareDrawerYear(year)}
          />
        )}

        {compareDrawerYear !== null && (
          <ProjectionCompareDrawer
            compareYear={compareDrawerYear}
            availableYears={priorYearActuals.years
              .map((y) => y.year)
              .filter((y) => y < currentForecastYear)
              .sort((a, b) => b - a)}
            onCompareYearChange={(year) => setCompareDrawerYear(year)}
            onClose={() => setCompareDrawerYear(null)}
            visibleScenarioProjection={scenarioProjection.slice(0, 12)}
            priorYearActuals={priorYearActuals}
            currentForecastYear={currentForecastYear}
            hasForecastCurrentCashBalance={hasForecastCurrentCashBalance}
            formatCurrency={formatCurrency}
            toMonthLabel={toMonthLabel}
          />
        )}

        {hasImportedData && activeTab === 'big-picture' && (
          <>
            <KpiCards cards={selectedKpiCards} vsLabel={kpiVsLabel} />
            <p className="data-trust-note">Excludes transfers &amp; financing · operating cash flow only</p>
            <NetCashFlowChart
              data={netCashFlowChartModel.trend}
              cashFlowMode={netCashFlowChartMode}
              timeframe={netChartTimeframe}
              onCashFlowModeChange={setNetCashFlowChartMode}
              onTimeframeChange={setNetChartTimeframe}
              onMonthPointClick={(month) =>
                navigateToDigHere({
                  month,
                  focusContext: 'month-drilldown',
                })
              }
            />

            <div className="cash-trend-row">
              <CashTrendHero result={cashTrendResult} negativeMonthsAsSubtitle />
              <CashTrendPlaceholder />
            </div>

            <DigHereHighlights result={whatNeedsAttention} />

            <div className="two-col-grid">
              <EfficiencyOpportunitiesCard result={efficiencyResult} />

              <TopCategoriesCard
                slices={kpiExpenseBreakdown.slices}
                total={kpiExpenseBreakdown.total}
                periodControl={
                  <PeriodDropdown
                    value={kpiTimeframe}
                    options={BIG_PICTURE_FRAME_OPTIONS}
                    onChange={(v) => setKpiTimeframe(v as BigPictureFrameValue)}
                  />
                }
              />
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

                {model.uncategorizedWarning ? (
                  <p className="subtle">
                    {model.uncategorizedWarning.count} uncategorized row{model.uncategorizedWarning.count === 1 ? '' : 's'} excluded
                    {' · '}
                    {formatCurrency(model.uncategorizedWarning.absoluteAmount)} omitted. Fix categories in source data.
                  </p>
                ) : null}
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

        {hasImportedData && activeTab === 'where-to-focus' && (() => {
          // Strip "Control " prefix (from opportunity titles) then normalize
          // Quicken subcategory colon separators into readable em-dashes.
          // Display-only transform — compute.ts is untouched.
          const formatCategoryLabel = (raw: string) =>
            raw.replace(/^Control\s+/i, '').trim().replace(/:/g, ' — ');
          const opportunities = model.opportunities;
          const visibleOpportunities = showAllFocusCategories
            ? opportunities
            : opportunities.slice(0, 5);
          const hasMoreOpportunities = opportunities.length > 5;

          let bannerText: string;
          if (opportunities.length >= 2) {
            bannerText = `“${formatCategoryLabel(opportunities[0].title)}” and “${formatCategoryLabel(opportunities[1].title)}” are your biggest opportunities to improve cash this month.`;
          } else if (opportunities.length === 1) {
            bannerText = `“${formatCategoryLabel(opportunities[0].title)}” is the main driver of higher costs this month.`;
          } else {
            bannerText = "You're in control this month. No major cost overruns detected.";
          }

          const movers = digHereInsights.movers;
          const visibleMovers = movers.slice(0, 7);
          const topIncreases = [...movers]
            .filter((mover) => mover.delta > 0)
            .sort((a, b) => b.delta - a.delta)
            .slice(0, 3);

          const topPayeesSubtitle =
            selectedDigHerePeriod === 'thisMonth'
              ? 'Top payees by total spend this month'
              : 'Top payees by total spend this period';

          return (
            <div className="stack-grid">
              <article className="focus-banner">
                <p>{bannerText}</p>
              </article>

              <article className="card focus-section">
                <div className="card-head">
                  <h3>What needs attention right now</h3>
                  <p className="subtle">Spending that ran above your normal this month</p>
                </div>
                {opportunities.length === 0 ? (
                  <p className="empty-state">You're in control this month. No major cost overruns detected.</p>
                ) : (
                  <>
                    <ul className="focus-row-list">
                      {visibleOpportunities.map((item) => (
                        <li key={item.title} className="focus-row">
                          <p className="focus-row-title">{formatCategoryLabel(item.title)}</p>
                          <p className="focus-row-detail">About {formatCurrency(item.savings)} above your recent monthly norm</p>
                          <p className="focus-row-sub">Higher than usual compared to recent months</p>
                        </li>
                      ))}
                    </ul>
                    {hasMoreOpportunities && (
                      <button
                        type="button"
                        className="focus-view-all"
                        onClick={() => setShowAllFocusCategories((current) => !current)}
                      >
                        {showAllFocusCategories ? 'Show fewer' : 'View all categories'}
                      </button>
                    )}
                  </>
                )}
              </article>

              <p className="focus-bridge">These issues didn't start this month — here's what's been changing over time.</p>

              <article className="card focus-section">
                <div className="card-head">
                  <h3>What changed behind the scenes</h3>
                  <p className="subtle">Biggest shifts compared to last year</p>
                </div>
                {movers.length === 0 ? (
                  <p className="empty-state">No unusual changes compared to last year.</p>
                ) : (
                  <>
                    {topIncreases.length > 0 && (
                      <p className="focus-interpretation">
                        Your biggest year-over-year increases were {topIncreases.map((mover) => formatCategoryLabel(mover.category)).join(', ')}.
                      </p>
                    )}
                    <ul className="movers-list focus-movers-list">
                      {visibleMovers.map((mover) => {
                        const tone =
                          mover.delta > 0 ? 'is-up' : mover.delta < 0 ? 'is-down' : 'is-flat';
                        const arrow = mover.delta > 0 ? '▲' : mover.delta < 0 ? '▼' : '●';
                        const sign = mover.delta > 0 ? '+' : mover.delta < 0 ? '-' : '';
                        const pctText =
                          mover.deltaPercent === null || Number.isNaN(mover.deltaPercent)
                            ? 'n/a'
                            : `${mover.deltaPercent > 0 ? '+' : ''}${Math.round(mover.deltaPercent)}%`;
                        const directionWord =
                          mover.delta > 0 ? 'Up' : mover.delta < 0 ? 'Down' : 'Flat';
                        return (
                          <li key={mover.category}>
                            <div>
                              <p>
                                <span>{formatCategoryLabel(mover.category)}</span>
                              </p>
                              <small>
                                {directionWord} {formatCurrency(Math.abs(mover.delta))} vs last year ({pctText})
                              </small>
                              <small className="focus-row-sub">
                                From {formatCurrency(mover.previous)} to {formatCurrency(mover.current)}
                              </small>
                            </div>
                            <div className={`mover-delta ${tone}`}>
                              <div className="mover-delta-main">
                                <span>{arrow}</span>
                                <strong>{sign}{formatCurrency(Math.abs(mover.delta))}</strong>
                              </div>
                              <small>{pctText}</small>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </article>

              <TopPayeesTable
                payees={digHereInsights.topPayees}
                title="Where the money is going"
                subtitle={topPayeesSubtitle}
              />
            </div>
          );
        })()}

        {hasImportedData && activeTab === 'trends' && (
          <div className="stack-grid">
            <div className="trend-charts-pair">
              <TrendLineChart data={model.trend} metric="income" title="Revenue Trend" trendWindowOverride={trendsMaWindow} displayWindow={trendsMaWindow} rangeLabelOverride={trendsRangeLabel} interpretationVariant="revenue" yTickLabelStep={2} />
              <TrendLineChart data={model.trend} metric="expense" title="Expense Trend" trendWindowOverride={trendsMaWindow} displayWindow={trendsMaWindow} rangeLabelOverride={trendsRangeLabel} interpretationVariant="expense" yTickLabelStep={2} />
            </div>

            {(() => {
              const rollupRows = model.monthlyRollups
                .filter((r) => r.month < currentCalendarMonth)
                .slice(-trendsMaWindow)
                .reverse();
              const totalRevenue = rollupRows.reduce((s, r) => s + r.revenue, 0);
              const totalExpenses = rollupRows.reduce((s, r) => s + r.expenses, 0);
              const totalNet = rollupRows.reduce((s, r) => s + r.netCashFlow, 0);
              const periodMargin = totalRevenue > 0 ? (totalNet / totalRevenue) * 100 : 0;
              return (
                <article className="card table-card rollups-table-card">
                  <div className="card-head">
                    <h3>Monthly Rollups</h3>
                  </div>
                  <table className="rollups-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Revenue</th>
                        <th>Expenses</th>
                        <th>Net Cash Flow</th>
                        <th>Profit Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollupRows.map((rollup) => (
                        <tr key={rollup.month}>
                          <td>{toMonthLabel(rollup.month)}</td>
                          <td>{formatCurrency(rollup.revenue)}</td>
                          <td>{formatCurrency(rollup.expenses)}</td>
                          <td className={rollup.netCashFlow < 0 ? 'is-negative' : undefined}>{formatCurrency(rollup.netCashFlow)}</td>
                          <td className={rollup.savingsRate < 0 ? 'is-negative' : undefined}>{rollup.savingsRate.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Period total</td>
                        <td>{formatCurrency(totalRevenue)}</td>
                        <td>{formatCurrency(totalExpenses)}</td>
                        <td className={totalNet < 0 ? 'is-negative' : undefined}>{formatCurrency(totalNet)}</td>
                        <td className={periodMargin < 0 ? 'is-negative' : undefined}>{periodMargin.toFixed(1)}%</td>
                      </tr>
                    </tfoot>
                  </table>
                </article>
              );
            })()}
          </div>
        )}

        {hasImportedData && activeTab === 'what-if' && (
          <div className="stack-grid">
            <CashFlowForecastModule
              data={cashFlowForecastTrend}
              monthlyRollups={model.monthlyRollups}
              fullForecast={scenarioProjection}
              reserveTarget={model.runway.reserveTarget}
              fixedReserveAmount={
                businessRules.safetyReserveMethod === 'fixed' &&
                businessRules.safetyReserveAmount > 0
                  ? businessRules.safetyReserveAmount
                  : null
              }
              targetNetMargin={
                businessRules.targetNetMargin > 0
                  ? businessRules.targetNetMargin
                  : null
              }
              decisionSignals={forecastDecisionSignals}
              seasonality={forecastSeasonality}
              currentCashBalance={forecastCurrentCashBalance}
              forecastRangeMonths={forecastRangeMonths}
              forecastRangeValue={forecastRange}
              forecastRangeOptions={FORECAST_RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label, months: option.months }))}
              onForecastRangeChange={(nextValue) => {
                const parsed = parseForecastRangeValue(nextValue);
                if (parsed) setForecastRange(parsed);
              }}
              scenarioKey={selectedScenarioKey}
              onScenarioChange={(scenarioKey) => setSelectedScenarioKey(scenarioKey)}
              revenueGrowthPct={scenarioInput.revenueGrowthPct}
              expenseChangePct={scenarioInput.expenseChangePct}
              receivableDays={scenarioInput.receivableDays}
              payableDays={scenarioInput.payableDays}
              onRevenueGrowthChange={(nextValue) => updateCustomScenario({ revenueGrowthPct: nextValue })}
              onExpenseChange={(nextValue) => updateCustomScenario({ expenseChangePct: nextValue })}
              onReceivableDaysChange={(nextValue) => updateCustomScenario({ receivableDays: nextValue })}
              onPayableDaysChange={(nextValue) => updateCustomScenario({ payableDays: nextValue })}
              forecastEvents={expandedForecastEvents}
              contracts={forecastContracts}
              onAddEvent={(events) => setForecastEvents((prev) => {
                const next = [...prev, ...events];
                void saveSharedForecastEvents(next);
                return next;
              })}
              onUpdateEvent={(updated) => setForecastEvents((prev) => {
                const next = prev.map((e) => (e.id === updated.id ? updated : e));
                void saveSharedForecastEvents(next);
                return next;
              })}
              onReplaceGroup={(groupId, events) => setForecastEvents((prev) => {
                const filtered = prev.filter((e) => {
                  const parts = e.id.split('__');
                  const eGroupId = parts.length === 3 ? parts[1] : e.id;
                  return eGroupId !== groupId;
                });
                const next = [...filtered, ...events];
                void saveSharedForecastEvents(next);
                return next;
              })}
              onDeleteEvent={(groupId) => setForecastEvents((prev) => {
                const next = prev.filter((e) => {
                  const parts = e.id.split('__');
                  const eGroupId = parts.length === 3 ? parts[1] : e.id;
                  return eGroupId !== groupId;
                });
                void saveSharedForecastEvents(next);
                return next;
              })}
              onToggleEvent={(groupId, enabled) => setForecastEvents((prev) => {
                const next = prev.map((e) => {
                  const parts = e.id.split('__');
                  const eGroupId = parts.length === 3 ? parts[1] : e.id;
                  return eGroupId === groupId ? { ...e, enabled } : e;
                });
                void saveSharedForecastEvents(next);
                return next;
              })}
            />

            <article className="card table-card projection-table-card" ref={projectionTableRef}>
              <div className="projection-header">
                <h3 className="projection-table-title">Projection Table</h3>
                <div className="projection-table-actions">
                  <div className="projection-table-compare-wrap">
                    <span className="projection-table-compare-label">Compare</span>
                    <div className="segmented-toggle projection-compare-toggle" role="group" aria-label="Compare years">
                      {pillYears.map((year) => {
                        const isActive = projectionActiveYears.includes(year);
                        return (
                          <button
                            key={year}
                            type="button"
                            aria-pressed={isActive}
                            className={`segmented-toggle-btn${isActive ? ' is-active' : ''}`}
                            onClick={() =>
                              setProjectionActiveYears((prev) =>
                                isActive ? prev.filter((y) => y !== year) : [...prev, year]
                              )
                            }
                          >
                            {year}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="projection-export-btn"
                    onClick={() => {
                      const scenarioLabel = selectedScenarioKey;
                      const today = new Date().toISOString().slice(0, 10);
                      const filename = `wx-cfo-projection-${scenarioLabel}-${today}.csv`;
                      const allDetectedAsc = [...priorYearActuals.years.map((ya) => ya.year)]
                        .filter((y) => y !== currentForecastYear)
                        .sort((a, b) => a - b);
                      const headers = ['Month'];
                      for (const y of allDetectedAsc) {
                        headers.push(`${y} Cash In`, `${y} Cash Out`, `${y} Net`);
                      }
                      headers.push('Cash In', 'Cash Out', 'Net', 'Balance');
                      const yearDataMap = new Map(priorYearActuals.years.map((ya) => [ya.year, ya]));
                      const csvRows = [headers.join(',')];
                      for (const row of visibleScenarioProjection) {
                        const monthNum = Number.parseInt(row.month.slice(5, 7), 10);
                        const cells: string[] = [toMonthLabel(row.month)];
                        for (const y of allDetectedAsc) {
                          const ya = yearDataMap.get(y);
                          const ma = ya?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 };
                          cells.push(ma.cashIn.toFixed(2), ma.cashOut.toFixed(2), ma.net.toFixed(2));
                        }
                        cells.push(row.cashIn.toFixed(2), row.cashOut.toFixed(2), row.netCashFlow.toFixed(2), row.endingCashBalance.toFixed(2));
                        csvRows.push(cells.join(','));
                      }
                      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement('a');
                      anchor.href = url;
                      anchor.download = filename;
                      anchor.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Export CSV
                  </button>
                </div>
              </div>
              {useOldProjectionTable ? (
              <div className="projection-table-scroll projection-table-legacy-shell">
                {(() => {
                  const sortedActiveDesc = [...projectionActiveYears].sort((a, b) => b - a);
                  const hasActive = sortedActiveDesc.length > 0;
                  const hasSingleYear = sortedActiveDesc.length === 1;
                  const forecastYear = currentForecastYear;
                  const yearDataMap = new Map(priorYearActuals.years.map((ya) => [ya.year, ya]));
                  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

                  // Forecast totals — shared by both table modes
                  const totalForecastCI = visibleScenarioProjection.reduce((s, r) => s + r.cashIn, 0);
                  const totalForecastCO = visibleScenarioProjection.reduce((s, r) => s + r.cashOut, 0);
                  const totalForecastNet = visibleScenarioProjection.reduce((s, r) => s + r.netCashFlow, 0);

                  if (!hasActive) {
                    return (
                      <table className="projection-table">
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th>Cash In</th>
                            <th>Cash Out</th>
                            <th>Net</th>
                            <th>{hasForecastCurrentCashBalance ? 'Balance' : 'Cumulative Net'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleScenarioProjection.map((row) => (
                            <tr key={row.month}>
                              <td>{toMonthLabel(row.month)}</td>
                              <td>{formatCurrency(row.cashIn)}</td>
                              <td>{formatCurrency(row.cashOut)}</td>
                              <td className={row.netCashFlow < 0 ? 'is-negative' : undefined}>{formatCurrency(row.netCashFlow)}</td>
                              <td className={row.endingCashBalance < 0 ? 'is-negative' : undefined}>{formatCurrency(row.endingCashBalance)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="total-row">
                            <td className="total-label">Period total</td>
                            <td>{formatCurrency(totalForecastCI)}</td>
                            <td>{formatCurrency(totalForecastCO)}</td>
                            <td className={totalForecastNet < 0 ? 'is-negative' : undefined}>{formatCurrency(totalForecastNet)}</td>
                            <td className="balance-placeholder">&mdash;</td>
                          </tr>
                        </tfoot>
                      </table>
                    );
                  }

                  // Actuals totals per active year
                  const totalActuals = new Map<number, { cashIn: number; cashOut: number; net: number }>();
                  for (const year of sortedActiveDesc) {
                    let ci = 0, co = 0, net = 0;
                    for (const row of visibleScenarioProjection) {
                      const m = Number.parseInt(row.month.slice(5, 7), 10);
                      const ma = yearDataMap.get(year)?.months[m] ?? { cashIn: 0, cashOut: 0, net: 0 };
                      ci += ma.cashIn; co += ma.cashOut; net += ma.net;
                    }
                    totalActuals.set(year, { cashIn: ci, cashOut: co, net });
                  }

                  const fmtVarPct = (pct: number) => {
                    const sign = pct >= 0 ? '+' : '-';
                    const abs = Math.abs(pct).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                    return `${sign}${abs}%`;
                  };

                  const fmtDiff = (val: number): string =>
                    val > 0 ? `+${formatCurrency(val)}` : formatCurrency(val);

                  const varColCount = hasSingleYear ? 2 : 0;
                  const cashInCols = 1 + sortedActiveDesc.length + varColCount;
                  const cashOutCols = 1 + sortedActiveDesc.length + varColCount;
                  const netCols = 1 + sortedActiveDesc.length + varColCount;

                  return (
                    <table className="projection-table comparison-mode">
                      <thead>
                        <tr className="projection-group-row">
                          <th rowSpan={2} className="projection-month-header">Month</th>
                          <th colSpan={cashInCols} className="proj-group-start">Cash In</th>
                          <th colSpan={cashOutCols} className="proj-group-start">Cash Out</th>
                          <th colSpan={netCols} className="proj-group-start">Net</th>
                        </tr>
                        <tr className="projection-sub-row">
                          {/* Cash In subcolumns */}
                          <th className="projection-sub-forecast proj-group-start">{forecastYear}</th>
                          {sortedActiveDesc.map((y) => <th key={`ci-${y}`} className="projection-sub-actual">{y}</th>)}
                          {hasSingleYear && <th className="projection-sub-actual">Change</th>}
                          {hasSingleYear && <th className="projection-sub-actual">%</th>}
                          {/* Cash Out subcolumns */}
                          <th className="projection-sub-forecast proj-group-start">{forecastYear}</th>
                          {sortedActiveDesc.map((y) => <th key={`co-${y}`} className="projection-sub-actual">{y}</th>)}
                          {hasSingleYear && <th className="projection-sub-actual">Change</th>}
                          {hasSingleYear && <th className="projection-sub-actual">%</th>}
                          {/* Net subcolumns */}
                          <th className="projection-sub-forecast proj-group-start">{forecastYear}</th>
                          {sortedActiveDesc.map((y) => <th key={`n-${y}`} className="projection-sub-actual">{y}</th>)}
                          {hasSingleYear && <th className="projection-sub-actual">Change</th>}
                          {hasSingleYear && <th className="projection-sub-actual">%</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleScenarioProjection.map((row) => {
                          const monthNum = Number.parseInt(row.month.slice(5, 7), 10);
                          const ma1 = hasSingleYear
                            ? yearDataMap.get(sortedActiveDesc[0])?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 }
                            : null;
                          const fmtVar = (pct: number) => fmtVarPct(pct);
                          return (
                            <tr key={row.month}>
                              <td>{MONTH_NAMES[monthNum - 1]}</td>
                              {/* Cash In group */}
                              <td className="proj-group-start proj-forecast-value">{formatCurrency(row.cashIn)}</td>
                              {sortedActiveDesc.map((year) => {
                                const ma = yearDataMap.get(year)?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 };
                                const cls = ma.cashIn < 0 ? 'proj-actuals-negative' : 'proj-actuals-value';
                                return <td key={`ci-${year}-${row.month}`} className={cls}>{formatCurrency(ma.cashIn)}</td>;
                              })}
                              {hasSingleYear && (() => {
                                if (!ma1 || ma1.cashIn === 0) return <td className="projection-var-neutral">&mdash;</td>;
                                const diff = row.cashIn - ma1.cashIn;
                                const cls = diff > 0 ? 'projection-var-positive' : diff < 0 ? 'projection-var-negative' : 'projection-var-neutral';
                                return <td className={cls}>{fmtDiff(diff)}</td>;
                              })()}
                              {hasSingleYear && (() => {
                                if (!ma1 || ma1.cashIn === 0) return <td className="projection-var-neutral">&mdash;</td>;
                                const varPct = ((row.cashIn - ma1.cashIn) / Math.abs(ma1.cashIn)) * 100;
                                const colorClass = varPct > 0 ? 'projection-var-positive' : 'projection-var-negative';
                                return <td className={colorClass}>{fmtVar(varPct)}</td>;
                              })()}
                              {/* Cash Out group */}
                              <td className="proj-group-start proj-forecast-value">{formatCurrency(row.cashOut)}</td>
                              {sortedActiveDesc.map((year) => {
                                const ma = yearDataMap.get(year)?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 };
                                const cls = ma.cashOut < 0 ? 'proj-actuals-negative' : 'proj-actuals-value';
                                return <td key={`co-${year}-${row.month}`} className={cls}>{formatCurrency(ma.cashOut)}</td>;
                              })}
                              {hasSingleYear && (() => {
                                if (!ma1 || ma1.cashOut === 0) return <td className="projection-var-neutral">&mdash;</td>;
                                const diff = row.cashOut - ma1.cashOut;
                                // Cash Out: inverted — spending more than prior = bad (red), less = good (green)
                                const cls = diff > 0 ? 'projection-var-cashout-positive' : diff < 0 ? 'projection-var-cashout-negative' : 'projection-var-neutral';
                                return <td className={cls}>{fmtDiff(diff)}</td>;
                              })()}
                              {hasSingleYear && (() => {
                                if (!ma1 || ma1.cashOut === 0) return <td className="projection-var-neutral">&mdash;</td>;
                                const varPct = ((row.cashOut - ma1.cashOut) / Math.abs(ma1.cashOut)) * 100;
                                // Cash Out: inverted — spending more than prior = bad (red), less = good (green)
                                const colorClass = varPct > 0 ? 'projection-var-cashout-positive' : 'projection-var-cashout-negative';
                                return <td className={colorClass}>{fmtVar(varPct)}</td>;
                              })()}
                              {/* Net group */}
                              <td className={`proj-group-start proj-forecast-value${row.netCashFlow < 0 ? ' is-negative' : ''}`}>{formatCurrency(row.netCashFlow)}</td>
                              {sortedActiveDesc.map((year) => {
                                const ma = yearDataMap.get(year)?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 };
                                const cls = ma.net < 0 ? 'proj-actuals-negative' : 'proj-actuals-value';
                                return <td key={`n-${year}-${row.month}`} className={cls}>{formatCurrency(ma.net)}</td>;
                              })}
                              {hasSingleYear && (() => {
                                if (!ma1 || ma1.net === 0) return <td className="projection-var-neutral">&mdash;</td>;
                                const diff = row.netCashFlow - ma1.net;
                                const cls = diff > 0 ? 'projection-var-positive' : diff < 0 ? 'projection-var-negative' : 'projection-var-neutral';
                                return <td className={cls}>{fmtDiff(diff)}</td>;
                              })()}
                              {hasSingleYear && (() => {
                                if (!ma1 || ma1.net === 0) return <td className="projection-var-neutral">&mdash;</td>;
                                const varPct = ((row.netCashFlow - ma1.net) / Math.abs(ma1.net)) * 100;
                                const colorClass = varPct > 0 ? 'projection-var-positive' : 'projection-var-negative';
                                return <td className={colorClass}>{fmtVar(varPct)}</td>;
                              })()}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="total-row">
                          <td className="total-label">Period total</td>
                          {/* Cash In totals */}
                          <td className="proj-group-start proj-forecast-value">{formatCurrency(totalForecastCI)}</td>
                          {sortedActiveDesc.map((year) => {
                            const tot = totalActuals.get(year) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            const cls = tot.cashIn < 0 ? 'proj-actuals-negative' : 'proj-actuals-value';
                            return <td key={`tot-ci-${year}`} className={cls}>{formatCurrency(tot.cashIn)}</td>;
                          })}
                          {hasSingleYear && (() => {
                            const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            if (tot.cashIn === 0) return <td className="proj-actuals-value">&mdash;</td>;
                            const diff = totalForecastCI - tot.cashIn;
                            const cls = diff > 0 ? 'projection-var-positive' : diff < 0 ? 'projection-var-negative' : 'projection-var-neutral';
                            return <td className={cls}>{fmtDiff(diff)}</td>;
                          })()}
                          {hasSingleYear && (() => {
                            const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            if (tot.cashIn === 0) return <td className="proj-actuals-value">&mdash;</td>;
                            const pct = ((totalForecastCI - tot.cashIn) / Math.abs(tot.cashIn)) * 100;
                            const cls = pct > 0 ? 'projection-var-positive' : 'projection-var-negative';
                            return <td className={cls}>{fmtVarPct(pct)}</td>;
                          })()}
                          {/* Cash Out totals */}
                          <td className="proj-group-start proj-forecast-value">{formatCurrency(totalForecastCO)}</td>
                          {sortedActiveDesc.map((year) => {
                            const tot = totalActuals.get(year) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            const cls = tot.cashOut < 0 ? 'proj-actuals-negative' : 'proj-actuals-value';
                            return <td key={`tot-co-${year}`} className={cls}>{formatCurrency(tot.cashOut)}</td>;
                          })}
                          {hasSingleYear && (() => {
                            const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            if (tot.cashOut === 0) return <td className="proj-actuals-value">&mdash;</td>;
                            const diff = totalForecastCO - tot.cashOut;
                            // Cash Out: inverted — spending more than prior = bad (red), less = good (green)
                            const cls = diff > 0 ? 'projection-var-cashout-positive' : diff < 0 ? 'projection-var-cashout-negative' : 'projection-var-neutral';
                            return <td className={cls}>{fmtDiff(diff)}</td>;
                          })()}
                          {hasSingleYear && (() => {
                            const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            if (tot.cashOut === 0) return <td className="proj-actuals-value">&mdash;</td>;
                            const pct = ((totalForecastCO - tot.cashOut) / Math.abs(tot.cashOut)) * 100;
                            // Cash Out: inverted — spending more than prior = bad (red), less = good (green)
                            const cls = pct > 0 ? 'projection-var-cashout-positive' : 'projection-var-cashout-negative';
                            return <td className={cls}>{fmtVarPct(pct)}</td>;
                          })()}
                          {/* Net totals */}
                          <td className={`proj-group-start proj-forecast-value${totalForecastNet < 0 ? ' is-negative' : ''}`}>{formatCurrency(totalForecastNet)}</td>
                          {sortedActiveDesc.map((year) => {
                            const tot = totalActuals.get(year) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            const cls = tot.net < 0 ? 'proj-actuals-negative' : 'proj-actuals-value';
                            return <td key={`tot-n-${year}`} className={cls}>{formatCurrency(tot.net)}</td>;
                          })}
                          {hasSingleYear && (() => {
                            const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            if (tot.net === 0) return <td className="proj-actuals-value">&mdash;</td>;
                            const diff = totalForecastNet - tot.net;
                            const cls = diff > 0 ? 'projection-var-positive' : diff < 0 ? 'projection-var-negative' : 'projection-var-neutral';
                            return <td className={cls}>{fmtDiff(diff)}</td>;
                          })()}
                          {hasSingleYear && (() => {
                            const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                            if (tot.net === 0) return <td className="proj-actuals-value">&mdash;</td>;
                            const pct = ((totalForecastNet - tot.net) / Math.abs(tot.net)) * 100;
                            const cls = pct > 0 ? 'projection-var-positive' : 'projection-var-negative';
                            return <td className={cls}>{fmtVarPct(pct)}</td>;
                          })()}
                        </tr>
                      </tfoot>
                    </table>
                  );
                })()}
              </div>
              ) : (
                <ProjectionTableV2
                  visibleScenarioProjection={visibleScenarioProjection}
                  priorYearActuals={priorYearActuals}
                  projectionActiveYears={projectionActiveYears}
                  currentForecastYear={currentForecastYear}
                  hasForecastCurrentCashBalance={hasForecastCurrentCashBalance}
                  formatCurrency={formatCurrency}
                  toMonthLabel={toMonthLabel}
                />
              )}
            </article>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="stack-grid">
            <div className="ta-page">

              <div className="ta-page-header">
                <h1 className="ta-page-title">Settings</h1>
                <p className="ta-page-subtitle">Where your data comes from and how your forecast works</p>
              </div>

              <div className="settings-subnav-wrap">
                <div className="settings-subnav">
                  <button
                    type="button"
                    className={`settings-subnav-btn${activeSection === 'data' ? ' is-active' : ''}`}
                    onClick={() => setActiveSection('data')}
                  >
                    Data
                  </button>
                  <button
                    type="button"
                    className={`settings-subnav-btn${activeSection === 'accounts' ? ' is-active' : ''}`}
                    onClick={() => setActiveSection('accounts')}
                  >
                    Accounts
                  </button>
                  <button
                    type="button"
                    className={`settings-subnav-btn${activeSection === 'rules' ? ' is-active' : ''}`}
                    onClick={() => setActiveSection('rules')}
                  >
                    Rules
                  </button>
                  <button
                    type="button"
                    className={`settings-subnav-btn${activeSection === 'contracts' ? ' is-active' : ''}`}
                    onClick={() => setActiveSection('contracts')}
                  >
                    Contracts &amp; Renewals
                  </button>
                </div>
              </div>

              <div className="settings-content-shell">

              {/* ── Section 1: DATA ─────────────────────────────────────── */}
              <div className={`settings-section-pane${activeSection === 'data' ? '' : ' is-hidden'}`}>
              <div className="ta-section">
                <div className="ta-section-header">
                  <h2 className="ta-section-title">Data</h2>
                </div>
                <div className="ta-section-body">

                  {/* System Status card */}
                  <div className="ta-card sys-status-card">
                    <div className="ta-card-header">
                      <h3 className="ta-card-title">System Status</h3>
                    </div>
                    <div className="ta-card-body">
                      {(() => {
                        const parseFailures = lastImportSummary?.parseFailures ?? 0;
                        const possibleDuplicates = lastImportSummary?.possibleDuplicatesFlagged ?? 0;
                        const acknowledgedSet = new Set(businessRules.acknowledgedNoncashAccounts);
                        const unacknowledgedNonCashAccounts = includedNonCashForecastAccounts.filter(
                          (record) => !acknowledgedSet.has(record.id)
                        );
                        const nonCashCount = unacknowledgedNonCashAccounts.length;
                        const hasCashAnchor = includedCashAccountCount > 0;
                        const rulesMarginValid =
                          businessRules.targetNetMargin === null ||
                          businessRules.targetNetMargin > 0;
                        // safetyReserveMethod is always 'monthly' or 'fixed' — always valid

                        // Evaluate status — first matching condition wins
                        let status: 'at-risk' | 'needs-review' | 'healthy';
                        const atRiskLines: string[] = [];

                        if (!hasImportedData) atRiskLines.push('No active data source');
                        if (parseFailures > 0) atRiskLines.push(`${parseFailures} parse failure${parseFailures === 1 ? '' : 's'} detected`);
                        if (hasImportedData && !hasCashAnchor) atRiskLines.push('No cash anchor account available');
                        if (!rulesMarginValid) atRiskLines.push('Required rules are missing');

                        const needsReviewLines: string[] = [];
                        if (!businessRules.suppressDuplicateWarnings && possibleDuplicates > 0) needsReviewLines.push(`${possibleDuplicates} possible duplicate${possibleDuplicates === 1 ? '' : 's'} to review`);
                        if (nonCashCount > 0) needsReviewLines.push(`${nonCashCount} non-cash account${nonCashCount === 1 ? '' : 's'} included in forecast — verify this is intentional`);

                        if (atRiskLines.length > 0) {
                          status = 'at-risk';
                        } else if (needsReviewLines.length > 0) {
                          status = 'needs-review';
                        } else {
                          status = 'healthy';
                        }

                        const badgeClass =
                          status === 'healthy' ? 'sys-status-badge is-healthy' :
                          status === 'needs-review' ? 'sys-status-badge is-needs-review' :
                          'sys-status-badge is-at-risk';

                        const badgeLabel =
                          status === 'healthy' ? 'Healthy' :
                          status === 'needs-review' ? 'Needs review' :
                          'At risk';

                        let statusLines: string[];
                        if (status === 'healthy') {
                          statusLines = [
                            `Data imported — ${storedImportedTransactionCount.toLocaleString()} transactions`,
                            'No parse errors',
                            'Rules configured',
                          ];
                        } else if (status === 'needs-review') {
                          statusLines = needsReviewLines;
                        } else {
                          statusLines = atRiskLines.slice(0, 4);
                        }

                        return (
                          <>
                            <p className="sys-status-title">System status</p>
                            <span className={badgeClass}>{badgeLabel}</span>
                            <ul className="sys-status-lines">
                              {statusLines.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Direct CSV Import card */}
                  <div className="ta-card">
                    <div className="ta-card-header">
                      <h3 className="ta-card-title">Direct CSV Import</h3>
                    </div>
                    <div className="ta-card-body">
                      <div className="card-head">
                        <p className="subtle">{importDescription}</p>
                      </div>

                      <input
                        ref={importFileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="sr-only"
                        onChange={(event) => void handleImportCsvSelection(event)}
                      />

                      <div className="settings-actions">
                        <button type="button" onClick={() => importFileInputRef.current?.click()} disabled={importLoading}>
                          {importLoading ? 'Importing...' : 'Import Quicken CSV'}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => void handleClearImportedData()}
                          disabled={importLoading || storedImportedTransactionCount === 0}
                        >
                          {clearImportedDataLabel}
                        </button>
                      </div>

                      {bootLoadError ? <p className="settings-error">{bootLoadError}</p> : null}
                      {importError ? <p className="settings-error">{importError}</p> : null}

                      <div className="settings-meta">
                        <p>
                          Active analysis source:{' '}
                          <strong>{activeDataSet?.sourceLabel ?? 'No imported dataset loaded'}</strong>
                        </p>
                        {lastImportSummary?.latestTxnMonth ? (
                          <p>
                            Updated through: <strong>{toMonthLabel(lastImportSummary.latestTxnMonth)}</strong>
                          </p>
                        ) : null}
                        <p>
                          Imported transactions stored: <strong>{storedImportedTransactionCount.toLocaleString()}</strong>
                        </p>
                        <p>
                          Imported data active:{' '}
                          <strong>
                            {importedSourceStatus}
                          </strong>
                        </p>
                        <p>
                          Source precedence: <strong>{sourcePrecedenceLabel}</strong>
                        </p>
                        {importedDataSet ? (
                          <>
                            <p>
                              Source storage:{' '}
                              <strong>{lastImportSummary?.storageScope === 'shared' ? 'Shared imported dataset' : 'Browser-local imported dataset'}</strong>
                            </p>
                            <p>
                              Import mode: <strong>{importModeLabel}</strong>
                            </p>
                          </>
                        ) : null}
                      </div>

                      {lastImportSummary ? (
                        <div className="import-summary">
                          <div className="import-summary-grid">
                            <div>
                              <span className="import-summary-label">Source file</span>
                              <strong>{lastImportSummary.sourceFileName}</strong>
                            </div>
                            <div>
                              <span className="import-summary-label">Imported</span>
                              <strong>{formatTimestamp(lastImportSummary.importedAtIso)}</strong>
                            </div>
                            <div>
                              <span className="import-summary-label">New imported</span>
                              <strong>{lastImportSummary.newImported}</strong>
                            </div>
                            <div>
                              <span className="import-summary-label">Exact duplicates skipped</span>
                              <strong>{lastImportSummary.exactDuplicatesSkipped}</strong>
                            </div>
                            <div>
                              <span className="import-summary-label">Possible duplicates imported</span>
                              <strong>{lastImportSummary.possibleDuplicatesFlagged}</strong>
                            </div>
                            <div>
                              <span className="import-summary-label">Parse failures</span>
                              <strong>{lastImportSummary.parseFailures}</strong>
                            </div>
                          </div>

                          {renderedDuplicateExamples.length > 0 ? (
                            <div className="import-summary-section">
                              <h4>Possible duplicates</h4>
                              <ul className="import-issue-list">
                                {renderedDuplicateExamples.map((issue) => (
                                  <li key={`dup-${issue.lineNumber}`}>
                                    <strong>Line {issue.lineNumber}.</strong> {issue.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {renderedParseFailureExamples.length > 0 ? (
                            <div className="import-summary-section">
                              <h4>Parse failures</h4>
                              <ul className="import-issue-list">
                                {renderedParseFailureExamples.map((issue) => (
                                  <li key={`parse-${issue.lineNumber}`}>
                                    <strong>{issue.lineNumber > 0 ? `Line ${issue.lineNumber}.` : 'Import error.'}</strong> {issue.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                </div>
              </div>
              </div>{/* end data wrapper */}

              {/* ── Section 2: ACCOUNTS ─────────────────────────────────── */}
              <div className={`settings-section-pane${activeSection === 'accounts' ? '' : ' is-hidden'}`}>
              <div className="ta-section">
                <div className="ta-section-header">
                  <h2 className="ta-section-title">Accounts</h2>
                </div>
                <div className="ta-section-body">

                  <div className="ta-card">
                    <div className="ta-card-header">
                      <h3 className="ta-card-title">Account Setup</h3>
                    </div>
                    <div className="ta-card-body">
                      <div className="card-head">
                        <p className="subtle">Auto-discovered from imported CSV data. Your edits become the source of truth for future imports.</p>
                        <p className="subtle">
                          Settings storage: <strong>{accountSettingsSourceLabel}</strong>
                        </p>
                      </div>

                      <div className="account-setup-summary">
                        <p className="account-setup-summary-title">Cash anchor</p>
                        <p className="account-setup-summary-copy">
                          Forecast starting cash uses <strong>active Cash accounts only</strong>. Non-cash accounts are ignored in the forecast anchor even if they are marked <strong>In Forecast</strong>.
                        </p>
                        <div className="account-setup-summary-grid">
                          <div>
                            <span className="account-setup-summary-label">Loaded data window</span>
                            <strong>{forecastWindowLabel}</strong>
                          </div>
                          <div>
                            <span className="account-setup-summary-label">Included accounts</span>
                            <strong>{includedForecastAccounts.length.toLocaleString()} total · {includedCashAccountCount.toLocaleString()} cash</strong>
                          </div>
                          <div>
                            <span className="account-setup-summary-label">Current cash basis</span>
                            <strong>{formatCurrency(forecastCurrentCashBalance)}</strong>
                          </div>
                        </div>
                        <ul className="account-setup-summary-notes">
                          <li><strong>Starting Balance</strong> should be the account balance on <strong>{forecastWindowStartLabel}</strong>.</li>
                          <li><strong>Current Balance</strong> is calculated as Starting Balance + loaded net transactions for that account.</li>
                          <li>The forecast uses the computed balance from cash accounts as its starting point.</li>
                        </ul>
                      </div>

                      {accountRecords.length === 0 ? (
                        <p className="empty-state">No account names have been discovered from the current data source yet.</p>
                      ) : (
                        <div className="settings-table-wrap">
                          <table className="account-settings-table">
                            <thead>
                              <tr>
                                <th>Detected Account</th>
                                <th>Account Name</th>
                                <th>Type</th>
                                <th>Starting Balance at Window Start</th>
                                <th>Current Balance (computed)</th>
                                <th>In Forecast</th>
                                <th>Active</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {accountRecords.map((record) => (
                                <tr key={record.id}>
                                  <td>
                                    <span className="account-source-name">{record.discoveredAccountName}</span>
                                  </td>
                                  <td>
                                    <input
                                      className="settings-table-input"
                                      type="text"
                                      value={record.accountName}
                                      onChange={(event) => handleAccountRecordChange(record.id, 'accountName', event.target.value)}
                                    />
                                  </td>
                                  <td>
                                    <select
                                      className="settings-table-input"
                                      value={record.accountType}
                                      onChange={(event) =>
                                        handleAccountRecordChange(record.id, 'accountType', event.target.value as AccountType)
                                      }
                                    >
                                      <option value="Cash">Cash</option>
                                      <option value="Credit Card">Credit Card</option>
                                      <option value="Loan">Loan</option>
                                      <option value="Other">Other</option>
                                    </select>
                                  </td>
                                  <td>
                                    <div className="account-balance-input-cell">
                                      <input
                                        className="settings-table-input"
                                        type="number"
                                        step="0.01"
                                        value={record.startingBalance}
                                        aria-label={`${record.accountName} starting balance at window start`}
                                        onChange={(event) => {
                                          const nextValue = Number.parseFloat(event.target.value);
                                          handleAccountRecordChange(
                                            record.id,
                                            'startingBalance',
                                            Number.isFinite(nextValue) ? nextValue : 0
                                          );
                                        }}
                                      />
                                      <span className="account-input-hint">
                                        {Math.abs(record.startingBalance) <= EPSILON && forecastCashAnchorAccountIds.has(record.id)
                                          ? `Needed for forecast basis as of ${forecastWindowStartLabel}`
                                          : `Balance on ${forecastWindowStartLabel}`}
                                      </span>
                                    </div>
                                  </td>
                                  <td>
                                    <div className="account-balance-cell">
                                      <span className="account-balance-computed">
                                        {formatCurrency(
                                          record.startingBalance +
                                            (accountBalanceMap.get(record.id) ?? 0)
                                        )}
                                      </span>
                                      <span className="account-balance-note">
                                        {record.accountType === 'Cash' && record.includeInCashForecast
                                          ? 'Cash anchor'
                                          : record.accountType !== 'Cash' && record.includeInCashForecast
                                            ? businessRules.acknowledgedNoncashAccounts.includes(record.id)
                                              ? <>
                                                  Included in forecast{' '}
                                                  <span className="account-balance-note-ok">✓</span>
                                                </>
                                              : <>
                                                  Included in forecast{' '}
                                                  <span
                                                    className="account-balance-note-warn"
                                                    title="This account is included in the forecast but is not a cash account. Verify this is intentional."
                                                  >
                                                    ⚠
                                                  </span>
                                                  {' '}
                                                  <button
                                                    type="button"
                                                    className="noncash-ack-btn"
                                                    onClick={() =>
                                                      updateBusinessRules({
                                                        acknowledgedNoncashAccounts: [
                                                          ...businessRules.acknowledgedNoncashAccounts,
                                                          record.id,
                                                        ],
                                                      })
                                                    }
                                                  >
                                                    This inclusion is intentional
                                                  </button>
                                                </>
                                            : 'Excluded'}
                                      </span>
                                    </div>
                                  </td>
                                  <td>
                                    <label className="settings-checkbox">
                                      <input
                                        type="checkbox"
                                        checked={record.includeInCashForecast}
                                        onChange={(event) =>
                                          handleAccountRecordChange(record.id, 'includeInCashForecast', event.target.checked)
                                        }
                                      />
                                      <span>{record.includeInCashForecast ? 'Included' : 'Excluded'}</span>
                                    </label>
                                  </td>
                                  <td>
                                    <label className="settings-checkbox">
                                      <input
                                        type="checkbox"
                                        checked={record.active}
                                        onChange={(event) => handleAccountRecordChange(record.id, 'active', event.target.checked)}
                                      />
                                      <span>{record.active ? 'Active' : 'Inactive'}</span>
                                    </label>
                                  </td>
                                  <td>
                                    <span className={record.isUserConfigured ? 'settings-badge is-user' : 'settings-badge is-auto'}>
                                      {record.isUserConfigured ? 'User configured' : 'Auto-discovered'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
              </div>{/* end accounts wrapper */}

              {/* ── Section 3: RULES ────────────────────────────────────── */}
              <div className={`settings-section-pane${activeSection === 'rules' ? '' : ' is-hidden'}`}>
              <div className="ta-section">
                <div className="ta-section-header">
                  <h2 className="ta-section-title">Rules</h2>
                </div>
                <div className="ta-section-body">

                  <div className="ta-card">
                    <div className="ta-card-header">
                      <h3 className="ta-card-title">Rules</h3>
                    </div>
                    <div className="ta-card-body">
                      <div className="rules-list">

                        {/* Rule 1 — Profit target */}
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Profit target</span>
                            <span className="rules-row-sub">Cards use this as the monthly goal threshold</span>
                          </div>
                          <div className="rules-row-control">
                            <div className="rules-pct-input-wrap">
                              <input
                                className="rules-pct-input"
                                type="number"
                                min="1"
                                max="100"
                                step="1"
                                aria-label="Profit target percentage"
                                value={
                                  businessRules.targetNetMargin != null
                                    ? Math.round(businessRules.targetNetMargin * 100)
                                    : 25
                                }
                                onChange={(event) => {
                                  const raw = Number.parseFloat(event.target.value);
                                  if (Number.isFinite(raw) && raw > 0 && raw <= 100) {
                                    updateBusinessRules({ targetNetMargin: raw / 100 });
                                  }
                                }}
                              />
                              <span className="rules-pct-suffix">%</span>
                            </div>
                          </div>
                        </div>

                        {/* Rule 2 — Safety line */}
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Safety line</span>
                            <span className="rules-row-sub">
                              {businessRules.safetyReserveMethod === 'fixed'
                                ? 'Fixed reserve amount used as your safety line'
                                : '1 month of average operating expenses'}
                            </span>
                          </div>
                          <div className="rules-row-control rules-row-control--col">
                            <div className="segmented-toggle">
                              <button
                                type="button"
                                className={`segmented-toggle-btn${businessRules.safetyReserveMethod === 'monthly' ? ' is-active' : ''}`}
                                onClick={() => updateBusinessRules({ safetyReserveMethod: 'monthly' })}
                              >
                                1 month of expenses
                              </button>
                              <button
                                type="button"
                                className={`segmented-toggle-btn${businessRules.safetyReserveMethod === 'fixed' ? ' is-active' : ''}`}
                                onClick={() => updateBusinessRules({ safetyReserveMethod: 'fixed' })}
                              >
                                Fixed amount
                              </button>
                            </div>
                            {businessRules.safetyReserveMethod === 'fixed' && (
                              <div className="rules-currency-input-wrap">
                                <span className="rules-currency-prefix">$</span>
                                <input
                                  className="rules-currency-input"
                                  type="number"
                                  min="0"
                                  step="1000"
                                  aria-label="Safety line amount"
                                  placeholder="40000"
                                  value={businessRules.safetyReserveAmount === 0 ? '' : businessRules.safetyReserveAmount}
                                  onChange={(event) => {
                                    const raw = Number.parseFloat(event.target.value);
                                    updateBusinessRules({
                                      safetyReserveAmount: Number.isFinite(raw) && raw >= 0 ? raw : 0,
                                    });
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Rule 3 — Forecast style */}
                        {/* Persisted in 2a; consumed by Forecast page in sub-phase 2c.
                            Until 2c ships, toggling here saves the value but has no
                            visible effect on the Forecast page. */}
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Forecast style</span>
                            <span className="rules-row-sub">
                              How forecasts plan ahead. Reality plans for tougher conditions — it is the safer default. Recovery assumes things go closer to plan.
                            </span>
                          </div>
                          <div className="rules-row-control">
                            <div className="segmented-toggle">
                              <button
                                type="button"
                                className={`segmented-toggle-btn${businessRules.forecastPosture === 'reality' ? ' is-active' : ''}`}
                                onClick={() => updateBusinessRules({ forecastPosture: 'reality' })}
                              >
                                Reality
                              </button>
                              <button
                                type="button"
                                className={`segmented-toggle-btn${businessRules.forecastPosture === 'recovery' ? ' is-active' : ''}`}
                                onClick={() => updateBusinessRules({ forecastPosture: 'recovery' })}
                              >
                                Recovery
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Rule 5 — Duplicate warnings */}
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Duplicate warnings</span>
                            <span className="rules-row-sub">
                              {businessRules.suppressDuplicateWarnings
                                ? 'Duplicate count is hidden from System Status'
                                : 'Duplicate transactions are flagged in System Status'}
                            </span>
                          </div>
                          <div className="rules-row-control">
                            <div className="segmented-toggle">
                              <button
                                type="button"
                                className={`segmented-toggle-btn${!businessRules.suppressDuplicateWarnings ? ' is-active' : ''}`}
                                onClick={() => updateBusinessRules({ suppressDuplicateWarnings: false })}
                              >
                                Show duplicate warnings
                              </button>
                              <button
                                type="button"
                                className={`segmented-toggle-btn${businessRules.suppressDuplicateWarnings ? ' is-active' : ''}`}
                                onClick={() => updateBusinessRules({ suppressDuplicateWarnings: true })}
                              >
                                Suppress for full imports
                              </button>
                            </div>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>

                  <div className="ta-card">
                    <div className="ta-card-header">
                      <h3 className="ta-card-title">Forecast Scenario Assumptions</h3>
                    </div>
                    <div className="ta-card-body">
                      <div className="rules-list">
                        {([
                          {
                            key: 'best' as const,
                            label: 'Best Case',
                            sub: 'Revenue growth and expense change used by the Best Case scenario',
                            revKey: 'scenarioBestRevenueGrowthPct' as const,
                            expKey: 'scenarioBestExpenseChangePct' as const,
                          },
                          {
                            key: 'base' as const,
                            label: 'Base Case',
                            sub: 'Revenue growth and expense change used by the Base Case scenario',
                            revKey: 'scenarioBaseRevenueGrowthPct' as const,
                            expKey: 'scenarioBaseExpenseChangePct' as const,
                          },
                          {
                            key: 'worst' as const,
                            label: 'Worst Case',
                            sub: 'Revenue growth and expense change used by the Worst Case scenario',
                            revKey: 'scenarioWorstRevenueGrowthPct' as const,
                            expKey: 'scenarioWorstExpenseChangePct' as const,
                          },
                        ]).map((row) => (
                          <div className="rules-row" key={row.key}>
                            <div className="rules-row-info">
                              <span className="rules-row-label">{row.label}</span>
                              <span className="rules-row-sub">{row.sub}</span>
                            </div>
                            <div className="rules-row-control rules-row-control--scenario">
                              <label className="rules-pct-field">
                                <span className="rules-pct-field-label">Revenue</span>
                                <div className="rules-pct-input-wrap">
                                  <input
                                    className="rules-pct-input"
                                    type="number"
                                    min="-100"
                                    max="100"
                                    step="1"
                                    aria-label={`${row.label} revenue growth percentage`}
                                    value={Math.round(businessRules[row.revKey])}
                                    onChange={(event) => {
                                      const raw = Number.parseFloat(event.target.value);
                                      if (Number.isFinite(raw) && raw >= -100 && raw <= 100) {
                                        updateBusinessRules({ [row.revKey]: raw } as Partial<BusinessRules>);
                                      }
                                    }}
                                  />
                                  <span className="rules-pct-suffix">%</span>
                                </div>
                              </label>
                              <label className="rules-pct-field">
                                <span className="rules-pct-field-label">Expenses</span>
                                <div className="rules-pct-input-wrap">
                                  <input
                                    className="rules-pct-input"
                                    type="number"
                                    min="-100"
                                    max="100"
                                    step="1"
                                    aria-label={`${row.label} expense change percentage`}
                                    value={Math.round(businessRules[row.expKey])}
                                    onChange={(event) => {
                                      const raw = Number.parseFloat(event.target.value);
                                      if (Number.isFinite(raw) && raw >= -100 && raw <= 100) {
                                        updateBusinessRules({ [row.expKey]: raw } as Partial<BusinessRules>);
                                      }
                                    }}
                                  />
                                  <span className="rules-pct-suffix">%</span>
                                </div>
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                </div>
              </div>
              </div>{/* end rules wrapper */}

              {/* ── Section 4: CONTRACTS & RENEWALS ─────────────────────── */}
              <div className={`settings-section-pane${activeSection === 'contracts' ? '' : ' is-hidden'}`}>
                <ContractsSettingsPane
                  contracts={forecastContracts}
                  onCreate={handleCreateRenewalContract}
                  onUpdate={handleUpdateRenewalContract}
                  onDelete={handleDeleteRenewalContract}
                />
              </div>

              </div>{/* end settings-content-shell */}
            </div>
          </div>
        )}

        {import.meta.env.DEV && activeTab === 'ui-lab' && (
          <div className="stack-grid">
            <div className="ui-lab-header">
              <div className="ui-lab-header-copy">
                <h2 className="ui-lab-title">UI Lab</h2>
                <p className="ui-lab-subtitle">Canonical component reference. Components added one at a time.</p>
              </div>
            </div>

            <div className="ui-lab-section">
              <h3 className="ui-lab-section-title">MetricCard</h3>
              <p className="ui-lab-section-subtitle">Source: demo.tailadmin.com/ai (Users tile). Locked spec, 2026-05-06.</p>
              <div className="ui-lab-preview-width">
                <article className="metric-card">
                  <div className="metric-card__header">
                    <span className="metric-card__label">Users</span>
                    <svg
                      className="metric-card__icon"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" />
                      <circle cx="9" cy="7" r="4" stroke="currentColor" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" />
                    </svg>
                  </div>
                  <h2 className="metric-card__value">10,590</h2>
                  <div className="metric-card__footer">
                    <span className="metric-card__subtitle">Last 30 Days</span>
                    <span className="metric-card__delta metric-card__delta--up">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 19V5" stroke="currentColor" />
                        <path d="m5 12 7-7 7 7" stroke="currentColor" />
                      </svg>
                      3.52%
                    </span>
                  </div>
                </article>
              </div>
            </div>

            <div className="ui-lab-section">
              <h3 className="ui-lab-section-title">RevenueCard</h3>
              <p className="ui-lab-section-subtitle">Source: demo.tailadmin.com/sales (Total Revenue tile). Locked spec, 2026-05-06. Borderless 12px shell — distinct from MetricCard.</p>
              <div className="ui-lab-preview-width">
                <article className="revenue-card">
                  <div className="revenue-card__header">
                    <div className="revenue-card__title-block">
                      <h3 className="revenue-card__title">Total Revenue</h3>
                      <div className="revenue-card__delta-row">
                        <p className="revenue-card__delta revenue-card__delta--up">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M7.9974 2.66602L7.9974 13.3336M4 6.66334L7.99987 2.66602L12 6.66334" stroke="currentColor" />
                          </svg>
                          32%
                        </p>
                        <p className="revenue-card__delta-context">vs last month</p>
                      </div>
                    </div>
                    <svg
                      className="revenue-card__icon"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="12" y1="2" x2="12" y2="22" stroke="currentColor" />
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" />
                    </svg>
                  </div>
                  <div className="revenue-card__hero-row">
                    <h2 className="revenue-card__value">$10,590</h2>
                    <div className="revenue-card__sparkline-slot" aria-hidden="true">
                      <ReactApexChart
                        options={UI_LAB_SPARKLINE_OPTIONS}
                        series={[{ name: 'value', data: UI_LAB_SPARKLINE_SERIES }]}
                        type="area"
                        height={70}
                        width="100%"
                      />
                    </div>
                  </div>
                </article>
              </div>
            </div>

            <div className="ui-lab-section">
              <h3 className="ui-lab-section-title">StatisticsCard</h3>
              <p className="ui-lab-section-subtitle">Source: demo.tailadmin.com/sales (Users &amp; Revenue Statistics card). Locked spec, 2026-05-06. Chart implemented 2026-05-07.</p>
              <div className="ui-lab-preview-width--wide">
                <article className="statistics-card">
                  <div className="statistics-card__header">
                    <div className="statistics-card__title-block">
                      <h3 className="statistics-card__title">Users &amp; Revenue Statistics</h3>
                      <p className="statistics-card__subtitle">Visualize month-to-month progress and engagement.</p>
                    </div>
                    <div className="statistics-card__tabs" role="tablist">
                      {(['daily','weekly','monthly'] as const).map((id) => (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={uiLabStatsTab === id}
                          className={`statistics-card__tab${uiLabStatsTab === id ? ' statistics-card__tab--active' : ''}`}
                          onClick={() => setUiLabStatsTab(id)}
                        >
                          {id.charAt(0).toUpperCase() + id.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Pattern C custom legend — minor structural deviation: legend and chart
                      are named siblings (not wrapped in an anonymous block) so the chart
                      container can keep its locked 250px height without nesting. */}
                  <div className="statistics-card__legend" role="list">
                    <div className="statistics-card__legend-item" role="listitem">
                      <span
                        className="statistics-card__legend-marker"
                        style={{ background: '#465fff' }}
                        aria-hidden="true"
                      />
                      <span className="statistics-card__legend-label">Online Sales</span>
                    </div>
                    <div className="statistics-card__legend-item" role="listitem">
                      <span
                        className="statistics-card__legend-marker"
                        style={{ background: '#9cb9ff' }}
                        aria-hidden="true"
                      />
                      <span className="statistics-card__legend-label">Offline Sales</span>
                    </div>
                  </div>
                  <div className="statistics-card__chart">
                    <ReactApexChart
                      type="area"
                      height={250}
                      options={STATISTICS_CARD_OPTIONS}
                      series={STATISTICS_CARD_SERIES}
                    />
                  </div>
                </article>
              </div>
            </div>

            <div className="ui-lab-section">
              <h3 className="ui-lab-section-title">TotalBalanceCard</h3>
              <p className="ui-lab-section-subtitle">Source: demo.tailadmin.com/finance (Total Balance tile). Locked spec, 2026-05-15. Nested shell — outer 18px gray frame with bottom actions bar, inner 12px white card.</p>
              <div className="ui-lab-preview-width--medium">
                <article className="total-balance-card">
                  <div className="total-balance-card__inner">
                    <div className="total-balance-card__header">
                      <div className="total-balance-card__title-block">
                        <h3 className="total-balance-card__title">Total Balance</h3>
                        <p className="total-balance-card__subtitle">Your cash and balance for last 30 days</p>
                      </div>
                      <div className="total-balance-card__header-actions">
                        <button type="button" className="total-balance-card__dropdown">
                          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                            <circle cx="9" cy="9" r="9" fill="#3C3B6E" />
                            <path d="M9 0a9 9 0 0 1 0 18V0Z" fill="#B22234" />
                            <path d="M0 9h18" stroke="#FFFFFF" strokeWidth="0.6" />
                          </svg>
                          USD
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button type="button" className="total-balance-card__dropdown">
                          June 2025
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="total-balance-card__amount-row">
                      <div className="total-balance-card__amount-block">
                        <h2 className="total-balance-card__amount">19,857.00</h2>
                        <div className="total-balance-card__trend">
                          <span className="total-balance-card__trend-delta total-balance-card__trend-delta--up">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                              <path d="M8 13.333V2.667M4 6.663l4-3.996 4 3.996" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            3.2%
                          </span>
                          <span className="total-balance-card__trend-text">than last month</span>
                        </div>
                      </div>
                      <div className="total-balance-card__sparkline-slot" aria-hidden="true">
                        <ReactApexChart
                          options={TOTAL_BALANCE_SPARKLINE_OPTIONS}
                          series={[{ name: 'value', data: TOTAL_BALANCE_SPARKLINE_SERIES }]}
                          type="area"
                          height={70}
                          width="100%"
                        />
                      </div>
                    </div>

                    <div className="total-balance-card__account-row">
                      <span className="total-balance-card__account-label">Primary Account:</span>
                      <span className="total-balance-card__account-number">•••• •••• •••• 5332</span>
                      <div className="total-balance-card__account-actions">
                        <button type="button" className="total-balance-card__icon-btn" aria-label="Copy account number">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button type="button" className="total-balance-card__detail-btn">See Details</button>
                      </div>
                    </div>
                  </div>

                  <div className="total-balance-card__actions">
                    <button type="button" className="total-balance-card__action total-balance-card__action--primary">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Transfer
                    </button>
                    <button type="button" className="total-balance-card__action total-balance-card__action--secondary">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M17 7 7 17M7 9v8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Received
                    </button>
                    <button type="button" className="total-balance-card__action total-balance-card__action--icon" aria-label="More actions">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </article>
              </div>
            </div>
          </div>
        )}
      </section>

      </div>
    </div>
  );
}