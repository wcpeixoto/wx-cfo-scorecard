import type { Mover } from '../lib/data/contract';

type MoversListProps = {
  movers: Mover[];
  title?: string;
};

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

export default function MoversList({ movers, title = 'Dig Here Movers' }: MoversListProps) {
  return (
    <article className="card movers-card">
      <div className="card-head">
        <h3>{title}</h3>
        <p className="subtle">Largest category shifts vs prior month</p>
      </div>

      {movers.length === 0 ? (
        <p className="empty-state">Not enough history yet to compute movers.</p>
      ) : (
        <ul className="movers-list">
          {movers.map((mover) => (
            <li key={mover.category}>
              <div>
                <p>{mover.category}</p>
                <small>
                  Prev {formatCurrency(mover.previous)} {'->'} Now {formatCurrency(mover.current)}
                </small>
              </div>
              <div className={`mover-delta ${mover.delta > 0 ? 'is-up' : mover.delta < 0 ? 'is-down' : 'is-flat'}`}>
                <span>{mover.delta > 0 ? '▲' : mover.delta < 0 ? '▼' : '●'}</span>
                <strong>{formatCurrency(mover.delta)}</strong>
                <small>{formatPercent(mover.deltaPercent)}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
