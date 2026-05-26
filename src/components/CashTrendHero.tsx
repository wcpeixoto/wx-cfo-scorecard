/**
 * CashTrendHero — Cash Trend macro signal card (Pattern B)
 *
 * Half-width card on Big Picture, paired with CashTrendPlaceholder. Status
 * accent flows through child elements via the --cth-accent CSS custom
 * property set per status modifier class.
 *
 * Body content: dominant metric line, status-driven interpretation line,
 * and a single proof line. A compact best-fit trend line sits under the
 * status pill on the right; it carries one signal only — is the 6-month
 * direction worsening? — leaving the pill to carry state.
 *
 * Interaction model: ⓘ tooltip only.
 */

import { useId } from 'react';
import type {
  CashTrendBar,
  CashTrendResult,
  CashTrendStatus,
} from '../lib/kpis/cashTrend';
import { formatCompact } from '../lib/utils/formatCompact';

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
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function CashTrendCompactLine({ bars }: { bars: CashTrendBar[] }) {
  const W = 132;
  const H = 36;
  const PAD = 4;
  const innerW = W - 2 * PAD;
  const innerH = H - 2 * PAD;
  const values = bars.map((b) => b.netCash);
  const { slope, intercept } = leastSquaresSlope(values);
  const lastIdx = values.length - 1;
  const y0 = intercept;
  const yN = intercept + lastIdx * slope;
  const lo = Math.min(...values, y0, yN);
  const hi = Math.max(...values, y0, yN);
  const range = hi - lo || 1;
  const mapY = (v: number) => PAD + innerH * (1 - (v - lo) / range);
  const isWorsening = slope <= WORSENING_SLOPE_PER_MONTH;
  return (
    <svg
      className={`cth-trend-line${isWorsening ? ' is-worsening' : ''}`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
    >
      <line
        x1={PAD}
        y1={mapY(y0)}
        x2={PAD + innerW}
        y2={mapY(yN)}
        strokeWidth={1.75}
        strokeLinecap="round"
      />
    </svg>
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
        <div className="cth-header">
          <div className="cth-header-left">
            <h3 className="cth-title">Cash Trend</h3>
            <p className="cth-subtitle">Last 6 complete months</p>
          </div>
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

      {/* ── Header (Pattern B) ────────────────────────────────────────── */}
      <div className="cth-header">
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
          {showTrendLine && (
            <div className="cth-trend-block">
              <span className="cth-trend-eyebrow">Trend</span>
              <CashTrendCompactLine bars={result.monthlyBars} />
            </div>
          )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="cth-body">
        <div className="cth-body-left">
          <div className="cth-metric-primary">
            <span className="cth-metric-amount">{netCashFormatted}</span>
            <span className="cth-metric-noun">net cash</span>
          </div>
          <div className="cth-metric-secondary">
            6-month cumulative profit margin: <span className="cth-metric-margin">{marginFormatted}</span>
          </div>
          <div className="cth-interpretation">{result.interpretation}</div>
        </div>
        {!negativeMonthsAsSubtitle && (
          <div className="cth-stat-block">
            <div className="cth-stat-number">{result.negativeMonthCount} of {totalMonths}</div>
            <div className="cth-stat-label">negative months</div>
          </div>
        )}
      </div>

    </div>
  );
}
