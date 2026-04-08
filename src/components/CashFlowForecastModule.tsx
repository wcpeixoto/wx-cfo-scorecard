import { useMemo, useState } from 'react';
import TrendLineChart from './TrendLineChart';
import type {
  CashFlowForecastStatus,
  ForecastDecisionSignals,
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
}: ForecastSliderControlProps) {
  const safeSpan = Math.max(max - min, 1);
  const sliderPercent = ((value - min) / safeSpan) * 100;
  const valueTransform = sliderPercent < 8 ? 'translateX(0%)' : sliderPercent > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
  const sliderTicks = (tickValues ?? [min, (min + max) / 2, max]).filter(
    (tick, index, list) => tick >= min && tick <= max && list.indexOf(tick) === index
  );

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
  receivableDays,
  payableDays,
  onRevenueGrowthChange,
  onExpenseChange,
  onReceivableDaysChange,
  onPayableDaysChange,
}: CashFlowForecastModuleProps) {
  const [viewMode, setViewMode] = useState<ForecastViewMode>('cumulative');
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const breakEvenLabel = decisionSignals.breakEvenMonth ? toMonthLabel(decisionSignals.breakEvenMonth) : 'Not visible yet';
  const troughMonthLabel = decisionSignals.cashTroughMonth ? toMonthLabel(decisionSignals.cashTroughMonth) : 'Not available';
  const troughBalanceLabel =
    decisionSignals.cashTroughBalance === null ? 'Forecast unavailable' : formatCurrencyCompact(decisionSignals.cashTroughBalance);
  const reserveBreachLabel = !decisionSignals.reserveBreachEvaluated
    ? 'Not available'
    : decisionSignals.reserveBreachMonth
      ? toMonthLabel(decisionSignals.reserveBreachMonth)
      : 'Not breached';
  const negativeCashLabel =
    data.length === 0 ? 'Not available' : decisionSignals.negativeCashMonth ? toMonthLabel(decisionSignals.negativeCashMonth) : 'Stays above zero';
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
      <div className="forecast-toolbar">
        <div className="forecast-scenario-toggle" role="group" aria-label="Forecast scenario">
          {scenarioOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={scenarioKey === option.key ? 'is-active' : ''}
              onClick={() => onScenarioChange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="forecast-toolbar-actions">
          <label className="forecast-inline-select">
            <span>Forecast horizon</span>
            <select value={forecastRangeValue} onChange={(event) => onForecastRangeChange(event.target.value)}>
              {forecastRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`forecast-advanced-toggle${advancedOpen ? ' is-active' : ''}`}
            onClick={() => setAdvancedOpen((previous) => !previous)}
            aria-expanded={advancedOpen}
          >
            Advanced
          </button>
        </div>
      </div>

      <div className="forecast-view-toggle" role="group" aria-label="Forecast chart mode">
        <button
          type="button"
          className={viewMode === 'cumulative' ? 'is-active' : ''}
          onClick={() => setViewMode('cumulative')}
        >
          {hasCurrentCashBalance ? 'Cash in Bank' : 'Cumulative Change'}
        </button>
        <button
          type="button"
          className={viewMode === 'monthly' ? 'is-active' : ''}
          onClick={() => setViewMode('monthly')}
        >
          Monthly Change
        </button>
      </div>

      <section className="card forecast-chart-shell">
        <div className="forecast-mode-row">
          <div className="forecast-mode-copy">
            <span className={`forecast-mode-pill is-${seasonality.mode}`}>{seasonalityModeLabel}</span>
            <span className="forecast-mode-note">{seasonalitySupportLabel}</span>
          </div>
          {seasonalityConfidenceLabel ? (
            <span className={`forecast-mode-badge is-${seasonality.confidence}`}>{seasonalityConfidenceLabel}</span>
          ) : null}
        </div>

        {visibleSeasonalityWarning ? (
          <div className="forecast-warning-callout" role="status" aria-live="polite">
            {visibleSeasonalityWarning.message}
          </div>
        ) : null}

        <TrendLineChart
          data={displaySeries}
          metric="net"
          title={chartTitle}
          tooltipVariant="forecast"
          pointStatusByMonth={displayPointStatusByMonth}
          showRevenueExpenseInTooltip={viewMode === 'monthly'}
          rangeLabelOverride={monthlyRangeLabel}
        />

        <div className="forecast-decision-grid" aria-label="Forecast decision signals">
          <article className="forecast-decision-card">
            <div className="forecast-decision-head">
              <span className="forecast-decision-label">Break-even Month</span>
              <span className="forecast-decision-meta">Durable non-negative cash flow</span>
            </div>
            <strong className="forecast-decision-value">{breakEvenLabel}</strong>
          </article>

          <article className="forecast-decision-card">
            <div className="forecast-decision-head">
              <span className="forecast-decision-label">Cash Trough Month</span>
              <span className="forecast-decision-meta">Lowest projected cash balance</span>
            </div>
            <strong className="forecast-decision-value">{troughMonthLabel}</strong>
            <span className="forecast-decision-subvalue">{troughBalanceLabel}</span>
          </article>

          <article className="forecast-decision-card">
            <div className="forecast-decision-head">
              <span className="forecast-decision-label">Reserve Floor Breach</span>
              <span className="forecast-decision-meta">First month below current reserve floor</span>
            </div>
            <strong className="forecast-decision-value">{reserveBreachLabel}</strong>
          </article>

          <article className="forecast-decision-card">
            <div className="forecast-decision-head">
              <span className="forecast-decision-label">Negative Cash Month</span>
              <span className="forecast-decision-meta">First month projected cash turns negative</span>
            </div>
            <strong className="forecast-decision-value">{negativeCashLabel}</strong>
          </article>
        </div>

        <div className="forecast-control-stack" aria-label="What-if controls">
          <div className="forecast-slider-grid forecast-slider-grid--main">
            <ForecastSliderControl
              label="Revenue Growth"
              min={-12}
              max={12}
              step={1}
              value={revenueGrowthPct}
              onChange={onRevenueGrowthChange}
              tickValues={[-12, 0, 12]}
            />

            <ForecastSliderControl
              label="Expense Change"
              min={-12}
              max={12}
              step={1}
              value={expenseChangePct}
              onChange={onExpenseChange}
              tickValues={[-12, 0, 12]}
            />
          </div>

          {advancedOpen ? (
            <div className="forecast-advanced-panel" aria-label="Advanced forecast settings">
              <div className="forecast-advanced-head">
                <span className="forecast-advanced-title">Advanced timing</span>
                <span className="forecast-advanced-copy">Defaults stay at 3 days unless you need a manual override.</span>
              </div>

              <div className="forecast-slider-grid forecast-slider-grid--advanced">
                <ForecastSliderControl
                  label="Receivables Timing"
                  min={0}
                  max={30}
                  step={1}
                  value={receivableDays}
                  onChange={onReceivableDaysChange}
                  formatValue={formatDays}
                  formatTickValue={formatDays}
                  tickValues={[0, 15, 30]}
                />

                <ForecastSliderControl
                  label="Payables Timing"
                  min={0}
                  max={30}
                  step={1}
                  value={payableDays}
                  onChange={onPayableDaysChange}
                  formatValue={formatDays}
                  formatTickValue={formatDays}
                  tickValues={[0, 15, 30]}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
