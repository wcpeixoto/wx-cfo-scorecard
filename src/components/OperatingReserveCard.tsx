// OperatingReserveCard — extracted from Dashboard.tsx inline block.
// Receives only the two root values; all derived state is computed internally.

const EPSILON = 0.00001;

/** Threshold below which the reserve is considered "below target" (warning).
 *  Below 50% funded is critical. 50–100% is warning. 100%+ is healthy.
 *  Mirrors the reserve_critical threshold in signals.ts (RESERVE_CRITICAL_THRESHOLD = 0.50). */
const RESERVE_TIGHT_THRESHOLD = 0.50;

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

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

function getReserveBadgeState(percentFunded: number | null): { label: string; className: string } {
  if (percentFunded === null) return { label: '—', className: 'card-status-badge is-neutral' };
  if (percentFunded >= 1.0) return { label: '✓ Fully funded', className: 'card-status-badge is-healthy' };
  if (percentFunded >= RESERVE_TIGHT_THRESHOLD) return { label: '↓ Below target', className: 'card-status-badge is-warning' };
  return { label: '↓ Critical', className: 'card-status-badge is-critical' };
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
}: {
  percentLabel: string;
  coverageLabel: string;
  fillPercent: number;
  toneClass: string;
  reserveTarget: number;
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
  const maxLabel = reserveTarget > EPSILON ? formatCompactCurrency(reserveTarget) : '—';

  return (
    <div className="reserve-gauge-wrap">
      <svg viewBox={`0 0 ${size} ${labelY + 4}`} className="reserve-gauge-svg" aria-hidden="true">
        <path d={trackPath} fill="none" stroke="var(--bg-muted)" strokeWidth={strokeWidth} strokeLinecap="round" />
        {clampedPercent > 0 && (
          <path d={fillPath} fill="none" className={`reserve-gauge-arc ${toneClass}`} strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
        <text x={trackStart.x - strokeWidth / 2} y={labelY} textAnchor="start" className="reserve-gauge-end-label">$0</text>
        <text x={trackEnd.x + strokeWidth / 2} y={labelY} textAnchor="end" className="reserve-gauge-end-label">{maxLabel}</text>
      </svg>
      <div className="reserve-gauge-center">
        <span className="reserve-gauge-value">{percentLabel}</span>
        <span className="reserve-gauge-coverage">{coverageLabel}</span>
        <span className="reserve-gauge-label">of reserve funded</span>
      </div>
    </div>
  );
}

interface OperatingReserveCardProps {
  currentCashBalance: number;
  reserveTarget: number;
}

export function OperatingReserveCard({ currentCashBalance, reserveTarget }: OperatingReserveCardProps) {
  const reservePercent = getReservePercentDisplay(currentCashBalance, reserveTarget);
  const reserveFillPercent = reservePercent === null ? 0 : Math.min(Math.max(reservePercent, 0), 100);
  const reserveTone = reserveToneClassName(reservePercent);
  const reserveBadge = getReserveBadgeState(reservePercent !== null ? reservePercent / 100 : null);
  const coverageWeeks = computeCoverageWeeks(currentCashBalance, reserveTarget);

  return (
    <article className="card reserve-card">
      <div className="reserve-header">
        <div className="reserve-header-copy">
          <h3>Operating Reserve</h3>
          <span className="reserve-subtitle">3-month avg expenses</span>
        </div>
        <span className={reserveBadge.className}>{reserveBadge.label}</span>
      </div>

      <ReserveGauge
        percentLabel={formatReservePercentLabel(reservePercent)}
        coverageLabel={formatCoverageWeeks(coverageWeeks)}
        fillPercent={reserveFillPercent}
        toneClass={reserveTone}
        reserveTarget={reserveTarget}
      />

      <div className="reserve-coverage">
        <div className="reserve-coverage-head">
          <span className="reserve-coverage-label">Cash on Hand</span>
          <span className="reserve-coverage-value">{formatCoverageWeeks(coverageWeeks)}</span>
        </div>
        <div className="reserve-coverage-track" aria-hidden="true">
          <div
            className={`reserve-coverage-fill ${reserveTone}`}
            style={{ width: `${Math.min((coverageWeeks / 4) * 100, 100)}%` }}
          />
        </div>
      </div>

      <div className="reserve-stat-cards">
        <div className="reserve-stat-card">
          <span className="reserve-stat-card-label">Cash on hand</span>
          <span className="reserve-stat-card-value">{formatCurrency(currentCashBalance)}</span>
        </div>
        <div className="reserve-stat-card">
          <span className="reserve-stat-card-label">Safety line</span>
          <span className="reserve-stat-card-value">{reserveTarget > EPSILON ? formatCurrency(reserveTarget) : '—'}</span>
        </div>
      </div>
    </article>
  );
}
