import ReactApexChart from 'react-apexcharts';
import type { ExpenseSlice } from '../lib/data/contract';

type TopCategoriesCardProps = {
  slices: ExpenseSlice[];
  total: number;
  subtitle?: string;
};

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export default function TopCategoriesCard({
  slices,
  total,
  subtitle = 'Expense breakdown this month',
}: TopCategoriesCardProps) {
  const top = slices.slice(0, 6);

  if (top.length === 0) {
    return (
      <article className="card top-categories-card">
        <div className="card-head">
          <h3>Top Expense Categories</h3>
          <p className="subtle">{subtitle}</p>
        </div>
        <p className="empty-state">No expense data yet.</p>
      </article>
    );
  }

  const chartOptions: ApexCharts.ApexOptions = {
    chart: {
      type: 'donut',
      toolbar: { show: false },
      animations: { enabled: false },
      background: 'transparent',
      sparkline: { enabled: false },
    },
    colors: top.map((s) => s.color),
    labels: top.map((s) => s.name),
    dataLabels: { enabled: false },
    legend: { show: false },
    stroke: { width: 2, colors: ['#FFFFFF'] },
    plotOptions: {
      pie: {
        donut: {
          size: '50%',
          labels: {
            show: false,
          },
        },
      },
    },
    tooltip: {
      style: { fontFamily: 'inherit', fontSize: '13px' },
      y: {
        formatter: (val: number) => {
          const pct = total > 0 ? Math.round((val / total) * 100) : 0;
          return `${formatCurrency(val)} · ${pct}%`;
        },
      },
    },
    states: {
      hover: { filter: { type: 'lighten', value: 0.05 } },
      active: { filter: { type: 'none' } },
    },
  };

  return (
    <article className="card top-categories-card">
      <div className="card-head">
        <div>
          <h3>Top Expense Categories</h3>
          <p className="top-categories-total">Total: {formatCurrency(total)}</p>
        </div>
        <p className="subtle">{subtitle}</p>
      </div>

      <div className="top-categories-layout">
        <div className="top-categories-donut-wrap">
          <ReactApexChart
            type="donut"
            series={top.map((s) => s.value)}
            options={chartOptions}
            height={200}
          />
        </div>

        <ul className="top-categories-legend">
          {top.map((slice) => {
            const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
            return (
              <li key={slice.name} className="top-categories-legend-item">
                <span className="top-categories-legend-dot" style={{ background: slice.color }} aria-hidden="true" />
                <span className="top-categories-legend-name">{slice.name}</span>
                <span className="top-categories-legend-pct">{pct}%</span>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}
