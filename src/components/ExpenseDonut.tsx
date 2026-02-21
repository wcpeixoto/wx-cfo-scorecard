import type { ExpenseSlice } from '../lib/data/contract';

type ExpenseDonutProps = {
  slices: ExpenseSlice[];
};

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function buildConicGradient(slices: ExpenseSlice[]): string {
  if (slices.length === 0) {
    return 'conic-gradient(#d9e2f5 0deg, #d9e2f5 360deg)';
  }

  let cursor = 0;
  const stops: string[] = [];

  slices.forEach((slice) => {
    const degrees = Math.max(slice.share * 360, 1);
    const nextCursor = cursor + degrees;
    stops.push(`${slice.color} ${cursor}deg ${nextCursor}deg`);
    cursor = nextCursor;
  });

  if (cursor < 360) {
    stops.push(`#d9e2f5 ${cursor}deg 360deg`);
  }

  return `conic-gradient(${stops.join(', ')})`;
}

export default function ExpenseDonut({ slices }: ExpenseDonutProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <article className="card donut-card">
      <div className="card-head">
        <h3>Expense Mix</h3>
        <p className="subtle">Current month category composition</p>
      </div>

      <div className="donut-layout">
        <div className="donut-shell" style={{ background: buildConicGradient(slices) }}>
          <div className="donut-center">
            <span>Total</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
        </div>

        <ul className="legend-list">
          {slices.map((slice) => (
            <li key={slice.name}>
              <span className="legend-dot" style={{ background: slice.color }} aria-hidden="true" />
              <span className="legend-name">{slice.name}</span>
              <span className="legend-value">{formatCurrency(slice.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
