import { useMemo } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { MonthlyRollup, Txn } from '../lib/data/contract';
import { selectPayrollHealth } from '../lib/kpis/payrollSeries';
import { latestRollupMonth } from '../lib/kpis/incomeExpenseSeries';
import { chartTokens } from '../lib/ui/chartTokens';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatPct(value: number | null): string {
  if (value == null) return '—';
  return `${value}%`;
}

type Props = {
  txns: readonly Txn[];
  monthlyRollups: MonthlyRollup[];
  payrollTargetPercent: number;
};

export default function PayrollHealthCard({ txns, monthlyRollups, payrollTargetPercent }: Props) {
  const { points, current } = useMemo(
    () => selectPayrollHealth(txns, monthlyRollups),
    [txns, monthlyRollups],
  );

  const latestMonthName = useMemo(() => {
    const latest = latestRollupMonth(monthlyRollups);
    if (!latest) return null;
    const monthIndex = Number(latest.slice(5, 7)) - 1;
    return MONTH_NAMES[monthIndex] ?? null;
  }, [monthlyRollups]);

  const categories = useMemo(
    () => points.map((p) => (p.isCurrent && p.isPartial ? `${p.year} YTD` : p.year)),
    [points],
  );

  const tooltipTitles = useMemo(
    () =>
      points.map((p) =>
        p.isCurrent && p.isPartial && latestMonthName
          ? `${p.year} YTD through ${latestMonthName}`
          : p.year,
      ),
    [points, latestMonthName],
  );

  const hasData = points.length > 0;

  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'area',
        toolbar: { show: false },
        fontFamily: 'Outfit, sans-serif',
        background: 'transparent',
        zoom: { enabled: false },
      },
      colors: [chartTokens.brand],
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2 },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.25, opacityTo: 0.05, stops: [0, 100] },
      },
      // Flag the trailing YTD point with a distinct marker so it reads as a
      // partial-year value, not a full-year comparison.
      markers: {
        size: 0,
        discrete:
          hasData && current?.isCurrent && current.isPartial
            ? [
                {
                  seriesIndex: 0,
                  dataPointIndex: points.length - 1,
                  fillColor: chartTokens.brandSecondary,
                  strokeColor: chartTokens.brand,
                  size: 5,
                },
              ]
            : [],
        hover: { size: 5 },
      },
      xaxis: {
        categories,
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { style: { fontSize: '12px', colors: chartTokens.axisText } },
        crosshairs: { show: false },
      },
      yaxis: {
        tickAmount: 4,
        forceNiceScale: true,
        min: 0,
        labels: {
          formatter: (val: number) => `${Math.round(val * 10) / 10}%`,
          style: { fontSize: '12px', colors: chartTokens.axisText },
        },
      },
      grid: {
        borderColor: chartTokens.gridBorder,
        strokeDashArray: 4,
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } },
      },
      legend: { show: false },
      states: {
        hover: { filter: { type: 'none' } },
        active: { filter: { type: 'none' } },
      },
      tooltip: {
        theme: 'light',
        x: { formatter: (_val: number, opts?: { dataPointIndex: number }) =>
          opts ? tooltipTitles[opts.dataPointIndex] ?? '' : '' },
        y: { formatter: (val: number | null) => (val == null ? 'No revenue' : `${val}%`) },
      },
    }),
    [categories, tooltipTitles, hasData, current, points.length],
  );

  const chartSeries = useMemo(
    () => [{ name: 'Payroll % of revenue', data: points.map((p) => p.payrollPct) }],
    [points],
  );

  return (
    <article className="ph-card">
      <div className="ph-header">
        <h3 className="ph-title">Payroll Health</h3>
      </div>

      <div className="ph-hero">
        <span className="ph-hero-value">{formatPct(current?.payrollPct ?? null)}</span>
        <span className="ph-hero-label">Payroll as % of revenue</span>
        <span className="ph-hero-target">Target: {payrollTargetPercent}%</span>
      </div>

      <div className="ph-chart">
        {hasData ? (
          <Chart options={options} series={chartSeries} type="area" height={200} />
        ) : (
          <div className="ph-empty">No payroll data available.</div>
        )}
      </div>

      <div className="ph-footer">
        <div className="ph-kpi">
          <span className="ph-kpi-value">{formatPct(current?.payrollPct ?? null)}</span>
          <span className="ph-kpi-label">This year</span>
        </div>
        <div className="ph-kpi">
          <span className="ph-kpi-value">{payrollTargetPercent}%</span>
          <span className="ph-kpi-label">Target (from Rules)</span>
        </div>
      </div>
    </article>
  );
}
