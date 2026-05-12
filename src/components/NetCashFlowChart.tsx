import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { toMonthLabel } from '../lib/kpis/compute';
import type { CashFlowMode, TrendPoint } from '../lib/data/contract';
import { chartTokens } from '../lib/ui/chartTokens';

type TimeframeOption = 6 | 12 | 24 | 36 | 'all';

type TimeframeItem = {
  value: TimeframeOption;
  label: string;
};

type NetCashFlowChartProps = {
  data: TrendPoint[];
  cashFlowMode?: CashFlowMode;
  timeframe?: TimeframeOption;
  onCashFlowModeChange?: (nextMode: CashFlowMode) => void;
  onTimeframeChange?: (nextTimeframe: TimeframeOption) => void;
  onMonthPointClick?: (month: string) => void;
};

const TIMEFRAME_OPTIONS: TimeframeItem[] = [
  { value: 6, label: 'Last 6 months' },
  { value: 12, label: 'Last 12 months' },
  { value: 24, label: 'Last 24 months' },
  { value: 36, label: 'Last 36 months' },
  { value: 'all', label: 'All time' },
];

function timeframeLabel(value: TimeframeOption): string {
  return TIMEFRAME_OPTIONS.find((o) => o.value === value)?.label ?? 'Last 12 months';
}

function formatShortMonth(month: string): string {
  const [year, m] = month.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const idx = parseInt(m, 10) - 1;
  return `${names[idx] ?? m} ${year.slice(2)}`;
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function xAxisLabelStep(count: number): number {
  if (count >= 24) return 3;
  if (count >= 12) return 2;
  return 1;
}

// Returns nice axis bounds that guarantee 0 falls on a tick boundary
function computeNiceAxisBounds(dataMin: number, dataMax: number) {
  const lo = dataMin < -100 ? Math.min(dataMin, 0) : 0;
  const hi = Math.max(dataMax, 0);
  const maxAbs = Math.max(Math.abs(lo), Math.abs(hi)) || 1000;
  const roughInterval = maxAbs / 2;
  const mag = Math.pow(10, Math.floor(Math.log10(roughInterval)));
  const interval = [1, 2, 2.5, 5, 10].map((c) => c * mag).find((c) => roughInterval <= c) ?? mag * 10;
  const axisMin = lo < 0 ? -Math.ceil(-lo / interval) * interval : 0;
  const axisMax = hi > 0 ? Math.ceil(hi / interval) * interval : interval;
  const tickAmount = Math.round((axisMax - axisMin) / interval);
  const span = axisMax - axisMin;
  const zeroOffset = span === 0 ? 50 : (axisMax / span) * 100;
  return { axisMin, axisMax, tickAmount, zeroOffset };
}

function computeLinearTrend(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values.slice();
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return values.map((_, i) => Math.round((slope * i + intercept) * 100) / 100);
}

export default function NetCashFlowChart({
  data,
  cashFlowMode = 'operating',
  timeframe: controlledTimeframe,
  onCashFlowModeChange,
  onTimeframeChange,
  onMonthPointClick,
}: NetCashFlowChartProps) {
  const [internalTimeframe, setInternalTimeframe] = useState<TimeframeOption>(12);
  const timeframe = controlledTimeframe ?? internalTimeframe;
  const setTimeframe = useCallback(
    (next: TimeframeOption) => {
      if (onTimeframeChange) onTimeframeChange(next);
      else setInternalTimeframe(next);
    },
    [onTimeframeChange]
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cashflowTooltipId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const scopedData = useMemo(() => {
    if (timeframe === 'all') return data;
    return data.slice(-timeframe);
  }, [data, timeframe]);

  const categories = useMemo(() => scopedData.map((d) => formatShortMonth(d.month)), [scopedData]);
  const values = useMemo(() => scopedData.map((d) => d.net), [scopedData]);
  const months = useMemo(() => scopedData.map((d) => d.month), [scopedData]);
  const trendValues = useMemo(() => computeLinearTrend(values), [values]);
  const labelStep = useMemo(() => xAxisLabelStep(categories.length), [categories.length]);

  const hasPositive = useMemo(() => values.some((v) => v > 0), [values]);
  const hasNegative = useMemo(() => values.some((v) => v < 0), [values]);

  // Compute nice axis bounds with 0 guaranteed as a tick boundary
  const { yAxisMin, yAxisMax, yAxisTickAmount, gradientZeroOffset } = useMemo(() => {
    if (values.length === 0) return { yAxisMin: -1000, yAxisMax: 1000, yAxisTickAmount: 4, gradientZeroOffset: 50 };
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const { axisMin, axisMax, tickAmount } = computeNiceAxisBounds(dataMin, dataMax);
    const clampedMax = Math.max(dataMax, 0);
    const clampedMin = Math.min(dataMin, 0);
    const dataRange = clampedMax - clampedMin;
    const gradientZeroOffset = dataRange === 0 ? 50 : (clampedMax / dataRange) * 100;
    return { yAxisMin: axisMin, yAxisMax: axisMax, yAxisTickAmount: tickAmount, gradientZeroOffset };
  }, [values]);

  const rangeLabel = useMemo(() => {
    if (scopedData.length === 0) return '';
    const first = toMonthLabel(scopedData[0].month);
    const last = toMonthLabel(scopedData[scopedData.length - 1].month);
    return `${first} \u2013 ${last}`;
  }, [scopedData]);

  const subtitle = cashFlowMode === 'operating'
    ? 'Operating mode excludes capital distribution.'
    : 'Total mode includes capital distribution.';

  const options = useMemo<ApexOptions>(() => {
    // Build dual-color gradient stops: blue above zero, red below zero
    // gradientZeroOffset is data-based (objectBoundingBox units), not axis-based
    const z = gradientZeroOffset;
    const colorStops = hasPositive && hasNegative
      ? [
          [
            { offset: 0, color: chartTokens.brand, opacity: 0.28 },
            { offset: z, color: chartTokens.brand, opacity: 0 },
            { offset: z, color: chartTokens.error, opacity: 0 },
            { offset: 100, color: chartTokens.error, opacity: 0.28 },
          ],
        ]
      : hasNegative
      ? [
          [{ offset: 0, color: chartTokens.error, opacity: 0 }, { offset: 100, color: chartTokens.error, opacity: 0.28 }],
        ]
      : [
          [{ offset: 0, color: chartTokens.brand, opacity: 0.28 }, { offset: 100, color: chartTokens.brand, opacity: 0 }],
        ];

    return ({
    chart: {
      type: 'area',
      height: 310,
      fontFamily: 'inherit',
      toolbar: { show: false },
      zoom: { enabled: false },
      sparkline: { enabled: false },
      events: {
        dataPointSelection: (_e, _chart, config?: { dataPointIndex?: number }) => {
          const idx = config?.dataPointIndex ?? -1;
          if (idx >= 0 && idx < months.length && onMonthPointClick) {
            onMonthPointClick(months[idx]);
          }
        },
      },
    },
    plotOptions: {
      area: { fillTo: 'origin' },
    },
    colors: [chartTokens.brand],
    fill: {
      type: 'gradient',
      opacity: 1,
      gradient: {
        type: 'vertical',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        colorStops: colorStops as any,
      },
    },
    stroke: {
      width: 2.25,
      curve: 'smooth',
      lineCap: 'round',
    },
    dataLabels: { enabled: false },
    markers: {
      size: 0,
      hover: { sizeOffset: 5 },
    },
    annotations: {
      yaxis: [
        {
          y: 0,
          borderColor: chartTokens.crosshairStroke,
          borderWidth: 0.75,
          strokeDashArray: 0,
          label: { text: '' },
        },
      ],
    },
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
      labels: {
        hideOverlappingLabels: false,
        trim: false,
        offsetY: 2,
        formatter: (value: string, _timestamp?: number, opts?: { dataPointIndex?: number }) => {
          const index = opts?.dataPointIndex ?? categories.indexOf(value);
          if (index < 0) return value;
          if (index === 0 || index === categories.length - 1) return value;
          return index % labelStep === 0 ? value : '';
        },
        style: {
          fontSize: '12px',
          fontWeight: '500',
          colors: chartTokens.axisText,
        },
      },
    },
    yaxis: {
      min: yAxisMin,
      max: yAxisMax,
      tickAmount: yAxisTickAmount,
      labels: {
        formatter: formatCurrency,
        offsetX: -4,
        style: {
          fontSize: '12px',
          fontWeight: '500',
          colors: chartTokens.axisText,
        },
      },
    },
    grid: {
      borderColor: chartTokens.gridBorder,
      strokeDashArray: 4,
      padding: {
        left: 6,
        right: 10,
        top: 6,
        bottom: 0,
      },
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: formatCurrency,
      },
    },
    legend: { show: false },
  });
  }, [categories, months, onMonthPointClick, cashFlowMode, labelStep, hasPositive, hasNegative, gradientZeroOffset, yAxisMin, yAxisMax, yAxisTickAmount]);

  const series = useMemo(() => [
    { name: cashFlowMode === 'total' ? 'Total' : 'Operating', data: values, type: 'area' },
  ], [cashFlowMode, values]);

  return (
    <article className="card chart-card">
      <div className="card-head chart-head chart-head-has-center">
        <div className="chart-head-left">
          <h3 className="chart-head-title">Monthly Net Cash Flow</h3>
          <p className="subtle chart-head-subtitle">{subtitle}</p>
        </div>
        <div className="chart-head-middle" role="group" aria-label="Cash Flow mode selector">
          <div className="segmented-toggle">
            <button
              type="button"
              className={`segmented-toggle-btn${cashFlowMode === 'operating' ? ' is-active' : ''}`}
              onClick={() => onCashFlowModeChange?.('operating')}
            >
              Operating
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn${cashFlowMode === 'total' ? ' is-active' : ''}`}
              onClick={() => onCashFlowModeChange?.('total')}
            >
              Total
            </button>
          </div>
          <div className="cashflow-help">
            <button
              type="button"
              className="cashflow-tooltip"
              aria-label="Cash flow mode help"
              aria-describedby={cashflowTooltipId}
            >
              &#9432;
            </button>
            <div id={cashflowTooltipId} role="tooltip" className="cashflow-tooltip-panel">
              <ul className="cashflow-tooltip-list">
                <li><strong>Operating</strong></li>
                <li className="cashflow-tooltip-body">Excludes capital distributions — shows the cash your business produces.</li>
                <li><strong>Total</strong></li>
                <li className="cashflow-tooltip-body">Includes capital distributions — the full cash movement in and out.</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="chart-head-right">
          <div className="chart-control-row">
            <div className="timeframe-menu" ref={menuRef}>
              <button
                type="button"
                className="timeframe-trigger"
                onClick={() => setMenuOpen((c) => !c)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                {timeframeLabel(timeframe)} &#9662;
              </button>
              {menuOpen && (
                <ul className="timeframe-list" role="menu" aria-label="Select timeframe">
                  {TIMEFRAME_OPTIONS.map((option) => (
                    <li key={option.label}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={timeframe === option.value}
                        className={timeframe === option.value ? 'is-active' : ''}
                        onClick={() => { setTimeframe(option.value); setMenuOpen(false); }}
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
            <p className="subtle chart-range-label">{rangeLabel}</p>
          </div>
        </div>
      </div>
      <div className="net-cash-flow-chart-body">
        <ReactApexChart options={options} series={series} type="line" height={310} />
      </div>
    </article>
  );
}
