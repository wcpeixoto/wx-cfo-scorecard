// OperatingReserveCard — extracted from Dashboard.tsx inline block.
// Receives only the two root values; all derived state is computed internally.

import { useId } from 'react';

const EPSILON = 0.00001;

function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function getReservePercentDisplay(currentCashBalance: number, reserveTarget: number): number | null {
  if (reserveTarget <= EPSILON) return null;
  return Math.round((currentCashBalance / reserveTarget) * 100);
}

function reserveToneClassName(percent: number | null): string {
  if (percent === null) return 'is-neutral';
  if (percent >= 100) return 'is-positive';
  return 'is-caution';
}

// Six-tier reserve pill, classified by funded ratio only (inclusive-lower,
// exclusive-upper). These bands intentionally differ from the priority
// thresholds in signals.ts (RESERVE_CRITICAL_THRESHOLD) — the card surfaces a
// finer-grained label; the priority engine keeps its own coarser signal. Do
// not re-couple them.
function getReserveBadgeState(percentFunded: number | null): { label: string; className: string } {
  if (percentFunded === null) return { label: '—', className: 'card-status-badge is-neutral' };
  if (percentFunded < 0.25) return { label: '↓ Critical', className: 'card-status-badge is-critical' };
  if (percentFunded < 0.50) return { label: '↓ Vulnerable', className: 'card-status-badge is-warning' };
  if (percentFunded < 0.75) return { label: '↓ Below target', className: 'card-status-badge is-warning' };
  if (percentFunded < 1.00) return { label: 'Nearly funded', className: 'card-status-badge is-neutral' };
  if (percentFunded < 1.50) return { label: '✓ Fully funded', className: 'card-status-badge is-healthy' };
  return { label: '✓ Above target', className: 'card-status-badge is-healthy' };
}

function getReserveSubtitle(currentCashBalance: number, reserveTarget: number): string {
  if (reserveTarget <= EPSILON) return '1-month expense goal';
  const gap = reserveTarget - currentCashBalance;
  if (gap <= 0) return 'Reserve goal reached';
  return `${formatCompactCurrency(gap)} to goal`;
}

function computeCoverageWeeks(currentCashBalance: number, reserveTarget: number): number {
  if (reserveTarget <= EPSILON || currentCashBalance <= 0) return 0;
  const weeklyBurn = reserveTarget / 4.33;
  if (weeklyBurn <= EPSILON) return 0;
  return Math.round(currentCashBalance / weeklyBurn);
}

function formatCoverageWeeks(weeks: number): string {
  if (weeks <= 0) return '0 weeks';
  return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

function formatReservePercentLabel(percent: number | null): string {
  if (percent === null) return '—';
  return `${percent}%`;
}

function ReserveGauge({
  percentLabel,
  coverageLabel,
  fillPercent,
  toneClass,
  reserveTarget,
  currentCashBalance,
}: {
  percentLabel: string;
  coverageLabel: string;
  fillPercent: number;
  toneClass: string;
  reserveTarget: number;
  currentCashBalance: number;
}) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 115;
  const strokeWidth = 18;
  const startAngle = Math.PI;
  const endAngle = 0;
  const clampedPercent = Math.min(Math.max(fillPercent, 0), 100);
  const fillAngle = startAngle - (clampedPercent / 100) * Math.PI;

  function polarToXY(angle: number): { x: number; y: number } {
    return { x: cx + radius * Math.cos(angle), y: cy - radius * Math.sin(angle) };
  }

  const trackStart = polarToXY(startAngle);
  const trackEnd = polarToXY(endAngle);
  const fillEnd = polarToXY(fillAngle);
  const largeArc = 0;

  const trackPath = `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 1 1 ${trackEnd.x} ${trackEnd.y}`;
  const fillPath = `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 ${largeArc} 1 ${fillEnd.x} ${fillEnd.y}`;

  const labelY = cy + strokeWidth / 2 + 16;
  const captionY = labelY + 15;
  const maxLabel = reserveTarget > EPSILON ? formatCompactCurrency(reserveTarget) : '—';

  return (
    <div className="reserve-gauge-wrap">
      <svg viewBox={`0 0 ${size} ${captionY + 4}`} className="reserve-gauge-svg" aria-hidden="true">
        <path d={trackPath} fill="none" stroke="var(--bg-muted)" strokeWidth={strokeWidth} strokeLinecap="round" />
        {clampedPercent > 0 && (
          <path d={fillPath} fill="none" className={`reserve-gauge-arc ${toneClass}`} strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
        <text x={trackStart.x - strokeWidth / 2} y={labelY} textAnchor="start" className="reserve-gauge-end-label">{formatCompactCurrency(currentCashBalance)}</text>
        <text x={trackStart.x - strokeWidth / 2} y={captionY} textAnchor="start" className="reserve-gauge-end-caption">Cash available</text>
        <text x={trackEnd.x + strokeWidth / 2} y={labelY} textAnchor="end" className="reserve-gauge-end-label">{maxLabel}</text>
        <text x={trackEnd.x + strokeWidth / 2} y={captionY} textAnchor="end" className="reserve-gauge-end-caption">Reserve goal</text>
      </svg>
      <div className="reserve-gauge-center">
        <span className="reserve-gauge-value">{percentLabel}</span>
        <span className="reserve-gauge-label">
          <span className="reserve-gauge-coverage">{coverageLabel}</span> covered
        </span>
      </div>
    </div>
  );
}

interface OperatingReserveCardProps {
  currentCashBalance: number;
  reserveTarget: number;
}

export function OperatingReserveCard({ currentCashBalance, reserveTarget }: OperatingReserveCardProps) {
  const tooltipId = useId();
  const reservePercent = getReservePercentDisplay(currentCashBalance, reserveTarget);
  const reserveFillPercent = reservePercent === null ? 0 : Math.min(Math.max(reservePercent, 0), 100);
  const reserveTone = reserveToneClassName(reservePercent);
  const reserveBadge = getReserveBadgeState(reservePercent !== null ? reservePercent / 100 : null);
  const coverageWeeks = computeCoverageWeeks(currentCashBalance, reserveTarget);

  return (
    <article className="card reserve-card">
      <div className="reserve-header">
        <div className="reserve-header-copy">
          <div className="reserve-title-row">
            <h3>Operating Reserve</h3>
            <span className="db-tooltip-wrap">
              <button
                type="button"
                className="db-tooltip-btn"
                aria-label="Operating Reserve explanation"
                aria-describedby={tooltipId}
              >
                &#9432;
              </button>
              <div id={tooltipId} role="tooltip" className="db-tooltip-panel reserve-tooltip-panel">
                <ul className="db-tooltip-list">
                  <li>Operating Reserve is cash set aside for short-term needs and emergencies.</li>
                  <li>You can change your Operating Reserve goal in Settings.</li>
                  <li>Current goal: 1 month of expenses, based on the average from the last 3 completed months.</li>
                </ul>
              </div>
            </span>
          </div>
          <span className="reserve-subtitle">{getReserveSubtitle(currentCashBalance, reserveTarget)}</span>
        </div>
        <span className={reserveBadge.className}>{reserveBadge.label}</span>
      </div>

      <ReserveGauge
        percentLabel={formatReservePercentLabel(reservePercent)}
        coverageLabel={formatCoverageWeeks(coverageWeeks)}
        fillPercent={reserveFillPercent}
        toneClass={reserveTone}
        reserveTarget={reserveTarget}
        currentCashBalance={currentCashBalance}
      />
    </article>
  );
}
