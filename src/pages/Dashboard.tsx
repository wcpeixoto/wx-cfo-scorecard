import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { SHEET_CSV_FALLBACK_URL, SHEET_CSV_URL, STORAGE_KEYS } from '../config';
import gracieSportsLogo from '../assets/gracie-sports-logo.svg';
import type { IconType } from 'react-icons';
import { FiGrid, FiLayers, FiRefreshCw, FiSearch, FiSettings, FiSliders, FiTrendingUp } from 'react-icons/fi';
import CashFlowForecastModule from '../components/CashFlowForecastModule';
import ExpenseDonut from '../components/ExpenseDonut';
import DigHereHighlights from '../components/DigHereHighlights';
import KpiCards from '../components/KpiCards';
import MoversList from '../components/MoversList';
import TopCategoriesCard from '../components/TopCategoriesCard';
import PeriodDropdown from '../components/PeriodDropdown';
import TopPayeesTable from '../components/TopPayeesTable';
import TrendLineChart from '../components/TrendLineChart';
import NetCashFlowChart from '../components/NetCashFlowChart';
import TrajectoryPanel from '../components/TrajectoryPanel';
import { computeLinearTrendLine, computeProgressiveMovingAverage } from '../lib/charts/movingAverage';
import { discoverAccountRecords, mergeDiscoveredAccountRecords, parseStoredAccountRecords } from '../lib/accounts';
import { includeExpenseForDigHere, isCapitalDistributionCategory } from '../lib/cashFlow';
import { runDataSanityChecks } from '../lib/dataSanity';
import { clearImportedTransactions, getImportedTransactionsSnapshot, importQuickenReportCsv } from '../lib/data/importedTransactions';
import {
  getSharedAccountSettings,
  isSharedPersistenceConfigured,
  saveSharedAccountSettings,
} from '../lib/data/sharedPersistence';
import { buildDataSet, toISODateOnly } from '../lib/data/normalize';
import { fetchSheetCsv } from '../lib/data/fetchCsv';
import {
  buildPrePhase4DebugReport,
  computeDashboardModel,
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
  | 'big-picture'
  | 'money-left'
  | 'dig-here'
  | 'trends'
  | 'what-if'
  | 'settings';

type NavItem = {
  id: TabId;
  label: string;
  icon: IconType;
};

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

const NAV_ITEMS: NavItem[] = [
  { id: 'big-picture', label: 'Big Picture', icon: FiGrid },
  { id: 'money-left', label: 'MLOT', icon: FiLayers },
  { id: 'dig-here', label: 'Dig Here', icon: FiSearch },
  { id: 'trends', label: 'Trends', icon: FiTrendingUp },
  { id: 'what-if', label: 'What-If Scenarios', icon: FiSliders },
  { id: 'settings', label: 'Settings', icon: FiSettings },
];

const DEFAULT_SCENARIO: ScenarioInput = {
  revenueGrowthPct: 0,
  expenseReductionPct: 0,
  months: 12,
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

function getReservePercentDisplay(currentCashBalance: number, reserveTarget: number): number | null {
  if (reserveTarget <= EPSILON) return null;
  return Math.round((currentCashBalance / reserveTarget) * 100);
}

function reserveToneClassName(percent: number | null): string {
  if (percent === null) return 'is-neutral';
  if (percent >= 100) return 'is-positive';
  return 'is-caution';
}

function getReserveBadgeState(percent: number | null): { label: string; toneClassName: string } {
  if (percent === null) return { label: 'Unavailable', toneClassName: 'is-neutral' };
  if (percent >= 100) return { label: 'At/above floor', toneClassName: 'is-positive' };
  return { label: 'Below floor', toneClassName: 'is-caution' };
}

function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function formatCoverageGapWeeks(currentCashBalance: number, reserveTarget: number): string {
  if (reserveTarget <= EPSILON) return '—';
  const gap = Math.max(reserveTarget - currentCashBalance, 0);
  if (gap <= EPSILON) return '0 weeks';
  const monthlyReserveRequirement = reserveTarget / 3;
  if (monthlyReserveRequirement <= EPSILON) return '—';
  const weeklyBurn = monthlyReserveRequirement / 4.33;
  const weeks = Math.round(gap / weeklyBurn);
  return `~${weeks} week${weeks === 1 ? '' : 's'}`;
}

function formatReservePercentLabel(percent: number | null): string {
  if (percent === null) return '—';
  return `${percent}%`;
}

function formatReserveFloorLabel(reserveTarget: number): string {
  if (reserveTarget <= EPSILON) return 'floor —';
  return `floor ${formatCurrency(reserveTarget)}`;
}

function ReserveGauge({ percentLabel, fillPercent, toneClass, reserveTarget }: {
  percentLabel: string;
  fillPercent: number;
  toneClass: string;
  reserveTarget: number;
}) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 115;
  const strokeWidth = 18;
  const startAngle = Math.PI;
  const endAngle = 0;
  const clampedPercent = Math.min(Math.max(fillPercent, 0), 100);
  const fillAngle = startAngle - (clampedPercent / 100) * Math.PI;

  function polarToXY(angle: number): { x: number; y: number } {
    return { x: cx + radius * Math.cos(angle), y: cy - radius * Math.sin(angle) };
  }

  const trackStart = polarToXY(startAngle);
  const trackEnd = polarToXY(endAngle);
  const fillEnd = polarToXY(fillAngle);
  const largeArc = clampedPercent > 50 ? 1 : 0;

  const trackPath = `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 1 1 ${trackEnd.x} ${trackEnd.y}`;
  const fillPath = `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 ${largeArc} 1 ${fillEnd.x} ${fillEnd.y}`;

  const labelY = cy + strokeWidth / 2 + 16;
  const maxLabel = reserveTarget > EPSILON ? formatCompactCurrency(reserveTarget) : '—';

  return (
    <div className="reserve-gauge-wrap">
      <svg viewBox={`0 0 ${size} ${labelY + 4}`} className="reserve-gauge-svg" aria-hidden="true">
        <path d={trackPath} fill="none" stroke="var(--bg-muted)" strokeWidth={strokeWidth} strokeLinecap="round" />
        {clampedPercent > 0 && (
          <path d={fillPath} fill="none" className={`reserve-gauge-arc ${toneClass}`} strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
        <text x={trackStart.x} y={labelY} textAnchor="start" className="reserve-gauge-end-label">$0</text>
        <text x={trackEnd.x} y={labelY} textAnchor="end" className="reserve-gauge-end-label">{maxLabel}</text>
      </svg>
      <div className="reserve-gauge-center">
        <span className="reserve-gauge-value">{percentLabel}</span>
        <span className="reserve-gauge-label">of reserve funded</span>
      </div>
    </div>
  );
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

function getStoredCsvUrl(): string {
  if (typeof window === 'undefined') return SHEET_CSV_URL;
  try {
    return window.localStorage.getItem(STORAGE_KEYS.csvUrl) ?? SHEET_CSV_URL;
  } catch {
    return SHEET_CSV_URL;
  }
}

function getStoredAccountSettings(): AccountRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    return parseStoredAccountRecords(window.localStorage.getItem(STORAGE_KEYS.accountSettings));
  } catch {
    return [];
  }
}

export default function Dashboard() {
  const sharedPersistenceEnabled = isSharedPersistenceConfigured();
  const profitabilityCashFlowMode: CashFlowMode = 'operating';
  const [activeTab, setActiveTab] = useState<TabId>('big-picture');
  const [csvUrl, setCsvUrl] = useState(getStoredCsvUrl);
  const [draftCsvUrl, setDraftCsvUrl] = useState(getStoredCsvUrl);
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
  const [dataSet, setDataSet] = useState<DataSet | null>(null);
  const [importedDataSet, setImportedDataSet] = useState<DataSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [lastImportSummary, setLastImportSummary] = useState<TransactionImportSummary | null>(null);
  const [storedImportedTransactionCount, setStoredImportedTransactionCount] = useState(0);
  const [accountRecords, setAccountRecords] = useState<AccountRecord[]>(getStoredAccountSettings);
  const [scenarioInput, setScenarioInput] = useState<ScenarioInput>(DEFAULT_SCENARIO);
  const [kpiTimeframe, setKpiTimeframe] = useState<BigPictureFrameValue>('lastMonth');
  const [netCashFlowChartMode, setNetCashFlowChartMode] = useState<CashFlowMode>('operating');
  const [digHereMoverGrouping, setDigHereMoverGrouping] = useState<MoverGrouping>('subcategories');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [forecastRange, setForecastRange] = useState<ForecastRangeValue>('90d');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [isBigPictureFilterOpen, setIsBigPictureFilterOpen] = useState(false);
  const preserveAccountSettingsOnImportClearRef = useRef(false);
  const sharedAccountSettingsSyncArmedRef = useRef(false);
  const [sharedAccountSettingsReady, setSharedAccountSettingsReady] = useState(!sharedPersistenceEnabled);
  const [sharedAccountSettingsHasRemoteData, setSharedAccountSettingsHasRemoteData] = useState(false);

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

  const loadImportedState = useCallback(async () => {
    try {
      const snapshot = await getImportedTransactionsSnapshot();
      setImportedDataSet(snapshot.dataSet);
      setLastImportSummary(snapshot.lastImportSummary);
      setStoredImportedTransactionCount(snapshot.transactionCount);
    } catch (importStateError) {
      const message = importStateError instanceof Error ? importStateError.message : 'Could not load imported transactions.';
      setImportError(message);
    }
  }, []);

  useEffect(() => {
    void loadImportedState();
  }, [loadImportedState]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncStateFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = parseTabId(params.get('tab'));
      const cashFlow = parseCashFlowMode(params.get('cf'));
      const nextQuery = params.get('q');
      const month = parseMonthToken(params.get('month'));
      const startMonth = parseMonthToken(params.get('start'));
      const endMonth = parseMonthToken(params.get('end'));
      const focusContext = parseDigHereFocusContext(params.get('focus'));
      const moverGrouping = parseMoverGrouping(params.get('mg'));

      const validRange = startMonth && endMonth && startMonth <= endMonth;

      setActiveTab(tab ?? 'big-picture');
      setNetCashFlowChartMode(cashFlow ?? 'operating');
      setQuery(nextQuery ?? '');
      setDigHereFocusMonth(validRange ? null : month);
      setDigHereStartMonth(validRange ? startMonth : null);
      setDigHereEndMonth(validRange ? endMonth : null);
      setDigHereFocusContext(focusContext);
      setDigHereMoverGrouping(moverGrouping ?? 'subcategories');
    };

    syncStateFromUrl();
    window.addEventListener('popstate', syncStateFromUrl);
    return () => window.removeEventListener('popstate', syncStateFromUrl);
  }, []);

  const activeDataSet = importedDataSet ?? dataSet;
  const baseTxns = useMemo(() => activeDataSet?.txns ?? [], [activeDataSet?.txns]);
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
      warnings.push('No active accounts are currently included in forecast, so cash forecasting has no account foundation yet.');
      return warnings;
    }
    if (!hasCurrentCashBalance) {
      warnings.push(
        `Included forecast accounts all have a $0 starting balance, so forecast can only show cumulative change instead of absolute cash in bank.`
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
    includedForecastAccounts,
    includedForecastAccountsMissingStartingBalance,
    includedNonCashForecastAccounts,
  ]);

  const model = useMemo(
    () =>
      computeDashboardModel(filteredTxns, {
        cashFlowMode: profitabilityCashFlowMode,
        anchorMonth: previousCalendarMonth ?? undefined,
        thisMonthAnchor: currentCalendarMonth,
        currentCashBalance,
      }),
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
    !digHereFocusMonth && activeTab === 'dig-here'
      ? digHereStartMonth ?? defaultDigHereRange.startMonth
      : digHereStartMonth;
  const activeDigHereEndMonth =
    !digHereFocusMonth && activeTab === 'dig-here'
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
    setIsMobileNavOpen(false);
  }, [activeTab]);

  const forecastRangeMonths = useMemo(
    () => FORECAST_RANGE_OPTIONS.find((option) => option.value === forecastRange)?.months ?? 3,
    [forecastRange]
  );
  const scenarioProjection = useMemo(
    () =>
      projectScenario(
        model,
        {
          ...scenarioInput,
          months: Math.max(scenarioInput.months, forecastRangeMonths),
        },
        currentCashBalance
      ),
    [currentCashBalance, forecastRangeMonths, model, scenarioInput]
  );
  const visibleScenarioProjection = useMemo(
    () => scenarioProjection.slice(0, forecastRangeMonths),
    [forecastRangeMonths, scenarioProjection]
  );
  const cashFlowForecastTrend = useMemo<TrendPoint[]>(
    () =>
      visibleScenarioProjection.map((point) => ({
        month: point.month,
        income: point.projectedIncome,
        expense: point.projectedExpense,
        net: point.projectedNet,
      })),
    [visibleScenarioProjection]
  );
  const cashFlowForecastStatusByMonth = useMemo<Partial<Record<string, CashFlowForecastStatus>>>(() => {
    const statuses: Partial<Record<string, CashFlowForecastStatus>> = {};
    visibleScenarioProjection.forEach((point) => {
      statuses[point.month] = 'projected';
    });
    return statuses;
  }, [visibleScenarioProjection]);

  const latestRollup = model.monthlyRollups[model.monthlyRollups.length - 1] ?? null;
  const previousRollup = model.monthlyRollups[model.monthlyRollups.length - 2] ?? null;
  const currentCalendarRollup = useMemo(
    () => model.monthlyRollups.find((rollup) => rollup.month === currentCalendarMonth) ?? null,
    [currentCalendarMonth, model.monthlyRollups]
  );
  const previousCalendarRollup = useMemo(
    () =>
      previousCalendarMonth
        ? model.monthlyRollups.find((rollup) => rollup.month === previousCalendarMonth) ?? null
        : null,
    [model.monthlyRollups, previousCalendarMonth]
  );
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

  const reservePercent = useMemo(
    () => getReservePercentDisplay(currentCashBalance, model.runway.reserveTarget),
    [currentCashBalance, model.runway.reserveTarget]
  );
  const reserveFillPercent = useMemo(
    () => (reservePercent === null ? 0 : Math.min(Math.max(reservePercent, 0), 100)),
    [reservePercent]
  );
  const reserveGapPercent = useMemo(() => {
    if (model.runway.reserveTarget <= EPSILON) return 0;
    return Math.min(
      Math.max(((model.runway.reserveTarget - currentCashBalance) / model.runway.reserveTarget) * 100, 0),
      100
    );
  }, [currentCashBalance, model.runway.reserveTarget]);
  const reserveTone = useMemo(() => reserveToneClassName(reservePercent), [reservePercent]);
  const reserveBadge = useMemo(() => getReserveBadgeState(reservePercent), [reservePercent]);

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
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next.tab);
      url.searchParams.delete('view');
      if (next.cashFlow !== 'operating') {
        url.searchParams.set('cf', next.cashFlow);
      } else {
        url.searchParams.delete('cf');
      }

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

      if (next.startMonth) {
        url.searchParams.set('start', next.startMonth);
      } else {
        url.searchParams.delete('start');
      }

      if (next.endMonth) {
        url.searchParams.set('end', next.endMonth);
      } else {
        url.searchParams.delete('end');
      }

      if (next.focusContext) {
        url.searchParams.set('focus', next.focusContext);
      } else {
        url.searchParams.delete('focus');
      }

      if (next.moverGrouping && next.moverGrouping !== 'subcategories') {
        url.searchParams.set('mg', next.moverGrouping);
      } else {
        url.searchParams.delete('mg');
      }

      if (mode === 'replace') {
        window.history.replaceState({}, '', url);
      } else {
        window.history.pushState({}, '', url);
      }
    },
    []
  );

  const navigateToTab = useCallback(
    (nextTab: TabId) => {
      setIsMobileNavOpen(false);

      const isFreshDigHereEntry = nextTab === 'dig-here';

      setActiveTab(nextTab);
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

      setActiveTab('dig-here');
      setQuery(nextQuery);
      setDigHereFocusMonth(focusMonth);
      setDigHereStartMonth(startMonth);
      setDigHereEndMonth(endMonth);
      setDigHereFocusContext(focusContext);

      writeDashboardUrlState({
        tab: 'dig-here',
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
      tab: 'dig-here',
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
          tab: 'dig-here',
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

  function handleSaveCsvUrl() {
    const nextUrl = draftCsvUrl.trim();
    setQuery('');
    writeDashboardUrlState({
      tab: activeTab,
      cashFlow: netCashFlowChartMode,
      queryText: '',
      month: digHereFocusMonth,
      startMonth: digHereStartMonth,
      endMonth: digHereEndMonth,
      focusContext: digHereFocusContext,
      moverGrouping: digHereMoverGrouping,
    }, 'replace');
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
    setQuery('');
    writeDashboardUrlState({
      tab: activeTab,
      cashFlow: netCashFlowChartMode,
      queryText: '',
      month: digHereFocusMonth,
      startMonth: digHereStartMonth,
      endMonth: digHereEndMonth,
      focusContext: digHereFocusContext,
      moverGrouping: digHereMoverGrouping,
    }, 'replace');
    setCsvUrl(SHEET_CSV_URL);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEYS.csvUrl, SHEET_CSV_URL);
      } catch {
        // Ignore storage failures and continue with in-memory URL.
      }
    }
  }

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
    ? 'Import Quicken-style report CSVs into shared storage. Each shared import replaces the current shared imported dataset and becomes the active analysis source when present.'
    : 'Import Quicken-style report CSVs directly into browser-local storage. Imported transactions become the active analysis source when present.';
  const clearImportedDataLabel = sharedPersistenceEnabled ? 'Clear shared imported data' : 'Clear local imported data';
  const sourcePrecedenceLabel = sharedPersistenceEnabled
    ? 'Shared imported dataset -> Google Sheets fallback'
    : 'Browser-local imported dataset -> Google Sheets fallback';
  const importedSourceStatus = importedDataSet
    ? lastImportSummary?.storageScope === 'shared'
      ? 'Yes, shared imported transactions are driving analysis.'
      : 'Yes, browser-local imported transactions are driving analysis.'
    : sharedPersistenceEnabled
      ? 'No shared imported dataset is available, so Google Sheets fallback is active.'
      : 'No browser-local imported dataset is available, so Google Sheets fallback is active.';
  const importModeLabel = lastImportSummary?.importMode === 'replace-all' ? 'Replace-all shared dataset' : 'Append to local dataset';
  const accountSettingsSourceLabel = sharedPersistenceEnabled
    ? sharedAccountSettingsHasRemoteData
      ? 'Shared account settings'
      : 'No shared account settings saved yet; using in-memory/discovered defaults until an edit is synced.'
    : 'Browser-local account settings';
  const fallbackSourceDescription = sharedPersistenceEnabled
    ? 'Fallback CSV source used only when no shared imported dataset is present.'
    : 'Optional fallback CSV source used when no browser-local imported dataset is present.';

  return (
    <div className="finance-app">
      <header className="app-top-nav">
        <div className="app-top-nav-inner">
          <div className="brand-wrap">
            <img className="brand-logo" src={gracieSportsLogo} alt="Gracie Sports logo" />
            <div>
              <h1>Financial Dashboard</h1>
            </div>
          </div>

          <button
            type="button"
            className="app-nav-toggle"
            aria-label="Toggle navigation menu"
            aria-controls="app-top-nav-menu"
            aria-expanded={isMobileNavOpen}
            onClick={() => setIsMobileNavOpen((current) => !current)}
          >
            ☰
          </button>

          <nav id="app-top-nav-menu" className={isMobileNavOpen ? 'app-nav is-open' : 'app-nav'} aria-label="Main navigation">
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={activeTab === item.id ? 'top-nav-item is-active' : 'top-nav-item'}
                    onClick={() => navigateToTab(item.id)}
                  >
                    <item.icon className="top-nav-icon" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="app-top-nav-search">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search payee, category, memo..."
              aria-label="Search transactions"
            />
          </div>

        </div>
      </header>

      <section className="main-zone">
        <header className="top-bar glass-panel">
          <div className="top-bar-main">
            <div className="top-bar-copy">
              <h2>
                {activeTab === 'dig-here' ? 'Dig Here' : selectedBigPictureTitle}
              </h2>
              <p className="top-bar-context">
                {activeTab === 'dig-here' ? digHereHeaderLabel : selectedHeaderComparisonLabel}
              </p>
            </div>

            <div className="top-controls top-controls-timeframe">
              {activeTab === 'dig-here' ? (
                <div className="dig-here-period-control" ref={monthPickerRef}>
                  <div className="dig-here-period-toggle" role="group" aria-label="Dig Here period selector">
                    {DIG_HERE_PERIOD_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={
                          option.value === 'custom'
                            ? isMonthPickerOpen
                              ? 'is-active'
                              : ''
                            : selectedDigHerePeriod === option.value
                              ? 'is-active'
                              : ''
                        }
                        onClick={() => applyDigHerePeriod(option.value)}
                        aria-expanded={option.value === 'custom' ? isMonthPickerOpen : undefined}
                        aria-haspopup={option.value === 'custom' ? 'dialog' : undefined}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {isMonthPickerOpen && (
                    <div className="dig-here-month-picker" role="dialog" aria-label="Choose Dig Here month or period">
                      <div className="dig-here-picker-mode" role="group" aria-label="Focus mode">
                        <button
                          type="button"
                          className={monthPickerMode === 'month' ? 'is-active' : ''}
                          onClick={() => setMonthPickerMode('month')}
                        >
                          Month
                        </button>
                        <button
                          type="button"
                          className={monthPickerMode === 'period' ? 'is-active' : ''}
                          onClick={() => setMonthPickerMode('period')}
                        >
                          Custom period
                        </button>
                      </div>

                      {monthPickerMode === 'month' ? (
                        <label className="dig-here-picker-field">
                          Month
                          <select
                            value={monthPickerDraftMonth}
                            onChange={(event) => setMonthPickerDraftMonth(event.target.value)}
                          >
                            {availableMonths.map((month) => (
                              <option key={month} value={month}>
                                {toMonthLabel(month)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <div className="dig-here-picker-period-grid">
                          <label className="dig-here-picker-field">
                            Start
                            <select
                              value={monthPickerDraftStart}
                              onChange={(event) => setMonthPickerDraftStart(event.target.value)}
                            >
                              {availableMonths.map((month) => (
                                <option key={`start-${month}`} value={month}>
                                  {toMonthLabel(month)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="dig-here-picker-field">
                            End
                            <select
                              value={monthPickerDraftEnd}
                              onChange={(event) => setMonthPickerDraftEnd(event.target.value)}
                            >
                              {availableMonths.map((month) => (
                                <option key={`end-${month}`} value={month}>
                                  {toMonthLabel(month)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}

                      <div className="dig-here-picker-buttons">
                        <button
                          type="button"
                          className="is-primary"
                          onClick={monthPickerMode === 'month' ? applyMonthChoice : applyPeriodChoice}
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          className="is-ghost"
                          onClick={() => {
                            resetDigHereFocus();
                            setIsMonthPickerOpen(false);
                          }}
                        >
                          Reset to default
                        </button>
                      </div>
                    </div>
                  )}
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
        </header>

        {error && <p className="error-banner">{error}</p>}

        {activeTab === 'big-picture' && (
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

            <div className="two-col-grid runway-highlights-grid">
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

              <article className="card reserve-card">
                <div className="reserve-header">
                  <div className="reserve-header-copy">
                    <h3>Operating Reserve</h3>
                    <span className="reserve-subtitle">3-month avg expenses</span>
                  </div>
                  <span className={`reserve-badge ${reserveBadge.toneClassName}`}>{reserveBadge.label}</span>
                </div>

                <ReserveGauge
                  percentLabel={formatReservePercentLabel(reservePercent)}
                  fillPercent={reserveFillPercent}
                  toneClass={reserveTone}
                  reserveTarget={model.runway.reserveTarget}
                />

                <div className="reserve-floor">
                  <div className="reserve-floor-head">
                    <span className="reserve-floor-current">{formatCompactCurrency(currentCashBalance)} current</span>
                    <span className="reserve-floor-target">{formatReserveFloorLabel(model.runway.reserveTarget)}</span>
                  </div>
                  <div className="reserve-floor-bar" aria-hidden="true">
                    <div
                      className={`reserve-floor-fill ${reserveTone}`}
                      style={{ width: `${reserveFillPercent}%` }}
                    />
                  </div>
                </div>

                <div className="reserve-stat-rows">
                  <div className="reserve-stat-row">
                    <div className="reserve-stat-head">
                      <span className="reserve-stat-label">Cash on hand</span>
                      <span className="reserve-stat-value">{formatCurrency(currentCashBalance)}</span>
                    </div>
                    <div className="reserve-stat-bar">
                      <div
                        className={`reserve-stat-bar-fill ${reserveTone}`}
                        style={{ width: `${reserveFillPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="reserve-stat-row">
                    <div className="reserve-stat-head">
                      <span className="reserve-stat-label">Coverage gap</span>
                      <span className="reserve-stat-value">
                        {formatCoverageGapWeeks(currentCashBalance, model.runway.reserveTarget)}
                      </span>
                    </div>
                    <div className="reserve-stat-bar">
                      <div
                        className="reserve-stat-bar-fill is-gap"
                        style={{ width: `${reserveGapPercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                <p className="reserve-structural">
                  Recurring payments cover 34% of expenses · 90–92% retention · Low structural risk
                </p>
              </article>
            </div>

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
            <div className="tab-grid">
              <MoversList
                movers={digHereInsights.movers}
                title="Where to Look"
                grouping={digHereMoverGrouping}
                onGroupingChange={handleDigHereMoverGroupingChange}
              />
              <TopPayeesTable
                payees={digHereInsights.topPayees}
                subtitle={selectedDigHerePeriod === 'thisMonth' ? 'Highest expense recipients this month' : 'Highest expense recipients this period'}
              />
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
            <CashFlowForecastModule
              data={cashFlowForecastTrend}
              pointStatusByMonth={cashFlowForecastStatusByMonth}
              currentCashBalance={currentCashBalance}
              hasCurrentCashBalance={hasCurrentCashBalance}
              forecastRangeMonths={forecastRangeMonths}
              forecastRangeValue={forecastRange}
              forecastRangeOptions={FORECAST_RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              onForecastRangeChange={(nextValue) => {
                const parsed = parseForecastRangeValue(nextValue);
                if (parsed) setForecastRange(parsed);
              }}
              revenueGrowthPct={scenarioInput.revenueGrowthPct}
              expenseReductionPct={scenarioInput.expenseReductionPct}
              onRevenueGrowthChange={(nextValue) =>
                setScenarioInput((prev) => ({
                  ...prev,
                  revenueGrowthPct: nextValue,
                }))
              }
              onExpenseReductionChange={(nextValue) =>
                setScenarioInput((prev) => ({
                  ...prev,
                  expenseReductionPct: nextValue,
                }))
              }
            />

            <article className="card table-card">
              <div className="card-head">
                <h3>Projection Table</h3>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Projected Income</th>
                    <th>Projected Expense</th>
                    <th>Projected Net</th>
                    <th>{hasCurrentCashBalance ? 'Projected Cash Balance' : 'Cumulative Net Change'}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleScenarioProjection.map((row) => (
                    <tr key={row.month}>
                      <td>{toMonthLabel(row.month)}</td>
                      <td>{formatCurrency(row.projectedIncome)}</td>
                      <td>{formatCurrency(row.projectedExpense)}</td>
                      <td className={row.projectedNet < 0 ? 'is-negative' : undefined}>{formatCurrency(row.projectedNet)}</td>
                      <td className={row.cumulativeNet < 0 ? 'is-negative' : undefined}>{formatCurrency(row.cumulativeNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="stack-grid">
            <article className="card settings-card">
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
                  <strong>{activeDataSet?.sourceLabel ?? activeDataSet?.sourceUrl ?? csvUrl}</strong>
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
            </article>

            <article className="card settings-card">
              <div className="card-head">
                <h3>Google Sheets Fallback</h3>
                <p className="subtle">{fallbackSourceDescription}</p>
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
                  Fallback source: <code>{dataSet?.sourceLabel ?? dataSet?.sourceUrl ?? csvUrl}</code>
                </p>
                <p>
                  Last fallback refresh: <strong>{formatTimestamp(dataSet?.fetchedAtIso ?? null)}</strong>
                </p>
              </div>
            </article>

            <article className="card settings-card">
              <div className="card-head">
                <h3>Account Setup</h3>
                <p className="subtle">Auto-discovered from imported CSV data. Your edits become the source of truth for future imports.</p>
                <p className="subtle">
                  Settings storage: <strong>{accountSettingsSourceLabel}</strong>
                </p>
              </div>

              <div className="account-setup-summary">
                <p className="account-setup-summary-title">Forecast cash foundation</p>
                <p className="account-setup-summary-copy">
                  Only <strong>Active</strong> accounts marked <strong>In Forecast</strong> contribute to current cash balance and the forecast starting point.
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
                  <li>The forecast uses that computed current balance as its starting point.</li>
                </ul>
              </div>

              {forecastFoundationWarnings.length > 0 ? (
                <div className="account-setup-warnings" role="status" aria-live="polite">
                  <p className="account-setup-warning-title">Check before trusting forecast output</p>
                  <ul>
                    {forecastFoundationWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

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
                                {record.active && record.includeInCashForecast ? 'Feeds forecast' : 'Not used in forecast'}
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
            </article>
          </div>
        )}
      </section>

      <aside className="right-panel">
        <section className="right-hero">
          <p className="eyebrow">Current Net</p>
          <h3>{currentCalendarRollup ? formatCurrency(currentCalendarRollup.netCashFlow) : '$0'}</h3>
          <p>
            {currentCalendarRollup
              ? `for ${toMonthLabel(currentCalendarRollup.month)} (${currentCalendarRollup.transactionCount.toLocaleString()} transactions)`
              : 'Waiting for data'}
          </p>

          <div className="delta-chip">
            <span>{(currentCalendarRollup?.netCashFlow ?? 0) >= (previousCalendarRollup?.netCashFlow ?? 0) ? '▲' : '▼'}</span>
            <span>
              vs previous {previousCalendarRollup ? formatCurrency(previousCalendarRollup.netCashFlow) : 'n/a'}
            </span>
          </div>
        </section>

        <section className="right-card">
          <h4>Quick Health</h4>
          <div className="mini-metrics">
            <p>
              Revenue <strong>{formatCurrency(currentCalendarRollup?.revenue ?? 0)}</strong>
            </p>
            <p>
              Expense <strong>{formatCurrency(currentCalendarRollup?.expenses ?? 0)}</strong>
            </p>
            <p>
              Savings Rate <strong>{(currentCalendarRollup?.savingsRate ?? 0).toFixed(1)}%</strong>
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
