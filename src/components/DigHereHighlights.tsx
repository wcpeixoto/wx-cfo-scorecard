type DigHereHighlightItem = {
  category: string;
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
};

type DigHereHighlightsProps = {
  items: DigHereHighlightItem[];
  timeframeLabel: string;
  onTitleClick?: () => void;
  onItemClick?: (item: DigHereHighlightItem) => void;
};

const EPSILON = 0.00001;

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatDeltaPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export default function DigHereHighlights({
  items,
  timeframeLabel,
  onTitleClick,
  onItemClick,
}: DigHereHighlightsProps) {
  const visibleItems = items.slice(0, 5);

  return (
    <article className="card highlights-card">
      <div className="card-head">
        {onTitleClick ? (
          <h3>
            <button type="button" className="highlights-title-btn" onClick={onTitleClick}>
              Dig Here Highlights
            </button>
          </h3>
        ) : (
          <h3>Dig Here Highlights</h3>
        )}
        <p className="subtle">{timeframeLabel}</p>
      </div>

      {visibleItems.length === 0 ? (
        <p className="empty-state">No material category shifts for this comparison window.</p>
      ) : (
        <ul className="highlights-list">
          {visibleItems.map((item) => {
            const isIncrease = item.delta > EPSILON;
            const isDecrease = item.delta < -EPSILON;
            const toneClass = isIncrease ? 'is-up' : isDecrease ? 'is-down' : 'is-flat';
            const arrow = isIncrease ? '▲' : isDecrease ? '▼' : '●';
            const deltaText = `${isIncrease ? '+' : ''}${formatCurrency(item.delta)}`;

            const rowBody = (
              <>
                <div className="highlights-main">
                  <p>{item.category}</p>
                  <small>
                    {formatCurrency(item.current)} vs {formatCurrency(item.previous)}
                  </small>
                </div>
                <div className={`highlights-delta ${toneClass}`}>
                  <strong>
                    {arrow} {deltaText}
                  </strong>
                  <span>{formatDeltaPercent(item.deltaPercent)}</span>
                </div>
              </>
            );

            return (
              <li key={item.category}>
                {onItemClick ? (
                  <button
                    type="button"
                    className="highlights-row-btn"
                    onClick={() => onItemClick(item)}
                    aria-label={`Open Dig Here for ${item.category}`}
                  >
                    {rowBody}
                  </button>
                ) : (
                  <div className="highlights-row-static">{rowBody}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
