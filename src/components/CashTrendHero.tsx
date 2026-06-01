/**
 * CashTrendHero — Cash Trend macro signal card (Pattern B)
 *
 * Half-width card on Big Picture, paired with CashTrendPlaceholder. Status
 * accent flows through child elements via the --cth-accent CSS custom
 * property set per status modifier class.
 *
 * Body content: dominant metric line, status-driven interpretation line,
 * and a single proof line. A compact area sparkline sits in the right
 * column of the header rendering the running CUMULATIVE net cash over
 * the same 6 months — the chart's end-point matches the direction of
 * the hero number (t6mNetCash) so the visual reinforces the headline
 * instead of carrying an independent slope signal. Color stays driven
 * by the monthly best-fit slope (red below the worsening threshold,
 * brand-blue otherwise) so a positive cumulative with a sharply
 * deteriorating month-over-month trend still reads as a warning.
 * No visible label above the sparkline; the chart container carries a
 * three-state accessible name instead (worsening / improving / stable).
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
  CashTrendBar,
  CashTrendResult,
  CashTrendStatus,
} from '../lib/kpis/cashTrend';
import { formatCompact } from '../lib/utils/formatCompact';
import { chartTokens } from '../lib/ui/chartTokens';

// Slope (dollars per month) at or below which the compact trend line turns
// red. Backtest-justified: 12 successive 6-month windows on the live
// fixture (Jun 2025 → May 2026) produced slopes in [-$1,760, +$2,598]/mo
// with median -$109/mo. At -$1,500, the line flags 3 windows (Jul 2025,
// Dec 2025, Mar 2026) — all visually-bad windows. Tighter thresholds
// (-$2,000) never trigger on this fixture; looser ones (-$1,000) chase
// noise. The line will flicker month-to-month when the underlying data
// flickers; this is the spec's accepted edge case 3 (outlier handling
// deferred).
const WORSENING_SLOPE_PER_MONTH = -1500;

const TREND_MIN_MONTHS = 6;

// Defensive y-axis half-window for the degenerate case where every month
// is exactly zero (cumulative series collapses to a flat 0-line). The
// real series has natural variance and pads from its own min/max — this
// constant only kicks in when rawRange === 0.
const DEGENERATE_Y_HALF_WINDOW = 1000;

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

function leastSquaresSlope(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  // NaN guard: if any input is non-finite, treat the trend as flat rather
  // than poisoning slope + intercept with NaN values downstream.
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(values[i])) return { slope: 0, intercept: 0 };
  }
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  // den = sum((i - xMean)^2) over [0, n-1] with n >= 2 is always > 0, so
  // the prior `den === 0 ? 0 : num / den` branch was unreachable.
  const slope = num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function ariaLabelForCumulative(cumulative: number[]): string {
  const end = cumulative[cumulative.length - 1] ?? 0;
  // Scale the per-month worsening threshold (-$1,500/mo) to the full
  // 6-month window so the three-state label tracks the cumulative
  // end-point at the same magnitude the color rule uses for monthly
  // slope. Improving threshold mirrors the worsening one (symmetric).
  const sigThreshold = Math.abs(WORSENING_SLOPE_PER_MONTH) * cumulative.length;
  if (end <= -sigThreshold) {
    return 'Cumulative cash over 6 months — direction worsening';
  }
  if (end >= sigThreshold) {
    return 'Cumulative cash over 6 months — direction improving';
  }
  return 'Cumulative cash over 6 months — stable';
}

function CashTrendSparkline({ bars }: { bars: CashTrendBar[] }) {
  // Color rule (unchanged) — least-squares slope of the MONTHLY net-cash
  // values, red below the worsening threshold. Slope is computed on the
  // monthly series, not the cumulative one, so a positive cumulative with
  // a sharply deteriorating month-over-month trend still reads red.
  const monthlyValues = bars.map((b) => b.netCash);
  const { slope } = leastSquaresSlope(monthlyValues);
  const isWorsening = slope <= WORSENING_SLOPE_PER_MONTH;
  const color = isWorsening ? chartTokens.error : chartTokens.brand;

  // Cumulative net cash, one running-sum point per month. The 6th value
  // equals t6mNetCash shown in the hero.
  let cum = 0;
  const cumulative = monthlyValues.map((v) => (cum += v));

  // Plotted series prepends an explicit $0 baseline so the line ALWAYS
  // starts at the visual baseline and finishes at t6mNetCash. Without
  // this, a front-loaded period (e.g. month 1 is the largest gain, later
  // months give some back) plots as `[m1_total, ..., t6mNetCash]` — a
  // peak-then-fade silhouette that can still read as "trending down"
  // even when t6mNetCash > 0. Anchoring at 0 makes the direction
  // visually equivalent to `t6mNetCash` direction: above baseline =
  // positive period, below = negative period.
  const series = [0, ...cumulative];

  // Y-axis spans the full plotted series (including the 0 baseline)
  // with 15% padding on both sides so the line stays off the container
  // edges. 0 is always in range by construction.
  const rawMin = Math.min(...series);
  const rawMax = Math.max(...series);
  const rawRange = rawMax - rawMin;
  const chartMin = rawRange === 0
    ? rawMin - DEGENERATE_Y_HALF_WINDOW
    : rawMin - 0.15 * rawRange;
  const chartMax = rawRange === 0
    ? rawMax + DEGENERATE_Y_HALF_WINDOW
    : rawMax + 0.15 * rawRange;

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
    // Cumulative trajectory — smoothing softens the month-to-month
    // shoulders without inventing data points (Apex `smooth` is a
    // standard spline through the 6 cumulative values).
    stroke: { curve: 'smooth', width: 2, colors: [color] },
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
      aria-label={ariaLabelForCumulative(cumulative)}
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
        <CashTrendSparkline bars={result.monthlyBars} />
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
