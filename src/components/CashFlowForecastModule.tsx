import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FiBarChart2, FiCheck, FiSlash } from 'react-icons/fi';
import ProjectedCashBalanceChart from './ProjectedCashBalanceChart';
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

// Forecast horizon segmented control split:
// — primary segments rendered directly in the toggle track (compact, common ranges)
// — overflow values rendered inside the More dropdown (longer ranges)
const FORECAST_PRIMARY_VALUES: readonly string[] = ['30d', '60d', '90d'];
const FORECAST_MORE_VALUES: readonly string[] = ['6m', '1y', '2y', '3y'];

// Short labels for the segmented control (parent passes longer "Next ..." labels
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
  /** Historical monthly actuals — drives the optional prior-period overlay. */
  monthlyRollups: MonthlyRollup[];
  fullForecast: ScenarioPoint[];
  reserveTarget: number;
  /** Optional: override the computed reserve target with a fixed amount from settings. */
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
  onDeleteEvent?: (groupId: string) => void;
  onToggleEvent?: (groupId: string, enabled: boolean) => void;
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

// Wraps the K or M unit suffix in a smaller span (75% size).
// Used wherever compact currency is rendered as a ReactNode hero value.
function wrapUnit(str: string): ReactNode {
  const match = str.match(/^(.*?)([KM])$/);
  if (!match) return str;
  return <>{match[1]}<span className="forecast-unit">{match[2]}</span></>;
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
      <span className="forecast-slider-label">{label}</span>
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
  monthlyRollups,
  fullForecast,
  reserveTarget,
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
  onRevenueGrowthChange,
  onExpenseChange,
  forecastEvents = [],
  contracts = [],
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
  onToggleEvent,
}: CashFlowForecastModuleProps) {
  const chartMountT0Ref = useRef(performance.now());
  const chartBootLoggedRef = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV && !chartBootLoggedRef.current) {
      chartBootLoggedRef.current = true;
      console.log('[BOOT] Charts render:', Math.round(performance.now() - chartMountT0Ref.current), 'ms');
    }
  }, []);

  // Forecast horizon "More" dropdown — primary range pills are 30/60/90 Days;
  // longer ranges (6 Months / 1/2/3 Years) live behind a More popover so the
  // segmented control stays compact while preserving every option.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

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

    // Editing: delete old group + re-add with new parameters (works for all frequencies)
    if (editingGroupId !== null) {
      onDeleteEvent?.(editingGroupId);
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
      onAddEvent?.(editEvents);
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

  // Close the More popover on outside click.
  useEffect(() => {
    if (!moreMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreMenuOpen]);

  const granularity: 'month' | 'week' = forecastRangeMonths < 6 ? 'week' : 'month';
  const startingCashBalance = Number.isFinite(currentCashBalance) ? currentCashBalance : 0;

  // Prior-period overlay. Helper returns monthly NET-change series + a prior
  // starting balance; we accumulate at the displayed granularity (monthly or
  // expanded-weekly) using the same logic the forecast itself applies to
  // `data`. Available at any horizon as long as coverage is complete.
  const [compareEnabled, setCompareEnabled] = useState(false);
  const priorPeriodInput = useMemo(() => {
    const forecastMonths = data.map((d) => d.month);
    return buildPriorPeriodSeries(monthlyRollups, startingCashBalance, forecastMonths);
  }, [data, monthlyRollups, startingCashBalance]);
  const priorPeriodAvailable = priorPeriodInput !== null;
  const priorPeriodActive = compareEnabled && priorPeriodAvailable;
  // Auto-collapse if availability is lost (e.g. user moves to a horizon with
  // insufficient prior coverage), so re-entering a supported horizon does not
  // silently re-enable the overlay.
  useEffect(() => {
    if (!priorPeriodAvailable && compareEnabled) setCompareEnabled(false);
  }, [priorPeriodAvailable, compareEnabled]);

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
    const shift = (m: string) => {
      const [y, mm] = m.split('-');
      return `${Number(y) - 1}-${mm}`;
    };
    const first = data[0]?.month;
    const last = data[data.length - 1]?.month;
    if (!first || !last) return '';
    return `${toMonthLabel(shift(first))} – ${toMonthLabel(shift(last))}`;
  }, [data, priorPeriodInput]);
  const displaySeries = granularity === 'week' ? weeklyCumulativeSeries : cumulativeSeries;
  const priorDisplaySeries = granularity === 'week' ? priorWeeklyCumulative : priorMonthlyCumulative;
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
  const scenarioOptions: Array<{ key: ForecastScenarioKey; label: string }> = [
    { key: 'base', label: 'Base Case' },
    { key: 'best', label: 'Best Case' },
    { key: 'worst', label: 'Worst Case' },
    { key: 'custom', label: 'Custom Case' },
  ];

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

  // Card 1 — Safety line coverage (full forecast horizon).
  //
  // SAFETY_LINE: When a fixedReserveAmount is provided from settings (fixed method),
  // use that value. Otherwise fall back to reserveTarget (1 month of trailing expenses).
  // Intentionally scenario-independent: the definition of "safe" must not move when
  // scenario inputs change. Goalposts stay fixed.
  const effectiveReserveTarget =
    fixedReserveAmount != null && fixedReserveAmount > 0
      ? fixedReserveAmount
      : reserveTarget;
  const fixedSafetyLine = effectiveReserveTarget;

  // SAFETY_GAP_FLOOR: gaps within ±$100 are treated as zero to suppress rounding noise.
  const SAFETY_GAP_FLOOR = 100;

  // Scan the FULL forecast array (not the visible chart window) for the lowest balance.
  // The horizon selector controls chart display only — this card always uses all months.
  const lowestBalanceIdx = fullForecast.length > 0
    ? fullForecast.reduce((minIdx, p, i) =>
        p.endingCashBalance < fullForecast[minIdx].endingCashBalance ? i : minIdx, 0)
    : -1;
  const lowestBalance = lowestBalanceIdx >= 0 ? fullForecast[lowestBalanceIdx].endingCashBalance : null;

  // gap = fixedSafetyLine − lowestProjectedBalance (positive = shortfall, negative = buffer)
  const safetyGap = lowestBalance !== null && fixedSafetyLine > 0
    ? fixedSafetyLine - lowestBalance
    : null;
  const isSafe = safetyGap === null || safetyGap <= SAFETY_GAP_FLOOR;

  // bufferState drives the two card states:
  //   'safe'    — lowest balance stays at or above the safety line
  //   'at-risk' — lowest balance dips below the safety line
  //   null      — no forecast data or no safety line configured
  const bufferState: 'safe' | 'at-risk' | null =
    fullForecast.length === 0 || fixedSafetyLine <= 0
      ? null
      : !isSafe
        ? 'at-risk'
        : 'safe';

  // Shortfall: total lump-sum reserve gap (used in at-risk state; no /mo suffix).
  const shortfall = safetyGap !== null && safetyGap > SAFETY_GAP_FLOOR ? safetyGap : null;

  // Buffer: how far above the safety line the lowest balance sits (used in safe state).
  // Clamped to zero: when the buffer is technically negative but within the ±$100 safe band,
  // we are still in the safe state — display "$0 above reserve", never a negative value.
  const safeBuffer = bufferState === 'safe' && lowestBalance !== null
    ? Math.max(0, lowestBalance - fixedSafetyLine)
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

  // Profit-goal-card variant: amount + " per month" suffix (no leading "+",
  // no "/mo"). Used only on the Profit goal card per the May 2026 copy
  // refresh — the value reads as estimated additional revenue.
  function fmtMonthlyValuePerMonth(value: number): ReactNode {
    const str = fmtMonthly(value);
    const idx = str.lastIndexOf('/mo');
    const amount = idx === -1 ? str : str.slice(0, idx);
    return <>{wrapUnit(amount)}<span className="forecast-mo"> per month</span></>;
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

        {/* Card 1 — Safety line coverage (full forecast horizon) */}
        {bufferState !== null && (
          <article className={`forecast-decision-card${bufferState === 'at-risk' ? ' forecast-decision-card--warning' : ''}`}>
            {bufferState === 'safe' && safeBuffer !== null && (
              <>
                <span className="forecast-decision-label">You&rsquo;re above your safety line</span>
                <strong className="forecast-decision-value forecast-decision-value--md forecast-decision-value--safe">{formatCurrencyCompactNode(safeBuffer)}</strong>
                <span className="forecast-decision-detail">Across your full forecast</span>
              </>
            )}
            {bufferState === 'safe' && safeBuffer === null && (
              <>
                <span className="forecast-decision-label">To stay above your safety line</span>
                <strong className="forecast-decision-value forecast-decision-value--md forecast-decision-value--safe">—</strong>
                <span className="forecast-decision-detail">Across your full forecast</span>
              </>
            )}
            {bufferState === 'at-risk' && shortfall !== null && (
              <>
                <span className="forecast-decision-label">To stay above your safety line</span>
                <strong className="forecast-decision-value forecast-decision-value--md">{formatCurrencyCompactNode(shortfall)}</strong>
                <span className="forecast-decision-detail">To reach your safety line</span>
              </>
            )}
            {bufferState === 'at-risk' && shortfall === null && (
              <>
                <span className="forecast-decision-label">Below your safety line</span>
                <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
                <span className="forecast-decision-detail">Across your full forecast</span>
              </>
            )}
          </article>
        )}
        {bufferState === null && (
          <article className="forecast-decision-card">
            <span className="forecast-decision-label">Safety line</span>
            <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
            <span className="forecast-decision-detail">No safety line set</span>
          </article>
        )}

        {/* Card 2 — At this pace */}
        <article className="forecast-decision-card">
          <span className="forecast-decision-label">At this pace, monthly result is</span>
          {avgNet !== null ? (
            <strong className={`forecast-decision-value forecast-decision-value--md${avgNet < 0 ? ' forecast-decision-value--negative' : ''}`}>{fmtMonthlyValueSigned(avgNet)}</strong>
          ) : (
            <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
          )}
          {netMarginPct !== null && avgCashIn !== null && avgCashIn > 0 && (
            <span className="forecast-decision-detail">That&rsquo;s about {netMarginPct}% net profit</span>
          )}
        </article>

        {/* Card 3 — Profit goal */}
        <article className="forecast-decision-card">
          <span className="forecast-decision-label">{isAtGoal ? 'Your current profit' : 'To hit your profit goal you need'}</span>
          {isAtGoal && avgNet !== null ? (
            <>
              <strong className="forecast-decision-value forecast-decision-value--md forecast-decision-value--safe">{fmtMonthlyValue(avgNet)}</strong>
              {netMarginPct !== null && (
                <span className="forecast-decision-meta">{netMarginPct}% net profit — this is solid</span>
              )}
            </>
          ) : profitGap !== null && targetProfit !== null ? (
            <>
              <strong className="forecast-decision-value forecast-decision-value--md">{fmtMonthlyValuePerMonth(profitGap)}</strong>
              <span className="forecast-decision-meta">Estimated additional revenue at your current margin to reach {Math.round(effectiveTargetNetMargin * 100)}% net profit.</span>
            </>
          ) : (
            <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
          )}
        </article>

      </div>

      <section className="card forecast-chart-shell">

        {(() => {
          // Single header IIFE — Net Change context lives in the left heading column;
          // the segmented timeline control sits on the right.
          const hasSeries = displaySeries.length > 0;
          const finalBalance = hasSeries ? displaySeries[displaySeries.length - 1].net : startingCashBalance;
          const netChange = finalBalance - startingCashBalance;
          const netSign = netChange > 0 ? '+' : netChange < 0 ? '−' : '';
          const netColor = netChange > 0 ? 'is-positive' : netChange < 0 ? 'is-negative' : '';
          const moreSelected = FORECAST_MORE_VALUES.includes(forecastRangeValue);
          const moreLabel = moreSelected
            ? FORECAST_RANGE_SHORT_LABELS[forecastRangeValue] ?? forecastRangeValue
            : 'More';
          return (
            <div className="projected-cash-header">
              <div className="projected-cash-heading">
                <div className="projected-cash-title-row">
                  <h3 className="forecast-chart-title">Projected Cash Balance</h3>
                  <div className="forecast-info-help">
                    <button type="button" className="forecast-info-icon" aria-label="How this forecast works">&#9432;</button>
                    <div role="tooltip" className="forecast-info-panel">
                      <p className="forecast-info-body">A directional view of where your cash is heading, based on recent activity and seasonal patterns &mdash; adjust the sliders to test scenarios.</p>
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
                <div
                  className="segmented-toggle"
                  role="radiogroup"
                  aria-label="Select forecast horizon"
                >
                  {FORECAST_PRIMARY_VALUES.map((val) => {
                    const opt = forecastRangeOptions.find((o) => o.value === val);
                    if (!opt) return null;
                    const isActive = forecastRangeValue === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={`segmented-toggle-btn${isActive ? ' is-active' : ''}`}
                        onClick={() => onForecastRangeChange(val)}
                      >
                        {FORECAST_RANGE_SHORT_LABELS[val] ?? opt.label}
                      </button>
                    );
                  })}
                  <div className="forecast-timeline-more timeframe-menu" ref={moreMenuRef}>
                    <button
                      type="button"
                      className={`segmented-toggle-btn forecast-timeline-more-trigger${moreSelected ? ' is-active' : ''}`}
                      aria-haspopup="menu"
                      aria-expanded={moreMenuOpen}
                      onClick={() => setMoreMenuOpen((c) => !c)}
                    >
                      {moreLabel} &#9662;
                    </button>
                    {moreMenuOpen && (
                      <ul className="timeframe-list" role="menu" aria-label="More forecast horizons">
                        {FORECAST_MORE_VALUES.map((val) => {
                          const opt = forecastRangeOptions.find((o) => o.value === val);
                          if (!opt) return null;
                          const isActive = forecastRangeValue === val;
                          return (
                            <li key={val}>
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={isActive}
                                className={isActive ? 'is-active' : ''}
                                onClick={() => {
                                  onForecastRangeChange(val);
                                  setMoreMenuOpen(false);
                                }}
                              >
                                {FORECAST_RANGE_SHORT_LABELS[val] ?? opt.label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={`forecast-compare-btn${priorPeriodActive ? ' is-active' : ''}`}
                  onClick={() => setCompareEnabled((c) => !c)}
                  disabled={!priorPeriodAvailable}
                  aria-pressed={priorPeriodActive}
                  aria-label={
                    priorPeriodAvailable
                      ? `Compare with prior period${priorPeriodRangeLabel ? ` (${priorPeriodRangeLabel})` : ''}`
                      : 'Compare unavailable — insufficient prior-period history'
                  }
                  title={
                    priorPeriodAvailable
                      ? undefined
                      : 'Need actual history covering the same calendar range one year earlier'
                  }
                >
                  <FiBarChart2 aria-hidden="true" focusable="false" />
                  <span>Compare</span>
                </button>
                </div>
                {priorPeriodActive && priorPeriodRangeLabel && (
                  <p className="projected-cash-compare-subtitle">Compared with {priorPeriodRangeLabel}</p>
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
            priorSeriesLabel="Prior Year"
          />
        </div>

        <div className="forecast-control-stack" aria-label="What-if controls">
          <div className="forecast-slider-grid forecast-slider-grid--main">
            <ForecastSliderControl
              label="Revenue Growth"
              min={-25}
              max={25}
              step={1}
              value={revenueGrowthPct}
              onChange={onRevenueGrowthChange}
              tickValues={[-25, 0, 25]}
              minorTickStep={5}
            />

            <ForecastSliderControl
              label="Expense Change"
              min={-25}
              max={25}
              step={1}
              value={expenseChangePct}
              onChange={onExpenseChange}
              tickValues={[-25, 0, 25]}
              minorTickStep={5}
            />
          </div>
        </div>

        <div className="forecast-events-section">
          <div className="forecast-events-header">
            <h4 className="forecast-events-title">Known Events</h4>
            <button type="button" className="forecast-event-add-btn" onClick={openAddModal}>
              + Add Cash Event
            </button>
          </div>
          {groupedEventRows.length > 0 && (
            <ul className="forecast-events-list">
              {groupedEventRows.map((group) => (
                <li key={group.groupId} className={`forecast-event-row${group.enabled === false ? ' is-disabled' : ''}${group.kind === 'renewal' ? ' is-renewal' : ''}`}>
                  <span className="forecast-event-month">{group.monthDisplay}</span>
                  <span className="forecast-event-title">{group.title}</span>
                  <span className="forecast-event-impacts">
                    {group.amount > 0 && (
                      <span className="forecast-event-impact forecast-event-impact--in">
                        +{formatCurrencyCompact(group.amount)}
                      </span>
                    )}
                    {group.amount < 0 && (
                      <span className="forecast-event-impact forecast-event-impact--out">
                        -{formatCurrencyCompact(Math.abs(group.amount))}
                      </span>
                    )}
                  </span>
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
