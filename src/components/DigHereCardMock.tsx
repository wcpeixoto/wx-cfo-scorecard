import React, { useState, useEffect, useRef } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

// ---------------------------------------------------------------------------
// Static mock data — no compute logic, no Dashboard state wiring
// ---------------------------------------------------------------------------

interface DigHereRow {
  label: string;
  headline: string;
  detail: string;
  tooltip: string;
  sparkData: number[];
}

const ROWS_ORIGINAL: DigHereRow[] = [
  {
    label: 'Payroll',
    headline: '$2,100 above expected',
    detail: '$11,710 this month vs $9,600 avg',
    tooltip:
      'Payroll is a fixed cost — we compare it to your 6-month average spend. Your typical month runs ~$9,600. This month came in $2,100 higher.',
    sparkData: [9400, 9800, 9500, 9600, 9700, 11710],
  },
  {
    label: 'Marketing',
    headline: '$1,800 above expected',
    detail: '$2,729 this month vs $929 avg',
    tooltip:
      'Marketing typically runs at 3% of revenue. Based on this month\'s revenue, ~$929 would be expected. You spent $2,729 — $1,800 above what your revenue justified.',
    sparkData: [800, 900, 850, 920, 880, 2729],
  },
  {
    label: 'Refunds & Allowances',
    headline: '$1,400 above expected',
    detail: '$2,098 this month vs $698 avg',
    tooltip:
      'Refunds & Allowances typically runs at 2% of revenue. Based on this month\'s revenue, ~$698 would be expected. You spent $2,098 — $1,400 above what your revenue justified.',
    sparkData: [600, 700, 650, 720, 680, 2098],
  },
];

const ROWS_UPDATED: DigHereRow[] = [
  {
    label: 'Payroll',
    headline: '+2.1K',
    detail: '$11,710 this month vs $9,600 expected',
    tooltip:
      'Payroll is a fixed cost — we compare it to your 6-month average spend. Your typical month runs ~$9,600. This month came in $2,100 higher.',
    sparkData: [9400, 9800, 9500, 9600, 9700, 11710],
  },
  {
    label: 'Marketing',
    headline: '+1.8K',
    detail: '$2,729 this month vs $929 expected',
    tooltip:
      'Marketing typically runs at 3% of revenue. Based on this month\'s revenue, ~$929 would be expected. You spent $2,729 — $1,800 above what your revenue justified.',
    sparkData: [800, 900, 850, 920, 880, 2729],
  },
  {
    label: 'Refunds & Allowances',
    headline: '+1.4K',
    detail: '$2,098 this month vs $698 expected',
    tooltip:
      'Refunds & Allowances typically runs at 2% of revenue. Based on this month\'s revenue, ~$698 would be expected. You spent $2,098 — $1,400 above what your revenue justified.',
    sparkData: [600, 700, 650, 720, 680, 2098],
  },
];

// ---------------------------------------------------------------------------
// Sparkline config — shared base, vivid variant matches Traffic Stats spec
// ---------------------------------------------------------------------------

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
      opacityFrom: 0.3,
      opacityTo: 0,
      stops: [0, 100],
    },
  },
  colors: ['#FB5454'],
  tooltip: { enabled: false },
  dataLabels: { enabled: false },
};

// opacityFrom 0.55 — matches Traffic Stats spec rgba(251,84,84,0.55)
const SPARK_OPTIONS_VIVID: ApexOptions = {
  ...SPARK_OPTIONS,
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.55,
      opacityTo: 0,
      stops: [0, 100],
    },
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  updated?: boolean;
  refinedLabels?: boolean;
}

export default function DigHereCardMock({ updated = false, refinedLabels = false }: Props) {
  const ROWS = updated ? ROWS_UPDATED : ROWS_ORIGINAL;
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Close tooltip on outside click
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

  return (
    <div className="wna-card" ref={cardRef}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="wna-header">
        <span className="wna-title">What Needs Attention</span>
        <span className="wna-period">Based on Mar 2026</span>
      </div>

      {/* ── Stat rows ──────────────────────────────────────────────────── */}
      {ROWS.map((row, i) => (
        <div
          key={row.label}
          className={`wna-row${i === 1 ? ' wna-row--middle' : ''}`}
        >
          {/* Left — stacked text */}
          <div className="wna-row-left">

            {/* Line 1 — category */}
            <div className="wna-label-row">
              <span className={`wna-category${refinedLabels ? ' wna-category--refined' : ''}`}>{row.label}</span>
            </div>

            {/* Line 2 — headline */}
            <div className="wna-headline">{row.headline}</div>

            {/* Line 3 — detail + ⓘ */}
            <div className={`wna-detail${refinedLabels ? ' wna-detail--sm' : ''}`}>
              {row.detail}
              <span className="wna-info-wrap">
                <button
                  className="wna-info-btn"
                  aria-label={`Explain ${row.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenTooltip(openTooltip === row.label ? null : row.label);
                  }}
                >ⓘ</button>
                {openTooltip === row.label && (
                  <div className="explain-tooltip" role="tooltip">
                    {row.tooltip}
                  </div>
                )}
              </span>
            </div>

          </div>

          {/* Right — sparkline */}
          <div className="wna-spark">
            <ReactApexChart
              type="area"
              series={[{ data: row.sparkData }]}
              options={refinedLabels ? SPARK_OPTIONS_VIVID : SPARK_OPTIONS}
              width={180}
              height={56}
            />
          </div>
        </div>
      ))}

    </div>
  );
}
