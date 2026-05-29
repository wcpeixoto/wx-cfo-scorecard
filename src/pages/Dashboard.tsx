import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { STORAGE_KEYS } from '../config';
import { useLocation, useNavigate } from 'react-router';
import { AppSidebar } from '../components/AppSidebar';
import { AppHeader } from '../components/AppHeader';
import { useSidebar } from '../context/SidebarContext';
import CashFlowForecastModule from '../components/CashFlowForecastModule';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import ProjectionTableV2 from '../components/ProjectionTableV2';
import LoadingScreen from '../components/LoadingScreen';
import DigHereHighlights from '../components/DigHereHighlights';
import CashTrendHero from '../components/CashTrendHero';
import IncomeExpenseCard from '../components/IncomeExpenseCard';
import PayrollEfficiencyCard from '../components/PayrollEfficiencyCard';
import CashReserveCalendarCard from '../components/CashReserveCalendarCard';
import KpiCards from '../components/KpiCards';
import TopCategoriesCard from '../components/TopCategoriesCard';
import PeriodDropdown from '../components/PeriodDropdown';
import NetCashFlowChart from '../components/NetCashFlowChart';
import { TodayPage } from '../components/TodayPage';
import { NextOwnerDistributionCardLab } from '../components/NextOwnerDistributionCardLab';
import { SecondaryPrioritiesLab } from '../components/SecondaryPrioritiesLab';
import { CfoAssistantCard } from '../components/CfoAssistantCard';
import { ProjectionCompareDrawer } from '../components/ProjectionCompareDrawer';
import { EfficiencyOpportunitiesCard } from '../components/EfficiencyOpportunitiesCard';
import { BusinessValuationCard } from '../components/BusinessValuationCard';
import {
  computeBusinessValuation,
  computeTtmOperatingProfit,
  type DriverGrade,
  type Range as BVRange,
} from '../lib/kpis/businessValuation';
import {
  computeValuationProjection,
  isValuationScenarioActive,
} from '../lib/kpis/valuationProjection';
import ContractsSettingsPane from '../components/ContractsSettingsPane';
import { computeEfficiencyOpportunities } from '../lib/kpis/efficiencyOpportunities';
import { computeLinearTrendLine, computeProgressiveMovingAverage } from '../lib/charts/movingAverage';
import { discoverAccountRecords, mergeDiscoveredAccountRecords, parseStoredAccountRecords } from '../lib/accounts';
import { isCapitalDistributionCategory } from '../lib/cashFlow';
import { computeWhatNeedsAttention } from '../lib/kpis/digHere';
import { computeCashTrend } from '../lib/kpis/cashTrend';
import { computeCashTrendDelta } from '../lib/data/cashTrendDelta';
import { buildCashBalanceSeries } from '../lib/data/balanceSeries';
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
  computeExpenseSlices,
  computeKpiComparisons,
  computeMonthlyRollups,
  computeReserveCoverageDelta,
  projectScenario,
  toMonthLabel,
} from '../lib/kpis/compute';
import { projectCategoryCadenceScenario } from '../lib/kpis/categoryCadence';
import { composeSplitConservative } from '../lib/kpis/splitConservative';
import { composeConservativeFloor } from '../lib/kpis/conservativeFloor';
import { applyEventsOverlay } from '../lib/kpis/applyEventsOverlay';
import { generateRenewalEvents } from '../lib/forecast/generateRenewalEvents';
import { expandRecurringEvents } from '../lib/forecast/expandRecurringEvents';
import { applyForecastFineTune } from '../lib/forecast/scenarioMath';
import { extendComposedProjection } from '../lib/forecast/extendComposedProjection';
import { TODAY_RUN_OUT_HORIZON_MONTHS } from '../lib/priorities/signals';
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
  | 'what-if'
  | 'settings'
  | 'ui-lab';

type BigPictureFrameValue = KpiComparisonTimeframe | 'custom';
type KpiFrameOption = { value: BigPictureFrameValue; label: string };
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
// Presets carry the slider DELTA on top of the Settings-saved fine-tune.
// Base = 0/0 (no extra adjustment); Best/Worst carry the saved deltas as
// they did before but now compound multiplicatively with Settings at
// projection-call time via applyForecastFineTune. Other slider fields
// remain canonical defaults shared across scenarios.
function getForecastScenarioPresets(
  settings: Pick<
    BusinessRules,
    | 'scenarioBestRevenueGrowthPct'
    | 'scenarioBestExpenseChangePct'
    | 'scenarioWorstRevenueGrowthPct'
    | 'scenarioWorstExpenseChangePct'
  >
): Record<Exclude<ForecastScenarioKey, 'custom'>, ScenarioInput> {
  return {
    base: {
      scenarioKey: 'base',
      revenueGrowthPct: 0,
      expenseChangePct: 0,
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

function openNativeDatePicker(event: React.MouseEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
    } catch {
      // showPicker may be blocked (no user activation) or unsupported; native typing still works.
    }
  }
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
// Top Expense Categories has its own timeframe, independent of the header.
// No 'custom' — the card has no date inputs of its own.
const TOP_CATEGORIES_FRAME_OPTIONS: KpiFrameOption[] = BIG_PICTURE_FRAME_OPTIONS.filter(
  (option) => option.value !== 'custom',
);
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
const EPSILON = 0.00001;
type TrendTimeframeOption = 6 | 12 | 24 | 36 | 'all';
const TREND_TIMEFRAMES: TrendTimeframeOption[] = [6, 12, 24, 36, 'all'];

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
    accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
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
    accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
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
    accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
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


function parseCashFlowMode(value: string | null): CashFlowMode | null {
  if (value === 'operating' || value === 'total') return value;
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
  const bigPictureFilterMenuRef = useRef<HTMLDivElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
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
  const [topCategoriesTimeframe, setTopCategoriesTimeframe] = useState<KpiComparisonTimeframe>('lastMonth');
  const [netCashFlowChartMode, setNetCashFlowChartMode] = useState<CashFlowMode>('operating');
  const [forecastRange, setForecastRange] = useState<ForecastRangeValue>('6m');
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

    setNetCashFlowChartMode(cashFlow ?? 'operating');
    setQuery(nextQuery ?? '');
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

  // True daily cash balance series for cash-included accounts. Same recipe
  // as `currentCashBalance` above (startingBalance + Σ rawAmount), evaluated
  // at every calendar day in the txn window. Feeds the Cash on Hand
  // sparkline + 30-day-average delta, and (via priorCashBalance) the
  // Operating Reserve coverage delta.
  const cashBalanceSeries = useMemo(
    () => buildCashBalanceSeries(baseTxns, accountRecords),
    [baseTxns, accountRecords],
  );
  const cashTrendData = useMemo(
    () => computeCashTrendDelta(cashBalanceSeries, currentCashBalance, latestAvailableTxnDate),
    [cashBalanceSeries, currentCashBalance, latestAvailableTxnDate],
  );
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
  const includedCashAccountCount = useMemo(
    () => includedForecastAccounts.filter((record) => record.accountType === 'Cash').length,
    [includedForecastAccounts]
  );
  const forecastFoundationWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (includedForecastAccounts.length === 0) {
      warnings.push('No accounts are currently marked In Forecast yet.');
      return warnings;
    }
    if (!hasCurrentCashBalance) {
      warnings.push(
        `All accounts marked In Forecast have a $0 starting balance, so forecast can only show cumulative change instead of absolute cash in bank.`
      );
    }
    if (includedForecastAccountsMissingStartingBalance.length > 0) {
      warnings.push(
        `${summarizeAccountNames(includedForecastAccountsMissingStartingBalance)} still need a starting balance as of ${forecastWindowStartLabel}.`
      );
    }
    if (includedNonCashForecastAccounts.length > 0) {
      warnings.push(
        `${summarizeAccountNames(includedNonCashForecastAccounts)} are included in forecast even though their account type is not Cash. Double-check that they should contribute to cash balance.`
      );
    }
    return warnings;
  }, [
    forecastWindowStartLabel,
    hasCurrentCashBalance,
    includedForecastAccounts.length,
    includedForecastAccountsMissingStartingBalance,
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

  // Business Valuation — SDE-method composer. Pure selector over
  // monthlyRollups (TTM operating profit) + businessRules (SDE add-backs,
  // multiple range, replacement cost, driver grades, lease metadata).
  const businessValuationResult = useMemo(() => {
    const ttmOperatingProfit = computeTtmOperatingProfit(
      model.monthlyRollups,
      new Date()
    );
    const replacementCost: BVRange | null =
      businessRules.replacementCostLower !== null &&
      businessRules.replacementCostUpper !== null
        ? {
            lower: businessRules.replacementCostLower,
            upper: businessRules.replacementCostUpper,
          }
        : null;
    return computeBusinessValuation(
      {
        ttmOperatingProfit,
        ownerW2Compensation: businessRules.ownerW2Compensation,
        personalExpensesThroughBusiness:
          businessRules.personalExpensesThroughBusiness,
        oneTimeExpensesToAddBack: businessRules.oneTimeExpensesToAddBack,
        oneTimeGainsToSubtract: businessRules.oneTimeGainsToSubtract,
        replacementCost,
        driverGrades: {
          recurringRevenue: businessRules.driverGradeRecurringRevenue,
          financialClarity: businessRules.driverGradeFinancialClarity,
          churnTracking: businessRules.driverGradeChurnTracking,
          coachDepth: businessRules.driverGradeCoachDepth,
          ownerIndependence: businessRules.driverGradeOwnerIndependence,
          brandStrength: businessRules.driverGradeBrandStrength,
        },
        lease: {
          startDate: businessRules.leaseStartDate,
          endDate: businessRules.leaseEndDate,
          renewalOption: businessRules.leaseRenewalOption,
          renewalYears: businessRules.leaseRenewalYears,
        },
      },
      new Date()
    );
  }, [
    model.monthlyRollups,
    businessRules.ownerW2Compensation,
    businessRules.personalExpensesThroughBusiness,
    businessRules.oneTimeExpensesToAddBack,
    businessRules.oneTimeGainsToSubtract,
    businessRules.replacementCostLower,
    businessRules.replacementCostUpper,
    businessRules.driverGradeRecurringRevenue,
    businessRules.driverGradeFinancialClarity,
    businessRules.driverGradeChurnTracking,
    businessRules.driverGradeCoachDepth,
    businessRules.driverGradeOwnerIndependence,
    businessRules.driverGradeBrandStrength,
    businessRules.leaseStartDate,
    businessRules.leaseEndDate,
    businessRules.leaseRenewalOption,
    businessRules.leaseRenewalYears,
  ]);

  const handleBusinessValuationReplacementCostChange = useCallback(
    (range: BVRange | null) => {
      updateBusinessRules({
        replacementCostLower: range === null ? null : range.lower,
        replacementCostUpper: range === null ? null : range.upper,
      });
    },
    [updateBusinessRules]
  );

  const handleBusinessValuationDriverGradeChange = useCallback(
    (
      key:
        | 'recurringRevenue'
        | 'financialClarity'
        | 'churnTracking'
        | 'coachDepth'
        | 'ownerIndependence'
        | 'brandStrength',
      grade: DriverGrade
    ) => {
      const patch: Partial<typeof businessRules> =
        key === 'recurringRevenue'
          ? { driverGradeRecurringRevenue: grade }
          : key === 'financialClarity'
            ? { driverGradeFinancialClarity: grade }
            : key === 'churnTracking'
              ? { driverGradeChurnTracking: grade }
              : key === 'coachDepth'
                ? { driverGradeCoachDepth: grade }
                : key === 'ownerIndependence'
                  ? { driverGradeOwnerIndependence: grade }
                  : { driverGradeBrandStrength: grade };
      updateBusinessRules(patch);
    },
    [updateBusinessRules]
  );
  // Operating Reserve coverage delta — computed here so the locked
  // computeReserveCoverageDelta no longer needs to walk back through
  // monthlyRollups for a prior cash balance. priorCashBalance comes from
  // the reconstructed-balance series via cashTrendData.
  const reserveCoverageDelta = useMemo(() => {
    const priorCashBalance =
      cashTrendData.series.length >= 2
        ? cashTrendData.series[cashTrendData.series.length - 2]
        : null;
    return computeReserveCoverageDelta(
      model.monthlyRollups,
      currentCashBalance,
      model.runway.reserveTarget,
      priorCashBalance,
    );
  }, [cashTrendData, currentCashBalance, model.monthlyRollups, model.runway.reserveTarget]);
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
        simulatedTimeframes: TREND_TIMEFRAMES.map((item) => `${item}m`).join(', '),
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

  // Composer's 12-month projection — Engine + Cadence + Reality/Recovery
  // composition. Captured separately so both the user-selected horizon
  // (forecastProjection below) and the fixed 24-month Today run-out signal
  // (todayRunOutNegativeCashMonth below) can extend from the same composed
  // output without re-running the composer. Both Engine and Cadence projections
  // are computed as composer inputs. Known Events are intentionally excluded
  // from composer inputs (events=[]) — see composeSplitConservative /
  // composeConservativeFloor policy notes for the symmetric one-sided-event
  // rationale. Cadence is hardcoded to a 12-month horizon (HORIZON_MONTHS in
  // categoryCadence.ts); composers throw on length mismatch by design
  // ("Caller responsibility to handle horizons beyond Cadence's reach").
  // Compose at 12 months and extend at the caller layer (see below).
  const forecastComposed = useMemo(
    () => {
      const fcT0 = performance.now();
      const scenarioWithMonths = {
        ...scenarioInput,
        months: Math.max(scenarioInput.months, forecastRangeMonths),
      };
      const COMPOSER_MONTHS_CAP = 12;
      const composerInput = applyForecastFineTune(
        {
          ...scenarioWithMonths,
          months: Math.min(scenarioWithMonths.months, COMPOSER_MONTHS_CAP),
        },
        businessRules.scenarioBaseRevenueGrowthPct ?? 0,
        businessRules.scenarioBaseExpenseChangePct ?? 0,
      );
      const engineProj = projectScenario(
        model,
        composerInput,
        currentCashBalance,
        []
      );
      const cadenceProj = projectCategoryCadenceScenario(
        model,
        composerInput,
        filteredTxns,
        currentCashBalance,
        []
      );
      // Reality (default) → Conservative Floor; Recovery → Split Conservative.
      // Defensive fallback: any unexpected posture value routes to Reality.
      const composed =
        businessRules.forecastPosture === 'recovery'
          ? composeSplitConservative(engineProj, cadenceProj, currentCashBalance)
          : composeConservativeFloor(engineProj, cadenceProj, currentCashBalance);
      if (import.meta.env.DEV && !bootPhaseLoggedRef.current.forecast && model.monthlyRollups.length > 0) {
        bootPhaseLoggedRef.current.forecast = true;
        console.log('[BOOT] Forecast compute:', Math.round(performance.now() - fcT0), 'ms');
      }
      return composed;
    },
    [filteredTxns, currentCashBalance, businessRules.forecastPosture, businessRules.scenarioBaseRevenueGrowthPct, businessRules.scenarioBaseExpenseChangePct, forecastRangeMonths, model, scenarioInput]
  );

  // Active forecast at the user-selected horizon. 2Y/3Y horizons extend the
  // 12-month composed historical-pattern forecast by repeating the monthly
  // pattern (flat, month-of-year aligned) and walking the running balance
  // forward. Composer inputs remain capped at 12 months because Cadence does
  // not extrapolate beyond its window. This is the caller-layer extension
  // policy locked in 2c.1. Known Events overlay applied after extension.
  const forecastProjection = useMemo(
    () => {
      const requestedMonths = Math.max(scenarioInput.months, forecastRangeMonths);
      const points = extendComposedProjection(forecastComposed, currentCashBalance, requestedMonths, expandedForecastEvents);
      return { points, seasonality: forecastComposed.seasonality };
    },
    [forecastComposed, scenarioInput.months, forecastRangeMonths, currentCashBalance, expandedForecastEvents]
  );
  const scenarioProjection = useMemo(() => forecastProjection.points, [forecastProjection.points]);
  const forecastSeasonality = useMemo(() => forecastProjection.seasonality, [forecastProjection.seasonality]);
  const visibleScenarioProjection = useMemo(
    () => scenarioProjection.slice(0, forecastRangeMonths),
    [forecastRangeMonths, scenarioProjection]
  );

  // Baseline projection — the operator's "default forecast" (the `base`
  // preset) projected through the same pipeline as scenarioProjection,
  // for the What-If chart's faded overlay. Two intentional choices:
  //   (1) "Baseline" = forecastScenarioPresets.base (which IS parameterized
  //       by businessRules.scenarioBase* settings). When the operator edits
  //       their business-rules base, they have moved their declared default
  //       on purpose — the overlay tracks that, not a frozen prior state.
  //   (2) The pipeline is duplicated inline rather than factored. The only
  //       difference from forecastProjection is the scenario-input object;
  //       factoring would touch the shared composer pathway used by the
  //       active forecast and ownerPayProjection (also inlined). Keeping
  //       the three call sites independent matches the existing pattern.
  // Short-circuits to null when the active scenario IS the base preset —
  // current === baseline → no overlay to draw, no compute cost paid.
  const baselineProjection = useMemo<ScenarioPoint[] | null>(() => {
    if (selectedScenarioKey === 'base') return null;
    const baseScenario = forecastScenarioPresets.base;
    const scenarioWithMonths = {
      ...baseScenario,
      months: Math.max(baseScenario.months, forecastRangeMonths),
    };
    const COMPOSER_MONTHS_CAP = 12;
    const composerInput = applyForecastFineTune(
      {
        ...scenarioWithMonths,
        months: Math.min(scenarioWithMonths.months, COMPOSER_MONTHS_CAP),
      },
      businessRules.scenarioBaseRevenueGrowthPct ?? 0,
      businessRules.scenarioBaseExpenseChangePct ?? 0,
    );
    const engineProj = projectScenario(
      model,
      composerInput,
      currentCashBalance,
      []
    );
    const cadenceProj = projectCategoryCadenceScenario(
      model,
      composerInput,
      filteredTxns,
      currentCashBalance,
      []
    );
    const composed =
      businessRules.forecastPosture === 'recovery'
        ? composeSplitConservative(engineProj, cadenceProj, currentCashBalance)
        : composeConservativeFloor(engineProj, cadenceProj, currentCashBalance);

    const requestedMonths = scenarioWithMonths.months;
    let result = composed;
    if (requestedMonths > composed.points.length && composed.points.length > 0) {
      const sourceByMonthOfYear = new Map<string, ScenarioPoint>();
      for (const p of composed.points) {
        const moy = p.month.slice(5, 7);
        if (!sourceByMonthOfYear.has(moy)) sourceByMonthOfYear.set(moy, p);
      }
      const firstMonth = composed.points[0].month;
      const extended: ScenarioPoint[] = [];
      let prevBalance = currentCashBalance;
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
        if (!source) break;
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
    return applyEventsOverlay(result.points, expandedForecastEvents);
  }, [
    selectedScenarioKey,
    forecastScenarioPresets,
    forecastRangeMonths,
    businessRules.forecastPosture,
    businessRules.scenarioBaseRevenueGrowthPct,
    businessRules.scenarioBaseExpenseChangePct,
    expandedForecastEvents,
    filteredTxns,
    currentCashBalance,
    model,
  ]);
  const forecastDecisionSignals = useMemo(
    () => computeForecastDecisionSignals(scenarioProjection, model.runway.reserveTarget),
    [model.runway.reserveTarget, scenarioProjection]
  );

  // Valuation projection — slider-driven "actual" leg + slider-neutral
  // "goal" leg fed into BusinessValuationCard. Shares the same first-12
  // basis as the decision-card averages above (DECISION_WINDOW_MONTHS).
  // Goal leg pulls from baselineProjection (base preset, slider-neutral);
  // when the active scenario IS the base, baselineProjection is null and
  // scenarioProjection IS the slider-neutral basis.
  //
  // Hero state gate: card uses the TTM-based current valuation by default
  // and only renders the scenario projection when revenue/expense sliders
  // are active. AR/AP day controls deliberately excluded — see
  // isValuationScenarioActive comments.
  const isValuationScenarioActiveNow = isValuationScenarioActive(scenarioInput);
  const valuationProjectionResult = useMemo(() => {
    const goalTargetMargin =
      businessRules.targetNetMargin != null && businessRules.targetNetMargin > 0
        ? businessRules.targetNetMargin
        : 0.25;
    return computeValuationProjection({
      forecastPoints: scenarioProjection,
      baselineForecastPoints: baselineProjection ?? scenarioProjection,
      // Anchor for the delta-SDE actual leg. ttmSde already includes
      // add-backs (computeSde in businessValuation.ts), so the actual
      // leg does NOT re-apply them — see valuationProjection.ts header.
      currentTtmSde: businessValuationResult.ttmSde,
      addBacks: {
        ownerW2Compensation: businessRules.ownerW2Compensation,
        personalExpensesThroughBusiness:
          businessRules.personalExpensesThroughBusiness,
        oneTimeExpensesToAddBack: businessRules.oneTimeExpensesToAddBack,
        oneTimeGainsToSubtract: businessRules.oneTimeGainsToSubtract,
      },
      derivedMultiple: businessValuationResult.derivedMultiple,
      displayMultipleRange: businessValuationResult.displayMultipleRange,
      effectiveTargetNetMargin: goalTargetMargin,
    });
  }, [
    scenarioProjection,
    baselineProjection,
    businessRules.targetNetMargin,
    businessRules.ownerW2Compensation,
    businessRules.personalExpensesThroughBusiness,
    businessRules.oneTimeExpensesToAddBack,
    businessRules.oneTimeGainsToSubtract,
    businessValuationResult.derivedMultiple,
    businessValuationResult.displayMultipleRange,
    businessValuationResult.ttmSde,
  ]);

  // Today's Cash on Hand "projected to run out" signal — sourced from a
  // dedicated 24-month projection so the row can't be silenced by a shorter
  // Forecast-page display window. The 12-month priority/badge pipeline
  // (detectSignals → TODAY_FORWARD_CASH_WINDOW_MONTHS) is intentionally
  // unchanged: badge = near-term severity, body row = longer-horizon outlook.
  // When the user already has ≥24m selected on Forecast, reuse the active
  // projection. Events re-expanded to the longer horizon so a recurring
  // event at month 13–24 still applies.
  const todayRunOutEvents = useMemo(
    () => expandRecurringEvents(forecastEvents, TODAY_RUN_OUT_HORIZON_MONTHS),
    [forecastEvents]
  );
  const todayRunOutNegativeCashMonth = useMemo<string | null>(() => {
    const projection = forecastRangeMonths >= TODAY_RUN_OUT_HORIZON_MONTHS
      ? forecastProjection.points
      : extendComposedProjection(forecastComposed, currentCashBalance, TODAY_RUN_OUT_HORIZON_MONTHS, todayRunOutEvents);
    return projection.find((point) => point.endingCashBalance < -EPSILON)?.month ?? null;
  }, [forecastComposed, currentCashBalance, forecastRangeMonths, forecastProjection.points, todayRunOutEvents]);

  // Dedicated projection for the Next Owner Distribution card. It mirrors
  // the forecastProjection pipeline above but FORCES three params,
  // independent of selectedScenarioKey / forecastPosture / forecastRangeMonths:
  //   - Scenario: Base preset (never custom).
  //   - Posture:  Reality — always composeConservativeFloor.
  //   - Horizon:  15 months (caller-layer month-of-year extension; the
  //               12-month composer cap is unchanged).
  // Known-events parity: the same applyEventsOverlay step on the same basis
  // as the main forecast, but expanded to >= 15 months so a short UI range
  // (default 3) does not under-count recurring events in the 15-month window.
  const OWNER_PAY_HORIZON_MONTHS = 15;
  const ownerPayExpandedEvents = useMemo(
    () =>
      expandRecurringEvents(
        forecastEvents,
        Math.max(OWNER_PAY_HORIZON_MONTHS, forecastRangeMonths)
      ),
    [forecastEvents, forecastRangeMonths]
  );
  const ownerPayProjection = useMemo(() => {
    const baseScenario = forecastScenarioPresets.base;
    const scenarioWithMonths = {
      ...baseScenario,
      months: Math.max(baseScenario.months, OWNER_PAY_HORIZON_MONTHS),
    };
    const COMPOSER_MONTHS_CAP = 12;
    const composerInput = applyForecastFineTune(
      {
        ...scenarioWithMonths,
        months: Math.min(scenarioWithMonths.months, COMPOSER_MONTHS_CAP),
      },
      businessRules.scenarioBaseRevenueGrowthPct ?? 0,
      businessRules.scenarioBaseExpenseChangePct ?? 0,
    );
    const engineProj = projectScenario(
      model,
      composerInput,
      currentCashBalance,
      []
    );
    const cadenceProj = projectCategoryCadenceScenario(
      model,
      composerInput,
      filteredTxns,
      currentCashBalance,
      []
    );
    // Reality posture only — always Conservative Floor, never Split.
    const composed = composeConservativeFloor(
      engineProj,
      cadenceProj,
      currentCashBalance
    );

    const requestedMonths = scenarioWithMonths.months;
    let result = composed;
    if (requestedMonths > composed.points.length && composed.points.length > 0) {
      const sourceByMonthOfYear = new Map<string, ScenarioPoint>();
      for (const p of composed.points) {
        const moy = p.month.slice(5, 7);
        if (!sourceByMonthOfYear.has(moy)) sourceByMonthOfYear.set(moy, p);
      }
      const firstMonth = composed.points[0].month;
      const extended: ScenarioPoint[] = [];
      let prevBalance = currentCashBalance;
      for (let i = 0; i < requestedMonths; i += 1) {
        if (i < composed.points.length) {
          const p = composed.points[i];
          extended.push(p);
          prevBalance = p.endingCashBalance;
          continue;
        }
        const monthToken =
          addMonthsToToken(firstMonth, i) ??
          composed.points[i % composed.points.length].month;
        const sourceMoy = monthToken.slice(5, 7);
        const source = sourceByMonthOfYear.get(sourceMoy);
        if (!source) break;
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
    // Same overlay step, same basis as the main forecast, but expanded to
    // >= 15 months (ownerPayExpandedEvents). Empty events → input unchanged.
    return applyEventsOverlay(result.points, ownerPayExpandedEvents);
  }, [
    filteredTxns,
    currentCashBalance,
    forecastScenarioPresets,
    businessRules.scenarioBaseRevenueGrowthPct,
    businessRules.scenarioBaseExpenseChangePct,
    ownerPayExpandedEvents,
    model,
  ]);
  // Effective reserve floor — identical to the Forecast safety-line rule
  // (Settings fixed-reserve override aware), NOT raw model.runway.reserveTarget.
  const ownerPayReserveFloor =
    businessRules.safetyReserveMethod === 'fixed' &&
    businessRules.safetyReserveAmount > 0
      ? businessRules.safetyReserveAmount
      : model.runway.reserveTarget;

  // Slider re-projection: given a revenueGrowthPct override, re-runs the
  // identical pipeline used to build ownerPayProjection but with the
  // supplied growth rate substituted. Called from NextOwnerDistributionCard
  // on slider change (session-only, no persistence).
  const reprojectOwnerPay = useCallback(
    (revenueGrowthPct: number): ScenarioPoint[] => {
      const baseScenario = forecastScenarioPresets.base;
      const scenarioWithMonths = {
        ...baseScenario,
        revenueGrowthPct,
        months: Math.max(baseScenario.months, OWNER_PAY_HORIZON_MONTHS),
      };
      const COMPOSER_MONTHS_CAP = 12;
      const composerInput = applyForecastFineTune(
        {
          ...scenarioWithMonths,
          months: Math.min(scenarioWithMonths.months, COMPOSER_MONTHS_CAP),
        },
        businessRules.scenarioBaseRevenueGrowthPct ?? 0,
        businessRules.scenarioBaseExpenseChangePct ?? 0,
      );
      const engineProj = projectScenario(
        model,
        composerInput,
        currentCashBalance,
        []
      );
      const cadenceProj = projectCategoryCadenceScenario(
        model,
        composerInput,
        filteredTxns,
        currentCashBalance,
        []
      );
      const composed = composeConservativeFloor(
        engineProj,
        cadenceProj,
        currentCashBalance
      );
      const requestedMonths = scenarioWithMonths.months;
      let result = composed;
      if (requestedMonths > composed.points.length && composed.points.length > 0) {
        const sourceByMonthOfYear = new Map<string, ScenarioPoint>();
        for (const p of composed.points) {
          const moy = p.month.slice(5, 7);
          if (!sourceByMonthOfYear.has(moy)) sourceByMonthOfYear.set(moy, p);
        }
        const firstMonth = composed.points[0].month;
        const extended: ScenarioPoint[] = [];
        let prevBalance = currentCashBalance;
        for (let i = 0; i < requestedMonths; i += 1) {
          if (i < composed.points.length) {
            const p = composed.points[i];
            extended.push(p);
            prevBalance = p.endingCashBalance;
            continue;
          }
          const monthToken =
            addMonthsToToken(firstMonth, i) ??
            composed.points[i % composed.points.length].month;
          const sourceMoy = monthToken.slice(5, 7);
          const source = sourceByMonthOfYear.get(sourceMoy);
          if (!source) break;
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
      return applyEventsOverlay(result.points, ownerPayExpandedEvents);
    },
    [
      filteredTxns,
      currentCashBalance,
      forecastScenarioPresets,
      businessRules.scenarioBaseRevenueGrowthPct,
      businessRules.scenarioBaseExpenseChangePct,
      ownerPayExpandedEvents,
      model,
    ]
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
  const cashFlowForecastBaselineTrend = useMemo<TrendPoint[] | null>(() => {
    if (!baselineProjection) return null;
    return baselineProjection.slice(0, forecastRangeMonths).map((point) => ({
      month: point.month,
      income: point.cashIn,
      expense: point.cashOut,
      net: point.netCashFlow,
    }));
  }, [baselineProjection, forecastRangeMonths]);
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
      metricToCard('net', 'Profit', selectedKpiComparison.netCashFlow),
      metricToCard('savingsRate', 'Profit Margin', selectedKpiComparison.savingsRate),
    ];
  }, [selectedKpiComparison, model.kpiCards]);

  // Ambient 12-month trailing series for the Revenue & Expenses mini-card
  // sparklines. Independent of the header timeframe; sourced from monthly
  // rollups so no new computation is required. Filter to calendar-complete
  // months only (matches the NetCashFlow chart's pipeline, compute.ts:1934)
  // so a partial current month can't produce a synchronized revenue/expense
  // cliff at the right edge.
  const kpiSparklinesById = useMemo<Record<string, { data: number[]; color: string }>>(() => {
    const completed = previousCalendarMonth
      ? model.monthlyRollups.filter((rollup) => rollup.month <= previousCalendarMonth)
      : model.monthlyRollups;
    const last12 = completed.slice(-12);
    if (last12.length < 2) return {};
    const sparks: Record<string, { data: number[]; color: string }> = {
      income: { data: last12.map((rollup) => rollup.revenue), color: chartTokens.brand },
      expense: { data: last12.map((rollup) => rollup.expenses), color: chartTokens.costSpike },
    };
    return sparks;
  }, [model.monthlyRollups, previousCalendarMonth]);

  const topCategoriesBreakdown = useMemo(() => {
    const comparison = model.kpiYoYComparisonByTimeframe[topCategoriesTimeframe];
    const startMonth = comparison?.currentStartMonth;
    const endMonth = comparison?.currentEndMonth;
    if (!startMonth || !endMonth) {
      return computeExpenseSlices([], profitabilityCashFlowMode);
    }
    const periodTxns = filteredTxns.filter((txn) => txn.month >= startMonth && txn.month <= endMonth);
    return computeExpenseSlices(periodTxns, profitabilityCashFlowMode);
  }, [model.kpiYoYComparisonByTimeframe, topCategoriesTimeframe, filteredTxns, profitabilityCashFlowMode]);

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


  const sustainability = useMemo<Array<{ label: string; value: string; evidence?: string }>>(() => {
    // Sustainability is a FIXED Big Picture health basis: last complete month vs
    // the same month last year (YoY). It deliberately does NOT read the KPI
    // timeframe — those controls now live on Today, and Big Picture health must
    // not react to a Today-only control. Same trend rule as metricToCard.
    const healthBasis = model.kpiYoYComparisonByTimeframe.lastMonth;
    const trendOf = (metric: { current: number; previous: number } | undefined) => {
      if (!metric) return 'flat';
      const delta = metric.current - metric.previous;
      return Math.abs(delta) <= EPSILON ? 'flat' : delta > 0 ? 'up' : 'down';
    };
    // Revenue Momentum / Cost Discipline evidence shares the badge's exact basis:
    // last-complete-month YoY (healthBasis), via the same trendOf used for the
    // badge — so the evidence direction can never contradict the verdict, and it
    // never reads the in-progress month. No MoM, no streak (a single YoY
    // {current, previous} carries no streak history).
    const formatYoYEvidence = (
      metric: { current: number; previous: number } | undefined,
    ): string | undefined => {
      if (!metric) return undefined;
      const direction = trendOf(metric);
      if (direction === 'flat') return 'Flat YoY';
      const pct =
        Math.abs(metric.previous) <= EPSILON
          ? null
          : Math.round((Math.abs(metric.current - metric.previous) / Math.abs(metric.previous)) * 100);
      const directionLabel = direction === 'up' ? 'Up' : 'Down';
      const pctText = pct === null ? '' : ` ${pct}%`;
      return `${directionLabel}${pctText} YoY`;
    };

    // Monthly Cash Result evidence: verb carries direction (figure is always
    // unsigned), plus a same-sign streak walked backward from the latest
    // rollup. $0 counts as non-negative — matches the badge's `>= 0 ? Healthy`
    // rule, so a $0 month is "Added" and breaks a negative streak.
    let monthlyCashEvidence: string | undefined;
    if (latestRollup) {
      const isNegative = latestRollup.netCashFlow < 0;
      const verb = isNegative ? 'Burned' : 'Added';
      const amount = formatCurrency(Math.abs(latestRollup.netCashFlow));
      let streak = 0;
      for (let i = model.monthlyRollups.length - 1; i >= 0; i--) {
        if ((model.monthlyRollups[i].netCashFlow < 0) !== isNegative) break;
        streak++;
      }
      const streakClause = streak > 1 ? ` · ${streak} months in a row` : '';
      monthlyCashEvidence = `${verb} ${amount} this month${streakClause}`;
    }
    const consistencyWindow = model.monthlyRollups.slice(-6);
    const positiveMonths = consistencyWindow.filter((rollup) => rollup.netCashFlow >= 0).length;
    const consistencyEvidence =
      consistencyWindow.length >= 6
        ? `${positiveMonths} of last 6 months positive`
        : `${model.monthlyRollups.length} months imported`;

    return [
      {
        label: 'Revenue Momentum',
        value: trendOf(healthBasis?.revenue) === 'up' ? 'Getting Better' : 'Getting Worse',
        evidence: formatYoYEvidence(healthBasis?.revenue),
      },
      {
        label: 'Cost Discipline',
        value: trendOf(healthBasis?.expenses) === 'down' ? 'Getting Better' : 'Needs Attention',
        evidence: formatYoYEvidence(healthBasis?.expenses),
      },
      {
        label: 'Monthly Cash Result',
        value: (latestRollup?.netCashFlow ?? 0) >= 0 ? 'Healthy' : 'Negative',
        evidence: monthlyCashEvidence,
      },
      {
        label: 'Consistency',
        value: model.monthlyRollups.length >= 6 ? 'Long-term Visible' : 'Need More History',
        evidence: consistencyEvidence,
      },
    ];
  }, [latestRollup, model.kpiYoYComparisonByTimeframe.lastMonth, model.monthlyRollups]);


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
      },
      mode: 'push' | 'replace' = 'push'
    ) => {
      const params = new URLSearchParams();
      if (next.cashFlow !== 'operating') params.set('cf', next.cashFlow);
      if (next.queryText?.trim()) params.set('q', next.queryText.trim());

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

      writeDashboardUrlState({
        tab: nextTab,
        cashFlow: netCashFlowChartMode,
        queryText: query,
      });
    },
    [netCashFlowChartMode, query, writeDashboardUrlState]
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

        {/* KPI snapshot — moved here from the Big Picture header. KPI state is still
            owned by Dashboard.tsx (rendered above TodayPage, which is untouched). The
            top-bar--big-picture / bp-overview-tray class names are legacy from the
            block's previous home on Big Picture. */}
        {hasImportedData && activeTab === 'today' && (
          <header className="top-bar glass-panel top-bar--big-picture">
            <div className="top-bar-main">
              <div className="top-bar-copy">
                <h2>{selectedBigPictureTitle}</h2>
                <p className="top-bar-context">{selectedHeaderComparisonLabel}</p>
              </div>

              <div className="top-controls top-controls-timeframe">
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
                        <ul className="timeframe-list" role="menu" aria-label="Select KPI timeframe">
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
                    <div className="kpi-custom-range" aria-label="Custom KPI date range">
                      <label>
                        <span>Start</span>
                        <input
                          type="date"
                          onClick={openNativeDatePicker}
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
                          onClick={openNativeDatePicker}
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
              </div>
            </div>
            <div className="bp-overview-tray">
              <KpiCards cards={selectedKpiCards} vsLabel={kpiVsLabel} sparklinesById={kpiSparklinesById} />
            </div>
            <p className="data-trust-note">Excludes transfers &amp; financing · operating cash flow only</p>
          </header>
        )}

        {hasImportedData && activeTab === 'today' && (
          <TodayPage
            model={model}
            txns={filteredTxns}
            forecastProjection={scenarioProjection}
            negativeCashMonth={todayRunOutNegativeCashMonth}
            ownerPayProjection={ownerPayProjection}
            ownerPayReserveFloor={ownerPayReserveFloor}
            targetNetMargin={businessRules.targetNetMargin}
            onCompareYear={(year) => setCompareDrawerYear(year)}
            reprojectOwnerPay={reprojectOwnerPay}
            cashTrendData={cashTrendData}
            reserveCoverageDelta={reserveCoverageDelta}
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
            hasCurrentCashBalance={hasCurrentCashBalance}
            formatCurrency={formatCurrency}
            toMonthLabel={toMonthLabel}
          />
        )}

        {hasImportedData && activeTab === 'big-picture' && (
          <>
            {/* Sustainability — health at a glance, pinned to last-month YoY; top of Big Picture */}
            <article className="card summary-card">
              <div className="card-head">
                <h3>Sustainability</h3>
                <p className="subtle">Health checks in one glance</p>
              </div>
              <ul className="status-list">
                {sustainability.map((item) => (
                  <li key={item.label}>
                    <span className="status-row-text">
                      {item.label}
                      {item.evidence ? <small className="status-evidence">{item.evidence}</small> : null}
                    </span>
                    <strong>{item.value}</strong>
                  </li>
                ))}
              </ul>
            </article>

            {/* Row 2: Income & Expense (60%) | Top Expense Categories (40%) */}
            <div className="two-col-grid two-col-grid--income-expense">
              <IncomeExpenseCard monthlyRollups={model.monthlyRollups} />
              <TopCategoriesCard
                slices={topCategoriesBreakdown.slices}
                total={topCategoriesBreakdown.total}
                periodControl={
                  <PeriodDropdown
                    value={topCategoriesTimeframe}
                    options={TOP_CATEGORIES_FRAME_OPTIONS}
                    onChange={(v) => setTopCategoriesTimeframe(v as KpiComparisonTimeframe)}
                  />
                }
              />
            </div>

            {/* Row 3: Cash Trend (1/3) | Monthly Net Cash Flow (2/3) — reuses the .cash-trend-row 1fr/2fr grid */}
            <div className="cash-trend-row">
              <CashTrendHero result={cashTrendResult} negativeMonthsAsSubtitle />
              <NetCashFlowChart
                data={netCashFlowChartModel.trend}
                cashFlowMode={netCashFlowChartMode}
                timeframe={netChartTimeframe}
                onCashFlowModeChange={setNetCashFlowChartMode}
                onTimeframeChange={setNetChartTimeframe}
              />
            </div>

            {/* Row 5 — Efficiency opportunity: Money Left (60%) | Payroll Efficiency (40%) */}
            <div className="two-col-grid two-col-grid--efficiency">
              <EfficiencyOpportunitiesCard result={efficiencyResult} />
              <PayrollEfficiencyCard
                txns={filteredTxns}
                monthlyRollups={model.monthlyRollups}
                payrollTargetPercent={businessRules.payrollTargetPercent}
                payrollExcessPerMonth={efficiencyResult.payrollExtraPerMonth}
              />
            </div>

            {/* Row 6 — Expense risk / timing: Cost Spikes (40%) | Cash Reserve Calendar (60%) */}
            <div className="two-col-grid two-col-grid--expense-risk">
              <DigHereHighlights result={whatNeedsAttention} />
              <CashReserveCalendarCard monthlyRollups={model.monthlyRollups} />
            </div>
          </>
        )}

        {hasImportedData && activeTab === 'what-if' && (
          <div className="stack-grid">
            <CashFlowForecastModule
              data={cashFlowForecastTrend}
              baselineData={cashFlowForecastBaselineTrend}
              monthlyRollups={model.monthlyRollups}
              fullForecast={scenarioProjection}
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
              currentCashBalance={currentCashBalance}
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
              settingsRevenueFineTunePct={businessRules.scenarioBaseRevenueGrowthPct ?? 0}
              settingsExpenseFineTunePct={businessRules.scenarioBaseExpenseChangePct ?? 0}
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
              rightSlot={
                <BusinessValuationCard
                  result={businessValuationResult}
                  projection={valuationProjectionResult}
                  isScenarioActive={isValuationScenarioActiveNow}
                  onReplacementCostChange={handleBusinessValuationReplacementCostChange}
                  onDriverGradeChange={handleBusinessValuationDriverGradeChange}
                />
              }
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
                            <th>{hasCurrentCashBalance ? 'Balance' : 'Cumulative Net'}</th>
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
                  hasCurrentCashBalance={hasCurrentCashBalance}
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
                            <strong>{formatCurrency(currentCashBalance)}</strong>
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
                                        {Math.abs(record.startingBalance) <= EPSILON && record.includeInCashForecast && record.active
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

                        {/* Rule — Payroll target */}
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Payroll target</span>
                            <span className="rules-row-sub">Payroll Health uses this as the % of revenue goal</span>
                          </div>
                          <div className="rules-row-control">
                            <div className="rules-pct-input-wrap">
                              <input
                                className="rules-pct-input"
                                type="number"
                                min="1"
                                max="100"
                                step="1"
                                aria-label="Payroll target percentage"
                                value={businessRules.payrollTargetPercent ?? 35}
                                onChange={(event) => {
                                  const raw = Number.parseFloat(event.target.value);
                                  if (Number.isFinite(raw) && raw > 0 && raw <= 100) {
                                    updateBusinessRules({ payrollTargetPercent: raw });
                                  }
                                }}
                              />
                              <span className="rules-pct-suffix">%</span>
                            </div>
                          </div>
                        </div>

                        {/* Rule 2 — Operating Reserve goal */}
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Operating Reserve goal</span>
                            <span className="rules-row-sub">
                              {businessRules.safetyReserveMethod === 'fixed'
                                ? 'Fixed amount used as your Operating Reserve goal'
                                : '1 month of expenses, based on the average of the last 3 completed months'}
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
                                  aria-label="Operating Reserve goal amount"
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
                            sub: 'Saved baseline for Best Case. The Forecast slider adjusts from here.',
                            revKey: 'scenarioBestRevenueGrowthPct' as const,
                            expKey: 'scenarioBestExpenseChangePct' as const,
                          },
                          {
                            key: 'base' as const,
                            label: 'Base Case',
                            sub: 'Saved baseline for Base Case. The Forecast slider adjusts from here.',
                            revKey: 'scenarioBaseRevenueGrowthPct' as const,
                            expKey: 'scenarioBaseExpenseChangePct' as const,
                          },
                          {
                            key: 'worst' as const,
                            label: 'Worst Case',
                            sub: 'Saved baseline for Worst Case. The Forecast slider adjusts from here.',
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

                  {/* Business Valuation settings — SDE add-backs (4 currency
                      inputs) and Lease metadata (4 inputs powering Lease
                      runway driver on the Business Valuation card). */}
                  <div className="ta-card">
                    <div className="ta-card-header">
                      <h3 className="ta-card-title">Business Valuation — SDE add-backs</h3>
                    </div>
                    <div className="ta-card-body">
                      <div className="rules-list">
                        {([
                          {
                            key: 'ownerW2Compensation' as const,
                            label: 'Owner W-2 compensation',
                            sub: 'Annual owner salary that runs through payroll',
                          },
                          {
                            key: 'personalExpensesThroughBusiness' as const,
                            label: 'Personal expenses through business',
                            sub: 'Owner-benefit costs the business covers',
                          },
                          {
                            key: 'oneTimeExpensesToAddBack' as const,
                            label: 'One-time expenses to add back',
                            sub: 'Non-recurring expenses in the TTM window',
                          },
                          {
                            key: 'oneTimeGainsToSubtract' as const,
                            label: 'One-time gains to subtract',
                            sub: 'Non-recurring gains in the TTM window',
                          },
                        ]).map((row) => {
                          const current = businessRules[row.key];
                          return (
                            <div key={row.key} className="rules-row">
                              <div className="rules-row-info">
                                <span className="rules-row-label">{row.label}</span>
                                <span className="rules-row-sub">{row.sub}</span>
                              </div>
                              <div className="rules-row-control">
                                <div className="rules-currency-input-wrap">
                                  <span className="rules-currency-prefix">$</span>
                                  <input
                                    className="rules-currency-input"
                                    type="number"
                                    min="0"
                                    step="1000"
                                    aria-label={`${row.label} amount`}
                                    placeholder="Blank"
                                    value={current === null ? '' : current}
                                    onChange={(event) => {
                                      const raw = event.target.value.trim();
                                      if (raw === '') {
                                        updateBusinessRules({ [row.key]: null } as Partial<BusinessRules>);
                                        return;
                                      }
                                      const num = Number.parseFloat(raw);
                                      if (Number.isFinite(num) && num >= 0) {
                                        updateBusinessRules({ [row.key]: num } as Partial<BusinessRules>);
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="ta-card">
                    <div className="ta-card-header">
                      <h3 className="ta-card-title">Business Valuation — Lease</h3>
                    </div>
                    <div className="ta-card-body">
                      <div className="rules-list">
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Lease start date</span>
                            <span className="rules-row-sub">When the current lease term began</span>
                          </div>
                          <div className="rules-row-control">
                            <input
                              className="rules-currency-input"
                              type="date"
                              aria-label="Lease start date"
                              value={businessRules.leaseStartDate ?? ''}
                              onChange={(event) => {
                                const raw = event.target.value.trim();
                                updateBusinessRules({
                                  leaseStartDate: raw === '' ? null : raw,
                                });
                              }}
                            />
                          </div>
                        </div>
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Lease end date</span>
                            <span className="rules-row-sub">When the current lease term ends — used to grade Lease runway</span>
                          </div>
                          <div className="rules-row-control">
                            <input
                              className="rules-currency-input"
                              type="date"
                              aria-label="Lease end date"
                              value={businessRules.leaseEndDate ?? ''}
                              onChange={(event) => {
                                const raw = event.target.value.trim();
                                updateBusinessRules({
                                  leaseEndDate: raw === '' ? null : raw,
                                });
                              }}
                            />
                          </div>
                        </div>
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Renewal option</span>
                            <span className="rules-row-sub">Whether the lease includes a renewal option</span>
                          </div>
                          <div className="rules-row-control">
                            <div className="segmented-toggle">
                              <button
                                type="button"
                                className={`segmented-toggle-btn${businessRules.leaseRenewalOption === true ? ' is-active' : ''}`}
                                onClick={() => updateBusinessRules({ leaseRenewalOption: true })}
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                className={`segmented-toggle-btn${businessRules.leaseRenewalOption === false ? ' is-active' : ''}`}
                                onClick={() => updateBusinessRules({ leaseRenewalOption: false })}
                              >
                                No
                              </button>
                            </div>
                          </div>
                        </div>
                        {businessRules.leaseRenewalOption === true && (
                          <div className="rules-row">
                            <div className="rules-row-info">
                              <span className="rules-row-label">Renewal option years</span>
                              <span className="rules-row-sub">How many additional years the renewal would add</span>
                            </div>
                            <div className="rules-row-control">
                              <input
                                className="rules-currency-input"
                                type="number"
                                min="0"
                                step="1"
                                aria-label="Renewal option years"
                                placeholder="0"
                                value={businessRules.leaseRenewalYears === null ? '' : businessRules.leaseRenewalYears}
                                onChange={(event) => {
                                  const raw = event.target.value.trim();
                                  if (raw === '') {
                                    updateBusinessRules({ leaseRenewalYears: null });
                                    return;
                                  }
                                  const num = Number.parseFloat(raw);
                                  if (Number.isFinite(num) && num >= 0) {
                                    updateBusinessRules({ leaseRenewalYears: num });
                                  }
                                }}
                              />
                            </div>
                          </div>
                        )}
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
                        <p className="revenue-card__delta-context">vs end of last month</p>
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
              <p className="ui-lab-section-subtitle">Source: demo.tailadmin.com/finance (Total Balance tile). Locked spec, 2026-05-15. White card surface — outer gray frame and bottom actions bar intentionally omitted.</p>
              <div className="ui-lab-preview-width--medium">
                <article className="total-balance-card">
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
                </article>
              </div>
            </div>

            <div className="ui-lab-section">
              <h3 className="ui-lab-section-title">NextOwnerDistributionCard</h3>
              <p className="ui-lab-section-subtitle">Independent live replica of the Today "Next Owner Distribution" card (chart, legend, axes, all states). Own component + .nodlab-* CSS so it can be iterated without touching the shipped card. Wired to real ownerPay data.</p>
              <div className="ui-lab-preview-width--medium">
                <NextOwnerDistributionCardLab
                  ownerPayProjection={ownerPayProjection}
                  reserveFloor={ownerPayReserveFloor}
                  reprojectOwnerPay={reprojectOwnerPay}
                />
              </div>
            </div>

            <div className="ui-lab-section">
              <h3 className="ui-lab-section-title">Secondary priorities</h3>
              <p className="ui-lab-section-subtitle">Ranked secondary-priority cards (Cash Flow / Revenue / etc.). Moved off the Today page; rendered here live from the same signal → rank pipeline.</p>
              <SecondaryPrioritiesLab
                model={model}
                txns={filteredTxns}
                forecastProjection={scenarioProjection}
              />
            </div>

            <div className="ui-lab-section">
              <h3 className="ui-lab-section-title">CFO Assistant</h3>
              <p className="ui-lab-section-subtitle">Moved off the Today page while assistant work is paused (see docs/CFO_ASSISTANT_PAUSED.md). Rendered here live from the same signal → commitment pipeline so it stays exercisable.</p>
              <div className="ui-lab-preview-width--medium">
                <CfoAssistantCard
                  model={model}
                  txns={filteredTxns}
                  forecastProjection={scenarioProjection}
                />
              </div>
            </div>
          </div>
        )}
      </section>

      </div>
    </div>
  );
}
