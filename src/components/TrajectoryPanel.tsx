import { toMonthLabel } from '../lib/kpis/compute';
import type { TrajectorySignal, TrajectorySignalId } from '../lib/data/contract';

type TrajectoryPanelProps = {
  signals: TrajectorySignal[];
};

const SIGNAL_ORDER: TrajectorySignalId[] = ['monthlyTrend', 'shortTermTrend', 'longTermTrend'];

function labelForSignal(id: TrajectorySignalId): string {
  if (id === 'monthlyTrend') return 'Monthly Trend';
  if (id === 'shortTermTrend') return 'Short-Term Trend';
  return 'Long-Term Trend';
}

function timeframeForSignal(id: TrajectorySignalId): TrajectorySignal['timeframe'] {
  if (id === 'monthlyTrend') return 'thisMonth';
  if (id === 'shortTermTrend') return 'last3Months';
  return 'ttm';
}

function toneFor(signal: TrajectorySignal): 'up' | 'down' | 'neutral' {
  if (!signal.hasSufficientHistory) return 'neutral';
  if (signal.direction === 'up') return 'up';
  if (signal.direction === 'down') return 'down';
  return 'neutral';
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value) || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatRange(startMonth: string | null, endMonth: string | null): string {
  if (!startMonth || !endMonth) return 'Insufficient history';
  if (startMonth === endMonth) return toMonthLabel(startMonth);
  return `${toMonthLabel(startMonth)} – ${toMonthLabel(endMonth)}`;
}

export default function TrajectoryPanel({ signals }: TrajectoryPanelProps) {
  const signalById = new Map(signals.map((signal) => [signal.id, signal]));

  const orderedSignals = SIGNAL_ORDER.map((id) => {
    const found = signalById.get(id);
    if (found) return found;

    return {
      id,
      label: labelForSignal(id),
      timeframe: timeframeForSignal(id),
      currentStartMonth: null,
      currentEndMonth: null,
      previousStartMonth: null,
      previousEndMonth: null,
      currentMonthCount: 0,
      previousMonthCount: 0,
      currentNetCashFlow: 0,
      previousNetCashFlow: 0,
      delta: 0,
      percentChange: null,
      direction: 'flat' as const,
      light: 'neutral' as const,
      hasSufficientHistory: false,
    };
  });

  return (
    <section className="card trajectory-card" aria-label="Trajectory three lights">
      <div className="card-head">
        <h3>Trajectory</h3>
        <p className="subtle">Three Lights · Net Cash Flow %</p>
      </div>

      <div className="trajectory-grid">
        {orderedSignals.map((signal) => {
          const tone = toneFor(signal);
          const arrow = tone === 'up' ? '▲' : tone === 'down' ? '▼' : '●';
          const currentRange = formatRange(signal.currentStartMonth, signal.currentEndMonth);
          const previousRange = formatRange(signal.previousStartMonth, signal.previousEndMonth);
          const comparisonText = signal.hasSufficientHistory ? `${currentRange} vs ${previousRange}` : currentRange;

          return (
            <article key={signal.id} className="trajectory-item">
              <div className="trajectory-head">
                <p className="trajectory-label">{signal.label}</p>
                <span className={`trajectory-light is-${tone}`} aria-hidden="true" />
              </div>
              <p className={`trajectory-value is-${tone}`}>
                <span aria-hidden="true">{arrow}</span>
                <span>{formatPercent(signal.percentChange)}</span>
              </p>
              <p className="trajectory-meta">{comparisonText}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
