interface EffRow {
  category: string;
  anchor: string;
  best: number;
  today: number;
  barFill: number;  // % of bar that is "extra" (gap to today)
  extra: string;    // extra cost vs best, formatted
}

interface Props {
  variant?: 'single' | 'comparison';
}

const MOCK_ROWS: EffRow[] = [
  { category: 'Payroll',              anchor: 'was 28% avg (Jan–Mar 2025)', best: 28, today: 43, barFill: 35, extra: '+$5.9K' },
  { category: 'Marketing',            anchor: 'was 2% avg (Jan–Mar 2024)',  best: 2,  today: 8,  barFill: 75, extra: '+$2.4K' },
  { category: 'COGS',                 anchor: 'was 1% avg (Apr–Jun 2024)',  best: 1,  today: 6,  barFill: 83, extra: '+$1.8K' },
  { category: 'Refunds & allowances', anchor: 'was 1% avg (Mar–May 2024)', best: 1,  today: 4,  barFill: 75, extra: '+$1.4K' },
];

export function EfficiencyOpportunitiesCard({ variant = 'single' }: Props) {
  const isComparison = variant === 'comparison';

  return (
    <div className="ta-card eff-opp-card">

      {/* Pattern B header — title + subtitle, no right controls */}
      <div className="eff-opp-header">
        <h3 className="eff-opp-title">Efficiency opportunities</h3>
        <p className="eff-opp-subtitle">Jan – Mar 2026  ·  vs your best 3-month stretch in the last 24 months</p>
      </div>

      {/* Headline strip — amount + label on one baseline row */}
      <div className="eff-headline-strip">
        <span className="eff-headline-amount">~$12,800/mo</span>
        <span className="eff-headline-label">available if you ran at your own best level</span>
      </div>

      {/* Column headers */}
      <div className="eff-col-headers">
        <span className="eff-col-cat">Category</span>
        <span className="eff-col-best">Your best</span>
        <span className="eff-col-today">Today</span>
        <span className="eff-col-extra">Extra/<span className="eff-col-extra-sub">mo</span></span>
      </div>

      {/* Data rows */}
      {MOCK_ROWS.map((row, i) => (
        <div
          key={row.category}
          className={i === MOCK_ROWS.length - 1 ? 'eff-row eff-row-last' : 'eff-row'}
        >
          {/* Col 1 — category name + anchor */}
          <div className="eff-row-cat-col">
            <span className="eff-row-cat-name">{row.category}</span>
            <span className="eff-row-cat-anchor">{row.anchor}</span>
          </div>

          {/* Col 2 — Your best % — center, muted */}
          <span className="eff-row-best-val">{row.best}%</span>

          {/* Col 3 — Today % — center, stronger */}
          <span className="eff-row-today-val">{row.today}%</span>

          {/* Col 4 — Extra amount (top) + bar (below) */}
          <div className="eff-row-extra-col">
            <span className="eff-row-extra-amt">{row.extra}</span>

            {/* Two-part bar: green (best) left + red (extra) right */}
            <div className={isComparison ? 'eff-bar eff-bar--comparison' : 'eff-bar eff-bar--soft'}>
              <div className="eff-bar-best" style={{ width: `${100 - row.barFill}%` }} />
              <div className="eff-bar-extra" style={{ width: `${row.barFill}%` }} />
            </div>
          </div>
        </div>
      ))}

      {/* Footnote */}
      <p className="eff-footnote">
        "Your best" is the lowest % of revenue a cost has been over any 3-month stretch in the last 24 months.
      </p>

    </div>
  );
}
