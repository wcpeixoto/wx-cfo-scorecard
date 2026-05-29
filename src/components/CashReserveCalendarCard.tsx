/**
 * CashReserveCalendarCard — historical "which months drain operating cash"
 *
 * Replaces the prior SeasonalityCard in the same Big Picture slot. Keeps
 * the same card chrome, x-axis month labels, and grid/baseline feel.
 * Everything else (title, subtitle, series, bar colors, advice copy) is
 * new and driven by `computeCashReserveCalendar`.
 *
 * Chart shape (single series of |avgNetCash| points):
 *   • A bar renders only for months whose tier is `constrain` or
 *     `watch`. Healthy months are `null` so ApexCharts skips them
 *     entirely, leaving a clean gap above the zero baseline.
 *   • Bars POINT UPWARD even though they represent cash drain — the
 *     label above each bar shows the true negative dollar value
 *     (`-$5.0K`) using the project's `formatCompact` helper.
 *   • Per-bar colors via `plotOptions.bar.distributed: true` so each
 *     bar's color comes from the `colors` array indexed by month:
 *     `chartTokens.error` for constrain, `chartTokens.costSpike` for
 *     watch. No new color tokens introduced.
 *
 * Low-data state:
 *   • Fewer than 24 completed months → no chart, locked copy.
 */

import { useId, useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { MonthlyRollup } from '../lib/data/contract';
import {
  computeCashReserveCalendar,
  type CashReserveTier,
} from '../lib/kpis/cashReserveCalendar';
import { chartTokens } from '../lib/ui/chartTokens';
import { formatCompact } from '../lib/utils/formatCompact';

type Props = {
  monthlyRollups: MonthlyRollup[];
  /** Override for tests / storybook. Defaults to live "now". */
  referenceDate?: Date;
};

const CHART_HEIGHT = 200;

/**
 * Bar color per month tier. Healthy months never reach the chart
 * (their data values are null) — they get a transparent slot in the
 * colors array purely so the `colors` array length matches the data
 * length, which is what ApexCharts uses to bind colors when
 * `distributed: true`.
 */
const COLOR_BY_TIER: Record<CashReserveTier, string> = {
  constrain: chartTokens.error,     // strong red — "dark red"
  watch: chartTokens.costSpike,     // softer red — same token used for cost-spike sparklines elsewhere
  healthy: 'transparent',
};

export default function CashReserveCalendarCard({ monthlyRollups, referenceDate }: Props) {
  const tooltipId = useId();
  const result = useMemo(
    () => computeCashReserveCalendar(monthlyRollups, referenceDate),
    [monthlyRollups, referenceDate],
  );

  const header = (
    <div className="crc-header">
      <div className="crc-title-row">
        <h3 className="crc-title">Cash reserve calendar</h3>
        <div className="db-tooltip-wrap">
          <button
            type="button"
            className="db-tooltip-btn"
            aria-label="Cash reserve calendar explanation"
            aria-describedby={tooltipId}
          >
            &#9432;
          </button>
          <div id={tooltipId} role="tooltip" className="db-tooltip-panel crc-tooltip-panel">
            <ul className="db-tooltip-list">
              <li className="db-tooltip-body">
                Months where operating cash usually goes negative. Bars
                show the average cash drain over the last 24 months.
              </li>
            </ul>
          </div>
        </div>
      </div>
      <p className="crc-subtitle">Know when your reserve is most at risk</p>
    </div>
  );

  if (result.state === 'low-data') {
    return (
      <article className="crc-card">
        {header}
        <div className="crc-empty">
          Not enough history yet to flag drain months. Once there are at
          least two years of complete monthly data, this card can show
          which calendar months historically pull cash down.
        </div>
      </article>
    );
  }

  const categories = result.byMonth.map((m) => m.shortLabel);

  // Bars point upward; healthy months render no bar (null).
  const drainData: (number | null)[] = result.byMonth.map((m) =>
    m.tier === 'healthy' ? null : Math.abs(m.avgNetCash),
  );

  // Per-bar colors aligned by index with the data array.
  const colors = result.byMonth.map((m) => COLOR_BY_TIER[m.tier]);

  // Pre-compute the signed string for each month so the data-label
  // formatter can look it up by data point index (the formatter only
  // receives the positive `val`, but we want to render the negative).
  const dataLabelByIndex: string[] = result.byMonth.map((m) =>
    m.tier === 'healthy' ? '' : formatCompact(-Math.abs(m.avgNetCash)),
  );

  const options: ApexOptions = {
    chart: {
      type: 'bar',
      stacked: false,
      toolbar: { show: false },
      accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
      fontFamily: 'Outfit, sans-serif',
      background: 'transparent',
      animations: { enabled: false },
    },
    colors,
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '55%',
        borderRadius: 3,
        borderRadiusApplication: 'end',
        // distributed: each bar takes its color from the colors[] array
        // by data-point index. Without this, ApexCharts would apply
        // colors[0] to the whole series.
        distributed: true,
        dataLabels: { position: 'top' },
      },
    },
    dataLabels: {
      enabled: true,
      formatter: (_val, opts) => {
        const idx = opts?.dataPointIndex;
        if (typeof idx !== 'number') return '';
        return dataLabelByIndex[idx] ?? '';
      },
      // Font / size / weight / color match OwnerDistributionsChart's
      // stacked-total label exactly so the two bar-chart cards read as a
      // single family. The #475467 hex is the UI_RULES tooltip
      // series-text color (Part 4) — used inline here to match OD's
      // existing pattern; not yet promoted to chartTokens.
      //
      // offsetY note: OD uses plotOptions.bar.dataLabels.total with
      // offsetY=-4; that's a stack-total label whose default position
      // already sits above the column. Per-point dataLabels here render
      // *at* the bar top by default — so to reproduce OD's ~6px visual
      // gap between bar top and label bottom, we shift further up.
      // Measured empirically: bar/label DOM rects match OD's gap at this
      // value.
      offsetY: -22,
      style: {
        fontSize: '11px',
        fontWeight: 500,
        fontFamily: 'Outfit, sans-serif',
        colors: ['#475467'],
      },
    },
    stroke: { show: true, width: 1, colors: ['transparent'] },
    legend: { show: false },
    grid: {
      borderColor: chartTokens.gridBorder,
      strokeDashArray: 4,
      padding: { top: 8, right: 4, bottom: 0, left: 4 },
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { fontSize: '11px', colors: chartTokens.axisText } },
      // Suppress the slot crosshair — `distributed` already gives per-bar
      // hover feedback via the marker fill.
      crosshairs: { show: false },
    },
    yaxis: {
      labels: { show: false },
      // min:0 keeps the zero/normal baseline flush at the bottom and
      // stops Apex from auto-centering when only a few non-null points
      // exist.
      min: 0,
      forceNiceScale: true,
    },
    states: {
      hover: { filter: { type: 'none' } },
      active: { filter: { type: 'none' } },
    },
    tooltip: {
      theme: 'light',
      shared: false,
      intersect: true,
      y: {
        formatter: (_val, opts) => {
          const idx = opts?.dataPointIndex;
          if (typeof idx !== 'number') return '';
          return dataLabelByIndex[idx] ?? '';
        },
        title: { formatter: () => 'Avg net cash' },
      },
    },
  };

  const series = [{ name: 'Cash drain', data: drainData }];

  return (
    <article className="crc-card">
      {header}

      <div className="crc-chart">
        <ReactApexChart options={options} series={series} type="bar" height={CHART_HEIGHT} />
      </div>

      <div className="crc-advice">
        <div className="crc-advice-label">What to do</div>
        <p className="crc-advice-body">{result.advice}</p>
      </div>
    </article>
  );
}
