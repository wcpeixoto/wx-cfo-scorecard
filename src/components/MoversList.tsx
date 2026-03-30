import type { Mover } from '../lib/data/contract';

type MoversListProps = {
  movers: Mover[];
  title?: string;
};

const EPSILON = 0.00001;
const SPARKLINE_WIDTH = 72;
const SPARKLINE_HEIGHT = 24;
const SPARKLINE_PADDING = 2;

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

function buildSparklinePath(
  values: number[],
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
  padding = SPARKLINE_PADDING
): string | null {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const safeRange = Math.abs(range) <= EPSILON ? 1 : range;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return values
    .map((value, index) => {
      const x = padding + (values.length === 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
      const normalizedY = (value - min) / safeRange;
      const y = padding + innerHeight - normalizedY * innerHeight;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export default function MoversList({ movers, title = 'Dig Here Movers' }: MoversListProps) {
  return (
    <article className="card movers-card">
      <div className="card-head">
        <h3>{title}</h3>
        <p className="subtle">Largest category shifts vs prior period</p>
      </div>

      {movers.length === 0 ? (
        <p className="empty-state">Not enough history yet to compute movers.</p>
      ) : (
        <ul className="movers-list">
          {movers.map((mover) => {
            const isNew = Math.abs(mover.previous) <= EPSILON && Math.abs(mover.current) > EPSILON;

            return (
              <li key={mover.category}>
                <div>
                  <p>
                    <span>{mover.category}</span>
                    {isNew ? <span className="novelty-badge">New</span> : null}
                  </p>
                  <small>
                    Prev {formatCurrency(mover.previous)} {'->'} Now {formatCurrency(mover.current)}
                  </small>
                </div>
                <div className="mover-side">
                  <div
                    className={`mover-delta ${mover.delta > 0 ? 'is-up' : mover.delta < 0 ? 'is-down' : 'is-flat'}`}
                  >
                    <div className="mover-delta-main">
                      <span>{mover.delta > 0 ? '▲' : mover.delta < 0 ? '▼' : '●'}</span>
                      <strong>{formatCurrency(mover.delta)}</strong>
                    </div>
                    <small>{formatPercent(mover.deltaPercent)}</small>
                  </div>
                  {mover.sparkline && mover.sparkline.length >= 3 ? (
                    <svg
                      className="mover-sparkline"
                      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d={buildSparklinePath(mover.sparkline) ?? ''} />
                    </svg>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
