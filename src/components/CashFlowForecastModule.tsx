import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import TrendLineChart from './TrendLineChart';
import type {
  CashFlowForecastStatus,
  ForecastDecisionSignals,
  ForecastEvent,
  ForecastScenarioKey,
  ForecastSeasonalityMeta,
  ScenarioPoint,
  TrendPoint,
} from '../lib/data/contract';
import { toMonthLabel } from '../lib/kpis/compute';

type SelectOption = { value: string; label: string };

type EventFrequency = 'once' | 'monthly' | 'yearly';

function generateEventMonths(startMonth: string, frequency: EventFrequency, forecastRangeMonths: number): string[] {
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

// DECISION_WINDOW: number of forecast months used for profit and margin cards.
// Cards 1 and 3 use forecast data, not trailing actuals.
// Change this constant if the business logic needs to shift to actuals later.
const DECISION_WINDOW_MONTHS = 12;

// Target net margin for the "money goal" card.
const TARGET_NET_MARGIN = 0.25;

type CashFlowForecastModuleProps = {
  data: TrendPoint[];
  fullForecast: ScenarioPoint[];
  reserveTarget: number;
  pointStatusByMonth: Partial<Record<string, CashFlowForecastStatus>>;
  decisionSignals: ForecastDecisionSignals;
  seasonality: ForecastSeasonalityMeta;
  currentCashBalance: number;
  hasCurrentCashBalance: boolean;
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
  onAddEvent?: (events: ForecastEvent[]) => void;
  onUpdateEvent?: (event: ForecastEvent) => void;
  onDeleteEvent?: (groupId: string) => void;
};

type ForecastViewMode = 'monthly' | 'cumulative';
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
  fullForecast,
  reserveTarget,
  pointStatusByMonth,
  decisionSignals,
  seasonality,
  currentCashBalance,
  hasCurrentCashBalance,
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
  onAddEvent,
  onUpdateEvent,
  onDeleteEvent,
}: CashFlowForecastModuleProps) {
  const chartMountT0Ref = useRef(performance.now());
  const chartBootLoggedRef = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV && !chartBootLoggedRef.current) {
      chartBootLoggedRef.current = true;
      console.log('[BOOT] Charts render:', Math.round(performance.now() - chartMountT0Ref.current), 'ms');
    }
  }, []);

  const [viewMode, setViewMode] = useState<ForecastViewMode>('cumulative');
  const [horizonMenuOpen, setHorizonMenuOpen] = useState(false);
  const horizonMenuRef = useRef<HTMLDivElement>(null);

  // Add Event modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [formMonth, setFormMonth] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formFrequency, setFormFrequency] = useState<EventFrequency>('once');
  const [formErrors, setFormErrors] = useState<{ month?: string; title?: string }>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Next 24 months for the month selector
  const forecastMonthOptions = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      return { value, label };
    });
  }, []);

  function openAddModal() {
    setEditingEventId(null);
    setEditingGroupId(null);
    setFormMonth('');
    setFormTitle('');
    setFormAmount('');
    setFormFrequency('once');
    setFormErrors({});
    setShowAddModal(true);
  }

  function openEditModal(group: (typeof groupedEventRows)[0]) {
    setEditingEventId(group.firstEvent.id);
    setEditingGroupId(group.groupId);
    setFormMonth(group.firstEvent.month);
    setFormTitle(group.title);
    setFormFrequency(group.frequency);
    setFormAmount(group.amount === 0 ? '' : String(group.amount));
    setFormErrors({});
    setShowAddModal(true);
  }

  function handleAddEventSubmit() {
    const errors: { month?: string; title?: string } = {};
    if (!formMonth) errors.month = 'Month is required';
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
      const editMonths = generateEventMonths(formMonth, formFrequency, forecastRangeMonths);
      const editEvents: ForecastEvent[] = editMonths.map((month, index) => ({
        id: `${formFrequency}__${newGroupId}__${index}`,
        month,
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

    const months = generateEventMonths(formMonth, formFrequency, forecastRangeMonths);
    const events: ForecastEvent[] = months.map((month, index) => ({
      id: `${formFrequency}__${groupId}__${index}`,
      month,
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
    if (!horizonMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (horizonMenuRef.current && !horizonMenuRef.current.contains(e.target as Node)) {
        setHorizonMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [horizonMenuOpen]);

  const currentHorizonLabel = forecastRangeOptions.find((o) => o.value === forecastRangeValue)?.label ?? forecastRangeValue;
  const granularity: 'month' | 'week' = forecastRangeMonths < 6 ? 'week' : 'month';
  const startingCashBalance = Number.isFinite(currentCashBalance) ? currentCashBalance : 0;

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
  const monthlyRangeLabel = data.length > 0 ? `${toMonthLabel(data[0].month)} – ${toMonthLabel(data[data.length - 1].month)}` : '';
  const displaySeries =
    granularity === 'week' ? (viewMode === 'monthly' ? weeklySeries : weeklyCumulativeSeries) : viewMode === 'monthly' ? data : cumulativeSeries;
  const displayPointStatusByMonth = useMemo<Partial<Record<string, CashFlowForecastStatus>>>(() => {
    if (granularity !== 'week') return pointStatusByMonth;
    const statusByWeek: Partial<Record<string, CashFlowForecastStatus>> = {};
    displaySeries.forEach((point) => {
      statusByWeek[point.month] = 'projected';
    });
    return statusByWeek;
  }, [displaySeries, granularity, pointStatusByMonth]);
  const chartTitle =
    viewMode === 'cumulative'
      ? hasCurrentCashBalance
        ? 'Cash Balance Forecast'
        : 'Cumulative Cash Change Forecast'
      : 'Monthly Cash Flow Forecast';
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
    const groups = new Map<string, { frequency: EventFrequency; events: ForecastEvent[] }>();
    for (const event of forecastEvents) {
      const parts = event.id.split('__');
      const isEncoded = parts.length === 3 && (parts[0] === 'once' || parts[0] === 'monthly' || parts[0] === 'yearly');
      const frequency: EventFrequency = isEncoded ? (parts[0] as EventFrequency) : 'once';
      const groupId = isEncoded ? parts[1] : event.id;
      if (!groups.has(groupId)) groups.set(groupId, { frequency, events: [] });
      groups.get(groupId)!.events.push(event);
    }
    return Array.from(groups.entries()).map(([groupId, { frequency, events }]) => {
      const sorted = [...events].sort((a, b) => a.month.localeCompare(b.month));
      const first = sorted[0];
      const amount = first.cashInImpact > 0 ? first.cashInImpact : -first.cashOutImpact;
      const freqLabel = frequency === 'monthly' ? 'Monthly' : frequency === 'yearly' ? 'Yearly' : 'Once';
      let monthDisplay: string;
      if (frequency === 'once') {
        monthDisplay = toMonthLabel(first.month);
      } else if (frequency === 'monthly') {
        monthDisplay = `starting ${toMonthLabel(first.month)}`;
      } else {
        const calMonth = new Date(first.month + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
        const startYear = first.month.split('-')[0];
        monthDisplay = `every ${calMonth}, starting ${startYear}`;
      }
      return { groupId, frequency, freqLabel, events: sorted, firstEvent: first, title: first.title, amount, monthDisplay };
    }).sort((a, b) => a.firstEvent.month.localeCompare(b.firstEvent.month));
  }, [forecastEvents]);

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
  // SAFETY_LINE: fixed reserve target passed in from Dashboard — 1 month of trailing
  // base-case average expenses. Intentionally scenario-independent: the definition of
  // "safe" must not move when scenario inputs change. Goalposts stay fixed.
  const fixedSafetyLine = reserveTarget;

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
  const targetProfit = avgCashIn !== null ? avgCashIn * TARGET_NET_MARGIN : null;
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
                <strong className="forecast-decision-value forecast-decision-value--md forecast-decision-value--warning">{formatCurrencyCompactNode(shortfall)}</strong>
                <span className="forecast-decision-detail">To reach your 1-month reserve</span>
              </>
            )}
            {bufferState === 'at-risk' && shortfall === null && (
              <>
                <span className="forecast-decision-label">Below your safety line</span>
                <strong className="forecast-decision-value forecast-decision-value--md forecast-decision-value--warning">—</strong>
                <span className="forecast-decision-detail">Across your full forecast</span>
              </>
            )}
          </article>
        )}
        {bufferState === null && (
          <article className="forecast-decision-card">
            <span className="forecast-decision-label">Safety line</span>
            <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
            <span className="forecast-decision-detail">No reserve target set</span>
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
              <strong className="forecast-decision-value forecast-decision-value--md">+{fmtMonthlyValue(profitGap)}</strong>
              <span className="forecast-decision-meta">This gets you to {fmtMonthly(targetProfit)} at {TARGET_NET_MARGIN * 100}% net profit</span>
            </>
          ) : (
            <strong className="forecast-decision-value forecast-decision-value--md">—</strong>
          )}
        </article>

      </div>

      <section className="card forecast-chart-shell">

        <div className="forecast-chart-topbar">
          <div className="forecast-chart-heading">
            <h3 className="forecast-chart-title">Projected Cash Balance</h3>
            <div className="forecast-info-help">
              <button type="button" className="forecast-info-icon" aria-label="How this forecast works">&#9432;</button>
              <div role="tooltip" className="forecast-info-panel">
                <p className="forecast-info-title">How this forecast works</p>
                <p className="forecast-info-body">Projected cash balance is based on recent operating cash trends, seasonal patterns from prior years, and the scenario assumptions shown below.</p>
                <p className="forecast-info-important"><strong>Important:</strong> This forecast is directional, not exact. Use the sliders if this year is tracking differently than usual.</p>
              </div>
            </div>
          </div>
          <div className="forecast-chart-actions">
            <div className="chart-control-row">
              <div className="timeframe-menu" ref={horizonMenuRef}>
                <button
                  type="button"
                  className="timeframe-trigger"
                  onClick={() => setHorizonMenuOpen((c) => !c)}
                  aria-haspopup="menu"
                  aria-expanded={horizonMenuOpen}
                >
                  {currentHorizonLabel} &#9662;
                </button>
                {horizonMenuOpen && (
                  <ul className="timeframe-list" role="menu" aria-label="Select forecast horizon">
                    {forecastRangeOptions.map((option) => (
                      <li key={option.value}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={forecastRangeValue === option.value}
                          className={forecastRangeValue === option.value ? 'is-active' : ''}
                          onClick={() => { onForecastRangeChange(option.value); setHorizonMenuOpen(false); }}
                        >
                          {option.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="chart-head-meta">
              <p className="subtle chart-range-label">{monthlyRangeLabel}</p>
            </div>
          </div>
        </div>

        {displaySeries.length > 0 && (() => {
          const initialBalance = displaySeries[0].net;
          const finalBalance = displaySeries[displaySeries.length - 1].net;
          const netChange = finalBalance - initialBalance;
          const netSign = netChange > 0 ? '+' : netChange < 0 ? '−' : '';
          const netColor = netChange > 0 ? 'is-positive' : netChange < 0 ? 'is-negative' : '';
          return (
            <div className="cash-summary-strip">
              <div className="cash-summary-item">
                <span className="cash-summary-label">Initial Balance</span>
                <span className="cash-summary-value">{formatCurrencyCompact(initialBalance)}</span>
              </div>
              <div className="cash-summary-item">
                <span className="cash-summary-label">Net Change</span>
                <span className={`cash-summary-value ${netColor}`}>{netSign}{formatCurrencyCompact(Math.abs(netChange))}</span>
              </div>
              <div className="cash-summary-item">
                <span className="cash-summary-label">Final Balance</span>
                <span className="cash-summary-value cash-summary-value--final">{formatCurrencyCompact(finalBalance)}</span>
              </div>
            </div>
          );
        })()}

        <TrendLineChart
          data={displaySeries}
          metric="net"
          title="Projected Cash Balance"
          tooltipVariant="forecast"
          pointStatusByMonth={displayPointStatusByMonth}
          showRevenueExpenseInTooltip={viewMode === 'monthly'}
          tooltipSingleLabel={viewMode === 'cumulative' ? 'Cash Balance' : undefined}
          rangeLabelOverride=""
          forecastRangeLabel=""
          hideDots
          hideTrend
          hideAxisLines
          showOnlyProjectedTicks
          showMonthlyXLabels
        />

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
          {groupedEventRows.length > 0 && (
            <ul className="forecast-events-list">
              {groupedEventRows.map((group) => (
                <li key={group.groupId} className="forecast-event-row">
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
                  <button
                    type="button"
                    className="forecast-event-edit-btn"
                    onClick={() => openEditModal(group)}
                    aria-label={`Edit ${group.title}`}
                  >
                    ✎
                  </button>
                  {confirmDeleteId === group.groupId ? (
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
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="forecast-event-add-btn" onClick={openAddModal}>
            + Add Cash Event
          </button>
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
              {/* Month */}
              <div className="event-form-field">
                <label className="event-form-label" htmlFor="evt-month">Month</label>
                <select
                  id="evt-month"
                  className={`event-form-select${!formMonth ? ' is-placeholder' : ''}`}
                  value={formMonth}
                  onChange={(e) => { setFormMonth(e.target.value); setFormErrors((prev) => ({ ...prev, month: undefined })); }}
                >
                  <option value="" disabled>Select month</option>
                  {forecastMonthOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {formErrors.month && <span className="event-form-error">{formErrors.month}</span>}
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
