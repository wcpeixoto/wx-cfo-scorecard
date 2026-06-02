import { useMemo, useState } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { CashFlowMode, MonthlyRollup, Txn } from '../lib/data/contract';
import {
  selectIncomeExpense,
  type IncomeExpenseGranularity,
  type IncomeExpenseTimeframe,
} from '../lib/kpis/incomeExpenseSeries';
import { computeIncomeExpenseRows } from '../lib/kpis/compute';
import PeriodDropdown, { type PeriodOption } from './PeriodDropdown';
import { chartTokens } from '../lib/ui/chartTokens';
import { formatCompact } from '../lib/utils/formatCompact';
import { IncomeExpenseTransactionsDrawer } from './IncomeExpenseTransactionsDrawer';

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
  txns: Txn[];
  cashFlowMode: CashFlowMode;
};

// Resolve the txn-window behind a clicked bar. Monthly bars map 1:1; yearly
// bars expand to Jan–Dec of the label year. Labels are 'YYYY-MM' or 'YYYY' as
// emitted by selectIncomeExpense.
function resolveBarWindow(
  label: string,
  granularity: IncomeExpenseGranularity,
): { startMonth: string; endMonth: string; displayLabel: string } {
  if (granularity === 'yearly') {
    return { startMonth: `${label}-01`, endMonth: `${label}-12`, displayLabel: label };
  }
  // 'YYYY-MM' → "Mon YYYY" for the drawer header.
  const [year, month] = label.split('-');
  const monthIdx = Number(month) - 1;
  const display = MONTH_ABBR[monthIdx] && year ? `${MONTH_ABBR[monthIdx]} ${year}` : label;
  return { startMonth: label, endMonth: label, displayLabel: display };
}

type DrawerState = {
  side: 'income' | 'expense';
  startMonth: string;
  endMonth: string;
  displayLabel: string;
  // Bar value as displayed by the chart at the clicked dataPointIndex —
  // reconciles the drawer header to the bar the user actually clicked
  // (avoids sub-cent drift on yearly bars, where the chart sums rounded
  // monthly rollups and the row contributions are rounded once at the end).
  chartDisplayedValue: number;
};

export default function IncomeExpenseCard({ monthlyRollups, txns, cashFlowMode }: Props) {
  const [timeframe, setTimeframe] = useState<IncomeExpenseTimeframe>('12m');
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);

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

  const drawerBundle = useMemo(() => {
    if (!drawerState) return null;
    return computeIncomeExpenseRows(txns, drawerState.startMonth, drawerState.endMonth, cashFlowMode);
  }, [drawerState, txns, cashFlowMode]);

  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: 'bar',
        stacked: false,
        toolbar: { show: false },
        accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
        fontFamily: 'Outfit, sans-serif',
        background: 'transparent',
        events: {
          // ApexCharts reports the clicked bar via dataPointIndex (column) and
          // seriesIndex (0=Income, 1=Expense, matching the order in chartSeries).
          // We capture the chart's already-displayed bar value at that
          // (seriesIndex, dataPointIndex) and pass it to the drawer header so
          // the drawer total reconciles to the bar the user clicked — never
          // re-summed from rows (yearly bars sum rounded monthly rollups, which
          // can sub-cent diverge from the row-contribution sum).
          dataPointSelection: (
            _event: unknown,
            _chartContext: unknown,
            config?: { dataPointIndex?: number; seriesIndex?: number },
          ) => {
            const idx = config?.dataPointIndex;
            const sIdx = config?.seriesIndex;
            if (typeof idx !== 'number' || idx < 0 || idx >= series.labels.length) return;
            if (sIdx !== 0 && sIdx !== 1) return;
            const label = series.labels[idx];
            const { startMonth, endMonth, displayLabel } = resolveBarWindow(label, granularity);
            const side: 'income' | 'expense' = sIdx === 0 ? 'income' : 'expense';
            const chartDisplayedValue =
              side === 'income' ? series.income[idx] : series.expense[idx];
            setDrawerState({ side, startMonth, endMonth, displayLabel, chartDisplayedValue });
          },
        },
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
      // Legend rendered above the chart by the card (see .ie-legend); the
      // Apex legend is hidden so the chart owns its full height.
      legend: { show: false },
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
    // series + granularity are captured by the dataPointSelection closure; if
    // they change, the options must recompute so clicks resolve the right window.
    [categories, series, granularity],
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

      <div className="ie-summary">
        <div className="ie-summary-metrics">
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
        <div className="ie-legend" aria-hidden="true">
          <span className="ie-legend-item">
            <span className="ie-legend-dot ie-legend-dot--income" />
            Income
          </span>
          <span className="ie-legend-item">
            <span className="ie-legend-dot ie-legend-dot--expense" />
            Expense
          </span>
        </div>
      </div>

      <div className="ie-chart">
        {hasData ? (
          <Chart options={options} series={chartSeries} type="bar" height={250} />
        ) : (
          <div className="ie-empty">No income or expense data for this period.</div>
        )}
      </div>

      {drawerState && drawerBundle && (
        <IncomeExpenseTransactionsDrawer
          side={drawerState.side}
          rows={
            drawerState.side === 'income' ? drawerBundle.income.rows : drawerBundle.expense.rows
          }
          chartDisplayedValue={drawerState.chartDisplayedValue}
          windowLabel={drawerState.displayLabel}
          onClose={() => setDrawerState(null)}
        />
      )}
    </article>
  );
}
