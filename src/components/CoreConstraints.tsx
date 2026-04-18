interface CoreConstraintsProps {
  reservePercent: number | null;
  forwardCashBalance: number;
  reserveTarget: number;
}

function formatCurrency(value: number): string {
  const abs = Math.abs(Math.round(value));
  const sign = value < 0 ? '-' : '';
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function CoreConstraints({
  reservePercent,
  forwardCashBalance,
  reserveTarget,
}: CoreConstraintsProps) {
  const reserveDisplay = reservePercent === null ? '—' : formatPercent(reservePercent);
  const forwardIsNegative = forwardCashBalance < 0;

  return (
    <div className="today-constraints">
      <div className="today-constraints-cell">
        <p className="today-constraints-label">Reserve funded</p>
        <p className="today-constraints-value">{reserveDisplay}</p>
        <p className="today-constraints-helper">Target: {formatCurrency(reserveTarget)}</p>
      </div>

      <div className="today-constraints-divider" aria-hidden="true" />

      <div className="today-constraints-cell">
        <p className="today-constraints-label">Forward cash floor</p>
        <p
          className={
            forwardIsNegative
              ? 'today-constraints-value is-negative'
              : 'today-constraints-value'
          }
        >
          {formatCurrency(forwardCashBalance)}
        </p>
        <p className="today-constraints-helper">Lowest projected point</p>
      </div>
    </div>
  );
}
