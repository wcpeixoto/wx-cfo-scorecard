/**
 * CashTrendHero — Cash Trend macro signal card (Pattern B)
 *
 * Half-width card on Big Picture, paired with CashTrendPlaceholder. Status
 * accent flows through child elements via the --cth-accent CSS custom
 * property set per status modifier class.
 *
 * Body content: dominant metric line, status-driven interpretation line,
 * and a single proof line. A compact area sparkline sits in the right
 * column of the header rendering the actual 6 monthly net-cash values;
 * it carries one signal only — is the 6-month direction worsening? —
 * leaving the pill to carry state. No visible label above the sparkline;
 * the chart container carries a three-state accessible name instead
 * (worsening / improving / stable).
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

// Mirror of the worsening threshold, used only for the three-state
// accessible label (worsening / improving / stable). The visual stays
// two-color (red below the worsening threshold, brand-blue otherwise);
// the assistive label gets the extra "improving" state so screen-reader
// and color-blind users hear direction without requiring a visible green.
const IMPROVING_SLOPE_PER_MONTH = 1500;

const TREND_MIN_MONTHS = 6;

// Flat-fallback threshold (dollars). The sparkline shows the linear
// best-fit trend over 6 months; "flat" means the trend's total movement
// across the window — |slope| × 6 — is under $500. That's a trend so
// shallow it isn't worth amplifying as a visible diagonal: render a
// centered horizontal line at the trend midpoint instead. Rendering-only
// — independent of the slope-based color rule above. (Math note:
// |slope|×6 < $500 implies |slope| < ~$83/mo, well below the worsening
// threshold of -$1,500/mo. Flat and red cannot co-occur on real data;
// the independence is a property of the code paths, not an observed
// combination.)
const FLAT_RANGE_THRESHOLD = 500;
const FLAT_VISUAL_HALF_WINDOW = 1000;

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

function ariaLabelForSlope(slope: number): string {
  if (slope <= WORSENING_SLOPE_PER_MONTH) {
    return 'Cash trend over 6 months — direction worsening';
  }
  if (slope >= IMPROVING_SLOPE_PER_MONTH) {
    return 'Cash trend over 6 months — direction improving';
  }
  return 'Cash trend over 6 months — stable';
}

function CashTrendSparkline({ bars }: { bars: CashTrendBar[] }) {
  const values = bars.map((b) => b.netCash);
  const { slope, intercept } = leastSquaresSlope(values);
  const isWorsening = slope <= WORSENING_SLOPE_PER_MONTH;
  const color = isWorsening ? chartTokens.error : chartTokens.brand;

  // Best-fit endpoints — the entire visual is the linear trend, not the
  // monthly noise. The neighbor "Monthly Profit" chart already
  // carries the month-by-month shape; this card communicates direction.
  const n = values.length;
  const startY = intercept;
  const endY = intercept + (n - 1) * slope;

  // Flat-rule: total movement across the 6-month window. Compared against
  // FLAT_RANGE_THRESHOLD ($500) so a near-zero slope doesn't get amplified
  // into a visible diagonal by the 15%-padded y-axis.
  const visualTraversal = Math.abs(slope) * 6;
  const isFlat = visualTraversal < FLAT_RANGE_THRESHOLD;

  let series: number[];
  let chartMin: number;
  let chartMax: number;
  if (isFlat) {
    const mid = (startY + endY) / 2;
    series = [mid, mid];
    chartMin = mid - FLAT_VISUAL_HALF_WINDOW;
    chartMax = mid + FLAT_VISUAL_HALF_WINDOW;
  } else {
    series = [startY, endY];
    // Y-axis anchored to the RAW monthly values (not the best-fit
    // endpoint range), so visual magnitude tracks the dollars the
    // business actually moves month-to-month — not the slope's own
    // narrow internal range. A modest slope on noisy data renders as
    // a near-flat line within a wide window; a strong slope still
    // looks strong because the endpoints span more of the same window.
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const rawRange = rawMax - rawMin;
    if (rawRange === 0) {
      // Defensive: all 6 values identical → slope is 0 → the isFlat
      // branch above already handles this. Guard left in to avoid a
      // degenerate zero-padding y-axis if that invariant ever shifts.
      const mid = (startY + endY) / 2;
      chartMin = mid - FLAT_VISUAL_HALF_WINDOW;
      chartMax = mid + FLAT_VISUAL_HALF_WINDOW;
    } else {
      chartMin = rawMin - 0.15 * rawRange;
      chartMax = rawMax + 0.15 * rawRange;
    }
  }

  const options: ApexOptions = {
    chart: {
      type: 'area',
      height: 70,
      fontFamily: 'Outfit, sans-serif',
      sparkline: { enabled: true },
      toolbar: { show: false },
      animations: { enabled: false },
    },
    // Anchor the area's lower edge at the chart canvas bottom (= the
    // sparkline container bottom = the supporting-metric baseline)
    // instead of the Apex default of zero. With the raw-anchored y-axis
    // (chartMin well below the line), the default-baseline fill would
    // collapse to a sliver; `fillTo: 'end'` makes it a proper trapezoid
    // anchored to the line, fading down via the gradient below.
    plotOptions: {
      area: {
        fillTo: 'end',
      },
    },
    // Two-point best-fit line — straight by construction; smoothing has no
    // effect on a single segment, declared `straight` for clarity.
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
      aria-label={ariaLabelForSlope(slope)}
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
