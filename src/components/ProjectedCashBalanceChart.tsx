import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { ForecastEvent, TrendPoint } from '../lib/data/contract';
import { niceTicks, formatTickLabel } from '../lib/charts/niceTicks';

type ProjectedCashBalanceChartProps = {
  data: TrendPoint[];
  granularity?: 'month' | 'week';
  knownEvents?: ForecastEvent[];
  height?: number;
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatShortMonth(month: string): string {
  const [year, m] = month.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${year.slice(2)}`;
}

function formatFullMonth(month: string): string {
  const [year, m] = month.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${year}`;
}

/** Bucket end date in "MMM D, YYYY" form for the tooltip header.
 *  Week granularity: extract the end of the existing range tooltipLabel ("May 25 – May 31, 2026").
 *  Month granularity: last day of the calendar month from YYYY-MM. */
function formatBucketEndDate(d: TrendPoint, granularity: 'month' | 'week'): string {
  if (granularity === 'week') {
    const label = d.tooltipLabel ?? d.axisLabel ?? d.month;
    // Range separator may be en dash, em dash, or hyphen; trim and take the right side
    const parts = label.split(/\s[–—-]\s/);
    return (parts.length >= 2 ? parts[parts.length - 1] : label).trim();
  }
  const [yearStr, mmStr] = d.month.split('-');
  const year = parseInt(yearStr, 10);
  const mm = parseInt(mmStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(mm)) return d.month;
  // new Date(year, mm, 0) = last day of month `mm` (mm is 1-indexed here)
  const lastDay = new Date(year, mm, 0).getDate();
  return `${MONTH_NAMES[mm - 1] ?? mmStr} ${lastDay}, ${year}`;
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

const formatSignedCurrency = (n: number) =>
  `${n > 0 ? '+' : ''}${formatCurrency(n)}`;

function xAxisLabelStep(count: number): number {
  if (count >= 24) return 3;
  if (count >= 12) return 2;
  return 1;
}

export default function ProjectedCashBalanceChart({
  data,
  granularity = 'month',
  knownEvents,
  height = 310,
}: ProjectedCashBalanceChartProps) {
  // Axis categories (short labels for display on x-axis)
  const categories = useMemo(
    () =>
      data.map((d) => {
        if (granularity === 'week') return d.axisLabel ?? d.month;
        return formatShortMonth(d.month);
      }),
    [data, granularity]
  );

  // Tooltip x-labels — bucket end date as "MMM D, YYYY" (e.g. "May 31, 2026").
  // Single date, no range, no metric label — see tooltip block below.
  const tooltipLabels = useMemo(
    () => data.map((d) => formatBucketEndDate(d, granularity)),
    [data, granularity]
  );

  const values = useMemo(() => data.map((d) => d.net), [data]);

  const labelStep = useMemo(() => xAxisLabelStep(categories.length), [categories.length]);

  // Known Events → annotation points. Map ForecastEvent fields to annotation shape internally.
  // Event month is YYYY-MM; match to first data point whose month starts with that prefix
  // (exact for monthly granularity, first week of month for weekly granularity).
  const eventAnnotationPoints = useMemo(() => {
    if (!knownEvents || knownEvents.length === 0) return [];
    type AnnotationPoint = NonNullable<NonNullable<ApexOptions['annotations']>['points']>[number];
    const points: AnnotationPoint[] = [];
    for (const event of knownEvents) {
      if (!event.enabled) continue;
      const netImpact = event.cashInImpact - event.cashOutImpact;
      if (netImpact === 0) continue;
      const idx = data.findIndex((d) => d.month.startsWith(event.month));
      if (idx < 0) continue;
      // Two annotation points per event at the same x: an invisible-marker
      // title-line above, and a value-line + visible dot below. Apex's
      // label.text renders through a single SVG <text> element with no
      // <tspan> children, so \n collapses; stacking via offsetY is the
      // cleanest in-API path. See feasibility test results.
      const labelStyle = {
        background: 'rgba(255, 255, 255, 0.96)',
        color: '#344054',
        fontSize: '11px',
        fontFamily: 'Outfit, sans-serif',
        padding: { left: 6, right: 6, top: 2, bottom: 2 },
      } as const;
      points.push({
        x: categories[idx],
        y: values[idx],
        marker: { size: 0 },
        label: {
          text: event.title,
          offsetY: -36,
          textAnchor: 'middle',
          borderColor: '#F79009',
          borderWidth: 1,
          style: labelStyle,
        },
      });
      points.push({
        x: categories[idx],
        y: values[idx],
        marker: {
          size: 5,
          fillColor: '#F79009',
          strokeColor: '#FFFFFF',
          strokeWidth: 2,
        },
        label: {
          text: formatSignedCurrency(netImpact),
          offsetY: -18,
          textAnchor: 'middle',
          borderColor: '#F79009',
          borderWidth: 1,
          style: labelStyle,
        },
      });
    }
    return points;
  }, [knownEvents, data, categories, values]);

  // Y-axis snapped to nice round ticks via the shared niceTicks helper.
  // Range covers the initial balance plus the full projected balance series
  // so the chart fits the data without padding tricks; the helper applies
  // a hybrid local/zero-based axis — see niceTicks.ts.
  const initialBalance = data.length > 0 ? data[0].net : 0;
  const dataMin = data.length > 0 ? Math.min(initialBalance, ...values) : 0;
  const dataMax = data.length > 0 ? Math.max(initialBalance, ...values) : 0;
  const { min: yAxisMin, max: yAxisMax, ticks: yAxisTicks } = useMemo(
    () => niceTicks(dataMin, dataMax),
    [dataMin, dataMax],
  );
  const yAxisTickAmount = Math.max(1, yAxisTicks.length - 1);

  const options = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: 'area',
        height,
        fontFamily: 'inherit',
        toolbar: { show: false },
        zoom: { enabled: false },
        sparkline: { enabled: false },
        animations: { enabled: true },
      },
      colors: ['#465FFF'],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'vertical',
          opacityFrom: 0.55,
          opacityTo: 0,
          stops: [0, 100],
        },
      },
      stroke: {
        width: 2,
        curve: 'smooth',
        lineCap: 'butt',
      },
      dataLabels: { enabled: false },
      markers: {
        size: 0,
        hover: { sizeOffset: 6 },
        strokeColors: '#FFFFFF',
        strokeWidth: 2,
        fillOpacity: 1,
        colors: ['#465FFF'],
      },
      grid: {
        borderColor: '#EAECF0',
        strokeDashArray: 4,
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } },
        padding: { left: 6, right: 10, top: 6, bottom: 0 },
      },
      xaxis: {
        categories,
        type: 'category',
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
        crosshairs: {
          show: true,
          stroke: { color: '#b6b6b6', width: 1, dashArray: 3 },
        },
        labels: {
          hideOverlappingLabels: true,
          trim: false,
          offsetY: 2,
          formatter: (value: string, _timestamp?: number, opts?: { dataPointIndex?: number }) => {
            const index = opts?.dataPointIndex ?? categories.indexOf(value);
            if (index < 0) return value;
            if (index === 0 || index === categories.length - 1) return value;
            return value;
          },
          style: {
            fontSize: '12px',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: '400',
            colors: '#344054',
          },
        },
      },
      yaxis: {
        min: yAxisMin,
        max: yAxisMax,
        tickAmount: yAxisTickAmount,
        forceNiceScale: false,
        labels: {
          formatter: formatTickLabel,
          offsetX: -4,
          style: {
            fontSize: '11px',
            fontFamily: 'Outfit, sans-serif',
            fontWeight: '400',
            colors: '#344054',
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
            if (idx >= 0 && idx < tooltipLabels.length) return tooltipLabels[idx];
            return value;
          },
        },
        y: {
          formatter: formatCurrency,
          // Suppress the "Cash Balance:" series-name prefix on the value row
          title: { formatter: () => '' },
        },
        marker: { show: true },
      },
      annotations: {
        points: eventAnnotationPoints,
      },
      legend: { show: false },
    }),
    [categories, tooltipLabels, labelStep, eventAnnotationPoints, height, yAxisMin, yAxisMax, yAxisTickAmount]
  );

  const series = useMemo(
    () => [{ name: 'Cash Balance', data: values }],
    [values]
  );

  return (
    <ReactApexChart options={options} series={series} type="area" height={height} />
  );
}
