import { useId } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { KpiCard } from '../lib/data/contract';

type KpiCardSparkline = { data: number[]; color: string };

type KpiCardsProps = {
  cards: KpiCard[];
  comparisonPeriodLabel?: string;
  sparklinesById?: Record<string, KpiCardSparkline>;
};

const EPSILON = 0.00001;

// Ambient 12-month trailing sparkline. Color is supplied by the caller
// (brand blue for Revenue, cost-spike coral for Expenses).
function buildSparkOptions(color: string): ApexOptions {
  return {
    chart: {
      type: 'area',
      sparkline: { enabled: true },
      toolbar: { show: false },
      accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
      animations: { enabled: false },
      fontFamily: 'Outfit, sans-serif',
    },
    stroke: { curve: 'smooth', width: 1.5, colors: [color] },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0, stops: [0, 100] },
    },
    colors: [color],
    dataLabels: { enabled: false },
    markers: { size: 0 },
    grid: { show: false },
    xaxis: { labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { show: false } },
    tooltip: { enabled: false },
    legend: { show: false },
  };
}

const HEALTH_METRIC_IDS = new Set(['net', 'savingsRate']);

function formatValue(value: number, format: KpiCard['format']): string {
  if (format === 'currency') {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  }

  if (format === 'percent') {
    return `${value.toFixed(1)}%`;
  }

  return value.toLocaleString();
}

function formatAbsoluteDelta(card: KpiCard): string {
  const delta = card.value - card.previousValue;
  const sign = delta > EPSILON ? '+' : delta < -EPSILON ? '-' : '';
  const magnitude = Math.abs(delta);

  if (card.format === 'currency') {
    const value = magnitude.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
    return `Δ ${sign}${value}`;
  }

  if (card.format === 'percent') {
    return `Δ ${sign}${magnitude.toFixed(1)} pts`;
  }

  return `Δ ${sign}${magnitude.toLocaleString()}`;
}

// Prior comparison value shown in the footer ("vs $147 in May 2025").
// Currency renders as whole dollars and number as locale, matching the main
// value; percent uses two decimals so small prior rates (e.g. 0.27%) stay
// legible rather than rounding to a single decimal.
function formatPriorValue(value: number, format: KpiCard['format']): string {
  if (format === 'currency') {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  }

  if (format === 'percent') {
    return `${value.toFixed(2)}%`;
  }

  return value.toLocaleString();
}

function formatPercentDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${Math.round(value)}%`;
}

export default function KpiCards({ cards, comparisonPeriodLabel = 'prior period', sparklinesById }: KpiCardsProps) {
  const netTooltipId = useId();
  return (
    <section className="kpi-grid" aria-label="Key metrics">
      {cards.map((card) => {
        const hasComparablePercent = card.deltaPercent !== null && !Number.isNaN(card.deltaPercent);
        const trendClass = hasComparablePercent
          ? card.trend === 'up'
            ? 'is-up'
            : card.trend === 'down'
              ? 'is-down'
              : 'is-flat'
          : 'is-flat';
        const absoluteDelta = formatAbsoluteDelta(card);
        const percentDelta = formatPercentDelta(card.deltaPercent);

        const isHealthMetric = HEALTH_METRIC_IDS.has(card.id);
        const valueColorClass = isHealthMetric
          ? card.value < -EPSILON
            ? ' is-negative'
            : card.value > EPSILON
              ? ' is-positive'
              : ''
          : '';

        const spark = sparklinesById?.[card.id];

        return (
          <article className="kpi-card" key={card.id}>
            <div className="kpi-label">
              {card.label}
              {card.id === 'net' && (
                <span className="db-tooltip-wrap">
                  <button
                    type="button"
                    className="db-tooltip-btn"
                    aria-label="Profit explanation"
                    aria-describedby={netTooltipId}
                  >
                    &#9432;
                  </button>
                  <div id={netTooltipId} role="tooltip" className="db-tooltip-panel is-wide">
                    We call this Profit to keep things simple. Technically, it&rsquo;s net cash flow: revenue minus expenses for this period, excluding transfers and financing.
                  </div>
                </span>
              )}
            </div>
            <div className="kpi-value-row">
              <p className={`kpi-value${valueColorClass}`}>{formatValue(card.value, card.format)}</p>
              {spark && spark.data.length > 1 && (
                <div className="kpi-card-spark" aria-hidden="true">
                  <ReactApexChart
                    type="area"
                    series={[{ data: spark.data }]}
                    options={buildSparkOptions(spark.color)}
                    width="100%"
                    height={40}
                  />
                </div>
              )}
            </div>
            <div className="kpi-footer">
              <span className={`kpi-badge ${trendClass}`}>
                <span aria-hidden="true" className="kpi-change-arrow">
                  {trendClass === 'is-up' ? '▲' : trendClass === 'is-down' ? '▼' : '●'}
                </span>
                <span className="kpi-change-percent">{percentDelta}</span>
              </span>
              <span className="kpi-vs-label">vs {formatPriorValue(card.previousValue, card.format)} {comparisonPeriodLabel}</span>
            </div>
          </article>
        );
      })}
    </section>
  );
}
