import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { ForecastEvent, TrendPoint } from '../lib/data/contract';
import { niceTicks, formatTickLabel } from '../lib/charts/niceTicks';
import { chartTokens } from '../lib/ui/chartTokens';

type ProjectedCashBalanceChartProps = {
  data: TrendPoint[];
  granularity?: 'month' | 'week';
  knownEvents?: ForecastEvent[];
  height?: number;
  /** Optional prior-period series aligned 1:1 to `data` for "Compare" overlay. */
  priorSeries?: TrendPoint[] | null;
  /** Label shown in the tooltip for the prior series. Defaults to "Prior Year". */
  priorSeriesLabel?: string;
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

/** Tooltip header date for the cash-balance chart.
 *  Week granularity: single date string from the bucket's periodStart
 *    ("Jun 8, 2026"), formatted via formatEventDate.
 *  Month granularity: last day of the calendar month from YYYY-MM
 *    ("Jun 30, 2026"), unchanged.
 *  Function name does not perfectly describe the week branch (it returns
 *  start, not end); renaming requires touching the caller and is
 *  intentionally out of scope. */
// Format YYYY-MM-DD → "Mmm DD, YYYY" (e.g. "Jun 12, 2026"). UTC-stable.
// Mirrors formatEventDate in CashFlowForecastModule.tsx — the row display
// uses the same shape for the same field. Inline rather than extracted
// because only two callers exist; both live in non-locked files.
function formatEventDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || !Number.isFinite(day)) return date;
  return new Date(Date.UTC(year, monthIndex, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatBucketEndDate(d: TrendPoint, granularity: 'month' | 'week'): string {
  if (granularity === 'week') {
    if (d.periodStart) return formatEventDate(d.periodStart);
    return d.tooltipLabel ?? d.axisLabel ?? d.month;
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

// Density control via Apex `xaxis.tickAmount`, not the formatter.
// Earlier formatter-based suppression (return '' or '​' for skipped
// indices) collided with Apex's annotation x-matching, which uses the
// formatter output as the lookup key — annotations on suppressed buckets
// silently dropped. tickAmount keeps formatter output stable so
// `x: categories[idx]` continues to match the raw category value.
// Apex distributes ticks internally; counts are approximate (±1 from target).
function computeTickAmount(count: number, granularity: 'month' | 'week'): number {
  if (granularity === 'week') {
    return count <= 5 ? Math.max(1, count - 1) : 5;
  }
  // monthly
  if (count <= 6) return Math.max(1, count - 1);
  if (count <= 12) return 6;
  if (count <= 24) return 8;
  return 9;
}

export default function ProjectedCashBalanceChart({
  data,
  granularity = 'month',
  knownEvents,
  height = 310,
  priorSeries = null,
  priorSeriesLabel = 'Prior Year',
}: ProjectedCashBalanceChartProps) {
  const hasPrior = !!priorSeries && priorSeries.length === data.length && priorSeries.length > 0;

  // Axis categories (short labels for display on x-axis)
  const categories = useMemo(
    () =>
      data.map((d) => {
        if (granularity === 'week') return d.axisLabel ?? d.month;
        return formatShortMonth(d.month);
      }),
    [data, granularity]
  );

  // Tooltip x-labels.
  // Monthly: full month + year ("May 2026").
  // Weekly: bucket end date as "MMM D, YYYY" ("May 31, 2026") so the day is
  // shown — week buckets only have meaning at day granularity.
  const tooltipLabels = useMemo(
    () =>
      data.map((d) =>
        granularity === 'week' ? formatBucketEndDate(d, granularity) : formatFullMonth(d.month),
      ),
    [data, granularity]
  );

  const values = useMemo(() => data.map((d) => d.net), [data]);

  const xAxisTickAmount = useMemo(
    () => computeTickAmount(categories.length, granularity),
    [categories.length, granularity],
  );

  // Known Events → orange marker dots only. No tooltip/label: the
  // dot's correspondence with the Known Events list row (orange leading
  // dot in CashFlowForecastModule) carries the meaning. Previous
  // tooltip implementations (SVG annotation label, always-on HTML
  // overlay, hover-gated HTML overlay) all caused cross-talk with the
  // chart-line hover tooltip and stacked-duplicate render bugs.
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
          fillColor: chartTokens.warning,
          strokeColor: '#FFFFFF',
          strokeWidth: 2,
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
  const priorValues = hasPrior ? priorSeries!.map((d) => d.net) : [];
  const combinedValues = hasPrior ? [...values, ...priorValues] : values;
  const dataMin = data.length > 0 ? Math.min(initialBalance, ...combinedValues) : 0;
  const dataMax = data.length > 0 ? Math.max(initialBalance, ...combinedValues) : 0;
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
      colors: hasPrior
        ? [chartTokens.brand, chartTokens.brandSecondary]
        : [chartTokens.brand],
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'light',
          type: 'vertical',
          opacityFrom: hasPrior ? [0.55, 0.12] : 0.55,
          opacityTo: 0,
          stops: [0, 100],
        },
      },
      stroke: {
        width: hasPrior ? [2, 2] : 2,
        curve: 'smooth',
        lineCap: 'butt',
        dashArray: hasPrior ? [0, 4] : 0,
      },
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
        tickAmount: xAxisTickAmount,
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
            if (idx >= 0 && idx < tooltipLabels.length) return tooltipLabels[idx];
            return value;
          },
        },
        y: {
          formatter: formatCurrency,
          // Always show the series name on the value row — matches the
          // TailAdmin "Users & Revenue Statistics" tooltip pattern (title
          // = period, then each series labelled with colored dot + name +
          // value).
        },
        marker: { show: true },
      },
      annotations: {
        points: eventAnnotationPoints,
      },
      legend: { show: false },
    }),
    [categories, tooltipLabels, xAxisTickAmount, eventAnnotationPoints, height, yAxisMin, yAxisMax, yAxisTickAmount, hasPrior]
  );

  const series = useMemo(
    () =>
      hasPrior
        ? [
            { name: 'Cash Balance', data: values },
            { name: priorSeriesLabel, data: priorValues },
          ]
        : [{ name: 'Cash Balance', data: values }],
    [values, hasPrior, priorValues, priorSeriesLabel]
  );

  return (
    <ReactApexChart options={options} series={series} type="area" height={height} />
  );
}
