/**
 * CashTrendHero — Cash Trend macro signal card
 *
 * Top of the Big Picture signal hierarchy. Consumes CashTrendResult from
 * computeCashTrend. Status drives accent color via CSS modifier classes.
 *
 * Interaction model: ⓘ tooltip only. No row clicks, no title clicks.
 * Matches the locked Cost Spikes interaction pattern.
 */

import { useEffect, useRef, useState } from 'react';
import type {
  CashTrendBar,
  CashTrendResult,
  CashTrendStatus,
  VelocityTag,
} from '../lib/kpis/cashTrend';
import { formatCompact } from '../lib/utils/formatCompact';

type Props = {
  result: CashTrendResult;
};

const HEADLINE_BY_STATUS: Record<CashTrendStatus, string> = {
  building: 'Building cash over the last 6 months',
  treading: 'Treading water over the last 6 months',
  pressure: 'Under pressure over the last 6 months',
  burning: 'Burning cash over the last 6 months',
};

const VELOCITY_COPY: Record<VelocityTag, string> = {
  improving: 'Margin is improving vs the prior 6 months.',
  softer: 'Margin is softer vs the prior 6 months.',
  stable: 'Margin is stable vs the prior 6 months.',
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

const TOOLTIP_TEXT =
  'T6M = the trailing six complete months. ' +
  'Six months smooths out single-month timing — a big invoice, a slow week, a one-off bill. ' +
  'The 10% target is the margin needed to fund reserve building and reinvestment, not just to break even.';

function MiniBars({ bars }: { bars: CashTrendBar[] }) {
  if (bars.length === 0) return null;

  // Layout
  const width = 240;
  const height = 64;
  const barGap = 8;
  const barWidth = (width - barGap * (bars.length - 1)) / bars.length;
  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.netCash)));
  const zeroY = height / 2;
  const maxBarHeight = height / 2 - 2;

  return (
    <svg
      className="cth-bars-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Net cash by month, last 6 months"
    >
      {bars.map((bar, i) => {
        const magnitude = Math.abs(bar.netCash) / maxAbs;
        const h = Math.max(2, magnitude * maxBarHeight);
        const x = i * (barWidth + barGap);
        const y = bar.isNegative ? zeroY : zeroY - h;
        const fill = bar.isNegative ? '#F04438' : '#12B76A';
        return (
          <rect
            key={bar.month}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            rx={2}
            fill={fill}
          >
            <title>{`${bar.label}: ${formatSignedCompact(bar.netCash)}`}</title>
          </rect>
        );
      })}
    </svg>
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
          <span className="cth-title">Cash Trend</span>
        </div>
        <div className="cth-empty">
          Not enough complete months yet to evaluate cash trend. Need at least 3 closed months.
        </div>
      </div>
    );
  }

  const { status, velocityTag, gap } = result;
  const headline = HEADLINE_BY_STATUS[status];
  const velocityText = VELOCITY_COPY[velocityTag];

  const metricLine = `${formatSignedCompact(result.t6mNetCash)} net cash · ${formatSignedPct(result.t6mMargin)} of revenue`;
  const proofLine = `${result.negativeMonthCount} of ${result.monthlyBars.length} months were negative`;
  const gapClass = gap >= 0 ? 'cth-gap--positive' : 'cth-gap--accent';

  return (
    <div className={`cth-card cth-card--${status}`} ref={cardRef}>

      <div className="cth-header">
        <span className="cth-title">Cash Trend</span>
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

      <div className="cth-headline">{headline}</div>

      <div className="cth-metric-line">{metricLine}</div>

      <div className={`cth-velocity-line cth-velocity--${velocityTag}`}>
        {velocityText}
      </div>

      <div className="cth-proof-line">{proofLine}</div>

      <div className="cth-target-line">
        <span className="cth-target-label">
          Target: 10% to fund reserve + reinvestment
        </span>
        <span className="cth-target-sep"> · </span>
        <span className={`cth-gap ${gapClass}`}>
          Gap: {formatSignedCompact(gap)}
        </span>
      </div>

      <div className="cth-bars">
        <MiniBars bars={result.monthlyBars} />
      </div>

    </div>
  );
}
