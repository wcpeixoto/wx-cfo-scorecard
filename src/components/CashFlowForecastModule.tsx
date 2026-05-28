import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FiBarChart2, FiCheck, FiChevronDown, FiSlash } from 'react-icons/fi';
import ProjectedCashBalanceChart from './ProjectedCashBalanceChart';
import PeriodDropdown, { type PeriodOption } from './PeriodDropdown';
import type {
  CashFlowForecastStatus,
  ForecastDecisionSignals,
  ForecastEvent,
  ForecastScenarioKey,
  ForecastSeasonalityMeta,
  MonthlyRollup,
  RenewalContract,
  ScenarioPoint,
  TrendPoint,
} from '../lib/data/contract';
import { toMonthLabel } from '../lib/kpis/compute';
import { buildPriorPeriodSeries } from '../lib/forecast/priorPeriodSeries';
import { buildReserveSeries } from '../lib/forecast/reserveSeries';
import { formatCompact } from '../lib/utils/formatCompact';

type SelectOption = { value: string; label: string; months: number };

type EventFrequency = 'once' | 'monthly' | 'yearly';

function generateEventMonths(startDate: string, frequency: EventFrequency, forecastRangeMonths: number): string[] {
  // startDate is YYYY-MM-DD; recurrence still operates at month granularity
  // because the overlay keys by YYYY-MM. Day-of-month is preserved on the
  // event record via the `date` field but does not affect month generation.
  const startMonth = startDate.slice(0, 7);

  if (frequency === 'once') return [startMonth];

  const today = new Date();
  const endDate = new Date(today.getFullYear(), today.getMonth() + forecastRangeMonths, 1);
  const horizonEnd = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;

  const months: string[] = [];

  if (frequency === 'monthly') {
    let current = startMonth;
    while (current <= horizonEnd) {
      months.push(current);
      const [y, m] = current.split('-').map(Number);
      const next = new Date(Date.UTC(y, m, 1)); // m is 1-indexed; Date.UTC(y, m, 1) = first of next month
      current = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
    }
  } else {
    const [startYear, startMonthNum] = startMonth.split('-').map(Number);
    const [endYear] = horizonEnd.split('-').map(Number);
    for (let year = startYear; year <= endYear; year++) {
      const candidate = `${year}-${String(startMonthNum).padStart(2, '0')}`;
      if (candidate <= horizonEnd) months.push(candidate);
    }
  }

  if (months.length === 0) months.push(startMonth);
  return months;
}

// Format YYYY-MM-DD → "Mmm DD, YYYY" (e.g. "Jun 30, 2026"). UTC-stable.
function formatEventDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || !Number.isFinite(day)) return date;
  return new Date(Date.UTC(year, monthIndex, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Today's local date as YYYY-MM-DD (matches <input type="date"> value format).
function todayDateValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Last day of (today + months) as YYYY-MM-DD. Used for the picker max.
function lastDayOfHorizon(monthsFromNow: number): string {
  const d = new Date();
  // Day 0 of (currentMonth + monthsFromNow + 1) = last day of horizon month.
  const horizonEnd = new Date(d.getFullYear(), d.getMonth() + monthsFromNow + 1, 0);
  return `${horizonEnd.getFullYear()}-${String(horizonEnd.getMonth() + 1).padStart(2, '0')}-${String(horizonEnd.getDate()).padStart(2, '0')}`;
}

// Build YYYY-MM-DD from a target month and a desired day, clamped to the
// last valid day of that month (e.g. day 31 in Feb → Feb 28/29). Recurrence
// uses this so monthly/yearly events on day 31 land cleanly in shorter months.
function dateInMonth(month: string, desiredDay: number): string {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return month;
  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(desiredDay, 1), lastDay);
  return `${month}-${String(day).padStart(2, '0')}`;
}

// Short labels for the horizon dropdown (parent passes longer "Next ..." labels
// which are still the canonical option labels — these are display-only).
const FORECAST_RANGE_SHORT_LABELS: Record<string, string> = {
  '30d': '30 Days',
  '60d': '60 Days',
  '90d': '90 Days',
  '6m':  '6 Months',
  '1y':  '1 Year',
  '2y':  '2 Years',
  '3y':  '3 Years',
};

// DECISION_WINDOW: number of forecast months used for profit and margin cards.
// Cards 1 and 3 use forecast data, not trailing actuals.
// Change this constant if the business logic needs to shift to actuals later.
const DECISION_WINDOW_MONTHS = 12;

// Target net margin for the "money goal" card.
// This default is used only when no value is passed via props.
const DEFAULT_TARGET_NET_MARGIN = 0.25;

type CashFlowForecastModuleProps = {
  data: TrendPoint[];
  /** Per-month TrendPoint series for the "base" preset projection, aligned 1:1 with `data`.
   *  Null when the active scenario IS the base preset (no overlay to draw). When non-null,
   *  renders as a faded overlay on the cash-balance chart so the operator can see how the
   *  active scenario differs from the default forecast. Suppressed by the chart layer
   *  whenever priorSeries or reserveSeries is already active (one overlay at a time). */
  baselineData?: TrendPoint[] | null;
  /** Historical monthly actuals — drives the optional prior-period overlay. */
  monthlyRollups: MonthlyRollup[];
  fullForecast: ScenarioPoint[];
  /** Optional: fixed reserve target from Settings (used when method = 'fixed'). */
  fixedReserveAmount?: number | null;
  /** Optional: override TARGET_NET_MARGIN from settings (0–1). Falls back to 0.25. */
  targetNetMargin?: number | null;
  decisionSignals: ForecastDecisionSignals;
  seasonality: ForecastSeasonalityMeta;
  currentCashBalance: number;
  forecastRangeMonths: number;
  forecastRangeValue: string;
  forecastRangeOptions: SelectOption[];
  onForecastRangeChange: (nextValue: string) => void;
  scenarioKey: ForecastScenarioKey;
  onScenarioChange: (nextValue: ForecastScenarioKey) => void;
  revenueGrowthPct: number;
  expenseChangePct: number;
  /** Settings-saved fine-tune pct, used to compute the slider's $-impact tooltip
   *  against the Settings-adjusted baseline rather than the raw history baseline.
   *  Defaults to 0 if not provided. */
  settingsRevenueFineTunePct?: number;
  settingsExpenseFineTunePct?: number;
  receivableDays: number;
  payableDays: number;
  onRevenueGrowthChange: (nextValue: number) => void;
  onExpenseChange: (nextValue: number) => void;
  onReceivableDaysChange: (nextValue: number) => void;
  onPayableDaysChange: (nextValue: number) => void;
  forecastEvents?: ForecastEvent[];
  contracts?: RenewalContract[];
  onAddEvent?: (events: ForecastEvent[]) => void;
  onUpdateEvent?: (event: ForecastEvent) => void;
  onReplaceGroup?: (groupId: string, events: ForecastEvent[]) => void;
  onDeleteEvent?: (groupId: string) => void;
  onToggleEvent?: (groupId: string, enabled: boolean) => void;
  /** Optional sibling rendered to the right of the Projected Cash Balance
   *  chart-shell. When provided, the chart and the slot share a 2/3 + 1/3
   *  grid. Used by the Forecast page to pair the Business Valuation card
   *  with the cash-balance chart. */
  rightSlot?: ReactNode;
};

type ForecastSliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (nextValue: number) => void;
  formatValue?: (value: number) => string;
  tickValues?: number[];
  formatTickValue?: (value: number) => string;
  minorTickStep?: number;
  secondaryLabel?: ReactNode;
  headerExtra?: ReactNode;
};

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseMonthStart(month: string): Date {
  const [yearToken, monthToken] = month.split('-');
  const year = Number.parseInt(yearToken, 10);
  const monthIndex = Number.parseInt(monthToken, 10) - 1;
  return new Date(Date.UTC(year, monthIndex, 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function weekStartMonday(date: Date): Date {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset));
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatWeekTooltip(start: Date, end: Date): string {
  const startLabel = formatShortDate(start);
  const endLabel = formatShortDate(end);
  const yearLabel = end.getUTCFullYear();
  return `${startLabel} – ${endLabel}, ${yearLabel}`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function expandMonthlyToWeekly(monthlyPoints: TrendPoint[]): TrendPoint[] {
  if (monthlyPoints.length === 0) return [];

  const monthlyMap = new Map(monthlyPoints.map((point) => [point.month, point]));
  const rangeStart = parseMonthStart(monthlyPoints[0].month);
  const rangeEnd = endOfMonth(parseMonthStart(monthlyPoints[monthlyPoints.length - 1].month));
  const firstWeekStart = weekStartMonday(rangeStart);
  const weeklyPoints: TrendPoint[] = [];

  for (let weekStart = new Date(firstWeekStart); weekStart <= rangeEnd; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const overlapStart = weekStart < rangeStart ? rangeStart : weekStart;
    const overlapEnd = weekEnd > rangeEnd ? rangeEnd : weekEnd;
    if (overlapStart > overlapEnd) continue;

    let income = 0;
    let expense = 0;
    let net = 0;

    for (let cursor = new Date(overlapStart); cursor <= overlapEnd; cursor = addDays(cursor, 1)) {
      const monthKey = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      const monthPoint = monthlyMap.get(monthKey);
      if (!monthPoint) continue;

      const monthDays = daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth());
      income += monthPoint.income / monthDays;
      expense += monthPoint.expense / monthDays;
      net += monthPoint.net / monthDays;
    }

    weeklyPoints.push({
      month: formatDateKey(weekStart),
      income: roundCurrency(income),
      expense: roundCurrency(expense),
      net: roundCurrency(net),
      granularity: 'week',
      axisLabel: formatShortDate(weekStart),
      tooltipLabel: formatWeekTooltip(overlapStart, overlapEnd),
      periodStart: formatDateKey(overlapStart),
      periodEnd: formatDateKey(overlapEnd),
    });
  }

  return weeklyPoints;
}

function formatSignedPercent(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
}

// Revenue-slider impact label: word-polarity instead of +/- signs.
// "$0/mo revenue" stays visible at the neutral position so the slot is
// understood before the user moves the slider.
function formatRevenueImpact(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '$0/mo revenue';
  const compact = formatCompact(Math.abs(rounded));
  return rounded > 0 ? `${compact}/mo revenue` : `${compact}/mo less revenue`;
}

// Expense-slider impact label: both polarities take an explicit qualifier.
function formatExpenseImpact(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '$0/mo expenses';
  const compact = formatCompact(Math.abs(rounded));
  return rounded > 0 ? `${compact}/mo more expenses` : `${compact}/mo less expenses`;
}

function formatDays(value: number): string {
  return `${Math.round(value)}d`;
}

function fmtK(n: number): string {
  const fixed = (n / 1_000).toFixed(1);
  return fixed.endsWith('.0') ? String(Math.round(n / 1_000)) : fixed;
}

function formatCurrencyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const fixed = (value / 1_000_000).toFixed(1);
    return `$${fixed.endsWith('.0') ? String(Math.round(value / 1_000_000)) : fixed}M`;
  }
  if (abs >= 1_000) return `$${fmtK(value)}K`;
  return `$${Math.round(value)}`;
}

function formatCurrencyFull(value: number): string {
  const rounded = Math.round(value);
  return `$${Math.abs(rounded).toLocaleString('en-US')}`;
}

function wrapUnit(str: string): ReactNode {
  return str;
}

function formatCurrencyCompactNode(value: number): ReactNode {
  return wrapUnit(formatCurrencyCompact(value));
}

function ForecastSliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue = formatSignedPercent,
  tickValues,
  formatTickValue = formatValue,
  minorTickStep,
  secondaryLabel,
  headerExtra,
}: ForecastSliderControlProps) {
  const safeSpan = Math.max(max - min, 1);
  const sliderPercent = ((value - min) / safeSpan) * 100;
  const valueTransform = sliderPercent < 8 ? 'translateX(0%)' : sliderPercent > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
  const sliderTicks = (tickValues ?? [min, (min + max) / 2, max]).filter(
    (tick, index, list) => tick >= min && tick <= max && list.indexOf(tick) === index
  );
  const minorTicks = minorTickStep
    ? Array.from({ length: Math.floor((max - min) / minorTickStep) + 1 }, (_, i) => min + i * minorTickStep)
        .filter((t) => t >= min && t <= max && !sliderTicks.some((mt) => Math.abs(mt - t) < 0.001))
    : [];

  return (
    <label className="forecast-slider-control">
      <div className="forecast-slider-header">
        <span className="forecast-slider-label">{label}</span>
        {secondaryLabel != null && (
          <span className="forecast-slider-impact">: {secondaryLabel}</span>
        )}
        {headerExtra}
      </div>
      <div className="forecast-slider-track-wrap">
        <span
          className="forecast-slider-thumb-value"
          style={{
            left: `${sliderPercent}%`,
            transform: valueTransform,
          }}
        >
          {formatValue(value)}
        </span>
        <div className="forecast-slider-ticks" aria-hidden="true">
          {sliderTicks.map((tick) => {
            const tickPercent = ((tick - min) / safeSpan) * 100;
            const isZero = Math.abs(tick) < 0.001;
            return (
              <span
                key={`${label}-tick-${tick}`}
                className={`forecast-slider-tick${isZero ? ' is-zero' : ''}`}
                style={{ left: `${tickPercent}%` }}
              />
            );
          })}
          {minorTicks.map((tick) => {
            const tickPercent = ((tick - min) / safeSpan) * 100;
            return (
              <span
                key={`${label}-minor-${tick}`}
                className="forecast-slider-tick forecast-slider-tick--minor"
                style={{ left: `${tickPercent}%` }}
              />
            );
          })}
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number.parseFloat(event.target.value))}
        />
        <div className="forecast-slider-tick-label-row" aria-hidden="true">
          {sliderTicks.map((tick) => (
            <span key={`${label}-tick-label-${tick}`}>{formatTickValue(tick)}</span>
          ))}
        </div>
      </div>
    </label>
  );
}

export default function CashFlowForecastModule({
  data,
  baselineData = null,
  monthlyRollups,
  fullForecast,
  fixedReserveAmount,
  targetNetMargin,
  decisionSignals,
  seasonality,
  currentCashBalance,
  forecastRangeMonths,
  forecastRangeValue,
  forecastRangeOptions,
  onForecastRangeChange,
  scenarioKey,
  onScenarioChange,
  revenueGrowthPct,
  expenseChangePct,
  settingsRevenueFineTunePct = 0,
  settingsExpenseFineTunePct = 0,
  onRevenueGrowthChange,
  onExpenseChange,
  forecastEvents = [],
  contracts = [],
  onAddEvent,
  onUpdateEvent,
  onReplaceGroup,
  onDeleteEvent,
  onToggleEvent,
  rightSlot,
}: CashFlowForecastModuleProps) {
  const chartMountT0Ref = useRef(performance.now());
  const chartBootLoggedRef = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV && !chartBootLoggedRef.current) {
      chartBootLoggedRef.current = true;
      console.log('[BOOT] Charts render:', Math.round(performance.now() - chartMountT0Ref.current), 'ms');
    }
  }, []);

  const [scenarioMenuOpen, setScenarioMenuOpen] = useState(false);
  const scenarioMenuRef = useRef<HTMLDivElement>(null);

  // Add Event modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [formDate, setFormDate] = useState('');
  const [formOriginalDate, setFormOriginalDate] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formFrequency, setFormFrequency] = useState<EventFrequency>('once');
  const [formErrors, setFormErrors] = useState<{ date?: string; title?: string }>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeSteerId, setActiveSteerId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Date picker bounds. Max sourced from FORECAST_RANGE_OPTIONS (passed
  // as forecastRangeOptions prop) — the canonical user-facing horizon.
  // Never hardcode 36 here; if the canonical horizon changes, this follows.
  const datePickerMin = useMemo(() => todayDateValue(), []);
  const datePickerMax = useMemo(() => {
    const maxMonths = forecastRangeOptions.reduce((acc, opt) => Math.max(acc, opt.months), 0);
    return lastDayOfHorizon(maxMonths);
  }, [forecastRangeOptions]);

  const periodDropdownOptions = useMemo<PeriodOption[]>(
    () =>
      forecastRangeOptions.map((opt) => ({
        value: opt.value,
        label: FORECAST_RANGE_SHORT_LABELS[opt.value] ?? opt.label,
      })),
    [forecastRangeOptions],
  );

  // Trailing-6mo average monthly revenue + expenses — close proxy to the
  // engine's baselineCashIn/Out without re-implementing deriveForecastBaseline.
  // Used only to translate the slider percent into an at-a-glance $/mo label.
  const baselineMonthlyRevenue = useMemo(() => {
    const recent = monthlyRollups.slice(-6);
    if (recent.length === 0) return 0;
    return recent.reduce((sum, r) => sum + r.revenue, 0) / recent.length;
  }, [monthlyRollups]);

  const baselineMonthlyExpense = useMemo(() => {
    const recent = monthlyRollups.slice(-6);
    if (recent.length === 0) return 0;
    return recent.reduce((sum, r) => sum + r.expenses, 0) / recent.length;
  }, [monthlyRollups]);

  // Slider tooltip = slider-only delta on the Settings-adjusted baseline.
  // Answers "what does this slider add on top of my default forecast?",
  // not "what do Settings + slider add together vs raw history?".
  const settingsAdjustedMonthlyRevenue = baselineMonthlyRevenue * (1 + settingsRevenueFineTunePct / 100);
  const settingsAdjustedMonthlyExpense = baselineMonthlyExpense * (1 + settingsExpenseFineTunePct / 100);
  const revenueImpactLabel = formatRevenueImpact((revenueGrowthPct / 100) * settingsAdjustedMonthlyRevenue);
  const expenseImpactLabel = formatExpenseImpact((expenseChangePct / 100) * settingsAdjustedMonthlyExpense);

  function openAddModal() {
    setEditingEventId(null);
    setEditingGroupId(null);
    // Default the date to today (local-tz) so the operator can submit
    // without touching the field. Edit modal still pre-fills the existing date.
    const todayValue = todayDateValue();
    setFormDate(todayValue);
    setFormOriginalDate(todayValue);
    setFormTitle('');
    setFormAmount('');
    setFormFrequency('once');
    setFormErrors({});
    setShowAddModal(true);
  }

  function openEditModal(group: (typeof groupedEventRows)[0]) {
    setEditingEventId(group.firstEvent.id);
    setEditingGroupId(group.groupId);
    // Pre-fill with the existing date (legacy events have a synthesized
    // last-day-of-month default applied at the persistence layer).
    const existingDate = group.firstEvent.date ?? '';
    setFormDate(existingDate);
    setFormOriginalDate(existingDate || null);
    setFormTitle(group.title);
    setFormFrequency(group.frequency);
    setFormAmount(group.amount === 0 ? '' : String(group.amount));
    setFormErrors({});
    setShowAddModal(true);
  }

  function handleAddEventSubmit() {
    const errors: { date?: string; title?: string } = {};
    if (!formDate) {
      errors.date = 'Choose the expected event date.';
    } else if (
      // Allow legacy past-date pre-fill on edit if unchanged. Reject any
      // new selection outside [today, last day of forecast horizon].
      formDate !== formOriginalDate &&
      (formDate < datePickerMin || formDate > datePickerMax)
    ) {
      errors.date = 'Choose a date within the forecast window.';
    }
    if (!formTitle.trim()) errors.title = 'Event title is required';
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    const amount = parseFloat(formAmount) || 0;
    const cashInImpact = amount >= 0 ? amount : 0;
    const cashOutImpact = amount < 0 ? Math.abs(amount) : 0;

    // Editing: replace the old group with the new occurrences in a single
    // atomic state+persistence update. Two separate calls (delete + add)
    // race in the persistence layer — each save's stale-row cleanup can
    // land out-of-order and wipe freshly-upserted rows. onReplaceGroup
    // does one setState and one save.
    if (editingGroupId !== null) {
      const newGroupId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Date.now().toString();
      const editMonths = generateEventMonths(formDate, formFrequency, forecastRangeMonths);
      const editEvents: ForecastEvent[] = editMonths.map((month, index) => ({
        id: `${formFrequency}__${newGroupId}__${index}`,
        month,
        // Recurrence preserves day-of-month from the picked date.
        date: dateInMonth(month, Number.parseInt(formDate.slice(8, 10), 10)),
        type: 'one_time_revenue',
        title: formTitle.trim(),
        status: 'planned',
        impactMode: 'fixed_amount',
        cashInImpact,
        cashOutImpact,
        enabled: true,
      }));
      onReplaceGroup?.(editingGroupId, editEvents);
      setEditingEventId(null);
      setEditingGroupId(null);
      setShowAddModal(false);
      return;
    }

    // New events: generate based on frequency
    const groupId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Date.now().toString();

    const months = generateEventMonths(formDate, formFrequency, forecastRangeMonths);
    const events: ForecastEvent[] = months.map((month, index) => ({
      id: `${formFrequency}__${groupId}__${index}`,
      month,
      date: `${month}-${formDate.slice(8, 10)}`,
      type: 'one_time_revenue',
      title: formTitle.trim(),
      status: 'planned',
      impactMode: 'fixed_amount',
      cashInImpact,
      cashOutImpact,
      enabled: true,
    }));

    onAddEvent?.(events);
    setShowAddModal(false);
  }

  useEffect(() => {
    if (!scenarioMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (scenarioMenuRef.current && !scenarioMenuRef.current.contains(e.target as Node)) {
        setScenarioMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [scenarioMenuOpen]);

  const granularity: 'month' | 'week' = forecastRangeMonths < 6 ? 'week' : 'month';
  const startingCashBalance = Number.isFinite(currentCashBalance) ? currentCashBalance : 0;

  // Prior-period overlay. Helper returns monthly NET-change series + a prior
  // starting balance; we accumulate at the displayed granularity (monthly or
  // expanded-weekly) using the same logic the forecast itself applies to
  // `data`. Available at any horizon as long as coverage is complete.
  type CompareMode = 'off' | 'past' | 'reserve';
  const [compareMode, setCompareMode] = useState<CompareMode>('off');
  const [compareMenuOpen, setCompareMenuOpen] = useState(false);
  const compareMenuRef = useRef<HTMLDivElement>(null);
  const priorPeriodInput = useMemo(() => {
    const forecastMonths = data.map((d) => d.month);
    return buildPriorPeriodSeries(monthlyRollups, startingCashBalance, forecastMonths);
  }, [data, monthlyRollups, startingCashBalance]);
  const priorPeriodAvailable = priorPeriodInput !== null;
  const priorPeriodActive = compareMode === 'past' && priorPeriodAvailable;

  const cumulativeSeries = useMemo<TrendPoint[]>(() => {
    let running = startingCashBalance;
    return data.map((point) => {
      running += point.net;
      return {
        ...point,
        net: roundCurrency(running),
      };
    });
  }, [data, startingCashBalance]);

  const weeklySeries = useMemo(() => expandMonthlyToWeekly(data), [data]);
  const weeklyCumulativeSeries = useMemo<TrendPoint[]>(() => {
    let running = startingCashBalance;
    return weeklySeries.map((point) => {
      running += point.net;
      return {
        ...point,
        net: roundCurrency(running),
      };
    });
  }, [startingCashBalance, weeklySeries]);

  // Baseline overlay accumulation. Mirrors the active-forecast accumulation
  // exactly (same startingCashBalance, same expandMonthlyToWeekly transform)
  // so monthly and weekly buckets line up 1:1 with the live series. Returns
  // null whenever baselineData is null — the chart layer suppresses the
  // overlay slot in that case.
  const baselineCumulativeSeries = useMemo<TrendPoint[] | null>(() => {
    if (!baselineData) return null;
    let running = startingCashBalance;
    return baselineData.map((point) => {
      running += point.net;
      return {
        ...point,
        net: roundCurrency(running),
      };
    });
  }, [baselineData, startingCashBalance]);
  const baselineWeeklyExpanded = useMemo(
    () => (baselineData ? expandMonthlyToWeekly(baselineData) : []),
    [baselineData],
  );
  const baselineWeeklyCumulativeSeries = useMemo<TrendPoint[] | null>(() => {
    if (!baselineData) return null;
    let running = startingCashBalance;
    return baselineWeeklyExpanded.map((point) => {
      running += point.net;
      return {
        ...point,
        net: roundCurrency(running),
      };
    });
  }, [baselineData, baselineWeeklyExpanded, startingCashBalance]);

  // Prior series accumulated at the displayed granularity. Monthly path
  // accumulates the raw monthly nets; weekly path runs the same
  // expandMonthlyToWeekly transform the forecast uses, so prior and forecast
  // weeks line up identically.
  const priorMonthlyCumulative = useMemo<TrendPoint[]>(() => {
    if (!priorPeriodInput) return [];
    let running = priorPeriodInput.startingBalance;
    return priorPeriodInput.netSeries.map((point) => {
      running += point.net;
      return { ...point, net: roundCurrency(running) };
    });
  }, [priorPeriodInput]);
  const priorWeeklyExpanded = useMemo(
    () => (priorPeriodInput ? expandMonthlyToWeekly(priorPeriodInput.netSeries) : []),
    [priorPeriodInput],
  );
  const priorWeeklyCumulative = useMemo<TrendPoint[]>(() => {
    if (!priorPeriodInput) return [];
    let running = priorPeriodInput.startingBalance;
    return priorWeeklyExpanded.map((point) => {
      running += point.net;
      return { ...point, net: roundCurrency(running) };
    });
  }, [priorPeriodInput, priorWeeklyExpanded]);
  const monthlyRangeLabel = data.length > 0 ? `${toMonthLabel(data[0].month)} – ${toMonthLabel(data[data.length - 1].month)}` : '';
  const priorPeriodRangeLabel = useMemo(() => {
    if (!priorPeriodInput) return '';
    const { priorMonths } = priorPeriodInput;
    if (priorMonths.length === 0) return '';
    const priorFirst = priorMonths[0];
    const priorLast = priorMonths[priorMonths.length - 1];
    if (priorFirst === priorLast) return toMonthLabel(priorFirst);
    return `${toMonthLabel(priorFirst)} – ${toMonthLabel(priorLast)}`;
  }, [priorPeriodInput]);
  const displaySeries = granularity === 'week' ? weeklyCumulativeSeries : cumulativeSeries;
  const priorDisplaySeries = granularity === 'week' ? priorWeeklyCumulative : priorMonthlyCumulative;
  const baselineDisplaySeries =
    granularity === 'week' ? baselineWeeklyCumulativeSeries : baselineCumulativeSeries;
  const reserveSeries = useMemo(
    () => buildReserveSeries(fullForecast, displaySeries, granularity),
    [fullForecast, displaySeries, granularity],
  );
  const reserveAvailable = reserveSeries !== null;
  const reserveActive = compareMode === 'reserve' && reserveAvailable;
  // Auto-collapse if the selected compare mode becomes unavailable (e.g. user
  // moves to a horizon with insufficient history or no full 30-day forward
  // windows). Re-entering a supported horizon does not silently re-enable
  // the overlay.
  useEffect(() => {
    if (compareMode === 'past' && !priorPeriodAvailable) setCompareMode('off');
    if (compareMode === 'reserve' && !reserveAvailable) setCompareMode('off');
  }, [compareMode, priorPeriodAvailable, reserveAvailable]);
  // Close compare menu on outside click.
  useEffect(() => {
    if (!compareMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (compareMenuRef.current && !compareMenuRef.current.contains(e.target as Node)) {
        setCompareMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [compareMenuOpen]);
  const reserveBreached = !!decisionSignals.reserveBreachMonth;
  const hasNegativeCash = !!decisionSignals.negativeCashMonth;
  const cashRiskState: 'safe' | 'warning' | 'critical' = hasNegativeCash ? 'critical' : reserveBreached ? 'warning' : 'safe';

  const negativeCashMonthLabel = decisionSignals.negativeCashMonth ? toMonthLabel(decisionSignals.negativeCashMonth) : null;
  const reserveBreachMonthLabel = decisionSignals.reserveBreachMonth ? toMonthLabel(decisionSignals.reserveBreachMonth) : null;
  const cashTroughMonthLabel = decisionSignals.cashTroughMonth ? toMonthLabel(decisionSignals.cashTroughMonth) : '—';
  const cashTroughBalanceLabel = decisionSignals.cashTroughBalance === null ? '—' : formatCurrencyCompact(decisionSignals.cashTroughBalance);
  const visibleSeasonalityWarning = useMemo(() => {
    if (!seasonality.warning) return null;
    return data.some((point) => point.month === seasonality.warning?.month) ? seasonality.warning : null;
  }, [data, seasonality.warning]);
  const seasonalityModeLabel = seasonality.mode === 'seasonal' ? 'Seasonal mode' : 'Fallback mode';
  const seasonalitySupportLabel =
    seasonality.mode === 'seasonal'
      ? `Using ${seasonality.completeYearsUsed.length} complete year${seasonality.completeYearsUsed.length === 1 ? '' : 's'}`
      : 'Using recent baseline only';
  const seasonalityConfidenceLabel =
    seasonality.confidence === 'low'
      ? 'Low confidence — limited seasonal history'
      : seasonality.confidence === 'strong'
        ? 'Strong confidence'
        : null;

  const groupedEventRows = useMemo(() => {
    type ManualBucket = { kind: 'manual'; frequency: EventFrequency; events: ForecastEvent[] };
    type RenewalBucket = { kind: 'renewal'; contractId: string; events: ForecastEvent[] };
    type Bucket = ManualBucket | RenewalBucket;

    const groups = new Map<string, Bucket>();
    for (const event of forecastEvents) {
      // Renewal-generated events: group by contractId. Source of truth is
      // the `source` column; the `renewal__{contractId}__{date}` id
      // convention is a secondary signal for legacy rows that may pre-date
      // the source field being populated.
      if (event.source === 'renewal' && event.contractId) {
        const groupId = `renewal:${event.contractId}`;
        if (!groups.has(groupId)) {
          groups.set(groupId, { kind: 'renewal', contractId: event.contractId, events: [] });
        }
        groups.get(groupId)!.events.push(event);
        continue;
      }

      // Legacy manual events: encoded id `<freq>__<groupId>__<index>`.
      const parts = event.id.split('__');
      const isEncoded = parts.length === 3 && (parts[0] === 'once' || parts[0] === 'monthly' || parts[0] === 'yearly');
      const frequency: EventFrequency = isEncoded ? (parts[0] as EventFrequency) : 'once';
      const groupId = isEncoded ? parts[1] : event.id;
      if (!groups.has(groupId)) groups.set(groupId, { kind: 'manual', frequency, events: [] });
      groups.get(groupId)!.events.push(event);
    }

    return Array.from(groups.entries()).map(([groupId, bucket]) => {
      const sorted = [...bucket.events].sort((a, b) => a.month.localeCompare(b.month));
      const first = sorted[0];
      const amount = first.cashInImpact > 0 ? first.cashInImpact : -first.cashOutImpact;
      // Date is the source of truth for display. Persistence layer
      // synthesizes last-day-of-month for legacy rows, so first.date is
      // always populated when the event came from Supabase.
      const firstDate = first.date ?? `${first.month}-01`;

      if (bucket.kind === 'renewal') {
        const contract = contracts.find((c) => c.id === bucket.contractId);
        // Cadence resolution: contract is the reliable source. Spacing
        // fallback only fires when contract is missing AND ≥2 events
        // exist in the horizon (≈12 months between consecutive events =
        // annual; otherwise monthly).
        let cadenceLabel: 'Monthly' | 'Annual';
        if (contract) {
          cadenceLabel = contract.renewalCadence === 'annual' ? 'Annual' : 'Monthly';
        } else if (sorted.length >= 2) {
          const [a, b] = sorted;
          const [ay, am] = a.month.split('-').map(Number);
          const [by, bm] = b.month.split('-').map(Number);
          const diff = (by - ay) * 12 + (bm - am);
          cadenceLabel = diff >= 6 ? 'Annual' : 'Monthly';
        } else {
          cadenceLabel = 'Monthly';
        }

        const title = contract?.name ?? first.title;
        const monthDisplay =
          cadenceLabel === 'Annual'
            ? `every ${formatEventDate(firstDate).replace(/, \d{4}$/, '')}, starting ${first.month.split('-')[0]}`
            : `starting ${formatEventDate(firstDate)}`;

        return {
          groupId,
          kind: 'renewal' as const,
          contractId: bucket.contractId,
          frequency: cadenceLabel === 'Annual' ? ('yearly' as EventFrequency) : ('monthly' as EventFrequency),
          freqLabel: cadenceLabel,
          events: sorted,
          firstEvent: first,
          title,
          amount,
          monthDisplay,
          enabled: first.enabled,
        };
      }

      const frequency = bucket.frequency;
      const freqLabel = frequency === 'monthly' ? 'Monthly' : frequency === 'yearly' ? 'Yearly' : 'Once';
      let monthDisplay: string;
      if (frequency === 'once') {
        monthDisplay = formatEventDate(firstDate);
      } else if (frequency === 'monthly') {
        monthDisplay = `starting ${formatEventDate(firstDate)}`;
      } else {
        monthDisplay = `every ${formatEventDate(firstDate).replace(/, \d{4}$/, '')}, starting ${first.month.split('-')[0]}`;
      }
      return {
        groupId,
        kind: 'manual' as const,
        contractId: undefined as string | undefined,
        frequency,
        freqLabel,
        events: sorted,
        firstEvent: first,
        title: first.title,
        amount,
        monthDisplay,
        enabled: first.enabled,
      };
    }).sort((a, b) => a.firstEvent.month.localeCompare(b.firstEvent.month));
  }, [forecastEvents, contracts]);

  // --- Decision card computations ---
  const decisionWindow = fullForecast.slice(0, DECISION_WINDOW_MONTHS);
  const avgNet = decisionWindow.length > 0
    ? decisionWindow.reduce((s, p) => s + p.netCashFlow, 0) / decisionWindow.length
    : null;
  const avgCashIn = decisionWindow.length > 0
    ? decisionWindow.reduce((s, p) => s + p.cashIn, 0) / decisionWindow.length
    : null;
  const netMarginPct = avgNet !== null && avgCashIn !== null && avgCashIn > 0
    ? Math.round((avgNet / avgCashIn) * 100)
    : null;

  // Card 1 — Operating Reserve Target (scenario-reactive, Option A).
  //
  // Target: fixed-method Settings amount when configured (intentionally
  // slider-immune — matches the Settings semantic). Otherwise one month of
  // scenario-projected expenses (avg cashOut over decisionWindow). The
  // expense slider therefore moves the target; the revenue slider does not.
  //
  // Gap: target − lowestProjectedBalance over the FULL forecast horizon,
  // so BOTH sliders move the gap — expense via target AND lowestBalance,
  // revenue via lowestBalance only. Signed (positive = short, negative =
  // above). ±$100 floor suppresses flicker around the threshold.
  const avgCashOut = decisionWindow.length > 0
    ? decisionWindow.reduce((s, p) => s + p.cashOut, 0) / decisionWindow.length
    : null;
  const scenarioReserveTarget =
    fixedReserveAmount != null && fixedReserveAmount > 0
      ? fixedReserveAmount
      : avgCashOut !== null ? avgCashOut : 0;
  const RESERVE_GAP_FLOOR = 100;
  const lowestBalanceIdx = fullForecast.length > 0
    ? fullForecast.reduce((minIdx, p, i) =>
        p.endingCashBalance < fullForecast[minIdx].endingCashBalance ? i : minIdx, 0)
    : -1;
  const lowestBalance = lowestBalanceIdx >= 0 ? fullForecast[lowestBalanceIdx].endingCashBalance : null;
  const reserveGap = scenarioReserveTarget > 0 && lowestBalance !== null
    ? scenarioReserveTarget - lowestBalance
    : null;

  // Card 3: profit target gap
  // Use targetNetMargin from settings if valid (>0), fall back to DEFAULT_TARGET_NET_MARGIN.
  const effectiveTargetNetMargin =
    targetNetMargin != null && targetNetMargin > 0
      ? targetNetMargin
      : DEFAULT_TARGET_NET_MARGIN;
  const targetProfit = avgCashIn !== null ? avgCashIn * effectiveTargetNetMargin : null;
  const profitGap = avgNet !== null && targetProfit !== null ? targetProfit - avgNet : null;
  const isAtGoal = profitGap !== null && profitGap <= 0;

  function fmtMonthly(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
      const fixed = (abs / 1_000_000).toFixed(1);
      return `$${fixed.endsWith('.0') ? String(Math.round(abs / 1_000_000)) : fixed}M/mo`;
    }
    if (abs >= 1_000) return `$${fmtK(abs)}K/mo`;
    return `$${Math.round(abs).toLocaleString()}/mo`;
  }

  function fmtMonthlyValue(value: number): ReactNode {
    const str = fmtMonthly(value);
    const idx = str.lastIndexOf('/mo');
    if (idx === -1) return wrapUnit(str);
    return <>{wrapUnit(str.slice(0, idx))}<span className="forecast-mo">/mo</span></>;
  }

  function fmtMonthlyValuePerMonth(value: number): ReactNode {
    const str = fmtMonthly(value);
    const idx = str.lastIndexOf('/mo');
    const amount = idx === -1 ? str : str.slice(0, idx);
    return <>{wrapUnit(amount)}<span className="forecast-mo">/mo</span></>;
  }

  // Signed variant: preserves the negative sign for values like avgNet.
  // fmtMonthly always strips sign via Math.abs — this wrapper re-applies it.
  function fmtMonthlyValueSigned(value: number): ReactNode {
    const prefix = value < 0 ? '−' : '';
    const str = fmtMonthly(value); // already uses Math.abs internally
    const idx = str.lastIndexOf('/mo');
    if (idx === -1) return <>{prefix}{wrapUnit(str)}</>;
    return <>{prefix}{wrapUnit(str.slice(0, idx))}<span className="forecast-mo">/mo</span></>;
  }

  return (
    <div className="forecast-cockpit">

      <div className="forecast-decision-grid" aria-label="Forecast decision signals">

        {/* Card 1 — Projected Reserve Need */}
        <article className="forecast-decision-card">
          <span className="forecast-decision-label forecast-decision-label--with-tooltip">
            Projected Reserve Need
            <span className="cashflow-help">
              <button type="button" className="cashflow-tooltip" aria-label="Projected Reserve Need explanation">&#9432;</button>
              <div role="tooltip" className="cashflow-tooltip-panel forecast-reserve-tooltip-panel">
                <ul className="cashflow-tooltip-list">
                  <li className="cashflow-tooltip-body">This shows how much cash reserve the business may need based on projected monthly expenses.</li>
                  <li className="cashflow-tooltip-body">Revenue changes affect your future cash balance, but they do not change the reserve need.</li>
                  <li className="cashflow-tooltip-body">Expense changes affect both the reserve need and your future cash balance.</li>
                </ul>
              </div>
            </span>
          </span>
          {scenarioReserveTarget > 0 ? (
            <>
              <strong className="forecast-decision-value forecast-decision-value--md">{formatCurrencyCompactNode(scenarioReserveTarget)}</strong>
              {reserveGap !== null ? (
                reserveGap > RESERVE_GAP_FLOOR ? (
                  <span className="forecast-decision-detail">{formatCurrencyCompact(Math.max(0, reserveGap))} short of your projected reserve need at the projected low</span>
                ) : (
                  <span className="forecast-decision-detail">{formatCurrencyCompact(Math.max(0, -reserveGap))} above your projected reserve need at the projected low</span>
                )
              ) : (
                <span className="forecast-decision-detail">No projection data yet</span>
              )}
            </>
          ) : (
            <>
              <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
              <span className="forecast-decision-detail">No Operating Reserve set</span>
            </>
          )}
        </article>

        {/* Card 2 — Projected Monthly Result */}
        <article className="forecast-decision-card">
          <span className="forecast-decision-label forecast-decision-label--with-tooltip">
            Projected Monthly Result
            <span className="cashflow-help">
              <button type="button" className="cashflow-tooltip" aria-label="Projected Monthly Result explanation">&#9432;</button>
              <div role="tooltip" className="cashflow-tooltip-panel forecast-result-tooltip-panel">
                <ul className="cashflow-tooltip-list">
                  <li className="cashflow-tooltip-body">This shows the average monthly result based on the active forecast scenario.</li>
                  <li className="cashflow-tooltip-body">Revenue and expense changes affect this number because they change projected cash in, cash out, and net profit.</li>
                </ul>
              </div>
            </span>
          </span>
          {avgNet !== null ? (
            <strong className={`forecast-decision-value forecast-decision-value--md${avgNet < 0 ? ' forecast-decision-value--negative' : ''}`}>{fmtMonthlyValueSigned(avgNet)}</strong>
          ) : (
            <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
          )}
          {netMarginPct !== null && avgCashIn !== null && avgCashIn > 0 && (
            <span className="forecast-decision-detail">That&rsquo;s about {netMarginPct}% net profit</span>
          )}
        </article>

        {/* Card 3 — Net Profit Target */}
        <article className="forecast-decision-card">
          <span className="forecast-decision-label">Net Profit Target: {Math.round(effectiveTargetNetMargin * 100)}%</span>
          {isAtGoal && avgNet !== null ? (
            <>
              <strong className="forecast-decision-value forecast-decision-value--md forecast-decision-value--safe">{fmtMonthlyValue(avgNet)}</strong>
              {netMarginPct !== null && (
                <span className="forecast-decision-detail">{netMarginPct}% net profit — this is solid</span>
              )}
            </>
          ) : profitGap !== null && targetProfit !== null ? (
            <>
              <strong className="forecast-decision-value forecast-decision-value--md">{fmtMonthlyValuePerMonth(profitGap)}</strong>
              <span className="forecast-decision-detail">Additional revenue needed at your current margin</span>
            </>
          ) : (
            <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
          )}
        </article>

      </div>

      <div className={`forecast-chart-row${rightSlot ? ' has-side' : ''}`}>
      <section className="card forecast-chart-shell">

        {(() => {
          // Single header IIFE — Net Change context lives in the left heading column;
          // the segmented timeline control sits on the right.
          const hasSeries = displaySeries.length > 0;
          const finalBalance = hasSeries ? displaySeries[displaySeries.length - 1].net : startingCashBalance;
          const netChange = finalBalance - startingCashBalance;
          const netSign = netChange > 0 ? '+' : netChange < 0 ? '−' : '';
          const netColor = netChange > 0 ? 'is-positive' : netChange < 0 ? 'is-negative' : '';
          return (
            <div className="projected-cash-header">
              <div className="projected-cash-heading">
                <div className="projected-cash-title-row">
                  <h3 className="forecast-chart-title">Projected Cash Balance</h3>
                  <div className="cashflow-help">
                    <button type="button" className="cashflow-tooltip" aria-label="How this forecast works">&#9432;</button>
                    <div role="tooltip" className="cashflow-tooltip-panel trend-tooltip-panel forecast-info-tooltip-panel">
                      <ul className="cashflow-tooltip-list trend-tooltip-list">
                        <li><strong>How this forecast works</strong></li>
                        <li className="cashflow-tooltip-body">A directional view of where your cash is heading, based on recent activity and seasonal patterns &mdash; adjust the sliders to test scenarios.</li>
                        <li><strong>Comparison mode</strong></li>
                        <li className="cashflow-tooltip-body">Past Data compares the projection to the same period from prior-year history.</li>
                      </ul>
                    </div>
                  </div>
                </div>
                {monthlyRangeLabel && (
                  <p className="projected-cash-date-range">{monthlyRangeLabel}</p>
                )}
                {hasSeries && (
                  <p className="projected-cash-net-change">
                    <span className={`projected-cash-net-change-value ${netColor}`}>
                      {netSign}{formatCurrencyCompact(Math.abs(netChange))}
                    </span>
                    <span className="projected-cash-net-change-label">Net Change</span>
                  </p>
                )}
              </div>
              <div className="projected-cash-timeline">
                <div className="projected-cash-timeline-row">
                <PeriodDropdown
                  value={forecastRangeValue}
                  options={periodDropdownOptions}
                  onChange={onForecastRangeChange}
                />
                <div className="action-dropdown" ref={scenarioMenuRef}>
                  {(() => {
                    const scenarioOptions = [
                      { key: 'base' as ForecastScenarioKey, label: 'Base Case' },
                      { key: 'best' as ForecastScenarioKey, label: 'Best Case' },
                      { key: 'worst' as ForecastScenarioKey, label: 'Worst Case' },
                      { key: 'custom' as ForecastScenarioKey, label: 'Custom Case' },
                    ] as const;
                    const selectedLabel =
                      scenarioOptions.find((o) => o.key === scenarioKey)?.label ?? 'Base Case';
                    return (
                      <>
                        <button
                          type="button"
                          className="action-dropdown-trigger"
                          aria-haspopup="menu"
                          aria-expanded={scenarioMenuOpen}
                          aria-label={`Forecast scenario: ${selectedLabel}`}
                          onClick={() => setScenarioMenuOpen((c) => !c)}
                        >
                          <span className="action-dropdown-label">{selectedLabel}</span>
                          <FiChevronDown
                            className={`action-dropdown-caret${scenarioMenuOpen ? ' is-open' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                        {scenarioMenuOpen && (
                          <ul className="action-dropdown-menu" role="menu" aria-label="Forecast scenario">
                            {scenarioOptions.filter((option) => option.key !== scenarioKey).map((option) => (
                              <li key={option.key}>
                                <button
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={scenarioKey === option.key}
                                  className={`scenario-menu-item${scenarioKey === option.key ? ' is-active' : ''}`}
                                  onClick={() => {
                                    onScenarioChange(option.key);
                                    setScenarioMenuOpen(false);
                                    if (option.key === 'custom') {
                                      setTimeout(() => {
                                        document
                                          .getElementById('forecast-custom-controls')
                                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                      }, 50);
                                    }
                                  }}
                                >
                                  <span className="scenario-menu-item-label">{option.label}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="action-dropdown forecast-compare-dropdown" ref={compareMenuRef}>
                  {(() => {
                    const isActive = compareMode !== 'off';
                    const buttonLabel =
                      compareMode === 'past'
                        ? 'Past Data'
                        : compareMode === 'reserve'
                          ? 'Cash Reserve'
                          : 'Compare';
                    return (
                      <>
                        <button
                          type="button"
                          className={`forecast-compare-btn${isActive ? ' is-active' : ''}`}
                          aria-pressed={isActive}
                          aria-label={
                            isActive
                              ? `Turn off compare (${buttonLabel})`
                              : 'Open compare options'
                          }
                          onClick={() => {
                            if (isActive) {
                              setCompareMode('off');
                              setCompareMenuOpen(false);
                            } else {
                              setCompareMenuOpen((c) => !c);
                            }
                          }}
                        >
                          <FiBarChart2 aria-hidden="true" focusable="false" />
                          <span className="action-dropdown-label">{buttonLabel}</span>
                        </button>
                        <button
                          type="button"
                          className="forecast-compare-caret"
                          aria-haspopup="menu"
                          aria-expanded={compareMenuOpen}
                          aria-label="Compare options"
                          onClick={() => setCompareMenuOpen((c) => !c)}
                        >
                          <FiChevronDown
                            className={`action-dropdown-caret${compareMenuOpen ? ' is-open' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                        {compareMenuOpen && (
                          <ul className="action-dropdown-menu" role="menu" aria-label="Compare overlay">
                            <li>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={compareMode === 'past'}
                                aria-disabled={!priorPeriodAvailable}
                                className={compareMode === 'past' ? 'is-active' : ''}
                                title={
                                  priorPeriodAvailable
                                    ? undefined
                                    : 'Need actual history covering the same calendar range one year earlier'
                                }
                                onClick={() => {
                                  if (!priorPeriodAvailable) return;
                                  setCompareMode('past');
                                  setCompareMenuOpen(false);
                                }}
                              >
                                Past Data
                              </button>
                            </li>
                            <li>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={compareMode === 'reserve'}
                                aria-disabled={!reserveAvailable}
                                className={compareMode === 'reserve' ? 'is-active' : ''}
                                title={
                                  reserveAvailable
                                    ? undefined
                                    : 'Cash Reserve requires at least one chart point with a full 30-day forward window'
                                }
                                onClick={() => {
                                  if (!reserveAvailable) return;
                                  setCompareMode('reserve');
                                  setCompareMenuOpen(false);
                                }}
                              >
                                Cash Reserve
                              </button>
                            </li>
                          </ul>
                        )}
                      </>
                    );
                  })()}
                </div>
                </div>
                {reserveActive && (
                  <p className="projected-cash-compare-subtitle">Rolling 30-day required reserve</p>
                )}
              </div>
            </div>
          );
        })()}

        <div className="projected-cash-chart-body">
          <ProjectedCashBalanceChart
            data={displaySeries}
            granularity={granularity}
            knownEvents={forecastEvents}
            priorSeries={priorPeriodActive ? priorDisplaySeries : null}
            priorSeriesLabel="Prior Period"
            reserveSeries={reserveActive ? reserveSeries : null}
            baselineSeries={baselineDisplaySeries}
          />
        </div>

        <div id="forecast-custom-controls" className="forecast-control-stack" aria-label="What-if controls">
          <div className="forecast-slider-grid forecast-slider-grid--main">
            <ForecastSliderControl
              label="Revenue Adjustment"
              min={-25}
              max={25}
              step={1}
              value={revenueGrowthPct}
              onChange={onRevenueGrowthChange}
              tickValues={[-25, 0, 25]}
              minorTickStep={5}
              secondaryLabel={revenueImpactLabel}
              headerExtra={
                <div className="cashflow-help">
                  <button type="button" className="cashflow-tooltip" aria-label="About these sliders">&#9432;</button>
                  <div role="tooltip" className="cashflow-tooltip-panel">
                    <ul className="cashflow-tooltip-list">
                      <li className="cashflow-tooltip-body">
                        Sliders change all future months. Use Cash Event for a specific event. Sliders stack on your Settings forecast. Zero = use Settings as-is.
                      </li>
                    </ul>
                  </div>
                </div>
              }
            />

            <ForecastSliderControl
              label="Expense Adjustment"
              min={-25}
              max={25}
              step={1}
              value={expenseChangePct}
              onChange={onExpenseChange}
              tickValues={[-25, 0, 25]}
              minorTickStep={5}
              secondaryLabel={expenseImpactLabel}
            />
          </div>
        </div>

        <div className="forecast-events-section">
          <div className="forecast-events-header">
            <button type="button" className="forecast-event-add-btn" onClick={openAddModal}>
              + Add Cash Event
            </button>
          </div>
          {groupedEventRows.length > 0 && (
            <ul className="forecast-events-list">
              {groupedEventRows.map((group) => (
                <li key={group.groupId} className={`forecast-event-row${group.enabled === false ? ' is-disabled' : ''}${group.kind === 'renewal' ? ' is-renewal' : ''}`}>
                  <span className="forecast-event-impacts">
                    {group.amount > 0 && (
                      <span className="forecast-event-impact forecast-event-impact--in">
                        {formatCurrencyFull(group.amount)}
                      </span>
                    )}
                    {group.amount < 0 && (
                      <span className="forecast-event-impact forecast-event-impact--out">
                        -{formatCurrencyFull(group.amount)}
                      </span>
                    )}
                  </span>
                  <span className="forecast-event-title">{group.title}</span>
                  <span className="forecast-event-month">{group.monthDisplay}</span>
                  <span className="forecast-event-status is-neutral">{group.freqLabel}</span>
                  <span className="forecast-event-controls">
                    {group.kind !== 'renewal' && (
                      <button
                        type="button"
                        className="forecast-event-toggle-btn"
                        onClick={() => onToggleEvent?.(group.groupId, !group.enabled)}
                        aria-label={group.enabled === false ? `Enable ${group.title}` : `Disable ${group.title}`}
                      >
                        {group.enabled === false ? <FiSlash size={14} aria-hidden="true" /> : <FiCheck size={14} aria-hidden="true" />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="forecast-event-edit-btn"
                      onClick={() =>
                        group.kind === 'renewal'
                          ? setActiveSteerId((prev) => (prev === group.groupId ? null : group.groupId))
                          : openEditModal(group)
                      }
                      aria-label={`Edit ${group.title}`}
                    >
                      ✎
                    </button>
                    {group.kind !== 'renewal' && (
                      confirmDeleteId === group.groupId ? (
                        <>
                          <span>Remove this event?</span>
                          <button
                            type="button"
                            className="forecast-event-delete-confirm-yes"
                            onClick={() => { onDeleteEvent?.(group.groupId); setConfirmDeleteId(null); }}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            className="forecast-event-delete-confirm-cancel"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="forecast-event-delete-btn"
                          onClick={() => setConfirmDeleteId(group.groupId)}
                          aria-label={`Remove ${group.title}`}
                        >
                          ✕
                        </button>
                      )
                    )}
                  </span>
                  {group.kind === 'renewal' && activeSteerId === group.groupId && (
                    <div className="forecast-event-steer">
                      <span className="forecast-event-steer-text">
                        This event is generated from {group.title}. Edit the
                        contract in Settings → Contracts &amp; Renewals to change it.
                      </span>
                      <button
                        type="button"
                        className="forecast-event-steer-close"
                        onClick={() => setActiveSteerId(null)}
                      >
                        Close
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {rightSlot}
      </div>

      {/* Add Event modal */}
      {showAddModal && (
        <div className="event-modal-overlay" role="dialog" aria-modal="true" aria-label="Add Event">
          <div className="event-modal-panel">
            <div className="event-modal-header">
              <h3 className="event-modal-title">{editingEventId ? 'Edit Event' : 'Add Known Event'}</h3>
            </div>
            <div className="event-modal-body">
              {/* Event Date */}
              <div className="event-form-field">
                <label className="event-form-label" htmlFor="evt-date">Event Date</label>
                <input
                  id="evt-date"
                  type="date"
                  className="event-form-input"
                  value={formDate}
                  min={datePickerMin}
                  max={datePickerMax}
                  onChange={(e) => { setFormDate(e.target.value); setFormErrors((prev) => ({ ...prev, date: undefined })); }}
                />
                <span className="event-form-helper">Select the date this cash event is expected to hit.</span>
                {formErrors.date && <span className="event-form-error">{formErrors.date}</span>}
              </div>

              {/* Title */}
              <div className="event-form-field">
                <label className="event-form-label" htmlFor="evt-title">Event Title</label>
                <input
                  id="evt-title"
                  type="text"
                  className="event-form-input"
                  placeholder="e.g. Annual tax payment"
                  maxLength={60}
                  value={formTitle}
                  onChange={(e) => { setFormTitle(e.target.value); setFormErrors((prev) => ({ ...prev, title: undefined })); }}
                />
                {formErrors.title && <span className="event-form-error">{formErrors.title}</span>}
              </div>

              {/* Amount */}
              <div className="event-form-field">
                <label className="event-form-label" htmlFor="evt-amount">Amount ($)</label>
                <input
                  id="evt-amount"
                  type="number"
                  className="event-form-input"
                  placeholder="0"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                />
                <span className="event-form-helper">Use + for money in, – for money out</span>
              </div>

              {/* Frequency */}
              <div className="event-form-field">
                <label className="event-form-label" htmlFor="evt-frequency">Frequency</label>
                <select
                  id="evt-frequency"
                  className="event-form-select"
                  value={formFrequency}
                  onChange={(e) => setFormFrequency(e.target.value as EventFrequency)}
                >
                  <option value="once">Once</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>
            <div className="event-modal-footer">
              <button type="button" className="event-modal-cancel" onClick={() => { setShowAddModal(false); setEditingEventId(null); setEditingGroupId(null); }}>
                Cancel
              </button>
              <button type="button" className="event-modal-submit" onClick={handleAddEventSubmit}>
                {editingEventId ? 'Save Changes' : 'Add Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
