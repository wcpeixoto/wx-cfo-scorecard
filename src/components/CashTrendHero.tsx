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

import { useEffect, useRef, useState } from 'react';
import type {
  CashTrendResult,
  CashTrendStatus,
} from '../lib/kpis/cashTrend';
import { formatCompact } from '../lib/utils/formatCompact';

type Props = {
  result: CashTrendResult;
};

const BADGE_BY_STATUS: Record<CashTrendStatus, { label: string; cls: string }> = {
  building: { label: 'Building Cash',  cls: 'is-healthy' },
  treading: { label: 'Treading Water', cls: 'is-warning' },
  pressure: { label: 'Under Pressure', cls: 'is-pressure' },
  burning:  { label: 'Burning Cash',   cls: 'is-critical' },
};

const TOOLTIP_TEXT =
  'T6M = the trailing six complete months. Six months smooths out single-month ' +
  'timing — a big invoice, a slow week, a one-off bill — so you see the ' +
  'underlying trajectory, not the noise.\n\n' +
  'The current calendar month is excluded because it is incomplete.';

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

export default function CashTrendHero({ result }: Props) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tooltipOpen) return;
    function handleOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setTooltipOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [tooltipOpen]);

  if (result.noData) {
    return (
      <div className="cth-card cth-card--treading" ref={cardRef}>
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

  const metricLine = `${formatSignedCompact(result.t6mNetCash)} net cash · ${formatSignedPct(result.t6mMargin)} margin`;
  const proofLine = `${result.negativeMonthCount} of ${result.monthlyBars.length || 6} months were negative`;

  return (
    <div className={`cth-card cth-card--${status}`} ref={cardRef}>

      {/* ── Header (Pattern B) ────────────────────────────────────────── */}
      <div className="cth-header">
        <div className="cth-header-left">
          <h3 className="cth-title">Cash Trend</h3>
          <p className="cth-subtitle">Last 6 complete months</p>
        </div>
        <div className="cth-header-right">
          <span className={`card-status-badge ${badge.cls}`}>
            {badge.label}
          </span>
          <span className="cth-info-wrap">
            <button
              type="button"
              className="cth-info-btn"
              aria-label="Explain Cash Trend"
              onClick={(e) => {
                e.stopPropagation();
                setTooltipOpen((v) => !v);
              }}
            >ⓘ</button>
            {tooltipOpen && (
              <div className="explain-tooltip cth-tooltip" role="tooltip">
                {TOOLTIP_TEXT}
              </div>
            )}
          </span>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="cth-body">
        <div className="cth-metric-line">{metricLine}</div>
        <div className="cth-interpretation">{result.interpretation}</div>
        <div className="cth-proof-line">{proofLine}</div>
      </div>

    </div>
  );
}
