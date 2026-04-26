/**
 * DigHereHighlights — "What Needs Attention" card
 *
 * Consumes WhatNeedsAttentionResult from computeWhatNeedsAttention.
 * Matches the locked UI Lab mock (DigHereCardMock.tsx) visual design:
 * refined category labels, vivid sparklines, inline ⓘ tooltip.
 *
 * Interaction model: the card is non-interactive except for the ⓘ icon
 * which toggles an explanatory tooltip. No row or title click handlers.
 */

import { useEffect, useRef, useState } from 'react';
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

function buildTooltip(row: WhatNeedsAttentionRow): string {
  if (row.bucket === 'fixed') {
    return (
      `${row.categoryName} typically runs ~${formatCompact(row.baselineAvgSpend)}/mo. ` +
      `This month came in ${formatCompact(row.delta)} higher.`
    );
  }
  return (
    `${row.categoryName} typically runs at ${formatRatioPct(row.baselineRatio)} of revenue. ` +
    `Based on this month's revenue, ~${formatCompact(row.expectedSpend)} would be expected. ` +
    `You spent ${formatCompact(row.currentSpend)}.`
  );
}

export default function DigHereHighlights({ result }: Props) {
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openTooltip) return;
    function handleOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setOpenTooltip(null);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openTooltip]);

  const rows = result.rows.slice(0, MAX_ROWS);
  const subtitle = result.currentMonth ? `Based on ${result.currentMonth}` : '';

  return (
    <div className="wna-card" ref={cardRef}>

      {/* ── Header (stacked) ───────────────────────────────────────────── */}
      <div className="wna-header wna-header--stacked">
        <span className="wna-title">What Needs Attention</span>
        {subtitle ? <span className="wna-period">{subtitle}</span> : null}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {result.noData ? (
        <div className="wna-empty">
          Not enough history to calculate a baseline yet.
        </div>
      ) : rows.length === 0 ? (
        <div className="wna-empty">
          No categories flagged this month.
        </div>
      ) : (
        rows.map((row, i) => {
          const headline = formatSignedCompact(row.delta);
          const detail =
            `${formatCompact(row.currentSpend)} this month vs ` +
            `${formatCompact(row.expectedSpend)} expected`;
          const isMiddle = i === 1 && rows.length >= 3;
          const tooltip = buildTooltip(row);

          return (
            <div
              key={row.categoryName}
              className={`wna-row${isMiddle ? ' wna-row--middle' : ''}`}
            >
              <div className="wna-row-left">

                <div className="wna-label-row">
                  <span className="wna-category wna-category--refined">
                    {row.categoryName}
                  </span>
                </div>

                <div className="wna-headline">{headline}</div>

                <div className="wna-detail wna-detail--sm">
                  {detail}
                  <span className="wna-info-wrap">
                    <button
                      type="button"
                      className="wna-info-btn"
                      aria-label={`Explain ${row.categoryName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenTooltip(
                          openTooltip === row.categoryName ? null : row.categoryName
                        );
                      }}
                    >ⓘ</button>
                    {openTooltip === row.categoryName && (
                      <div className="explain-tooltip" role="tooltip">
                        {tooltip}
                      </div>
                    )}
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
        })
      )}

    </div>
  );
}
