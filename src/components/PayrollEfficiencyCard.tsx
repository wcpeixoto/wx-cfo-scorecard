import { useId, useMemo } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { PayrollRollingPoint } from '../lib/kpis/efficiencyOpportunities';
import { chartTokens } from '../lib/ui/chartTokens';

function formatWholePct(value: number | null): string {
  if (value == null) return '—';
  return `${Math.round(value)}%`;
}

function formatRevPerDollar(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  return `$${value.toFixed(2)}`;
}

function formatExcess(perMonth: number | null): string {
  if (perMonth == null || perMonth <= 0) return '—';
  if (perMonth >= 1000) return `$${(perMonth / 1000).toFixed(1)}K`;
  return `$${Math.round(perMonth)}`;
}

type Props = {
  payrollTargetPercent: number;
  /** Hero basis — payroll % of revenue over the last 3 completed months, plus
   *  the lowest such % (best stretch) and its window. Same 3-month engine as
   *  Money Left (computeEfficiencyOpportunities), so the two cards agree. */
  payrollTodayPct: number | null;
  payrollBestPct: number | null;
  payrollBestWindowLabel: string | null;
  /** Footer excess $/mo vs. the best 3-month stretch (same engine). */
  payrollExcessPerMonth: number | null;
  /** Chart series — one entry per valid 3-month rolling window in the
   *  24-month lookback (up to 22). Same engine path as the hero/best fields,
   *  so chart, footer, hero, and subtitle all read from one basis. */
  payrollRollingSeries: readonly PayrollRollingPoint[];
};

export default function PayrollEfficiencyCard({
  payrollTargetPercent,
  payrollTodayPct,
  payrollBestPct,
  payrollBestWindowLabel,
  payrollExcessPerMonth,
  payrollRollingSeries,
}: Props) {
  const tooltipId = useId();

  const hasData = payrollRollingSeries.length > 0;

  const currentIdx = useMemo(
    () => payrollRollingSeries.findIndex((p) => p.isCurrent),
    [payrollRollingSeries],
  );
  const bestIdx = useMemo(
    () => payrollRollingSeries.findIndex((p) => p.isBest),
    [payrollRollingSeries],
  );
  const currentPoint = currentIdx >= 0 ? payrollRollingSeries[currentIdx] : null;
  const bestPoint = bestIdx >= 0 ? payrollRollingSeries[bestIdx] : null;

  const categories = useMemo(
    () => payrollRollingSeries.map((p) => p.label),
    [payrollRollingSeries],
  );

  // Hide ineligible windows by passing null y-values (Apex renders a gap).
  // The current window is always shown so the hero ↔ rightmost-point invariant
  // holds even in the theoretical edge case where the current window is
  // somehow ineligible — Wesley's hard rule is that ineligible windows can't
  // be misread as best-stretch candidates, and a null-gap satisfies that.
  const seriesData = useMemo(
    () =>
      payrollRollingSeries.map((p) =>
        p.isBenchmarkEligible || p.isCurrent ? p.payrollPct : null,
      ),
    [payrollRollingSeries],
  );

  const options: ApexOptions = useMemo(() => {
    // Markers: current (brand) + best (success). Best lands on an eligible
    // window by construction (engine gate), so the marker can't visually
    // imply a different best than the card label.
    const discrete: Array<{
      seriesIndex: number;
      dataPointIndex: number;
      fillColor: string;
      strokeColor: string;
      size: number;
    }> = [];
    if (hasData && currentIdx >= 0) {
      discrete.push({
        seriesIndex: 0,
        dataPointIndex: currentIdx,
        fillColor: chartTokens.brand,
        strokeColor: '#FFFFFF',
        size: 5,
      });
    }
    if (hasData && bestIdx >= 0 && bestIdx !== currentIdx) {
      discrete.push({
        seriesIndex: 0,
        dataPointIndex: bestIdx,
        fillColor: chartTokens.success,
        strokeColor: '#FFFFFF',
        size: 5,
      });
    }

    return {
      chart: {
        type: 'area',
        sparkline: { enabled: true },
        accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
        fontFamily: 'Outfit, sans-serif',
        background: 'transparent',
      },
      colors: [chartTokens.brand],
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2 },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.32, opacityTo: 0.04, stops: [0, 100] },
      },
      // Subtle dashed reference line at the wired payroll target.
      annotations: {
        yaxis: hasData
          ? [
              {
                y: payrollTargetPercent,
                borderColor: chartTokens.crosshairStroke,
                strokeDashArray: 4,
                label: {
                  text: `${payrollTargetPercent}% target`,
                  position: 'right',
                  textAnchor: 'end',
                  offsetX: -2,
                  offsetY: 13,
                  borderWidth: 0,
                  borderColor: 'transparent',
                  style: {
                    background: 'transparent',
                    color: chartTokens.axisText,
                    fontSize: '11px',
                    fontWeight: 400,
                    fontFamily: 'Outfit, sans-serif',
                  },
                },
              },
            ]
          : [],
      },
      markers: {
        size: 0,
        discrete,
        hover: { size: 4 },
      },
      xaxis: { categories },
      tooltip: {
        theme: 'light',
        x: {
          formatter: (_val: number, opts?: { dataPointIndex: number }) =>
            opts ? categories[opts.dataPointIndex] ?? '' : '',
        },
        y: {
          formatter: (val: number | null) => (val == null ? 'Not benchmarked' : `${Math.round(val)}%`),
          title: { formatter: () => 'Payroll' },
        },
        marker: { show: false },
      },
    };
  }, [categories, hasData, currentIdx, bestIdx, payrollTargetPercent]);

  const series = useMemo(
    () => [{ name: 'Payroll % of revenue', data: seriesData }],
    [seriesData],
  );

  const revCurrent = currentPoint ? formatRevPerDollar(currentPoint.revenuePerPayrollDollar) : '—';
  const revBest = bestPoint ? formatRevPerDollar(bestPoint.revenuePerPayrollDollar) : '—';

  return (
    <article className="pe-card">
      <div className="pe-header">
        <div className="pe-heading">
          <div className="pe-title-row">
            <h3 className="pe-title">Payroll Efficiency</h3>
            <div className="db-tooltip-wrap">
              <button
                type="button"
                className="db-tooltip-btn"
                aria-label="Payroll Efficiency explanation"
                aria-describedby={tooltipId}
              >
                &#9432;
              </button>
              <div id={tooltipId} role="tooltip" className="db-tooltip-panel pe-tooltip-panel">
                <ul className="db-tooltip-list">
                  <li><strong>What it shows</strong></li>
                  <li className="db-tooltip-body">
                    Payroll is usually the biggest bite out of revenue. The headline, chart, and
                    footer all read from the same 3-month rolling basis across the last 24 months.
                  </li>
                  <li><strong>Best stretch</strong></li>
                  <li className="db-tooltip-body">
                    Your lowest payroll % of revenue over any 3 consecutive months.
                  </li>
                  <li><strong>More than your best stretch</strong></li>
                  <li className="db-tooltip-body">
                    Compares your last 3 completed months against your best 3-month
                    payroll-to-revenue stretch.
                  </li>
                  <li><strong>Change the target</strong></li>
                  <li className="db-tooltip-body">
                    You can adjust the Payroll Target % in Settings → Rules.
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <p className="subtle">
            Best stretch: {formatWholePct(payrollBestPct)}
            {payrollBestWindowLabel ? ` · ${payrollBestWindowLabel}` : ''}
          </p>
        </div>
      </div>

      <div className="pe-hero">
        <div className="pe-hero-line">
          <span className="pe-hero-value">{formatWholePct(payrollTodayPct)}</span>
          <span className="pe-hero-sub">of revenue</span>
        </div>
      </div>

      <p className="pe-chart-caption">Last 24 months · 3-month rolling</p>
      <div className="pe-chart">
        {hasData ? (
          <Chart options={options} series={series} type="area" height={144} />
        ) : (
          <div className="pe-empty">No payroll data available.</div>
        )}
      </div>

      <div className="pe-footer">
        <div className="pe-kpi">
          <span className="pe-kpi-value">{revCurrent}</span>
          <span className="pe-kpi-label">Last 3 months revenue per $1 payroll</span>
          <span className="pe-kpi-helper">Best 3-month stretch: {revBest}</span>
        </div>
        <div className="pe-kpi">
          <span className="pe-kpi-value">{formatExcess(payrollExcessPerMonth)}</span>
          <span className="pe-kpi-label">More per month than your best stretch</span>
        </div>
      </div>
    </article>
  );
}
