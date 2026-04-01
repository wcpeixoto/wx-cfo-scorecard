import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { toMonthLabel } from '../lib/kpis/compute';
import type { CashFlowMode, TrendPoint } from '../lib/data/contract';

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
  return `${names[idx] ?? m} '${year.slice(2)}`;
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return `${sign}$${Math.round(abs).toLocaleString()}`;
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
  cashFlowMode = 'total',
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

  const rangeLabel = useMemo(() => {
    if (scopedData.length === 0) return '';
    const first = toMonthLabel(scopedData[0].month);
    const last = toMonthLabel(scopedData[scopedData.length - 1].month);
    return `${first} \u2013 ${last}`;
  }, [scopedData]);

  const subtitle = cashFlowMode === 'operating'
    ? 'Operating mode excludes capital distribution.'
    : 'Total mode includes capital distribution.';

  const options = useMemo<ApexOptions>(() => ({
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
    colors: ['#465fff', '#94a3b8'],
    fill: {
      type: ['gradient', 'solid'],
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.35,
        opacityTo: 0.05,
        stops: [0, 90, 100],
      },
      opacity: [1, 0],
    },
    stroke: {
      width: [2.5, 1.5],
      curve: ['smooth', 'straight'],
      dashArray: [0, 5],
    },
    dataLabels: { enabled: false },
    markers: {
      size: 0,
      hover: { sizeOffset: 5 },
    },
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: {
          fontSize: '11px',
          colors: '#6b7280',
        },
      },
    },
    yaxis: {
      labels: {
        formatter: formatCurrency,
        style: {
          fontSize: '11px',
          colors: '#6b7280',
        },
      },
    },
    grid: {
      borderColor: '#e5e7eb',
      strokeDashArray: 3,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
    },
    tooltip: {
      custom: ({ series, dataPointIndex }: { series: number[][], dataPointIndex: number }) => {
        const val = series[0]?.[dataPointIndex];
        if (val === undefined || val === null) return '';
        const sign = val < 0 ? '-' : '';
        const abs = Math.abs(val);
        const formatted = `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const accentColor = val < 0 ? '#ef4444' : '#465fff';
        const seriesName = cashFlowMode === 'total' ? 'Total' : 'Operating';
        return `<div style="padding:8px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.1);font-family:inherit"><div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:${accentColor};flex-shrink:0;display:inline-block"></span><span style="font-size:12px;color:#6b7280">${seriesName}:</span><span style="font-size:12px;font-weight:600;color:${accentColor}">${formatted}</span></div></div>`;
      },
    },
    legend: { show: false },
  }), [categories, months, onMonthPointClick, cashFlowMode]);

  const series = useMemo(() => [
    { name: cashFlowMode === 'total' ? 'Total' : 'Operating', data: values, type: 'area' },
    { name: 'Trend', data: trendValues, type: 'line' },
  ], [cashFlowMode, values, trendValues]);

  return (
    <article className="card chart-card">
      <div className="card-head chart-head chart-head-has-center">
        <div className="chart-head-left">
          <h3 className="chart-head-title">Monthly Net Cash Flow</h3>
          <p className="subtle chart-head-subtitle">{subtitle}</p>
        </div>
        <div className="chart-head-middle" role="group" aria-label="Cash Flow mode selector">
          <div className="cashflow-toggle">
            <button
              type="button"
              className={cashFlowMode === 'total' ? 'is-active' : ''}
              onClick={() => onCashFlowModeChange?.('total')}
            >
              Total
            </button>
            <button
              type="button"
              className={cashFlowMode === 'operating' ? 'is-active' : ''}
              onClick={() => onCashFlowModeChange?.('operating')}
            >
              Operating
            </button>
          </div>
          <div className="cashflow-help">
            <button type="button" className="cashflow-tooltip" aria-label="Cash flow mode help">
              &#9432;
            </button>
            <div role="tooltip" className="cashflow-tooltip-panel">
              <ul className="cashflow-tooltip-list">
                <li><strong>Operating</strong> excludes capital distribution</li>
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
      <div style={{ padding: '0 8px 8px' }}>
        <ReactApexChart options={options} series={series} type="line" height={310} />
      </div>
    </article>
  );
}
