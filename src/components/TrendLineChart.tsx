import { useId, useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { computeExponentialMovingAverage } from '../lib/charts/movingAverage';
import { toMonthLabel } from '../lib/kpis/compute';
import { chartTokens } from '../lib/ui/chartTokens';
import type { TrendPoint } from '../lib/data/contract';

type TrendMetric = 'income' | 'expense';

type TrendLineChartApexProps = {
  data: TrendPoint[];
  metric: TrendMetric;
  title: string;
  rangeLabelOverride?: string;
  trendWindowOverride: number;
  displayWindow: number;
  interpretationVariant: 'revenue' | 'expense';
  /** Show every Nth y-axis label (1 = all, 2 = every other). */
  yTickLabelStep?: number;
  height?: number;
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatShortMonth(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})/);
  if (!match) return month;
  const idx = Number.parseInt(match[2], 10) - 1;
  const yy = match[1].slice(-2);
  return `${MONTH_NAMES[idx] ?? match[2]} ${yy}`;
}

function formatCurrencyTick(value: number): string {
  if (Math.abs(value) < 0.5) return '$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

type TrendSignal = { direction: 'Rising' | 'Declining' | 'Flat'; pct: number };

function computeTrendSignal(emaValues: number[], window: number): TrendSignal | null {
  if (emaValues.length === 0) return null;
  const current = emaValues[emaValues.length - 1];
  const priorIdx = emaValues.length - 1 - window;
  if (priorIdx < 0) return null;
  const prior = emaValues[priorIdx];
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  const FLAT_THRESHOLD = 3;
  if (pct > FLAT_THRESHOLD) return { direction: 'Rising', pct };
  if (pct < -FLAT_THRESHOLD) return { direction: 'Declining', pct };
  return { direction: 'Flat', pct };
}

export default function TrendLineChartApex({
  data,
  metric,
  title,
  rangeLabelOverride,
  trendWindowOverride,
  displayWindow,
  interpretationVariant,
  yTickLabelStep = 1,
  height = 280,
}: TrendLineChartApexProps) {
  const trendTooltipId = useId();

  const { categories, seriesValues, rangeLabel, signal, yMin, yMax, yTickAmount } = useMemo(() => {
    if (data.length === 0) {
      return {
        categories: [] as string[],
        seriesValues: [] as number[],
        rangeLabel: '',
        signal: null as TrendSignal | null,
        yMin: 0,
        yMax: 10000,
        yTickAmount: 1,
      };
    }
    const values = data.map((item) => {
      const numeric = Number(item[metric]);
      return Number.isFinite(numeric) ? numeric : 0;
    });
    const emaFull = computeExponentialMovingAverage(values, trendWindowOverride);
    const sig = computeTrendSignal(emaFull, trendWindowOverride);

    const sliceN = Math.min(displayWindow, data.length);
    const slicedData = data.slice(-sliceN);
    const slicedEma = emaFull.slice(-sliceN);

    // Anchor y-axis at 0 and round max up to the nearest $10k step, matching
    // the old custom-SVG buildPositiveAxis. Without this, Apex auto-fits to
    // the EMA's narrow band and amplifies tiny month-to-month wiggle.
    const yStep = 10000;
    const maxRaw = Math.max(...slicedEma, 0);
    const computedYMax = Math.max(yStep, Math.ceil(maxRaw / yStep) * yStep);
    const computedTickAmount = computedYMax / yStep;

    const cats = slicedData.map((item) => formatShortMonth(item.month));
    const rl =
      rangeLabelOverride ??
      `${toMonthLabel(slicedData[0].month)} – ${toMonthLabel(slicedData[slicedData.length - 1].month)}`;
    return {
      categories: cats,
      seriesValues: slicedEma,
      rangeLabel: rl,
      signal: sig,
      yMin: 0,
      yMax: computedYMax,
      yTickAmount: computedTickAmount,
    };
  }, [data, metric, trendWindowOverride, displayWindow, rangeLabelOverride]);

  const seriesColor = metric === 'expense' ? chartTokens.error : chartTokens.brand;

  const options: ApexOptions = useMemo(() => ({
    chart: {
      type: 'area',
      height,
      fontFamily: 'Outfit, sans-serif',
      toolbar: { show: false },
      background: 'transparent',
      animations: { enabled: false },
      zoom: { enabled: false },
    },
    colors: [seriesColor],
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
    legend: { show: false },
    grid: {
      borderColor: chartTokens.gridBorder,
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
    },
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: { fontSize: '12px', fontWeight: 600, colors: chartTokens.axisTextSales },
      },
      crosshairs: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: {
      min: yMin,
      max: yMax,
      tickAmount: yTickAmount,
      labels: {
        style: { fontSize: '11px', fontWeight: 400, colors: chartTokens.axisTextSales },
        // Runtime signature is (val, tickIndex); Apex types declare (val, opts).
        formatter: ((value: number, index?: number) => {
          if (yTickLabelStep > 1 && typeof index === 'number' && index % yTickLabelStep !== 0) return '';
          return formatCurrencyTick(value);
        }) as unknown as (val: number) => string,
      },
    },
    tooltip: { enabled: false },
  }), [categories, height, seriesColor, yTickLabelStep, yMin, yMax, yTickAmount]);

  const series = useMemo(
    () => [{ name: title, data: seriesValues }],
    [title, seriesValues],
  );

  const interpretation = (() => {
    if (signal === null) return null;
    const pctText = `${Math.abs(signal.pct).toFixed(1)}%`;
    if (signal.direction === 'Rising') {
      return { direction: 'Rising' as const, pctText, icon: '↑', badgeClass: interpretationVariant === 'expense' ? 'is-down' : 'is-up' };
    }
    if (signal.direction === 'Declining') {
      return { direction: 'Declining' as const, pctText, icon: '↓', badgeClass: interpretationVariant === 'expense' ? 'is-up' : 'is-down' };
    }
    return { direction: 'Flat' as const, pctText, icon: '–', badgeClass: 'is-flat' };
  })();

  if (data.length === 0) {
    return (
      <article className="card chart-card">
        <div className="card-head">
          <h3>{title}</h3>
        </div>
        <p className="empty-state">No trend data available yet.</p>
      </article>
    );
  }

  return (
    <article className="card chart-card">
      <div className="card-head chart-head">
        <div className="chart-head-left">
          <div className="chart-title-row">
            <h3 className="chart-head-title">{title}</h3>
            <div className="cashflow-help">
              <button
                type="button"
                className="cashflow-tooltip"
                aria-label="How this trend works"
                aria-describedby={trendTooltipId}
              >
                ⓘ
              </button>
              <div id={trendTooltipId} role="tooltip" className="cashflow-tooltip-panel trend-tooltip-panel">
                <ul className="cashflow-tooltip-list trend-tooltip-list">
                  <li><strong>How this trend works</strong></li>
                  <li>This line smooths the last few months of results so you can see the direction more clearly without getting distracted by normal month-to-month swings.</li>
                  <li><strong>Method used</strong></li>
                  <li>We use an exponential moving average (EMA), which gives more weight to recent months and less weight to older months.</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="chart-head-meta">
            <p className="subtle chart-range-label">{rangeLabel}</p>
          </div>
        </div>
        <div className="chart-head-right">
          {interpretation && (
            <span className={`kpi-badge ${interpretation.badgeClass}`}>
              <span aria-hidden="true" className="kpi-change-arrow">{interpretation.icon}</span>
              <span className="kpi-change-percent">
                {interpretation.direction === 'Flat'
                  ? interpretation.direction
                  : `${interpretation.direction} ${interpretation.pctText}`}
              </span>
            </span>
          )}
        </div>
      </div>

      <ReactApexChart options={options} series={series} type="area" height={height} />
    </article>
  );
}
