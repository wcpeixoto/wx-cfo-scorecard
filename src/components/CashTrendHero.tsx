/**
 * CashTrendHero — Cash Trend macro signal card (Pattern B)
 *
 * Half-width card on Big Picture, paired with CashTrendPlaceholder. Status
 * accent flows through child elements via the --cth-accent CSS custom
 * property set per status modifier class.
 *
 * Body content: dominant metric line, status-driven interpretation line,
 * and a single proof line. No chart, no target, no gap, no velocity copy
 * — those concerns live elsewhere on the page (Monthly Net Cash Flow chart,
 * workspace settings target).
 *
 * Interaction model: ⓘ tooltip only.
 */

import { useId } from 'react';
import type {
  CashTrendResult,
  CashTrendStatus,
} from '../lib/kpis/cashTrend';
import { formatCompact } from '../lib/utils/formatCompact';

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
          <li>Cash Trend shows whether the business is building cash or operating too close to the edge.</li>
          <li>If this card shows pressure, look below for cost spikes and efficiency gaps.</li>
          <li>Net cash shows how much cash the business accumulated in the last 6 complete months. Margin shows that cash as a percent of revenue over the same period.</li>
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
