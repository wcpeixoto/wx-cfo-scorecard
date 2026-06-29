import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

import { chartTokens } from '../lib/ui/chartTokens';
import { formatMonthLong, formatMonthShort } from '../lib/gym/memberRetentionSeries';
import type { BeltBandSeries } from '../lib/gym/memberRetentionByBeltSeries';

type MemberRetentionByBeltChartProps = {
  months: string[]; // 'YYYY-MM' axis, ascending
  series: BeltBandSeries[]; // one per band, data aligned 1:1 to months (null = gap)
  height?: number;
};

// Distinct categorical line hues from the chart-token palette (UI_RULES §Chart Token File — no
// invented hex; there is no White/Purple/Brown token, so the LEGEND labels carry the belt meaning,
// exactly as RetentionEvolutionChart's three lines do). Sliced to the series count: adults uses all
// four, kids the first three. Order is locked to the band order in memberRetentionByBeltSeries.
const BELT_LINE_COLORS = [
  chartTokens.brand, // White
  chartTokens.success, // Blue / Grey-family
  chartTokens.warning, // Purple / Yellow+Orange
  chartTokens.info, // Brown+Black
];

// Churn sits low and base at 0 so month-to-month movement stays legible; cap a touch above the peak
// (next 5%, min 10%). Mirrors RetentionEvolutionChart.churnYDomain.
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

export default function MemberRetentionByBeltChart({
  months,
  series,
  height = 300,
}: MemberRetentionByBeltChartProps) {
  const categories = useMemo(() => months.map((m) => formatMonthShort(m)), [months]);
  const tooltipLabels = useMemo(() => months.map((m) => formatMonthLong(m)), [months]);

  const colors = useMemo(() => BELT_LINE_COLORS.slice(0, series.length), [series.length]);

  // Y-domain spans every visible line so no band line is clipped (nulls excluded).
  const domainValues = useMemo(() => {
    const vals: number[] = [];
    for (const s of series) for (const v of s.data) if (v != null) vals.push(v);
    return vals;
  }, [series]);
  const { min: yMin, max: yMax } = useMemo(() => churnYDomain(domainValues), [domainValues]);

  // Per-series mean (nulls excluded) for the legend label — same affordance as the sibling chart.
  const legendAverages = useMemo<(number | null)[]>(
    () =>
      series.map((s) => {
        const present = s.data.filter((v): v is number => v != null);
        if (present.length === 0) return null;
        return Math.round(present.reduce((sum, v) => sum + v, 0) / present.length);
      }),
    [series],
  );

  const apexSeries = useMemo(
    () => series.map((s) => ({ name: s.band, data: s.data })),
    [series],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: 'line',
        height,
        fontFamily: 'Outfit, sans-serif',
        toolbar: { show: false },
        accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
        zoom: { enabled: false },
        sparkline: { enabled: false },
        animations: { enabled: true },
      },
      colors,
      // CRITICAL (#499): for a `type: 'line'` series ApexCharts maps fill.opacity onto the line
      // STROKE's alpha — opacity:0 renders every line invisible. Clean opaque lines, no fills.
      fill: { type: 'solid', opacity: 1 },
      stroke: { width: 2, curve: 'straight', lineCap: 'butt', dashArray: 0 },
      dataLabels: { enabled: false },
      markers: {
        size: 0,
        hover: { sizeOffset: 6 },
        strokeColors: '#FFFFFF',
        strokeWidth: 2,
        fillOpacity: 1,
        colors,
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
          // The band name is the row label; the value is the trailing-3mo churn percent. An absent
          // cell is a gap → render an em dash, never 0%.
          formatter: (value: number | null) => (value == null ? '—' : `${value}%`),
        },
        marker: { show: true },
      },
      legend: {
        show: true,
        position: 'top',
        horizontalAlign: 'left',
        fontFamily: 'Outfit, sans-serif',
        fontSize: '12px',
        labels: { colors: chartTokens.chartTextStrong },
        markers: { size: 6, shape: 'circle' },
        itemMargin: { horizontal: 10, vertical: 4 },
        // Append the per-band mean (e.g. "White (Avg 9%)") without renaming the series — the series
        // name is the tooltip row label, so renaming would pollute hover tooltips.
        formatter: (seriesName: string, opts?: { seriesIndex?: number }) => {
          const avg = legendAverages[opts?.seriesIndex ?? -1];
          return avg == null ? seriesName : `${seriesName} (Avg ${avg}%)`;
        },
      },
    }),
    [categories, tooltipLabels, colors, yMin, yMax, height, legendAverages],
  );

  return (
    <ReactApexChart
      key={`belt-${series.length}`}
      options={options}
      series={apexSeries}
      type="line"
      height={height}
    />
  );
}
