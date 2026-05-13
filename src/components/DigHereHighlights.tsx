/**
 * DigHereHighlights — "What Needs Attention" card
 *
 * Consumes WhatNeedsAttentionResult from computeWhatNeedsAttention.
 * Visual design: refined category labels, vivid sparklines, inline ⓘ tooltip.
 *
 * Interaction model: the card is non-interactive except for the ⓘ icon,
 * which reveals an explanatory tooltip on hover/focus via the shared
 * .db-tooltip-* pattern. No row or title click handlers.
 */

import { useId } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type {
  WhatNeedsAttentionResult,
  WhatNeedsAttentionRow,
} from '../lib/kpis/digHere';
import { formatCompact } from '../lib/utils/formatCompact';

type Props = {
  result: WhatNeedsAttentionResult;
};

const MAX_ROWS = 3;

// Sparkline config — vivid variant (matches Traffic Stats spec rgba(251,84,84,0.55))
const SPARK_OPTIONS: ApexOptions = {
  chart: {
    type: 'area',
    sparkline: { enabled: true },
    toolbar: { show: false },
    fontFamily: 'Outfit, sans-serif',
    background: 'transparent',
  },
  stroke: { curve: 'smooth', width: 1.5 },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.55,
      opacityTo: 0,
      stops: [0, 100],
    },
  },
  colors: ['#FB5454'],
  tooltip: { enabled: false },
  dataLabels: { enabled: false },
};

function formatSignedCompact(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatCompact(n)}`;
}

function formatRatioPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

type TooltipContent = { typicalLabel: string; typicalBody: string; thisMonthBody: string };

function CostSpikeRow({ row, isMiddle }: { row: WhatNeedsAttentionRow; isMiddle: boolean }) {
  const tooltipId = useId();
  const headline = formatSignedCompact(row.delta);
  const detail =
    `${formatCompact(row.currentSpend)} this month vs ${formatCompact(row.expectedSpend)} expected`;
  const tip = buildTooltip(row);

  return (
    <div className={`wna-row${isMiddle ? ' wna-row--middle' : ''}`}>
      <div className="wna-row-left">
        <div className="wna-label-row">
          <span className="wna-category wna-category--refined">{row.categoryName}</span>
        </div>
        <div className="wna-headline">{headline}</div>
        <div className="wna-detail wna-detail--sm">
          {detail}
          <span className="wna-info-wrap db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label={`Explain ${row.categoryName}`}
              aria-describedby={tooltipId}
            >&#9432;</button>
            <div id={tooltipId} role="tooltip" className="db-tooltip-panel trend-tooltip-panel">
              <ul className="db-tooltip-list">
                <li><strong>{tip.typicalLabel}</strong></li>
                <li className="db-tooltip-body">{tip.typicalBody}</li>
                <li><strong>This month</strong></li>
                <li className="db-tooltip-body">{tip.thisMonthBody}</li>
              </ul>
            </div>
          </span>
        </div>
      </div>
      <div className="wna-spark">
        <ReactApexChart
          type="area"
          series={[{ data: row.sparklineData }]}
          options={SPARK_OPTIONS}
          width={180}
          height={56}
        />
      </div>
    </div>
  );
}

function buildTooltip(row: WhatNeedsAttentionRow): TooltipContent {
  if (row.bucket === 'fixed') {
    return {
      typicalLabel: 'Typical spend',
      typicalBody: `~${formatCompact(row.baselineAvgSpend)}/mo across the last 6 months.`,
      thisMonthBody: `${formatCompact(row.delta)} higher than typical.`,
    };
  }
  return {
    typicalLabel: 'Typical ratio',
    typicalBody: `${formatRatioPct(row.baselineRatio)} of revenue (6-month baseline).`,
    thisMonthBody: `${formatCompact(row.currentSpend)} spent vs ~${formatCompact(row.expectedSpend)} expected based on this month's revenue.`,
  };
}

export default function DigHereHighlights({ result }: Props) {
  const rows = result.rows.slice(0, MAX_ROWS);
  const subtitle = result.currentMonth ? `${result.currentMonth} · vs your 6-month baseline` : '';

  return (
    <div className="wna-card">

      {/* ── Header (stacked) ───────────────────────────────────────────── */}
      <div className="wna-header wna-header--stacked">
        <span className="wna-title">Cost Spikes to Investigate</span>
        {subtitle ? <span className="wna-period">{subtitle}</span> : null}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {result.noData ? (
        <div className="wna-empty">
          Not enough history to calculate a baseline yet.
        </div>
      ) : rows.length === 0 ? (
        <div className="wna-empty">
          No cost spikes this month. Spending is in line with your 6-month baseline.
        </div>
      ) : (
        rows.map((row, i) => (
          <CostSpikeRow
            key={row.categoryName}
            row={row}
            isMiddle={i === 1 && rows.length >= 3}
          />
        ))
      )}

    </div>
  );
}
