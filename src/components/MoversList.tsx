import type { Mover, MoverGrouping } from '../lib/data/contract';

type MoversListProps = {
  movers: Mover[];
  title?: string;
  grouping?: MoverGrouping;
  onGroupingChange?: (grouping: MoverGrouping) => void;
};

const EPSILON = 0.00001;
const SPARKLINE_WIDTH = 72;
const SPARKLINE_HEIGHT = 24;
const SPARKLINE_PADDING = 2;
const MOVER_GROUP_OPTIONS: Array<{ value: MoverGrouping; label: string }> = [
  { value: 'categories', label: 'Categories' },
  { value: 'subcategories', label: 'Subcategories' },
];

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

function buildFlatSparklinePath(
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
  padding = SPARKLINE_PADDING
): string {
  const y = height / 2;
  return `M ${padding} ${y.toFixed(2)} L ${(width - padding).toFixed(2)} ${y.toFixed(2)}`;
}

export default function MoversList({
  movers,
  title = 'Dig Here Movers',
  grouping = 'subcategories',
  onGroupingChange,
}: MoversListProps) {
  return (
    <article className="card movers-card">
      <div className="card-head movers-card-head">
        <div>
          <h3>{title}</h3>
          <p className="subtle">Largest category shifts vs prior period</p>
        </div>
        <div className="movers-group-toggle" role="group" aria-label="Mover grouping selector">
          {MOVER_GROUP_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={grouping === option.value ? 'is-active' : ''}
              onClick={() => onGroupingChange?.(option.value)}
              aria-pressed={grouping === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
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
                  <svg
                    className={`mover-sparkline ${
                      mover.sparkline && mover.sparkline.length >= 3 ? 'has-data' : 'is-placeholder'
                    }`}
                    viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d={buildSparklinePath(mover.sparkline ?? []) ?? buildFlatSparklinePath()} />
                  </svg>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
