import { useMemo, useState } from 'react';
import TrendLineChart from './TrendLineChart';
import type { CashFlowForecastStatus, TrendPoint } from '../lib/data/contract';
import { toMonthLabel } from '../lib/kpis/compute';

type SelectOption = { value: string; label: string };

type CashFlowForecastModuleProps = {
  data: TrendPoint[];
  pointStatusByMonth: Partial<Record<string, CashFlowForecastStatus>>;
  currentCashBalance: number;
  forecastRangeMonths: number;
  forecastRangeValue: string;
  forecastRangeOptions: SelectOption[];
  onForecastRangeChange: (nextValue: string) => void;
  revenueGrowthPct: number;
  expenseReductionPct: number;
  onRevenueGrowthChange: (nextValue: number) => void;
  onExpenseReductionChange: (nextValue: number) => void;
};

type ForecastViewMode = 'monthly' | 'cumulative';
type ForecastSliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (nextValue: number) => void;
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

function ForecastSliderControl({ label, value, min, max, step, onChange }: ForecastSliderControlProps) {
  const safeSpan = Math.max(max - min, 1);
  const sliderPercent = ((value - min) / safeSpan) * 100;
  const valueTransform = sliderPercent < 8 ? 'translateX(0%)' : sliderPercent > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
  const tickValues = [min, -25, 0, 25, max].filter((tick, index, list) => tick >= min && tick <= max && list.indexOf(tick) === index);

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
          {formatSignedPercent(value)}
        </span>
        <div className="forecast-slider-ticks" aria-hidden="true">
          {tickValues.map((tick) => {
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
          <span>{formatSignedPercent(min)}</span>
          <span>{formatSignedPercent(0)}</span>
          <span>{formatSignedPercent(max)}</span>
        </div>
      </div>
    </label>
  );
}

export default function CashFlowForecastModule({
  data,
  pointStatusByMonth,
  currentCashBalance,
  forecastRangeMonths,
  forecastRangeValue,
  forecastRangeOptions,
  onForecastRangeChange,
  revenueGrowthPct,
  expenseReductionPct,
  onRevenueGrowthChange,
  onExpenseReductionChange,
}: CashFlowForecastModuleProps) {
  const [viewMode, setViewMode] = useState<ForecastViewMode>('cumulative');
  const expenseChangePct = -expenseReductionPct;
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
  const chartTitle = viewMode === 'cumulative' ? 'Cash Balance Forecast' : 'Monthly Cash Flow Forecast';

  return (
    <div className="forecast-cockpit">
      <div className="forecast-view-toggle" role="group" aria-label="Forecast chart mode">
        <button
          type="button"
          className={viewMode === 'cumulative' ? 'is-active' : ''}
          onClick={() => setViewMode('cumulative')}
        >
          Cash in Bank
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
        <TrendLineChart
          data={displaySeries}
          metric="net"
          title={chartTitle}
          tooltipVariant="forecast"
          pointStatusByMonth={displayPointStatusByMonth}
          showRevenueExpenseInTooltip={viewMode === 'monthly'}
          rangeLabelOverride={monthlyRangeLabel}
          forecastRangeLabel="Forecast range"
          forecastRangeValue={forecastRangeValue}
          forecastRangeOptions={forecastRangeOptions}
          onForecastRangeChange={onForecastRangeChange}
        />

        <div className="forecast-slider-dual-row" aria-label="What-if controls">
          <ForecastSliderControl
            label="Revenue Change"
            min={-50}
            max={50}
            step={1}
            value={revenueGrowthPct}
            onChange={onRevenueGrowthChange}
          />

          <ForecastSliderControl
            label="Expense Change"
            min={-50}
            max={50}
            step={1}
            value={expenseChangePct}
            onChange={(nextExpenseChange) => {
              // Scenario state stores expense reduction; invert sign so formula is equivalent to (1 + expenseChangePct).
              onExpenseReductionChange(-nextExpenseChange);
            }}
          />
        </div>
      </section>
    </div>
  );
}
