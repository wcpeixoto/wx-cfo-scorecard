import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { STORAGE_KEYS } from '../config';
import { useLocation, useNavigate } from 'react-router';
import { FiRefreshCw } from 'react-icons/fi';
import { AppSidebar } from '../components/AppSidebar';
import { AppHeader } from '../components/AppHeader';
import { useSidebar } from '../context/SidebarContext';
import CashFlowForecastModule from '../components/CashFlowForecastModule';
import LoadingScreen from '../components/LoadingScreen';
import DigHereHighlights from '../components/DigHereHighlights';
import KpiCards from '../components/KpiCards';
import TopCategoriesCard from '../components/TopCategoriesCard';
import PeriodDropdown from '../components/PeriodDropdown';
import TopPayeesTable from '../components/TopPayeesTable';
import TrendLineChart from '../components/TrendLineChart';
import NetCashFlowChart from '../components/NetCashFlowChart';
import TrajectoryPanel from '../components/TrajectoryPanel';
import { TodayPage } from '../components/TodayPage';
import { computeLinearTrendLine, computeProgressiveMovingAverage } from '../lib/charts/movingAverage';
import { discoverAccountRecords, mergeDiscoveredAccountRecords, parseStoredAccountRecords } from '../lib/accounts';
import { includeExpenseForDigHere, isCapitalDistributionCategory } from '../lib/cashFlow';
import { computePriorYearActuals } from '../lib/kpis/priorYearActuals';
import { runDataSanityChecks } from '../lib/dataSanity';
import { clearImportedTransactions, getImportedTransactionsSnapshot, importQuickenReportCsv } from '../lib/data/importedTransactions';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  getSharedAccountSettings,
  getSharedWorkspaceSettings,
  isSharedPersistenceConfigured,
  saveSharedAccountSettings,
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
  computePriorityScore,
  computeMonthlyRollups,
  projectScenario,
  toMonthLabel,
} from '../lib/kpis/compute';
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
  ScenarioInput,
  TransactionImportSummary,
  TrendPoint,
  Txn,
} from '../lib/data/contract';

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
const FORECAST_SCENARIO_PRESETS: Record<Exclude<ForecastScenarioKey, 'custom'>, ScenarioInput> = {
  base: DEFAULT_SCENARIO,
  best: {
    scenarioKey: 'best',
    revenueGrowthPct: 4,
    expenseChangePct: -3,
    receivableDays: 3,
    payableDays: 3,
    months: 12,
  },
  worst: {
    scenarioKey: 'worst',
    revenueGrowthPct: -5,
    expenseChangePct: 4,
    receivableDays: 3,
    payableDays: 3,
    months: 12,
  },
};
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
const HIGHLIGHT_MIN_ABS_DELTA = 25;
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

type DigHereHighlight = {
  category: string;
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
  priorityScore: number;
};

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

function inMonthRange(month: string, startMonth: string | null, endMonth: string | null): boolean {
  if (!startMonth || !endMonth) return false;
  return month >= startMonth && month <= endMonth;
}

function toDeltaPercent(current: number, previous: number): number | null {
  if (Math.abs(previous) <= EPSILON) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
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
  const [lastImportSummary, setLastImportSummary] = useState<TransactionImportSummary | null>(null);
  const [storedImportedTransactionCount, setStoredImportedTransactionCount] = useState(0);
  const [accountRecords, setAccountRecords] = useState<AccountRecord[]>(getStoredAccountSettings);
  const [selectedScenarioKey, setSelectedScenarioKey] = useState<ForecastScenarioKey>('base');
  const [customScenarioInput, setCustomScenarioInput] = useState<ScenarioInput>(DEFAULT_CUSTOM_SCENARIO);
  const [kpiTimeframe, setKpiTimeframe] = useState<BigPictureFrameValue>('lastMonth');
  const [netCashFlowChartMode, setNetCashFlowChartMode] = useState<CashFlowMode>('operating');
  const [digHereMoverGrouping, setDigHereMoverGrouping] = useState<MoverGrouping>('subcategories');
  const [forecastRange, setForecastRange] = useState<ForecastRangeValue>('90d');
  const [forecastEvents, setForecastEvents] = useState<ForecastEvent[]>(DEFAULT_FORECAST_EVENTS);
  const [activeSection, setActiveSection] = useState<'data' | 'accounts' | 'rules'>('data');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [isBigPictureFilterOpen, setIsBigPictureFilterOpen] = useState(false);
  const preserveAccountSettingsOnImportClearRef = useRef(false);
  const sharedAccountSettingsSyncArmedRef = useRef(false);
  const compareYearHandledRef = useRef<number | null>(null);
  const projectionTableRef = useRef<HTMLDivElement>(null);
  const [sharedAccountSettingsReady, setSharedAccountSettingsReady] = useState(!sharedPersistenceEnabled);
  const [sharedAccountSettingsHasRemoteData, setSharedAccountSettingsHasRemoteData] = useState(false);
  const [businessRules, setBusinessRules] = useState<BusinessRules>(() => ({ ...DEFAULT_BUSINESS_RULES }));
  const scenarioInput = useMemo(
    () => (selectedScenarioKey === 'custom' ? customScenarioInput : FORECAST_SCENARIO_PRESETS[selectedScenarioKey]),
    [customScenarioInput, selectedScenarioKey]
  );

  const updateCustomScenario = useCallback(
    (patch: Partial<ScenarioInput>) => {
      const baseScenario =
        selectedScenarioKey === 'custom' ? customScenarioInput : { ...FORECAST_SCENARIO_PRESETS[selectedScenarioKey], scenarioKey: 'custom' as const };
      const nextCustomScenario: ScenarioInput = {
        ...baseScenario,
        ...patch,
        scenarioKey: 'custom',
      };
      setCustomScenarioInput(nextCustomScenario);
      setSelectedScenarioKey('custom');
    },
    [customScenarioInput, selectedScenarioKey]
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
      setImportError(message);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  useEffect(() => {
    void loadImportedState();
  }, [loadImportedState]);

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
  const forecastProjection = useMemo(
    () => {
      const fcT0 = performance.now();
      const result = projectScenario(
        model,
        {
          ...scenarioInput,
          months: Math.max(scenarioInput.months, forecastRangeMonths),
        },
        forecastCurrentCashBalance,
        forecastEvents
      );
      if (import.meta.env.DEV && !bootPhaseLoggedRef.current.forecast && model.monthlyRollups.length > 0) {
        bootPhaseLoggedRef.current.forecast = true;
        console.log('[BOOT] Forecast compute:', Math.round(performance.now() - fcT0), 'ms');
      }
      return result;
    },
    [forecastCurrentCashBalance, forecastEvents, forecastRangeMonths, model, scenarioInput]
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

  // Phase 4.11: deep-link handler — fires on each fresh arrival with a new compareYear param
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const compareYear = params.get('compareYear');
    if (!compareYear) return;

    const year = parseInt(compareYear, 10);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 2020 || year > currentYear) return;

    if (year === compareYearHandledRef.current) return; // same year already applied, skip

    compareYearHandledRef.current = year;
    setProjectionActiveYears([year]);
    setForecastRange('1y');
    setTimeout(() => {
      projectionTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }, [location.search, priorYearActuals]);

  // Phase 4.11b: reset deep-link ref when user leaves What-If tab,
  // so a fresh arrival with the same year fires again
  useEffect(() => {
    if (activeTab !== 'what-if') {
      compareYearHandledRef.current = null;
    }
  }, [activeTab]);

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

  const digHereHighlights = useMemo<DigHereHighlight[]>(() => {
    if (!selectedKpiComparison) return [];
    if (!selectedKpiComparison.currentEndMonth || !selectedKpiComparison.currentStartMonth) return [];

    const currentTotals = new Map<string, number>();
    const previousTotals = new Map<string, number>();

    filteredTxns.forEach((txn) => {
      if (txn.type !== 'expense') return;
      if (!includeExpenseForDigHere(txn.category, profitabilityCashFlowMode)) return;

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
      const deltaPercent = toDeltaPercent(current, previous);
      return {
        category,
        current,
        previous,
        delta,
        deltaPercent,
        priorityScore: computePriorityScore(delta, deltaPercent, previous, current),
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
        return b.priorityScore - a.priorityScore;
      })
      .slice(0, 5);
  }, [filteredTxns, profitabilityCashFlowMode, selectedKpiComparison]);

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
        <AppHeader query={query} onQueryChange={setQuery} />
      <section className="main-zone">
        {activeTab !== 'today' && activeTab !== 'what-if' && activeTab !== 'settings' && <header className="top-bar glass-panel">
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
            </div>

            <div className="top-controls top-controls-timeframe">
              {activeTab === 'where-to-focus' ? null : activeTab === 'trends' ? (
                <div className="kpi-timeframe-control">
                  <div className="kpi-timeframe-toggle" role="group" aria-label="Moving average window selector">
                    {TRENDS_MA_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={trendsMaWindow === option.value ? 'is-active' : ''}
                        onClick={() => setTrendsMaWindow(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="kpi-timeframe-control">
                  <div className="kpi-timeframe-toggle" role="group" aria-label="KPI timeframe selector">
                    {BIG_PICTURE_VISIBLE_FRAME_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={kpiTimeframe === option.value ? 'is-active' : ''}
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
                        className="timeframe-trigger"
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
              <button
                type="button"
                className="top-bar-freshness subtle clickable"
                onClick={() => navigateToTab('settings')}
                aria-label={`${lastUpdatedLabel}. Open Settings.`}
              >
                <FiRefreshCw className="top-bar-freshness-icon" aria-hidden="true" />
                <span>{lastUpdatedLabel}</span>
              </button>
            </div>
          </div>
        </header>}

        {!hasImportedData && (
          <article className="card settings-card">
            <div className="card-head">
              <h3>Imported Transactions Required</h3>
              <p className="subtle">
                Imported Quicken transactions are now the only runtime source of truth. Google Sheets fallback has been removed.
              </p>
            </div>
            <p className="empty-state">
              No imported transactions are available in {sharedPersistenceEnabled ? 'shared' : 'browser-local'} storage. Import a Quicken CSV to begin analysis.
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
          <TodayPage model={model} txns={filteredTxns} targetNetMargin={businessRules.targetNetMargin} />
        )}

        {hasImportedData && activeTab === 'big-picture' && (
          <>
            <KpiCards cards={selectedKpiCards} vsLabel={kpiVsLabel} />
            <p className="data-trust-note">Excludes transfers &amp; financing · operating cash flow only</p>
            <TrajectoryPanel signals={model.trajectorySignals} />
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

            <DigHereHighlights
              items={digHereHighlights}
              timeframeLabel={`${selectedKpiFrameLabel} comparison`}
              onTitleClick={() =>
                navigateToDigHere(
                  selectedKpiComparison?.currentStartMonth && selectedKpiComparison?.currentEndMonth
                    ? {
                        startMonth: selectedKpiComparison.currentStartMonth,
                        endMonth: selectedKpiComparison.currentEndMonth,
                        focusContext: 'category-shifts',
                      }
                    : undefined
                )
              }
              onItemClick={(item) =>
                navigateToDigHere({
                  category: item.category,
                  startMonth: selectedKpiComparison?.currentStartMonth ?? null,
                  endMonth: selectedKpiComparison?.currentEndMonth ?? null,
                  focusContext: 'category-shifts',
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
            bannerText = `${formatCategoryLabel(opportunities[0].title)} and ${formatCategoryLabel(opportunities[1].title)} are your biggest opportunities to improve cash this month.`;
          } else if (opportunities.length === 1) {
            bannerText = `${formatCategoryLabel(opportunities[0].title)} is the main driver of higher costs this month.`;
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
              <TrendLineChart data={model.trend} metric="income" title="Revenue Trend" hideDots hideActualLine hideAxisLines useEma hideHover trendWindowOverride={trendsMaWindow} displayWindow={trendsMaWindow} rangeLabelOverride={trendsRangeLabel} showInterpretation interpretationVariant="revenue" showTrendTooltip yTickLabelStep={2} />
              <TrendLineChart data={model.trend} metric="expense" title="Expense Trend" hideDots hideActualLine hideAxisLines useEma hideHover trendWindowOverride={trendsMaWindow} displayWindow={trendsMaWindow} rangeLabelOverride={trendsRangeLabel} showInterpretation interpretationVariant="expense" showTrendTooltip yTickLabelStep={2} />
            </div>

            <article className="card table-card">
              <div className="card-head">
                <h3>Monthly Rollups</h3>
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
                  {model.monthlyRollups.filter((r) => r.month < currentCalendarMonth).slice(-trendsMaWindow).reverse().map((rollup) => (
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
          <header className="top-bar glass-panel what-if-header">
            <div className="top-bar-main">
              <div className="top-bar-copy">
                <h2>Cash Flow Forecast</h2>
                <p className="top-bar-context">
                  Expected inflows, outflows, and projected balance
                </p>
              </div>
              <div className="top-controls top-controls-timeframe">
                <div className="forecast-scenario-toggle" role="group" aria-label="Forecast scenario">
                  {(
                    [
                      { key: 'base' as ForecastScenarioKey, label: 'Base Case' },
                      { key: 'best' as ForecastScenarioKey, label: 'Best Case' },
                      { key: 'worst' as ForecastScenarioKey, label: 'Worst Case' },
                      { key: 'custom' as ForecastScenarioKey, label: 'Custom Case' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={selectedScenarioKey === option.key ? 'is-active' : ''}
                      onClick={() => setSelectedScenarioKey(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="top-bar-freshness subtle clickable"
                  onClick={() => navigateToTab('settings')}
                  aria-label={`${lastUpdatedLabel}. Open Settings.`}
                >
                  <FiRefreshCw className="top-bar-freshness-icon" aria-hidden="true" />
                  <span>{lastUpdatedLabel}</span>
                </button>
              </div>
            </div>
          </header>
        )}

        {hasImportedData && activeTab === 'what-if' && (
          <div className="stack-grid">
            <CashFlowForecastModule
              data={cashFlowForecastTrend}
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
              forecastRangeOptions={FORECAST_RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
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
              forecastEvents={forecastEvents}
              onAddEvent={(events) => setForecastEvents((prev) => [...prev, ...events])}
              onUpdateEvent={(updated) => setForecastEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))}
              onDeleteEvent={(groupId) => setForecastEvents((prev) => prev.filter((e) => {
                const parts = e.id.split('__');
                const eGroupId = parts.length === 3 ? parts[1] : e.id;
                return eGroupId !== groupId;
              }))}
            />

            <article className="card table-card" ref={projectionTableRef}>
              <div className="projection-header">
                <h3>Projection Table</h3>
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
              <div className="table-subcontrols">
                <span className="table-subcontrols-label">Compare</span>
                <div className="projection-year-pills">
                  {/* Phase 4.11: when compareYear URL param is present on load,
                      use it as the active comparison year for this session only.
                      If the year is outside the default 3, temporarily use it as
                      the selected year — do not expand the list permanently.
                      Behavior is replace-on-load only, not sticky across navigation. */}
                  {pillYears.map((year) => {
                    const isActive = projectionActiveYears.includes(year);
                    return (
                      <button
                        key={year}
                        type="button"
                        className={`projection-year-pill${isActive ? ' is-active' : ''}`}
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
              <div className="projection-table-scroll">
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
                            <td className="total-label">Total</td>
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

                  const varColCount = hasSingleYear ? 1 : 0;
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
                          {hasSingleYear && <th className="projection-sub-actual">%</th>}
                          {/* Cash Out subcolumns */}
                          <th className="projection-sub-forecast proj-group-start">{forecastYear}</th>
                          {sortedActiveDesc.map((y) => <th key={`co-${y}`} className="projection-sub-actual">{y}</th>)}
                          {hasSingleYear && <th className="projection-sub-actual">%</th>}
                          {/* Net subcolumns */}
                          <th className="projection-sub-forecast proj-group-start">{forecastYear}</th>
                          {sortedActiveDesc.map((y) => <th key={`n-${y}`} className="projection-sub-actual">{y}</th>)}
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
                          <td className="total-label">Total</td>
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
                        <h3>Direct CSV Import</h3>
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

                          {lastImportSummary.possibleDuplicateExamples.length > 0 ? (
                            <div className="import-summary-section">
                              <h4>Possible duplicates</h4>
                              <ul className="import-issue-list">
                                {lastImportSummary.possibleDuplicateExamples.map((issue) => (
                                  <li key={`dup-${issue.lineNumber}`}>
                                    <strong>Line {issue.lineNumber}.</strong> {issue.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {lastImportSummary.parseFailureExamples.length > 0 ? (
                            <div className="import-summary-section">
                              <h4>Parse failures</h4>
                              <ul className="import-issue-list">
                                {lastImportSummary.parseFailureExamples.map((issue) => (
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
                        <h3>Account Setup</h3>
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

                        {/* Rule 2 — Safety reserve */}
                        <div className="rules-row">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Safety reserve</span>
                            <span className="rules-row-sub">
                              {businessRules.safetyReserveMethod === 'fixed'
                                ? 'Fixed reserve amount used as the safety floor'
                                : '1 month of average operating expenses'}
                            </span>
                          </div>
                          <div className="rules-row-control rules-row-control--col">
                            <div className="cashflow-toggle">
                              <button
                                type="button"
                                className={businessRules.safetyReserveMethod === 'monthly' ? 'is-active' : ''}
                                onClick={() => updateBusinessRules({ safetyReserveMethod: 'monthly' })}
                              >
                                1 month of expenses
                              </button>
                              <button
                                type="button"
                                className={businessRules.safetyReserveMethod === 'fixed' ? 'is-active' : ''}
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
                                  aria-label="Reserve target amount"
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

                        {/* Rule 3 — Cash flow timing (placeholder) */}
                        <div className="rules-row rules-row--coming-soon">
                          <div className="rules-row-info">
                            <span className="rules-row-label">Cash flow timing</span>
                            <span className="rules-row-sub">Coming soon — receivables and payables timing offsets</span>
                          </div>
                        </div>

                        {/* Rule 4 — Duplicate warnings */}
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
                            <div className="cashflow-toggle">
                              <button
                                type="button"
                                className={!businessRules.suppressDuplicateWarnings ? 'is-active' : ''}
                                onClick={() => updateBusinessRules({ suppressDuplicateWarnings: false })}
                              >
                                Show duplicate warnings
                              </button>
                              <button
                                type="button"
                                className={businessRules.suppressDuplicateWarnings ? 'is-active' : ''}
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

                </div>
              </div>
              </div>{/* end rules wrapper */}

              </div>{/* end settings-content-shell */}
            </div>
          </div>
        )}

        {import.meta.env.DEV && activeTab === 'ui-lab' && (
          <div className="stack-grid">

            {/* ── Page header ─────────────────────────────────────────── */}
            <div className="ui-lab-header">
              <div className="ui-lab-header-copy">
                <h2 className="ui-lab-title">UI Lab</h2>
                <p className="ui-lab-subtitle">Use this page to settle layout, spacing, and component patterns before applying them to production surfaces.</p>
              </div>
              <span className="ui-lab-dev-badge">Dev only</span>
            </div>

            {/* ── Section 1: KPI Cards ─────────────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">KPI Cards</h3>
                <p className="ui-lab-section-subtitle">Metric tiles with value, label, delta, and trend indicator</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 2: Chart Cards ───────────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Chart Cards</h3>
                <p className="ui-lab-section-subtitle">Chart container with title, subtitle, toolbar placeholder, and chart area</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 3: Status Cards ──────────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Status Cards</h3>
                <p className="ui-lab-section-subtitle">System status, health indicators, and alert states</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 4: Section Headers ───────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Section Headers</h3>
                <p className="ui-lab-section-subtitle">Page titles, section titles, and subtitles with optional controls</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 5: Insight Banners ───────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Insight Banners</h3>
                <p className="ui-lab-section-subtitle">Callout blocks for top-level interpretive sentences</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 6: Tables ────────────────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Tables</h3>
                <p className="ui-lab-section-subtitle">Data rows, column headers, and sortable list patterns</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 7: Segmented Toggles ─────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Segmented Toggles</h3>
                <p className="ui-lab-section-subtitle">Period selectors, view switchers, and option groups</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 8: Badges and Pills ──────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Badges and Pills</h3>
                <p className="ui-lab-section-subtitle">Status labels, category tags, and count indicators</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 9: Empty States ───────────────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Empty States</h3>
                <p className="ui-lab-section-subtitle">Zero-data and loading placeholder patterns</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

            {/* ── Section 10: Dark Mode Readiness ──────────────────────── */}
            <div className="ui-lab-section">
              <div className="ui-lab-section-head">
                <h3 className="ui-lab-section-title">Dark Mode Readiness</h3>
                <p className="ui-lab-section-subtitle">Placeholder space to validate dark variants — built alongside light, not retrofitted later</p>
              </div>
              <div className="ui-lab-placeholder">
                <span className="ui-lab-placeholder-label">Patterns go here</span>
              </div>
            </div>

          </div>
        )}
      </section>

      </div>
    </div>
  );
}
