import { useRef, useState, useEffect, useId } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { ScenarioPoint, Txn } from '../lib/data/contract';
import { classifyTxn, isBusinessIncomeCategory } from '../lib/cashFlow';
import { chartTokens } from '../lib/ui/chartTokens';

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function formatCompactWhole(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

type OwnerDistSeries = {
  years: number[];
  actual: number[];
  forecast: number[];
  /** Positive delta above the canonical forecast, per year. Non-zero only when
   *  a simulatedProjection is supplied and it produces MORE distributable
   *  surplus than the canonical projection. Stacks on top of the Forecast bar. */
  simulated: number[];
  /** Projected full-year distributable capacity for the current year:
   *  historical YTD actual + current-year forecast + simulated delta. Used by
   *  the signal pill and target badge — reflects simulation when active. */
  projectedFullYearCapacity: number;
};

/** Walk one projection and compute year-keyed incremental surplus above the
 *  reserve floor. Current year = end-of-year cash − reserve floor (matches the
 *  slider card's payout basis). Future years = YoY end-of-year delta, assuming
 *  the prior year's surplus was distributed so each year resets to the floor. */
function surplusByYear(
  projection: ScenarioPoint[],
  currentYear: number,
  reserveTarget: number,
): { surplus: Map<number, number>; monthsInHorizon: Set<string> } {
  const endOfYearBalance = new Map<number, number>();
  const monthsInHorizon = new Set<string>();
  for (const p of projection) {
    const y = Number(p.month.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    endOfYearBalance.set(y, p.endingCashBalance);
    monthsInHorizon.add(p.month);
  }
  const surplus = new Map<number, number>();
  for (const [year, endThis] of endOfYearBalance) {
    if (year === currentYear) {
      surplus.set(year, Math.max(0, endThis - reserveTarget));
    } else if (year > currentYear) {
      const endPrev = endOfYearBalance.get(year - 1);
      if (endPrev !== undefined) {
        surplus.set(year, Math.max(0, endThis - endPrev));
      }
    }
  }
  return { surplus, monthsInHorizon };
}

/** Historical = actual owner-distribution transactions, by year.
 *  Forecast = canonical distributable surplus above the reserve line.
 *  Simulated = positive delta from the slider's reprojection above the
 *  canonical forecast (stacks on top; zero when no simulatedProjection or when
 *  the slider reduces surplus). */
function buildOwnerDistSeries(
  transactions: Txn[],
  today: Date,
  forecastProjection: ScenarioPoint[],
  simulatedProjection: ScenarioPoint[] | undefined,
  reserveTarget: number
): OwnerDistSeries {
  const ownerDist = transactions.filter((t) => classifyTxn(t) === 'owner-distribution');

  const currentYear = today.getFullYear();

  const byYear = new Map<number, number>();
  for (const t of ownerDist) {
    const year = new Date(t.date).getFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + Math.abs(t.amount));
  }

  const { surplus: canonicalSurplus, monthsInHorizon } = surplusByYear(
    forecastProjection,
    currentYear,
    reserveTarget,
  );
  const simulatedSurplus = simulatedProjection
    ? surplusByYear(simulatedProjection, currentYear, reserveTarget).surplus
    : null;

  // Show the current year and the next year (next year's forecast is partial —
  // the horizon ends mid-year — but it's still plotted). Beyond next year, only
  // plot a forecast year when the horizon covers its full calendar year (Dec).
  const forecastYears = [...canonicalSurplus.keys()].filter(
    (y) =>
      y === currentYear ||
      y === currentYear + 1 ||
      (y > currentYear + 1 && monthsInHorizon.has(`${y}-12`)),
  );
  const yearSet = new Set<number>([...byYear.keys(), ...forecastYears]);
  const years = [...yearSet].sort((a, b) => a - b);

  const currentYearActual = byYear.get(currentYear) ?? 0;

  const actual: number[] = [];
  const forecast: number[] = [];
  const simulated: number[] = [];

  for (const year of years) {
    if (year < currentYear) {
      actual.push(byYear.get(year) ?? 0);
      forecast.push(0);
      simulated.push(0);
    } else {
      const canonical = canonicalSurplus.get(year) ?? 0;
      const sim = simulatedSurplus?.get(year) ?? canonical;
      // Simulated bar = positive delta above canonical. If the slider REDUCES
      // surplus, the canonical Forecast bar still shows; the chart doesn't
      // currently express below-canonical scenarios (acceptable v1 — the slider
      // card's hero copy already states when a what-if blocks the payout).
      actual.push(year === currentYear ? currentYearActual : 0);
      forecast.push(canonical);
      simulated.push(Math.max(0, sim - canonical));
    }
  }

  const currentYearIdx = years.indexOf(currentYear);
  const currentYearForecast = currentYearIdx >= 0 ? forecast[currentYearIdx] : 0;
  const currentYearSimulated = currentYearIdx >= 0 ? simulated[currentYearIdx] : 0;
  const projectedFullYearCapacity =
    currentYearActual + currentYearForecast + currentYearSimulated;
  return { years, actual, forecast, simulated, projectedFullYearCapacity };
}

/** Annual income by calendar year = NET Business Income (Sales + Other Income,
 *  signed), summed from the same transactions the card already receives. This
 *  matches the owner's accounting "Total Business Income" line exactly —
 *  including the occasional negative entry (reversal/correction) that the app's
 *  positive-only `revenue` rollup omits. Keyed by calendar year
 *  ("YYYY-MM" → YYYY) to align with the chart's year axis; current year is YTD. */
function incomeByYear(transactions: Txn[]): Map<number, number> {
  const byYear = new Map<number, number>();
  for (const txn of transactions) {
    if (!isBusinessIncomeCategory(txn.category)) continue;
    const match = txn.month.match(/^(\d{4})-\d{2}$/);
    if (!match) continue;
    const year = Number.parseInt(match[1], 10);
    byYear.set(year, (byYear.get(year) ?? 0) + (txn.rawAmount ?? 0));
  }
  return byYear;
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
  /** Canonical projection — feeds the Forecast bar. */
  forecastProjection: ScenarioPoint[];
  /** Slider-driven projection (when active). When present and producing more
   *  distributable surplus than the canonical, the positive delta stacks on
   *  top as the Simulated bar. */
  simulatedProjection?: ScenarioPoint[];
  reserveTarget: number;
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

export default function OwnerDistributionsChart({ transactions, today = new Date(), distributionStatus, distributionTargetAmount, distributionActualAmount, targetNetMargin, forecastProjection, simulatedProjection, reserveTarget, onCompareYear }: Props) {
  const { years, actual, forecast, simulated, projectedFullYearCapacity } = buildOwnerDistSeries(
    transactions,
    today,
    forecastProjection,
    simulatedProjection,
    reserveTarget
  );
  const hasSimulated = simulated.some((v) => v > 0);

  const currentYear = today.getFullYear();
  const titleTooltipId = useId();
  const pill = computeSignalPill(years, actual, projectedFullYearCapacity, currentYear);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Revenue is NOT plotted — it appears only in the bar tooltip. "Revenue" here =
  // net Business Income (matches the books); NOT the app's positive-only
  // `revenue` metric — see incomeByYear. Keyed to the chart's year axis.
  const revenueMap = incomeByYear(transactions);
  const revenueData = years.map((y) => revenueMap.get(y) ?? 0);

  // Historical years only: year < currentYear with actual data, sorted descending
  const actualYears = years
    .filter((y, i) => y < currentYear && actual[i] > 0)
    .sort((a, b) => b - a);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!isDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isDropdownOpen]);

  // Past-year comparison opens the modal ProjectionCompareDrawer (parent-owned).
  // Independent of the Revenue toggle — selecting a year does not change it.
  function handleYearSelect(year: number) {
    setIsDropdownOpen(false);
    onCompareYear?.(year);
  }

  const options: ApexOptions = {
    chart: {
      type: 'bar',
      stacked: true,
      toolbar: { show: false },
      accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
      fontFamily: 'Outfit, sans-serif',
      background: 'transparent',
    },
    // Color hierarchy: brand (Distribution = real) → brandSecondary (canonical
    // Forecast = softer brand tint) → info (Simulated = cyan hue-shift so the
    // what-if reads as a different category, not just a paler forecast). When
    // no simulation is active, the Simulated series is all zeros so no third
    // bar segment renders.
    colors: [chartTokens.brand, chartTokens.brandSecondary, chartTokens.info],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '39%',
        borderRadius: 5,
        borderRadiusApplication: 'end',
        borderRadiusWhenStacked: 'last',
        dataLabels: {
          position: 'top',
          total: {
            // Stack total (Distribution + Forecast) above each bar.
            enabled: true,
            formatter: (val: string | undefined) => formatCompactWhole(Number(val ?? 0)),
            offsetY: -4,
            style: {
              fontSize: '11px',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 500,
              color: '#475467',
            },
          },
        },
      },
    },
    // No per-point labels; the distribution total sits above the bars via
    // plotOptions.bar.dataLabels.total.
    dataLabels: { enabled: false },
    stroke: { show: true, width: 2, colors: ['transparent'] },
    xaxis: {
      categories: years.map(String),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { fontSize: '12px', colors: chartTokens.axisText } },
      crosshairs: { show: false },
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
        // Bar series (Distribution/Forecast) are looked up by name so the
        // tooltip stays correct regardless of series order.
        const valueByName = (name: string) => {
          const idx = w?.globals?.seriesNames?.indexOf(name) ?? -1;
          return idx >= 0 ? Number(series[idx]?.[dataPointIndex] ?? 0) : 0;
        };
        const actualVal = valueByName('Distribution');
        const forecastVal = valueByName('Forecast');
        const simulatedVal = valueByName('Simulated');
        // Revenue isn't a plotted series — read it from the closure by point index.
        const revenueVal = revenueData[dataPointIndex] ?? 0;
        const total = actualVal + forecastVal + simulatedVal;
        const year = w.globals.labels?.[dataPointIndex] ?? '';

        // A future year with no projected surplus to distribute.
        if (Number(year) > currentYear && total <= 0) {
          return `<div class="owl-tooltip-inner">
            <div class="apexcharts-tooltip-title">${year}</div>
            <div class="owl-tooltip-note">No forecast surplus<br>to distribute.</div>
          </div>`;
        }

        const dot = (color: string) =>
          `<span style="background-color:${color};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;flex-shrink:0;vertical-align:middle;"></span>`;

        // Distributions show as a margin (share of revenue), not a dollar value.
        // Falls back to the dollar amount when revenue is unavailable (e.g. a
        // future year with no income yet).
        const marginPct = (val: number) =>
          revenueVal > 0 ? `${Math.round((val / revenueVal) * 100)}%` : formatCompactWhole(val);

        const revenueRow = revenueVal > 0
          ? `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            ${dot(chartTokens.brand700)}
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">Revenue</span>
              <span class="apexcharts-tooltip-text-y-value">${formatCompact(revenueVal)}</span>
            </div>
          </div>`
          : '';

        let rows = '';
        if (actualVal > 0) {
          rows += `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            ${dot(chartTokens.brand)}
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">Distribution</span>
              <span class="apexcharts-tooltip-text-y-value">${marginPct(actualVal)}</span>
            </div>
          </div>`;
        }
        if (forecastVal > 0) {
          rows += `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            ${dot(chartTokens.brandSecondary)}
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">Forecast</span>
              <span class="apexcharts-tooltip-text-y-value">${marginPct(forecastVal)}</span>
            </div>
          </div>`;
        }
        if (simulatedVal > 0) {
          rows += `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            ${dot(chartTokens.info)}
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">Simulated</span>
              <span class="apexcharts-tooltip-text-y-value">${marginPct(simulatedVal)}</span>
            </div>
          </div>`;
        }

        const nonZeroCount = (actualVal > 0 ? 1 : 0) + (forecastVal > 0 ? 1 : 0) + (simulatedVal > 0 ? 1 : 0);
        const totalRow = nonZeroCount >= 2
          ? `<div class="owl-tooltip-total">
              <span class="owl-tooltip-total-label">Total</span>
              <span class="owl-tooltip-total-value">${marginPct(total)}</span>
            </div>`
          : '';

        return `<div class="owl-tooltip-inner">
          <div class="apexcharts-tooltip-title">${year}</div>
          ${revenueRow}
          ${rows}
          ${totalRow}
        </div>`;
      },
    },
  };

  // Stacked bars: Distribution + Forecast + Simulated. Simulated is the
  // positive delta above canonical, all-zero when no slider what-if is active.
  // Revenue is not plotted — it appears only in the bar tooltip.
  const series = [
    { name: 'Distribution', data: actual },
    { name: 'Forecast', data: forecast },
    { name: 'Simulated', data: simulated },
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
              {Math.round(targetNetMargin * 100)}% net profit goal for {currentYear}: ${Math.round(distributionTargetAmount / 1000)}K
            </p>
          )}
        </div>
        {distributionStatus
          ? <span className={TARGET_BADGE_CONFIG[distributionStatus].className}>{getTargetBadgeLabel(distributionStatus, projectedFullYearCapacity, distributionTargetAmount)}</span>
          : <span className={`card-status-badge ${ownerDistBadgeClass(pill.variant)}`}>{pill.label}</span>
        }
      </div>
      <div className="owner-dist-plot">
        <div className="owner-dist-legend-row">
          <div className="owner-dist-legend-items">
            <span className="owner-dist-legend-item">
              <span className="owner-dist-legend-dot actual"></span>
              Distribution
            </span>
            <span className="owner-dist-legend-item">
              <span className="owner-dist-legend-dot forecast"></span>
              Forecast
            </span>
            {hasSimulated && (
              <span className="owner-dist-legend-item">
                <span className="owner-dist-legend-dot simulated"></span>
                Simulated
              </span>
            )}
          </div>
        </div>
        <div className="owner-dist-chart">
          <Chart options={options} series={series} type="bar" height={210} />
        </div>
      </div>
      {actualYears.length > 0 && (
        <div className="owner-dist-footer">
          <div className="action-dropdown" ref={dropdownRef}>
            <button
              type="button"
              className="owner-dist-forecast-action"
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={isDropdownOpen}
            >
              Compare {currentYear} to a past year
            </button>
            {isDropdownOpen && (
              <ul className="action-dropdown-menu" role="menu" aria-label={`Compare ${currentYear} to a past year`}>
                {actualYears.map((year) => (
                  <li key={year}>
                    <button type="button" role="menuitem" onClick={() => handleYearSelect(year)}>
                      {year}
                    </button>
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
