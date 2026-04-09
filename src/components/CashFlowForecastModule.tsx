import { useMemo, useState } from 'react';
import TrendLineChart from './TrendLineChart';
import type {
  CashFlowForecastStatus,
  ForecastDecisionSignals,
  ForecastEvent,
  ForecastScenarioKey,
  ForecastSeasonalityMeta,
  TrendPoint,
} from '../lib/data/contract';
import { toMonthLabel } from '../lib/kpis/compute';

type SelectOption = { value: string; label: string };

type CashFlowForecastModuleProps = {
  data: TrendPoint[];
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

function formatCurrencyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
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
}: CashFlowForecastModuleProps) {
  const [viewMode, setViewMode] = useState<ForecastViewMode>('cumulative');
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
  const troughMonthLabel = decisionSignals.cashTroughMonth ? toMonthLabel(decisionSignals.cashTroughMonth) : 'Not available';
  const troughBalanceLabel =
    decisionSignals.cashTroughBalance === null ? '—' : formatCurrencyCompact(decisionSignals.cashTroughBalance);

  const riskVariant: 'safe' | 'warning' | 'critical' =
    decisionSignals.negativeCashMonth ? 'critical' :
    decisionSignals.reserveBreachMonth ? 'warning' : 'safe';
  const riskStatusLabel = riskVariant === 'critical' ? 'Critical' : riskVariant === 'warning' ? 'Warning' : 'Safe';
  const riskMessage =
    riskVariant === 'critical' ? 'Cash goes negative' :
    riskVariant === 'warning' ? 'Cash may drop below safe levels' :
    'No cash shortfall expected';
  const riskDetail =
    riskVariant === 'critical'
      ? `Projected deficit in ${toMonthLabel(decisionSignals.negativeCashMonth!)}`
      : riskVariant === 'warning'
        ? `Below reserve in ${toMonthLabel(decisionSignals.reserveBreachMonth!)}`
        : 'Balance stays above zero across forecast';

  const bufferStatusLabel = riskVariant === 'critical' ? 'Unsafe' : riskVariant === 'warning' ? 'Tight' : 'Healthy';
  const bufferDetail =
    riskVariant === 'critical' ? 'No cash cushion' :
    riskVariant === 'warning' ? 'Below minimum reserve' :
    'Above minimum reserve';
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

  return (
    <div className="forecast-cockpit">

      <div className="forecast-decision-grid" aria-label="Forecast decision signals">

        <article className="forecast-decision-card">
          <span className="forecast-decision-label">Cash Risk</span>
          <span className={`forecast-status-badge forecast-status-badge--${riskVariant}`}>{riskStatusLabel}</span>
          <span className="forecast-decision-message">{riskMessage}</span>
          <span className="forecast-decision-meta">{riskDetail}</span>
        </article>

        <article className="forecast-decision-card">
          <span className="forecast-decision-label">Lowest Cash Point</span>
          <strong className="forecast-decision-value">{troughBalanceLabel}</strong>
          <span className="forecast-decision-meta">{troughMonthLabel}</span>
        </article>

        <article className="forecast-decision-card">
          <span className="forecast-decision-label">Safety Buffer</span>
          <span className={`forecast-status-badge forecast-status-badge--${riskVariant}`}>{bufferStatusLabel}</span>
          <span className="forecast-decision-meta">{bufferDetail}</span>
        </article>

      </div>

      <section className="card forecast-chart-shell">
        {/* TODO: render warning pill here when confidence is degraded */}

        {visibleSeasonalityWarning ? (
          <div className="forecast-warning-callout" role="status" aria-live="polite">
            Heads up — this forecast follows seasonal patterns from prior years. If this year feels unusually different, use the sliders below to adjust.
          </div>
        ) : null}

        <TrendLineChart
          data={displaySeries}
          metric="net"
          title="Projected Cash Balance"
          tooltipVariant="forecast"
          pointStatusByMonth={displayPointStatusByMonth}
          showRevenueExpenseInTooltip={viewMode === 'monthly'}
          rangeLabelOverride={monthlyRangeLabel}
          forecastRangeLabel=""
          forecastRangeValue={forecastRangeValue}
          forecastRangeOptions={forecastRangeOptions}
          onForecastRangeChange={onForecastRangeChange}
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
          <div className="forecast-events-header">
            <span className="forecast-events-title">Known Events</span>
          </div>
          {forecastEvents.length === 0 ? (
            <p className="forecast-events-empty">No events added yet.</p>
          ) : (
            <ul className="forecast-events-list">
              {[...forecastEvents]
                .sort((a, b) => a.month.localeCompare(b.month))
                .map((event) => (
                  <li key={event.id} className="forecast-event-row">
                    <span className="forecast-event-month">{toMonthLabel(event.month)}</span>
                    <span className="forecast-event-title">{event.title}</span>
                    <span className="forecast-event-impacts">
                      {event.cashInImpact > 0 && (
                        <span className="forecast-event-impact forecast-event-impact--in">
                          +{formatCurrencyCompact(event.cashInImpact)}
                        </span>
                      )}
                      {event.cashOutImpact > 0 && (
                        <span className="forecast-event-impact forecast-event-impact--out">
                          -{formatCurrencyCompact(event.cashOutImpact)}
                        </span>
                      )}
                    </span>
                    <span
                      className={`forecast-event-status ${
                        event.status === 'tentative'
                          ? 'is-caution'
                          : event.status === 'committed'
                            ? 'is-positive'
                            : 'is-neutral'
                      }`}
                    >
                      {event.status}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
