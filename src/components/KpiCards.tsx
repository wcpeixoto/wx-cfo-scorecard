import type { KpiCard } from '../lib/data/contract';

type KpiCardsProps = {
  cards: KpiCard[];
};

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

function formatDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'n/a';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

export default function KpiCards({ cards }: KpiCardsProps) {
  return (
    <section className="kpi-grid" aria-label="Key metrics">
      {cards.map((card) => {
        const trendClass = card.trend === 'up' ? 'is-up' : card.trend === 'down' ? 'is-down' : 'is-flat';
        const delta = formatDelta(card.deltaPercent);

        return (
          <article className="kpi-card" key={card.id}>
            <p className="kpi-label">{card.label}</p>
            <p className="kpi-value">{formatValue(card.value, card.format)}</p>
            <p className={`kpi-delta ${trendClass}`}>
              <span aria-hidden="true">{card.trend === 'up' ? '▲' : card.trend === 'down' ? '▼' : '●'}</span>
              {delta}
            </p>
          </article>
        );
      })}
    </section>
  );
}
