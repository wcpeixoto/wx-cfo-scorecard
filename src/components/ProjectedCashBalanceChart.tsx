import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { ForecastEvent, TrendPoint } from '../lib/data/contract';

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

  // Tooltip x-labels (rich labels for hover — full month or week range)
  const tooltipLabels = useMemo(
    () =>
      data.map((d) => {
        if (granularity === 'week') return d.tooltipLabel ?? d.axisLabel ?? d.month;
        return formatFullMonth(d.month);
      }),
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
          text: event.title,
          borderColor: '#F79009',
          borderWidth: 1,
          style: {
            background: 'rgba(255, 255, 255, 0.96)',
            color: '#344054',
            fontSize: '11px',
            fontFamily: 'Outfit, sans-serif',
            padding: { left: 6, right: 6, top: 2, bottom: 2 },
          },
        },
      });
    }
    return points;
  }, [knownEvents, data, categories, values]);

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
            fontFamily: 'Outfit, sans-serif',
            fontWeight: '400',
            colors: '#344054',
          },
        },
      },
      yaxis: {
        labels: {
          formatter: formatCurrency,
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
        y: { formatter: formatCurrency },
        marker: { show: true },
      },
      annotations: {
        points: eventAnnotationPoints,
      },
      legend: { show: false },
    }),
    [categories, tooltipLabels, labelStep, eventAnnotationPoints, height]
  );

  const series = useMemo(
    () => [{ name: 'Cash Balance', data: values }],
    [values]
  );

  return (
    <ReactApexChart options={options} series={series} type="area" height={height} />
  );
}
