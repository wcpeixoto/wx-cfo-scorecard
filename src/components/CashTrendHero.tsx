/**
 * CashTrendHero — Cash Trend macro signal card (Pattern B)
 *
 * Half-width card on Big Picture, paired with CashTrendPlaceholder. Status
 * accent flows through child elements via the --cth-accent CSS custom
 * property set per status modifier class.
 *
 * Body content: dominant metric line, status-driven interpretation line,
 * and a single proof line. A compact area sparkline sits in the right
 * column of the header — a STRAIGHT two-point result line from a $0
 * baseline to t6mMargin. The chart's only job is to support the hero
 * number: positive 6-month margin slopes up, negative slopes down,
 * near-zero renders flat. Color is keyed off the same margin sign
 * (brand blue / error red / neutral). No visible label above the
 * sparkline; the chart container carries a three-state accessible name
 * instead (net positive / net negative / net flat).
 *
 * Layout is a 2-column CSS grid on .cth-card. Row 1: title block (col 1)
 * + pill (col 2). Row 2: metric block (col 1, bottom-aligned) + sparkline
 * (col 2, bottom-aligned + right-aligned). Row 3: verdict, spans both
 * columns. The bottom alignment in row 2 puts the sparkline's bottom on
 * the same baseline as the "6-month cumulative profit margin" supporting
 * line, with no overlap (separate grid cells) and no hard-coded offsets.
 * Container query at ≤380px hides the sparkline so narrow viewports can't
 * collide with text. The negativeMonthsAsSubtitle=false branch is still
 * compiled but is not a supported production layout — its optional
 * .cth-stat-block lands in row 4 spanning both columns.
 *
 * Interaction model: ⓘ tooltip only.
 */

import { useId } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type {
  CashTrendResult,
  CashTrendStatus,
} from '../lib/kpis/cashTrend';
import { formatCompact } from '../lib/utils/formatCompact';
import { chartTokens } from '../lib/ui/chartTokens';

const TREND_MIN_MONTHS = 6;

// Below this absolute decimal margin the chart renders flat and grey.
// Matches formatSignedPct's "0.0%" rounding cutoff (|pct| < 0.05 →
// "0.0%"), so any margin that displays as a non-zero percentage in the
// hero text also slopes visibly in the sparkline.
const NEAR_ZERO_MARGIN = 0.0005;

// Y-axis half-range floor. Without this, a tiny but non-flat margin
// would be padded into a near-edge line; with it, small margins still
// render close to the center line. 0.02 = 2 percentage points, large
// enough that a +0.5% margin slopes gently rather than sharply.
const MIN_Y_HALF_RANGE = 0.02;

type Props = {
  result: CashTrendResult;
  negativeMonthsAsSubtitle?: boolean;
};

const BADGE_BY_STATUS: Record<CashTrendStatus, { label: string; cls: string }> = {
  building: { label: 'Building Cash',  cls: 'is-healthy' },
  treading: { label: 'Treading Water', cls: 'is-warning' },
  pressure: { label: 'Under Pressure', cls: 'is-pressure' },
  burning:  { label: 'Burning Cash',   cls: 'is-critical' },
};

function formatSignedCompact(n: number): string {
  if (n === 0) return '$0';
  const sign = n > 0 ? '+' : '-';
  return `${sign}${formatCompact(Math.abs(n))}`;
}

function formatSignedPct(decimal: number): string {
  const pct = decimal * 100;
  if (Math.abs(pct) < 0.05) return '0.0%';
  const sign = pct > 0 ? '+' : '-';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function ariaLabelForResult(margin: number): string {
  if (Math.abs(margin) < NEAR_ZERO_MARGIN) {
    return '6-month cash result — net flat';
  }
  if (margin > 0) {
    return '6-month cash result — net positive';
  }
  return '6-month cash result — net negative';
}

function CashTrendSparkline({ margin }: { margin: number }) {
  // Color tied to the hero result, three-state: positive → brand blue,
  // negative → error red, near-zero → neutral grey. The slope-based color
  // rule and the per-month "sharp deterioration" signal were intentionally
  // dropped along with the cumulative trajectory — the chart's only job
  // now is to support the hero number's direction. The pill carries the
  // status nuance (Building / Treading / Pressure / Burning).
  const isFlat = Math.abs(margin) < NEAR_ZERO_MARGIN;
  const color = isFlat
    ? chartTokens.neutral
    : margin > 0
      ? chartTokens.brand
      : chartTokens.error;

  // Straight two-point line — [$0 baseline, t6mMargin]. Slope direction
  // and steepness both follow the margin value: positive margin slopes
  // up, negative slopes down, and a near-zero margin (below the display
  // rounding cutoff) renders flat at the baseline.
  const series = [0, isFlat ? 0 : margin];

  // Y-axis symmetric around 0 so the visual baseline is the center line
  // and slope direction reads as "ends above center" vs "ends below
  // center". Half-range floors at MIN_Y_HALF_RANGE so tiny margins don't
  // get padded into a near-edge line.
  const halfRange = Math.max(Math.abs(margin), MIN_Y_HALF_RANGE);
  const chartMin = -halfRange * 1.15;
  const chartMax = halfRange * 1.15;

  const options: ApexOptions = {
    chart: {
      type: 'area',
      height: 70,
      fontFamily: 'Outfit, sans-serif',
      sparkline: { enabled: true },
      toolbar: { show: false },
      accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
      animations: { enabled: false },
    },
    // Anchor the area's lower edge at the chart canvas bottom (= the
    // sparkline container bottom = the supporting-metric baseline)
    // instead of the Apex default of zero. With the y-axis padded below
    // the line, the default-baseline fill would collapse to a sliver;
    // `fillTo: 'end'` makes it a proper trapezoid anchored to the line,
    // fading down via the gradient below.
    plotOptions: {
      area: {
        fillTo: 'end',
      },
    },
    // Straight stroke between the two points — no smoothing. The chart
    // is a single result line, not a trajectory, so any curve treatment
    // would invent shape information the data doesn't carry.
    stroke: { curve: 'straight', width: 2, colors: [color] },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.6,
        opacityTo: 0,
        stops: [0, 100],
      },
    },
    colors: [color],
    dataLabels: { enabled: false },
    markers: { size: 0 },
    grid: { show: false },
    xaxis: { labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { min: chartMin, max: chartMax, labels: { show: false } },
    tooltip: { enabled: false },
    legend: { show: false },
  };

  return (
    <div
      className="cth-trend-sparkline"
      role="img"
      aria-label={ariaLabelForResult(margin)}
    >
      <ReactApexChart options={options} series={[{ data: series }]} type="area" height={70} />
    </div>
  );
}

export function CashTrendPlaceholder() {
  return (
    <div className="cth-placeholder">
      <span className="cth-placeholder-text">Coming soon</span>
    </div>
  );
}

export default function CashTrendHero({ result, negativeMonthsAsSubtitle = false }: Props) {
  const tooltipId = useId();
  if (result.noData) {
    return (
      <div className="cth-card cth-card--treading">
        <div className="cth-header-left">
          <h3 className="cth-title">Cash Trend</h3>
          <p className="cth-subtitle">Last 6 complete months</p>
        </div>
        <div className="cth-empty">
          Not enough complete months yet to evaluate cash trend. Need at least 3 closed months.
        </div>
      </div>
    );
  }

  const { status } = result;
  const badge = BADGE_BY_STATUS[status];

  const netCashFormatted = formatSignedCompact(result.t6mNetCash);
  const marginFormatted = formatSignedPct(result.t6mMargin);
  const totalMonths = result.monthlyBars.length || 6;
  const showTrendLine = result.monthlyBars.length >= TREND_MIN_MONTHS;

  const infoTooltip = (
    <div className="db-tooltip-wrap">
      <button
        type="button"
        className="db-tooltip-btn cth-info-icon"
        aria-label="Cash Trend explanation"
        aria-describedby={tooltipId}
      >
        &#9432;
      </button>
      <div id={tooltipId} role="tooltip" className="db-tooltip-panel is-wide">
        <ul className="db-tooltip-list">
          <li><strong>What it shows</strong></li>
          <li className="db-tooltip-body">Whether the business is building cash or operating too close to the edge.</li>
          <li><strong>How it's calculated</strong></li>
          <li className="db-tooltip-body">Net cash accumulated over the last 6 complete months; margin is that cash as a percent of revenue.</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className={`cth-card cth-card--${status}${negativeMonthsAsSubtitle ? ' cth-card--inline-stat' : ''}`}>

      {/* Row 1 — title block (col 1) + pill (col 2) */}
      <div className="cth-header-left">
        <div className="cth-title-row">
          <h3 className="cth-title">Cash Trend</h3>
          {negativeMonthsAsSubtitle && infoTooltip}
        </div>
        <p className="cth-subtitle">
          {negativeMonthsAsSubtitle
            ? `${result.negativeMonthCount} of the last ${totalMonths} months were negative`
            : 'Last 6 complete months'}
        </p>
      </div>
      <div className="cth-header-right">
        <span className={`card-status-badge ${badge.cls}`}>
          {badge.label}
        </span>
        {!negativeMonthsAsSubtitle && infoTooltip}
      </div>

      {/* Row 2 — metric block (col 1, bottom-aligned) + sparkline (col 2,
          bottom-aligned). Sparkline hides on narrow widths via @container. */}
      <div className="cth-body-left">
        <div className="cth-metric-primary">
          <span className="cth-metric-amount">{netCashFormatted}</span>
          <span className="cth-metric-noun">net cash</span>
        </div>
        <div className="cth-metric-secondary">
          6-month cumulative profit margin: <span className="cth-metric-margin">{marginFormatted}</span>
        </div>
      </div>
      {showTrendLine && (
        <CashTrendSparkline margin={result.t6mMargin} />
      )}

      {/* Row 3 — verdict, spans both columns */}
      <div className="cth-interpretation">{result.interpretation}</div>

      {/* Row 4 — optional mini-stat (non-production branch only) */}
      {!negativeMonthsAsSubtitle && (
        <div className="cth-stat-block">
          <div className="cth-stat-number">{result.negativeMonthCount} of {totalMonths}</div>
          <div className="cth-stat-label">negative months</div>
        </div>
      )}

    </div>
  );
}
