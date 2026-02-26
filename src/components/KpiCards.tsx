import type { KpiCard } from '../lib/data/contract';

type KpiCardsProps = {
  cards: KpiCard[];
};

const EPSILON = 0.00001;

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
  return `${prefix}${value.toFixed(1)}%`;
}

export default function KpiCards({ cards }: KpiCardsProps) {
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

        return (
          <article className="kpi-card" key={card.id}>
            <p className="kpi-label">{card.label}</p>
            <div className="kpi-main-row">
              <p className="kpi-value">{formatValue(card.value, card.format)}</p>
              <p className={`kpi-change ${trendClass}`}>
                <span aria-hidden="true" className="kpi-change-arrow">
                  {trendClass === 'is-up' ? '▲' : trendClass === 'is-down' ? '▼' : '●'}
                </span>
                <span className="kpi-change-percent">{percentDelta}</span>
              </p>
            </div>
            <p className={`kpi-delta-row ${trendClass}`}>{absoluteDelta}</p>
          </article>
        );
      })}
    </section>
  );
}
