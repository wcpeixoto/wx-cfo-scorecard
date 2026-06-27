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
  // By-age overlay — Youth / Adults points aligned 1:1 to `points` (the All axis). A null slot is a
  // line GAP. When BOTH are supplied the chart renders three distinguishable lines (All + Youth +
  // Adults); when absent it renders the gym-wide All line as the current area.
  youth?: (RetentionEvolutionPoint | null)[];
  adults?: (RetentionEvolutionPoint | null)[];
};

// Distinct categorical line colors from the chart-token palette (UI_RULES §Chart Token File — no
// invented hex). Blue / green / amber read as three different hues; the legend labels carry meaning.
const ALL_COLOR = chartTokens.brand;
const YOUTH_COLOR = chartTokens.success;
const ADULTS_COLOR = chartTokens.warning;

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

export default function RetentionEvolutionChart({
  points,
  metric,
  height = 300,
  youth,
  adults,
}: RetentionEvolutionChartProps) {
  const isChurn = metric === 'churn';
  const byAge = youth != null && adults != null;

  const categories = useMemo(() => points.map((p) => formatMonthShort(p.periodMonth)), [points]);
  const tooltipLabels = useMemo(() => points.map((p) => formatMonthLong(p.periodMonth)), [points]);

  // Metric value for a point (or null gap) — the SAME selector drives every line, so the metric and
  // timeframe controls move all of them together.
  const valueOf = useMemo(
    () => (p: RetentionEvolutionPoint | null): number | null =>
      p === null ? null : isChurn ? churnPctOf(p) : p.retentionPct,
    [isChurn],
  );

  const allValues = useMemo(() => points.map((p) => valueOf(p) as number), [points, valueOf]);
  const youthValues = useMemo(() => (youth ? youth.map(valueOf) : null), [youth, valueOf]);
  const adultsValues = useMemo(() => (adults ? adults.map(valueOf) : null), [adults, valueOf]);

  // Y-domain spans every VISIBLE line so a segment line is never clipped (nulls excluded).
  const domainValues = useMemo(() => {
    const vals = [...allValues];
    if (youthValues) for (const v of youthValues) if (v != null) vals.push(v);
    if (adultsValues) for (const v of adultsValues) if (v != null) vals.push(v);
    return vals;
  }, [allValues, youthValues, adultsValues]);

  const { min: yMin, max: yMax } = useMemo(
    () => (isChurn ? churnYDomain(domainValues) : retentionYDomain(domainValues)),
    [domainValues, isChurn],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: byAge ? 'line' : 'area',
        height,
        fontFamily: 'Outfit, sans-serif',
        toolbar: { show: false },
        accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
        zoom: { enabled: false },
        sparkline: { enabled: false },
        animations: { enabled: true },
      },
      colors: byAge ? [ALL_COLOR, YOUTH_COLOR, ADULTS_COLOR] : [ALL_COLOR],
      // Area fill only in the single-line All view; the By-age view is clean lines (no stacked
      // translucent fills).
      fill: byAge
        ? { type: 'solid', opacity: 0 }
        : {
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
        colors: byAge ? [ALL_COLOR, YOUTH_COLOR, ADULTS_COLOR] : [ALL_COLOR],
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
          // Series name ("All" / "Youth" / "Adults" or "Churn" / "Retention") is the label; the
          // value is the metric percent. Suppressed/absent cohort cells are gaps → render an em dash.
          formatter: (value: number | null) => (value == null ? '—' : `${value}%`),
        },
        marker: { show: true },
      },
      // Legend distinguishes the three lines in By-age view; the single All line needs none.
      legend: byAge
        ? {
            show: true,
            position: 'bottom',
            horizontalAlign: 'left',
            fontFamily: 'Outfit, sans-serif',
            fontSize: '12px',
            labels: { colors: chartTokens.chartTextStrong },
            markers: { size: 6, shape: 'circle' },
            itemMargin: { horizontal: 10, vertical: 4 },
          }
        : { show: false },
    }),
    [byAge, categories, tooltipLabels, yMin, yMax, height],
  );

  const series = useMemo(() => {
    if (byAge && youthValues && adultsValues) {
      return [
        { name: 'All', data: allValues },
        { name: 'Youth', data: youthValues },
        { name: 'Adults', data: adultsValues },
      ];
    }
    return [{ name: isChurn ? 'Churn' : 'Retention', data: allValues }];
  }, [byAge, isChurn, allValues, youthValues, adultsValues]);

  return (
    // Remount on mode change — ApexCharts does not cleanly switch an existing instance between
    // `area` and `line`; a fresh key forces a clean redraw with the new series set.
    <ReactApexChart
      key={byAge ? 'byAge' : 'all'}
      options={options}
      series={series}
      type={byAge ? 'line' : 'area'}
      height={height}
    />
  );
}
