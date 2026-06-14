import { useId } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { KpiCard } from '../lib/data/contract';

type KpiCardSparkline = { data: number[]; color: string; categories?: string[] };

function formatSparkY(val: number, format: KpiCard['format']): string {
  if (format === 'percent') return `${val.toFixed(1)}%`;
  if (format === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(val);
  }
  return val.toLocaleString();
}

type KpiCardsProps = {
  cards: KpiCard[];
  comparisonPeriodLabel?: string;
  sparklinesById?: Record<string, KpiCardSparkline>;
};

const EPSILON = 0.00001;

// Ambient 12-month trailing sparkline. Color is supplied by the caller
// (brand blue for Revenue, cost-spike coral for Expenses).
//
// Mix `hex` toward white by `amount` (0 = same color, 1 = pure white).
// Used to derive a tinted end-stop for the area gradient so it fades into
// a lighter version of the stroke color, not white — produces the soft
// color-cloud fill from the TailAdmin Sales reference.
function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(lr)}${h(lg)}${h(lb)}`;
}

function buildSparkOptions(
  color: string,
  format: KpiCard['format'],
  categories: string[],
): ApexOptions {
  return {
    chart: {
      type: 'area',
      sparkline: { enabled: true },
      toolbar: { show: false },
      accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
      animations: { enabled: false },
      fontFamily: 'Outfit, sans-serif',
    },
    stroke: { curve: 'smooth', width: 1, colors: [color] },
    fill: {
      type: 'gradient',
      gradient: {
        opacityFrom: 0.55,
        opacityTo: 0,
        gradientToColors: [lighten(color, 0.6)],
        stops: [0, 100],
      },
    },
    colors: [color],
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 3 } },
    grid: { show: false },
    xaxis: { categories, labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { show: false } },
    tooltip: {
      enabled: true,
      theme: 'light',
      x: {
        formatter: (_v: number, opts?: { dataPointIndex: number }) =>
          opts ? categories[opts.dataPointIndex] ?? '' : '',
      },
      y: {
        formatter: (val: number) => formatSparkY(val, format),
        title: { formatter: () => '' },
      },
      marker: { show: false },
    },
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
        // Arrow glyph follows the direction of the change; badge color follows
        // favorability (sentiment), so e.g. a fall in Expenses is a green ↓.
        const directionClass = hasComparablePercent
          ? card.trend === 'up'
            ? 'is-up'
            : card.trend === 'down'
              ? 'is-down'
              : 'is-flat'
          : 'is-flat';
        const sentimentClass = hasComparablePercent
          ? card.sentiment === 'up'
            ? 'is-up'
            : card.sentiment === 'down'
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
            <div className="kpi-card-header">
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
              <div className="kpi-trend-marker">
                <span className={`kpi-badge ${sentimentClass}`}>
                  {directionClass === 'is-up' && (
                    <svg
                      aria-hidden="true"
                      className="kpi-change-arrow"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M7.9974 2.66602L7.9974 13.3336M4 6.66334L7.99987 2.66602L12 6.66334"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {directionClass === 'is-down' && (
                    <svg
                      aria-hidden="true"
                      className="kpi-change-arrow"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M7.9974 13.3336L7.9974 2.66602M4 9.33619L7.99987 13.3335L12 9.33619"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  <span className="kpi-change-percent">{percentDelta}</span>
                </span>
              </div>
            </div>
            <div className="kpi-value-row">
              <div className="kpi-value-col">
                <h2 className={`kpi-value${valueColorClass}`}>{formatValue(card.value, card.format)}</h2>
                <span className="kpi-vs-label">
                  <span className="kpi-vs-part">vs {formatPriorValue(card.previousValue, card.format)}</span>{' '}
                  <span className="kpi-vs-part">{comparisonPeriodLabel}</span>
                </span>
              </div>
              {spark && spark.data.length > 1 && (
                <div className="kpi-card-spark" aria-hidden="true">
                  <ReactApexChart
                    type="area"
                    series={[{ data: spark.data }]}
                    options={buildSparkOptions(spark.color, card.format, spark.categories ?? [])}
                    width="100%"
                    height={44}
                  />
                </div>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
