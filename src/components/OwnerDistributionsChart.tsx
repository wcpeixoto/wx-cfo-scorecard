import { useRef, useState, useEffect, useId } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { ScenarioPoint, Txn } from '../lib/data/contract';
import { classifyTxn } from '../lib/cashFlow';
import { chartTokens } from '../lib/ui/chartTokens';

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

type OwnerDistSeries = {
  years: number[];
  actual: number[];
  forecast: number[];
  /** Projected full-year distributable capacity for the current year:
   *  historical YTD actual + current-year forecast surplus. Used by the
   *  signal pill and target badge. */
  projectedFullYearCapacity: number;
};

/** Historical = actual owner-distribution transactions, by year.
 *  Forecast = incremental distributable surplus above the safety/reserve line,
 *  derived from the shared operating-cash forecast (ScenarioPoint[]). Owner
 *  distributions stay out of the operating forecast itself; their projection
 *  is reconstructed here from "what cash the forecast leaves above reserve." */
function buildOwnerDistSeries(
  transactions: Txn[],
  today: Date,
  forecastProjection: ScenarioPoint[],
  reserveTarget: number,
  currentCashBalance: number
): OwnerDistSeries {
  const ownerDist = transactions.filter((t) => classifyTxn(t) === 'owner-distribution');

  const currentYear = today.getFullYear();

  const byYear = new Map<number, number>();
  for (const t of ownerDist) {
    const year = new Date(t.date).getFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + Math.abs(t.amount));
  }

  // Last forecasted end-of-year cash balance per year inside the horizon.
  const endOfYearBalance = new Map<number, number>();
  for (const p of forecastProjection) {
    const y = Number(p.month.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    endOfYearBalance.set(y, p.endingCashBalance);
  }

  const forecastYears = [...endOfYearBalance.keys()].filter((y) => y >= currentYear);
  const yearSet = new Set<number>([...byYear.keys(), ...forecastYears]);
  const years = [...yearSet].sort((a, b) => a - b);

  const currentYearActual = byYear.get(currentYear) ?? 0;
  const reserveFloor = Math.max(reserveTarget, currentCashBalance);
  const endOfCurrentYear = endOfYearBalance.get(currentYear);
  const currentYearForecastSurplus =
    endOfCurrentYear !== undefined ? Math.max(0, endOfCurrentYear - reserveFloor) : 0;

  const actual: number[] = [];
  const forecast: number[] = [];

  for (const year of years) {
    if (year < currentYear) {
      actual.push(byYear.get(year) ?? 0);
      forecast.push(0);
    } else if (year === currentYear) {
      actual.push(currentYearActual);
      forecast.push(currentYearForecastSurplus);
    } else {
      const endThis = endOfYearBalance.get(year);
      const endPrev = endOfYearBalance.get(year - 1);
      if (endThis === undefined || endPrev === undefined) {
        actual.push(0);
        forecast.push(0);
      } else {
        // Incremental surplus assumes prior-year surplus was distributed,
        // so the year starts at the reserve line. Floor negative years at 0.
        actual.push(0);
        forecast.push(Math.max(0, endThis - endPrev));
      }
    }
  }

  const projectedFullYearCapacity = currentYearActual + currentYearForecastSurplus;
  return { years, actual, forecast, projectedFullYearCapacity };
}

type PillVariant = 'insufficient' | 'above-avg' | 'below-avg' | 'on-track';
type PillConfig = { label: string; variant: PillVariant };

function computeSignalPill(
  years: number[],
  actual: number[],
  projectedFullYearCapacity: number,
  currentYear: number
): PillConfig {
  const completeIndexes = years.reduce<number[]>((acc, y, i) => {
    if (y < currentYear && actual[i] > 0) acc.push(i);
    return acc;
  }, []);

  if (completeIndexes.length < 2) {
    return { label: 'Insufficient history', variant: 'insufficient' };
  }

  const priorAvg =
    completeIndexes.reduce((sum, i) => sum + actual[i], 0) / completeIndexes.length;

  const ratio = priorAvg > 0 ? projectedFullYearCapacity / priorAvg : 0;

  if (ratio > 1.1) return { label: '↑ Above avg', variant: 'above-avg' };
  if (ratio < 0.9) return { label: '↓ Below avg', variant: 'below-avg' };
  return { label: 'On track', variant: 'on-track' };
}

function ownerDistBadgeClass(variant: PillVariant): string {
  switch (variant) {
    case 'above-avg': return 'is-critical';
    case 'below-avg': return 'is-warning';   // amber — below avg is a mixed signal, not a positive
    case 'on-track': return 'is-neutral';
    case 'insufficient': return 'is-neutral';
  }
}

type DistributionStatus = 'below_target' | 'on_target' | 'above_target';

type Props = {
  transactions: Txn[];
  today?: Date;
  distributionStatus?: DistributionStatus;
  distributionTargetAmount?: number;
  distributionActualAmount?: number;
  targetNetMargin?: number;
  forecastProjection: ScenarioPoint[];
  reserveTarget: number;
  currentCashBalance: number;
  onCompareYear?: (year: number) => void;
};

const TARGET_BADGE_CONFIG: Record<DistributionStatus, { label: string; className: string }> = {
  below_target: { label: '↓ Below target', className: 'card-status-badge is-warning' },
  on_target:    { label: '✓ On target',    className: 'card-status-badge is-healthy' },
  above_target: { label: '↑ Above target', className: 'card-status-badge is-critical' },
};

function getTargetBadgeLabel(
  status: DistributionStatus,
  forecastTotal?: number,
  targetAmount?: number
): string {
  if (forecastTotal != null && targetAmount != null && targetAmount > 0) {
    const pct = Math.round((forecastTotal / targetAmount) * 100);
    if (isFinite(pct) && !isNaN(pct)) {
      const arrow = pct >= 100 ? '↑' : '↓';
      return `${arrow} Forecast: ${pct}% of target`;
    }
  }
  return TARGET_BADGE_CONFIG[status].label;
}

export default function OwnerDistributionsChart({ transactions, today = new Date(), distributionStatus, distributionTargetAmount, distributionActualAmount, targetNetMargin, forecastProjection, reserveTarget, currentCashBalance, onCompareYear }: Props) {
  const { years, actual, forecast, projectedFullYearCapacity } = buildOwnerDistSeries(
    transactions,
    today,
    forecastProjection,
    reserveTarget,
    currentCashBalance
  );

  const currentYear = today.getFullYear();
  const titleTooltipId = useId();
  const pill = computeSignalPill(years, actual, projectedFullYearCapacity, currentYear);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Historical years only: year < currentYear with actual data, sorted descending
  const actualYears = years
    .filter((y, i) => y < currentYear && actual[i] > 0)
    .sort((a, b) => b - a);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isDropdownOpen]);

  function handleYearSelect(year: number) {
    setIsDropdownOpen(false);
    onCompareYear?.(year);
  }

  const options: ApexOptions = {
    chart: {
      type: 'bar',
      stacked: true,
      toolbar: { show: false },
      fontFamily: 'Outfit, sans-serif',
      background: 'transparent',
    },
    colors: [chartTokens.brand, chartTokens.brandSecondary],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '39%',
        borderRadius: 5,
        borderRadiusApplication: 'end',
        borderRadiusWhenStacked: 'last',
        dataLabels: {
          total: {
            enabled: true,
            formatter: (val: string | undefined) => formatCompact(Number(val ?? 0)),
            offsetY: -4,
            style: {
              fontSize: '12px',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 600,
              color: '#475467',
            },
          },
        },
      },
    },
    dataLabels: { enabled: false },
    stroke: {
      show: true,
      width: 2,
      colors: ['transparent'],
    },
    xaxis: {
      categories: years.map(String),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { fontSize: '12px', colors: chartTokens.axisText } },
      crosshairs: { width: 'barWidth', opacity: 0 },
    },
    yaxis: {
      tickAmount: 4,
      forceNiceScale: true,
      labels: {
        formatter: (val: number) => '$' + (val / 1000).toFixed(0) + 'k',
        style: { fontSize: '12px', colors: chartTokens.axisText },
      },
    },
    grid: {
      borderColor: chartTokens.gridBorder,
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
    states: {
      hover: { filter: { type: 'none' } },
      active: { filter: { type: 'none' } },
    },
    legend: {
      show: false,
    },
    tooltip: {
      theme: 'light',
      shared: true,
      intersect: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      custom: ({ series, dataPointIndex, w }: { series: number[][], dataPointIndex: number, w: any }) => {
        const actualVal = Number(series[0]?.[dataPointIndex] ?? 0);
        const forecastVal = Number(series[1]?.[dataPointIndex] ?? 0);
        const total = actualVal + forecastVal;
        const year = w.globals.labels?.[dataPointIndex] ?? '';

        const dot = (color: string) =>
          `<span style="background-color:${color};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;flex-shrink:0;vertical-align:middle;"></span>`;

        let rows = '';
        if (actualVal > 0) {
          rows += `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            ${dot(chartTokens.brand)}
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">Actual</span>
              <span class="apexcharts-tooltip-text-y-value">${formatCompact(actualVal)}</span>
            </div>
          </div>`;
        }
        if (forecastVal > 0) {
          rows += `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            ${dot(chartTokens.brandSecondary)}
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">Forecast</span>
              <span class="apexcharts-tooltip-text-y-value">${formatCompact(forecastVal)}</span>
            </div>
          </div>`;
        }

        const totalRow = (actualVal > 0 && forecastVal > 0)
          ? `<div class="owl-tooltip-total">
              <span class="owl-tooltip-total-label">Total</span>
              <span class="owl-tooltip-total-value">${formatCompact(total)}</span>
            </div>`
          : '';

        return `<div class="owl-tooltip-inner">
          <div class="apexcharts-tooltip-title">${year}</div>
          ${rows}
          ${totalRow}
        </div>`;
      },
    },
  };

  const series = [
    { name: 'Actual', data: actual },
    { name: 'Forecast', data: forecast },
  ];

  return (
    <article className="owner-dist-card">
      <div className="owner-dist-header">
        <div className="owner-dist-header-left">
          <div className="owner-dist-title-row">
            <h3 className="owner-dist-title">Owner Distributions</h3>
            <span className="db-tooltip-wrap">
              <button
                type="button"
                className="db-tooltip-btn"
                aria-label="Owner Distributions explanation"
                aria-describedby={titleTooltipId}
              >
                &#9432;
              </button>
              <div id={titleTooltipId} role="tooltip" className="db-tooltip-panel owner-dist-tooltip-panel">
                <ul className="db-tooltip-list">
                  <li>You can change your net profit goal in Settings.</li>
                </ul>
              </div>
            </span>
          </div>
          {targetNetMargin && targetNetMargin > 0 && distributionTargetAmount && distributionTargetAmount > 0 && (
            <p className="owner-dist-subtitle">
              {Math.round(targetNetMargin * 100)}% net profit goal: ${Math.round(distributionTargetAmount / 1000)}<span className="forecast-unit">K</span>
            </p>
          )}
        </div>
        {distributionStatus
          ? <span className={TARGET_BADGE_CONFIG[distributionStatus].className}>{getTargetBadgeLabel(distributionStatus, projectedFullYearCapacity, distributionTargetAmount)}</span>
          : <span className={`card-status-badge ${ownerDistBadgeClass(pill.variant)}`}>{pill.label}</span>
        }
      </div>
      <div>
        <div className="owner-dist-legend-row">
          <span className="owner-dist-legend-item">
            <span className="owner-dist-legend-dot actual"></span>
            Actual
          </span>
          <span className="owner-dist-legend-item">
            <span className="owner-dist-legend-dot forecast"></span>
            Forecast
          </span>
        </div>
        <div className="owner-dist-chart">
          <Chart options={options} series={series} type="bar" height={229} />
        </div>
      </div>
      {actualYears.length > 0 && (
        <div className="owner-dist-footer">
          <div className="action-dropdown" ref={dropdownRef}>
            <button
              className="owner-dist-forecast-action"
              onClick={() => setIsDropdownOpen(prev => !prev)}
            >
              Compare {currentYear} to a past year
            </button>
            {isDropdownOpen && (
              <ul className="action-dropdown-menu">
                {actualYears.map(year => (
                  <li key={year}>
                    <button onClick={() => handleYearSelect(year)}>{year}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
