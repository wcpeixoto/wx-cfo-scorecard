/**
 * DigHereHighlights — "What Needs Attention" card
 *
 * Consumes WhatNeedsAttentionResult from computeWhatNeedsAttention.
 * Visual design: refined category labels, vivid sparklines, a title ⓘ
 * tooltip, and inline per-row typical-vs-current detail copy.
 *
 * Interaction model: the card is non-interactive except for the title ⓘ
 * icon, which reveals an explanatory tooltip on hover/focus via the shared
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
import { chartTokens } from '../lib/ui/chartTokens';

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
  colors: [chartTokens.costSpike],
  tooltip: { enabled: false },
  dataLabels: { enabled: false },
};

function formatRatioPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

// formatCompact, but drop a whole-number ".0" decimal (e.g. $2.0K → $2K).
// Card-local: the shared formatCompact intentionally keeps one decimal app-wide.
function formatDollars(n: number): string {
  return formatCompact(n).replace(/\.0K$/, 'K');
}

function CostSpikeRow({ row, isMiddle }: { row: WhatNeedsAttentionRow; isMiddle: boolean }) {
  const headline = formatDollars(row.delta);
  const detail =
    row.bucket === 'variable'
      ? `Usually ~${formatRatioPct(row.baselineRatio)} of revenue · this month ${formatRatioPct(row.currentRatio)} (${formatDollars(row.currentSpend)} vs ${formatDollars(row.expectedSpend)})`
      : `Usually ~${formatDollars(row.baselineAvgSpend)}/mo · this month ${formatDollars(row.currentSpend)}`;

  return (
    <div className={`wna-row${isMiddle ? ' wna-row--middle' : ''}`}>
      <div className="wna-row-left">
        <div className="wna-label-row">
          <span className="wna-category wna-category--refined">{row.categoryName}</span>
        </div>
        <div className="wna-headline">
          <span className="wna-arrow">&#8593;</span>&nbsp;{headline}
        </div>
        <div className="wna-detail wna-detail--sm">{detail}</div>
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

export default function DigHereHighlights({ result }: Props) {
  const rows = result.rows.slice(0, MAX_ROWS);
  const titleTooltipId = useId();
  const subtitle = result.currentMonth ? `${result.currentMonth} · vs last 6-month avg` : '';

  return (
    <div className="wna-card">

      {/* ── Header (stacked) ───────────────────────────────────────────── */}
      <div className="wna-header wna-header--stacked">
        <div className="wna-title-row">
          <h3 className="wna-title">Cost Spikes to Investigate</h3>
          <div className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="Cost Spikes to Investigate explanation"
              aria-describedby={titleTooltipId}
            >
              &#9432;
            </button>
            <div id={titleTooltipId} role="tooltip" className="db-tooltip-panel wna-tooltip-panel">
              <ul className="db-tooltip-list">
                <li>Shows costs that ran higher than usual last month.</li>
                <li>Fixed costs, like rent or insurance, are compared to their 6-month average.</li>
                <li>Costs that move with revenue, like marketing or merchant fees, are compared to their usual share of revenue.</li>
              </ul>
            </div>
          </div>
        </div>
        {subtitle ? <p className="wna-period">{subtitle}</p> : null}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {result.noData ? (
        <div className="wna-empty">
          Not enough history to calculate a baseline yet.
        </div>
      ) : rows.length === 0 ? (
        <div className="wna-empty">
          No cost spikes this month. Spending is in line with your last 6-month average.
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
