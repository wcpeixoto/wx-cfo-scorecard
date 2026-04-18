import type { KpiCard } from '../lib/data/contract';

type KpiCardsProps = {
  cards: KpiCard[];
  vsLabel?: string;
};

const EPSILON = 0.00001;

const HEALTH_METRIC_IDS = new Set(['net', 'savingsRate']);

function formatValue(value: number, format: KpiCard['format']): string {
  if (format === 'currency') {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  }

  if (format === 'percent') {
    return `${value.toFixed(1)}%`;
  }

  return value.toLocaleString();
}

function formatAbsoluteDelta(card: KpiCard): string {
  const delta = card.value - card.previousValue;
  const sign = delta > EPSILON ? '+' : delta < -EPSILON ? '-' : '';
  const magnitude = Math.abs(delta);

  if (card.format === 'currency') {
    const value = magnitude.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
    return `Δ ${sign}${value}`;
  }

  if (card.format === 'percent') {
    return `Δ ${sign}${magnitude.toFixed(1)} pts`;
  }

  return `Δ ${sign}${magnitude.toLocaleString()}`;
}

function formatPercentDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${Math.round(value)}%`;
}

export default function KpiCards({ cards, vsLabel = 'vs prior period' }: KpiCardsProps) {
  return (
    <section className="kpi-grid" aria-label="Key metrics">
      {cards.map((card) => {
        const hasComparablePercent = card.deltaPercent !== null && !Number.isNaN(card.deltaPercent);
        const trendClass = hasComparablePercent
          ? card.trend === 'up'
            ? 'is-up'
            : card.trend === 'down'
              ? 'is-down'
              : 'is-flat'
          : 'is-flat';
        const absoluteDelta = formatAbsoluteDelta(card);
        const percentDelta = formatPercentDelta(card.deltaPercent);

        const isHealthMetric = HEALTH_METRIC_IDS.has(card.id);
        const valueColorClass = isHealthMetric
          ? card.value < -EPSILON
            ? ' is-negative'
            : card.value > EPSILON
              ? ' is-positive'
              : ''
          : '';

        return (
          <article className="kpi-card" key={card.id}>
            <p className="kpi-label">{card.label}</p>
            <p className={`kpi-value${valueColorClass}`}>{formatValue(card.value, card.format)}</p>
            <div className="kpi-footer">
              <span className={`kpi-badge ${trendClass}`}>
                <span aria-hidden="true" className="kpi-change-arrow">
                  {trendClass === 'is-up' ? '▲' : trendClass === 'is-down' ? '▼' : '●'}
                </span>
                <span className="kpi-change-percent">{percentDelta}</span>
              </span>
              <span className="kpi-vs-label">{vsLabel}</span>
            </div>
          </article>
        );
      })}
    </section>
  );
}
