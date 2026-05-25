import { useId, useState } from 'react';
import type { EfficiencyOpportunitiesResult, EfficiencyRow } from '../lib/kpis/efficiencyOpportunities';
import { EfficiencyDrilldownDrawer } from './EfficiencyDrilldownDrawer';
import { chartTokens } from '../lib/ui/chartTokens';

interface Props {
  result: EfficiencyOpportunitiesResult;
}

function formatHeadline(totalPerMonth: number): string {
  if (totalPerMonth >= 1000) {
    return `$${(totalPerMonth / 1000).toFixed(1)}K/mo`;
  }
  return `$${Math.round(totalPerMonth)}/mo`;
}

function formatExtra(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000;
    return `$${k.toFixed(1)}K`;
  }
  return `$${Math.round(amount)}`;
}

export function EfficiencyOpportunitiesCard({ result }: Props) {
  const { windowLabel, rows, totalExtraPerMonth } = result;

  const tooltipId = useId();
  const bestTooltipId = useId();
  const [selectedRow, setSelectedRow] = useState<EfficiencyRow | null>(null);

  // Bars scale to the largest recoverable monthly amount in the current row set.
  const maxRecoverable = rows.reduce((max, r) => Math.max(max, r.extraPerMonth), 0);

  return (
    <div className="ta-card eff-opp-card">

      {/* Pattern B header — title + ⓘ tooltip + context line */}
      <div className="eff-opp-header">
        <div className="eff-title-row">
          <h3 className="eff-opp-title" aria-label="Money Left on the Table">Money Left on the Table</h3>
          <div className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="Money Left on the Table explanation"
              aria-describedby={tooltipId}
            >
              &#9432;
            </button>
            <div id={tooltipId} role="tooltip" className="db-tooltip-panel eff-tooltip-panel">
              <ul className="db-tooltip-list">
                <li>
                  Money that could move back to the owner’s pocket each month if your biggest cost
                  categories returned to your best 3-month efficiency level.
                </li>
                <li>
                  “Your best” — your lowest cost % of revenue for that category over a 3-month stretch.
                </li>
                <li>
                  “Today” — your current 3-month average.
                </li>
                <li>
                  “Recoverable/mo” — the monthly dollars you could recover by getting that cost back to
                  your best level.
                </li>
              </ul>
            </div>
          </div>
        </div>
        <p className="eff-opp-context">{windowLabel} · vs your best 3-month stretch in the last 24 months</p>
      </div>

      {/* Headline strip — amount + label on one baseline row */}
      <div className="eff-headline-strip">
        <span className="eff-headline-amount">{formatHeadline(totalExtraPerMonth)}</span>
        <span className="eff-headline-label">more than your best efficiency level</span>
      </div>

      {/* Column headers */}
      <div className="eff-col-headers">
        <span className="eff-col-cat">Category</span>
        {/* Desktop: two separate columns. Mobile: single combined column */}
        <span className="eff-col-today">Today</span>
        <span className="eff-col-best">
          Your best
          <span className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="Your best column explanation"
              aria-describedby={bestTooltipId}
            >
              &#9432;
            </button>
            <span id={bestTooltipId} role="tooltip" className="db-tooltip-panel eff-col-tooltip-panel">
              {'Click any "Your best" percentage to see the revenue, spend, and % comparison between that best stretch and today.'}
            </span>
          </span>
        </span>
        <span className="eff-col-best-now">Best → Now</span>
        <span className="eff-col-extra">Recoverable per month</span>
      </div>

      {/* Data rows */}
      {rows.map((row, i) => {
        const barPct = maxRecoverable > 0 ? (row.extraPerMonth / maxRecoverable) * 100 : 0;
        return (
          <div
            key={row.category}
            className={i === rows.length - 1 ? 'eff-row eff-row-last' : 'eff-row'}
          >
            {/* Col 1 — category name + anchor */}
            <div className="eff-row-cat-col">
              <span
                className="eff-row-cat-name eff-row-cat-name--clickable"
                onClick={() => setSelectedRow(row)}
              >
                {row.category}
              </span>
              <span className="eff-row-cat-anchor">{row.bestPeriodLabel}</span>
            </div>

            {/* Col 2 — Today % — desktop only */}
            <span className="eff-row-today-val">{row.todayPct}%</span>

            {/* Col 3 — Your best % — clickable into comparison drawer — desktop only */}
            <span
              className="eff-row-best-val eff-row-best-val--clickable"
              role="button"
              tabIndex={0}
              aria-label={`Compare ${row.category} best stretch versus today`}
              onClick={() => setSelectedRow(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedRow(row);
                }
              }}
            >
              {row.bestPct}%
            </span>

            {/* Combined best→today — mobile only */}
            <span
              className="eff-row-combined-val eff-row-cat-name--clickable"
              onClick={() => setSelectedRow(row)}
            >
              {row.bestPct}% → {row.todayPct}%
            </span>

            {/* Col 4 — bar grows left-to-right, dollar value right-anchored at the end */}
            <div className="eff-row-extra-col">
              <div className="eff-bar">
                <div
                  className="eff-bar-fill"
                  style={{ width: `${barPct}%`, background: chartTokens.brand }}
                />
              </div>
              <span className="eff-row-extra-amt">{formatExtra(row.extraPerMonth)}</span>
            </div>
          </div>
        );
      })}

      {selectedRow && (
        <EfficiencyDrilldownDrawer
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
        />
      )}

    </div>
  );
}
