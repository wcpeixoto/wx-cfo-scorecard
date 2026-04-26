/**
 * CashTrendHero — Cash Trend macro signal card (Pattern B)
 *
 * Half-width card on Big Picture, paired with CashTrendPlaceholder. Status
 * accent flows through child elements via the --cth-accent CSS custom
 * property set per status modifier class.
 *
 * Interaction model: ⓘ tooltip only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type {
  CashTrendResult,
  CashTrendStatus,
  VelocityTag,
} from '../lib/kpis/cashTrend';
import { formatCompact } from '../lib/utils/formatCompact';

type Props = {
  result: CashTrendResult;
};

const HEADLINE_BY_STATUS: Record<CashTrendStatus, string> = {
  building: 'Building cash over the last 6 months',
  treading: 'Treading water over the last 6 months',
  pressure: 'Under pressure over the last 6 months',
  burning: 'Burning cash over the last 6 months',
};

const BADGE_BY_STATUS: Record<CashTrendStatus, { label: string; cls: string }> = {
  building: { label: 'Building Cash',  cls: 'is-healthy' },
  treading: { label: 'Treading Water', cls: 'is-warning' },
  pressure: { label: 'Under Pressure', cls: 'is-pressure' },
  burning:  { label: 'Burning Cash',   cls: 'is-critical' },
};

const VELOCITY_COPY: Record<VelocityTag, string> = {
  improving: 'Margin is improving vs the prior 6 months.',
  softer: 'Margin is softer vs the prior 6 months.',
  stable: 'Margin is stable vs the prior 6 months.',
};

const TOOLTIP_TEXT =
  'T6M = the trailing six complete months. ' +
  'Six months smooths out single-month timing — a big invoice, a slow week, a one-off bill. ' +
  'The 10% target is the margin needed to fund reserve building and reinvestment, not just to break even.';

function formatSignedCompact(n: number): string {
  if (n === 0) return '$0';
  const sign = n > 0 ? '+' : '-';
  return `${sign}${formatCompact(Math.abs(n))}`;
}

function formatSignedPct(decimal: number): string {
  const pct = decimal * 100;
  if (Math.abs(pct) < 0.05) return '0.0%';
  const sign = pct > 0 ? '+' : '-';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function formatYAxisCurrency(val: number): string {
  const abs = Math.abs(val);
  const k = abs / 1000;
  const display = k < 10 ? k.toFixed(1) : Math.round(k).toString();
  if (val === 0) return '$0';
  return val < 0 ? `-$${display}K` : `+$${display}K`;
}

function formatTooltipNetCash(val: number): string {
  const abs = Math.abs(val);
  const k = abs / 1000;
  const display = k < 10 ? k.toFixed(1) : k.toFixed(1);
  return val < 0
    ? `-$${display}K net cash`
    : `+$${display}K net cash`;
}

export function CashTrendPlaceholder() {
  return (
    <div className="cth-placeholder">
      <span className="cth-placeholder-text">Coming soon</span>
    </div>
  );
}

export default function CashTrendHero({ result }: Props) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tooltipOpen) return;
    function handleOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setTooltipOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [tooltipOpen]);

  // Bar chart options + colors — recomputed together because distributed:true
  // requires the colors array length and order to match the data array.
  const { chartOptions, chartSeries } = useMemo(() => {
    const bars = result.monthlyBars;
    const colors = bars.map((b) => (b.isNegative ? '#F04438' : '#12B76A'));
    const categories = bars.map((b) => {
      // 'Jan 2026' → 'Jan'
      const space = b.label.indexOf(' ');
      return space > 0 ? b.label.slice(0, space) : b.label;
    });

    const options: ApexOptions = {
      chart: {
        type: 'bar',
        fontFamily: 'Outfit, sans-serif',
        toolbar: { show: false },
        background: 'transparent',
        height: 160,
      },
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: '39%',
          borderRadius: 5,
          borderRadiusApplication: 'end',
          distributed: true,
        },
      },
      stroke: {
        show: true,
        width: 4,
        colors: ['transparent'],
      },
      colors,
      dataLabels: { enabled: false },
      legend: { show: false },
      grid: {
        borderColor: '#EAECF0',
        strokeDashArray: 4,
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } },
      },
      xaxis: {
        categories,
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: {
          style: {
            fontSize: '12px',
            colors: Array(bars.length).fill('#667085'),
          },
        },
      },
      yaxis: {
        labels: {
          formatter: formatYAxisCurrency,
          style: { fontSize: '12px', colors: ['#667085'] },
        },
      },
      tooltip: {
        theme: 'light',
        x: { show: false },
        y: { formatter: formatTooltipNetCash },
      },
      annotations: {
        yaxis: [
          {
            y: 0,
            borderColor: '#D0D5DD',
            borderWidth: 1,
            strokeDashArray: 0,
          },
        ],
      },
    };

    const series = [
      {
        name: 'Net cash',
        data: bars.map((b) => Number(b.netCash.toFixed(2))),
      },
    ];

    return { chartOptions: options, chartSeries: series };
  }, [result.monthlyBars]);

  if (result.noData) {
    return (
      <div className="cth-card cth-card--treading" ref={cardRef}>
        <div className="cth-header">
          <div className="cth-header-left">
            <h3 className="cth-title">Cash Trend</h3>
            <p className="cth-subtitle">Last 6 complete months · vs 10% target</p>
          </div>
        </div>
        <div className="cth-empty">
          Not enough complete months yet to evaluate cash trend. Need at least 3 closed months.
        </div>
      </div>
    );
  }

  const { status, velocityTag, gap } = result;
  const headline = HEADLINE_BY_STATUS[status];
  const velocityText = VELOCITY_COPY[velocityTag];
  const badge = BADGE_BY_STATUS[status];

  const metricLine = `${formatSignedCompact(result.t6mNetCash)} net cash · ${formatSignedPct(result.t6mMargin)} of revenue`;
  const proofLine = `${result.negativeMonthCount} of ${result.monthlyBars.length} months were negative`;
  const gapClass = gap >= 0 ? 'cth-gap--positive' : 'cth-gap--accent';

  return (
    <div className={`cth-card cth-card--${status}`} ref={cardRef}>

      {/* ── Header (Pattern B) ────────────────────────────────────────── */}
      <div className="cth-header">
        <div className="cth-header-left">
          <h3 className="cth-title">Cash Trend</h3>
          <p className="cth-subtitle">Last 6 complete months · vs 10% target</p>
        </div>
        <div className="cth-header-right">
          <span className={`card-status-badge ${badge.cls}`}>
            {badge.label}
          </span>
          <span className="cth-info-wrap">
            <button
              type="button"
              className="cth-info-btn"
              aria-label="Explain Cash Trend"
              onClick={(e) => {
                e.stopPropagation();
                setTooltipOpen((v) => !v);
              }}
            >ⓘ</button>
            {tooltipOpen && (
              <div className="explain-tooltip cth-tooltip" role="tooltip">
                {TOOLTIP_TEXT}
              </div>
            )}
          </span>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="cth-body">
        <div className="cth-metric-line">{metricLine}</div>
        <div className="cth-headline">{headline}</div>

        <div className={`cth-velocity-line cth-velocity--${velocityTag}`}>
          {velocityText}
        </div>

        <div className="cth-proof-line">{proofLine}</div>
        <div className="cth-target-line">Target: 10% margin</div>
        <div className={`cth-gap-line ${gapClass}`}>
          Gap to target: {formatSignedCompact(gap)}
        </div>

        <div className="cth-chart-wrap">
          <ReactApexChart
            type="bar"
            options={chartOptions}
            series={chartSeries}
            height={160}
          />
        </div>
      </div>

    </div>
  );
}
