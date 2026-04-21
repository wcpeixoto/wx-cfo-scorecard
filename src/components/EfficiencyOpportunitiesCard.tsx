import type { EfficiencyOpportunitiesResult } from '../lib/kpis/efficiencyOpportunities';

interface Props {
  result: EfficiencyOpportunitiesResult;
  variant?: 'single' | 'comparison';
}

function formatHeadline(totalPerMonth: number): string {
  const rounded = Math.round(totalPerMonth / 100) * 100;
  return `~$${rounded.toLocaleString('en-US')}/mo`;
}

function formatExtra(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000;
    return `+$${k.toFixed(1)}K`;
  }
  return `+$${Math.round(amount)}`;
}

export function EfficiencyOpportunitiesCard({ result, variant = 'single' }: Props) {
  const isComparison = variant === 'comparison';
  const { windowLabel, rows, totalExtraPerMonth } = result;

  return (
    <div className="ta-card eff-opp-card">

      {/* Pattern B header — title + subtitle, no right controls */}
      <div className="eff-opp-header">
        <h3 className="eff-opp-title">Efficiency opportunities</h3>
        <p className="eff-opp-subtitle">{windowLabel}  ·  vs your best 3-month stretch in the last 24 months</p>
      </div>

      {/* Headline strip — amount + label on one baseline row */}
      <div className="eff-headline-strip">
        <span className="eff-headline-amount">{formatHeadline(totalExtraPerMonth)}</span>
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
      {rows.map((row, i) => (
        <div
          key={row.category}
          className={i === rows.length - 1 ? 'eff-row eff-row-last' : 'eff-row'}
        >
          {/* Col 1 — category name + anchor */}
          <div className="eff-row-cat-col">
            <span className="eff-row-cat-name">{row.category}</span>
            <span className="eff-row-cat-anchor">{row.bestPeriodLabel}</span>
          </div>

          {/* Col 2 — Your best % — center, muted */}
          <span className="eff-row-best-val">{row.bestPct}%</span>

          {/* Col 3 — Today % — center, stronger */}
          <span className="eff-row-today-val">{row.todayPct}%</span>

          {/* Col 4 — Extra amount (top) + bar (below) */}
          <div className="eff-row-extra-col">
            <span className="eff-row-extra-amt">{formatExtra(row.extraPerMonth)}</span>

            {/* Two-part bar: green (best) left + red (extra) right */}
            <div className={isComparison ? 'eff-bar eff-bar--comparison' : 'eff-bar eff-bar--soft'}>
              <div className="eff-bar-best" style={{ width: `${row.greenWidthPct}%` }} />
              <div className="eff-bar-extra" style={{ width: `${row.redWidthPct}%` }} />
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
