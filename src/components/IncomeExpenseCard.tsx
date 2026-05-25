import { useMemo, useState } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { MonthlyRollup } from '../lib/data/contract';
import {
  selectIncomeExpense,
  type IncomeExpenseGranularity,
  type IncomeExpenseTimeframe,
} from '../lib/kpis/incomeExpenseSeries';
import PeriodDropdown, { type PeriodOption } from './PeriodDropdown';
import { chartTokens } from '../lib/ui/chartTokens';
import { formatCompact } from '../lib/utils/formatCompact';

// Card-local timeframe options — independent from the Big Picture header timeframe.
const TIMEFRAME_OPTIONS: PeriodOption[] = [
  { value: '6m', label: '6 Months' },
  { value: '12m', label: '12 Months' },
  { value: '18m', label: '18 Months' },
  { value: '24m', label: '24 Months' },
  { value: '36m', label: '36 Months' },
  { value: '5y', label: '5 Years' },
  { value: 'all', label: 'All' },
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatAxisLabel(key: string, granularity: IncomeExpenseGranularity): string {
  if (granularity === 'yearly') return key.slice(2);
  const [year, month] = key.split('-');
  return `${MONTH_ABBR[Number(month) - 1]} ${year.slice(2)}`;
}

// Y-axis ticks: whole-number compact (no decimal). Distinct from the shared
// formatCompact used by the tooltip + footer totals, which keep one decimal.
function formatYAxisCompact(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs < 1000) return `${sign}$${Math.round(abs)}`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

type Props = {
  monthlyRollups: MonthlyRollup[];
};

export default function IncomeExpenseCard({ monthlyRollups }: Props) {
  const [timeframe, setTimeframe] = useState<IncomeExpenseTimeframe>('12m');

  const { series, granularity } = useMemo(
    () => selectIncomeExpense(monthlyRollups, timeframe),
    [monthlyRollups, timeframe],
  );

  const categories = useMemo(
    () => series.labels.map((key) => formatAxisLabel(key, granularity)),
    [series.labels, granularity],
  );

  const hasData = series.labels.length > 0;
  const netPositive = series.netIncome >= 0;

  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        stacked: false,
        toolbar: { show: false },
        fontFamily: 'Outfit, sans-serif',
        background: 'transparent',
      },
      colors: [chartTokens.brand, chartTokens.brandSecondary],
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: '60%',
          borderRadius: 5,
          borderRadiusApplication: 'end',
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: true, width: 2, colors: ['transparent'] },
      legend: {
        show: true,
        position: 'top',
        horizontalAlign: 'left',
        fontFamily: 'Outfit, sans-serif',
        fontSize: '12px',
        labels: { colors: chartTokens.axisText },
        markers: { shape: 'circle' },
      },
      xaxis: {
        categories,
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: { style: { fontSize: '12px', colors: chartTokens.axisText } },
        crosshairs: { width: 'barWidth' },
      },
      yaxis: {
        tickAmount: 4,
        forceNiceScale: true,
        labels: {
          formatter: (val: number) => formatYAxisCompact(val),
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
      tooltip: {
        theme: 'light',
        shared: true,
        intersect: false,
        y: { formatter: (val: number) => formatCompact(val) },
      },
    }),
    [categories],
  );

  const chartSeries = useMemo(
    () => [
      { name: 'Income', data: series.income },
      { name: 'Expense', data: series.expense },
    ],
    [series.income, series.expense],
  );

  return (
    <article className="ie-card">
      <div className="ie-header">
        <h3 className="ie-title">Income &amp; Expense</h3>
        <PeriodDropdown
          value={timeframe}
          options={TIMEFRAME_OPTIONS}
          onChange={(value) => setTimeframe(value as IncomeExpenseTimeframe)}
        />
      </div>

      <div className="ie-chart">
        {hasData ? (
          <Chart options={options} series={chartSeries} type="bar" height={200} />
        ) : (
          <div className="ie-empty">No income or expense data for this period.</div>
        )}
      </div>

      <div className="ie-footer">
        <div className="ie-total">
          <span className="ie-total-label">Total Income</span>
          <span className="ie-total-value">{formatCompact(series.totalIncome)}</span>
        </div>
        <div className="ie-total">
          <span className="ie-total-label">Total Expense</span>
          <span className="ie-total-value">{formatCompact(-series.totalExpense)}</span>
        </div>
        <div className="ie-total">
          <span className="ie-total-label">Net Income</span>
          <span className={`ie-total-value ${netPositive ? 'is-positive' : 'is-negative'}`}>
            {formatCompact(series.netIncome)}
          </span>
        </div>
      </div>
    </article>
  );
}
