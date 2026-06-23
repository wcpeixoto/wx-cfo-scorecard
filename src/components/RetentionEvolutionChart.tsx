import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

import { chartTokens } from '../lib/ui/chartTokens';
import {
  churnPctOf,
  formatMonthLong,
  formatMonthShort,
  type RetentionEvolutionPoint,
  type RetentionMetric,
} from '../lib/gym/memberRetentionSeries';

type RetentionEvolutionChartProps = {
  points: RetentionEvolutionPoint[];
  metric: RetentionMetric;
  height?: number;
};

// Retention sits in a tight 85–100% band; zero-basing the y-axis would flatten the line. Floor to
// the nearest 5% below the data min (clamped), cap at 100% (retention can't exceed 100%).
function retentionYDomain(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 80, max: 100 };
  const lo = Math.min(...values);
  const min = Math.max(0, Math.min(90, Math.floor((lo - 4) / 5) * 5));
  return { min, max: 100 };
}

// Churn sits low (~5–12%); base at 0 and cap a touch above the peak (next 5%, min 10%) so the
// month-to-month movement stays legible instead of flattening on the floor.
function churnYDomain(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 15 };
  const hi = Math.max(...values);
  return { min: 0, max: Math.min(100, Math.max(10, Math.ceil((hi + 1) / 5) * 5)) };
}

function tickAmountFor(count: number): number {
  if (count <= 6) return Math.max(1, count - 1);
  if (count <= 12) return 6;
  return 8;
}

export default function RetentionEvolutionChart({ points, metric, height = 300 }: RetentionEvolutionChartProps) {
  const isChurn = metric === 'churn';
  const categories = useMemo(() => points.map((p) => formatMonthShort(p.periodMonth)), [points]);
  const tooltipLabels = useMemo(() => points.map((p) => formatMonthLong(p.periodMonth)), [points]);
  const values = useMemo(
    () => points.map((p) => (isChurn ? churnPctOf(p) : p.retentionPct)),
    [points, isChurn],
  );
  const { min: yMin, max: yMax } = useMemo(
    () => (isChurn ? churnYDomain(values) : retentionYDomain(values)),
    [values, isChurn],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: 'area',
        height,
        fontFamily: 'Outfit, sans-serif',
        toolbar: { show: false },
        accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
        zoom: { enabled: false },
        sparkline: { enabled: false },
        animations: { enabled: true },
      },
      colors: [chartTokens.brand],
      fill: {
        type: 'gradient',
        gradient: { shade: 'light', type: 'vertical', opacityFrom: 0.5, opacityTo: 0, stops: [0, 100] },
      },
      stroke: { width: 2, curve: 'straight', lineCap: 'butt', dashArray: 0 },
      dataLabels: { enabled: false },
      markers: {
        size: 0,
        hover: { sizeOffset: 6 },
        strokeColors: '#FFFFFF',
        strokeWidth: 2,
        fillOpacity: 1,
        colors: [chartTokens.brand],
      },
      grid: {
        borderColor: chartTokens.gridBorder,
        strokeDashArray: 4,
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } },
        padding: { left: 6, right: 10, top: 6, bottom: 0 },
      },
      xaxis: {
        categories,
        type: 'category',
        tickAmount: tickAmountFor(categories.length),
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
        crosshairs: {
          show: true,
          stroke: { color: chartTokens.crosshairStroke, width: 1, dashArray: 3 },
        },
        labels: {
          hideOverlappingLabels: true,
          trim: false,
          offsetY: 2,
          style: {
            fontSize: '12px',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: '400',
            colors: chartTokens.chartTextStrong,
          },
        },
      },
      yaxis: {
        min: yMin,
        max: yMax,
        tickAmount: 4,
        forceNiceScale: false,
        labels: {
          formatter: (value: number) => `${Math.round(value)}%`,
          offsetX: -4,
          style: {
            fontSize: '11px',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: '400',
            colors: chartTokens.chartTextStrong,
          },
        },
      },
      tooltip: {
        theme: 'light',
        shared: true,
        intersect: false,
        style: { fontSize: '12px', fontFamily: 'Outfit, sans-serif' },
        x: {
          formatter: (value: string, opts?: { dataPointIndex?: number }) => {
            const idx = opts?.dataPointIndex ?? -1;
            return idx >= 0 && idx < tooltipLabels.length ? tooltipLabels[idx] : value;
          },
        },
        y: {
          // Just the metric percentage — the series name ("Churn" / "Retention") is the label,
          // so the tooltip reads e.g. "Churn: 9.9%". No counts (they overflowed/clipped the panel).
          formatter: (value: number) => `${value}%`,
        },
        marker: { show: true },
      },
      legend: { show: false },
    }),
    [categories, tooltipLabels, points, values, yMin, yMax, height, isChurn],
  );

  const series = useMemo(
    () => [{ name: isChurn ? 'Churn' : 'Retention', data: values }],
    [values, isChurn],
  );

  return <ReactApexChart options={options} series={series} type="area" height={height} />;
}
