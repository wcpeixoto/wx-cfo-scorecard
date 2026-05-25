import { useId, useMemo } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { MonthlyRollup, Txn } from '../lib/data/contract';
import { selectPayrollHealth } from '../lib/kpis/payrollSeries';
import { chartTokens } from '../lib/ui/chartTokens';

function formatWholePct(value: number | null): string {
  if (value == null) return '—';
  return `${Math.round(value)}%`;
}

function formatRevPerDollar(revenue: number, payroll: number): string {
  if (!(payroll > 0)) return '—';
  return `$${(revenue / payroll).toFixed(2)}`;
}

function formatExcess(perMonth: number | null): string {
  if (perMonth == null || perMonth <= 0) return '—';
  if (perMonth >= 1000) return `$${(perMonth / 1000).toFixed(1)}K`;
  return `$${Math.round(perMonth)}`;
}

type Props = {
  txns: readonly Txn[];
  monthlyRollups: MonthlyRollup[];
  payrollTargetPercent: number;
  /** Payroll-specific excess $/mo, reused from the excess-cost card's
   *  methodology (computeEfficiencyOpportunities). Null when unavailable. */
  payrollExcessPerMonth: number | null;
};

export default function PayrollEfficiencyCard({
  txns,
  monthlyRollups,
  payrollTargetPercent,
  payrollExcessPerMonth,
}: Props) {
  const { points, current, bestYear } = useMemo(
    () => selectPayrollHealth(txns, monthlyRollups),
    [txns, monthlyRollups],
  );
  const tooltipId = useId();

  const hasData = points.length > 0;

  const categories = useMemo(
    () => points.map((p) => (p.isCurrent && p.isPartial ? `${p.year} YTD` : p.year)),
    [points],
  );

  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'area',
        sparkline: { enabled: true },
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
      // Subtle dashed reference line + far-right label at the wired payroll target.
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
      // Subtle marker on the trailing (current / YTD) point only.
      markers: {
        size: 0,
        discrete:
          hasData && current?.isCurrent
            ? [
                {
                  seriesIndex: 0,
                  dataPointIndex: points.length - 1,
                  fillColor: chartTokens.brand,
                  strokeColor: '#FFFFFF',
                  size: 4,
                },
              ]
            : [],
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
          formatter: (val: number | null) => (val == null ? 'No revenue' : `${Math.round(val)}%`),
          title: { formatter: () => 'Payroll' },
        },
        marker: { show: false },
      },
    }),
    [categories, hasData, current, points.length, payrollTargetPercent],
  );

  const series = useMemo(
    () => [{ name: 'Payroll % of revenue', data: points.map((p) => p.payrollPct) }],
    [points],
  );

  const revCurrent = current ? formatRevPerDollar(current.revenue, current.payroll) : '—';
  const revBest = bestYear ? formatRevPerDollar(bestYear.revenue, bestYear.payroll) : '—';

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
                  <li className="db-tooltip-body">
                    Payroll is usually the biggest bite out of revenue. This card shows whether that
                    cost is getting more or less efficient over time.
                  </li>
                  <li className="db-tooltip-body">
                    Best year means your lowest payroll % in the yearly trend.
                  </li>
                  <li className="db-tooltip-body">
                    “More than your best stretch” compares this year's average monthly payroll cost
                    against your lowest 3-month payroll stretch.
                  </li>
                  <li className="db-tooltip-body">
                    You can adjust the Payroll Target % in Settings → Rules.
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <p className="subtle">
            Best year: {formatWholePct(bestYear?.payrollPct ?? null)}
            {bestYear ? ` in ${bestYear.year}` : ''}
          </p>
        </div>
      </div>

      <div className="pe-hero">
        <div className="pe-hero-line">
          <span className="pe-hero-value">{formatWholePct(current?.payrollPct ?? null)}</span>
          <span className="pe-hero-sub">of revenue</span>
        </div>
      </div>

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
          <span className="pe-kpi-label">Revenue per $1 payroll</span>
          <span className="pe-kpi-helper">Best year: {revBest}</span>
        </div>
        <div className="pe-kpi">
          <span className="pe-kpi-value">{formatExcess(payrollExcessPerMonth)}</span>
          <span className="pe-kpi-label">More per month than your best stretch</span>
        </div>
      </div>
    </article>
  );
}
