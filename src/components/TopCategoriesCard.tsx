import { useState, type ReactNode } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ExpenseSliceWithRows } from '../lib/kpis/compute';
import { formatCompact } from '../lib/utils/formatCompact';
import { TopExpensesTransactionsDrawer } from './TopExpensesTransactionsDrawer';

type TopCategoriesCardProps = {
  slices: ExpenseSliceWithRows[];
  total: number;
  periodControl?: ReactNode;
};

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export default function TopCategoriesCard({ slices, total, periodControl }: TopCategoriesCardProps) {
  // The card owns the drill-down drawer state (same shape as
  // EfficiencyOpportunitiesCard ↔ EfficiencyDrilldownDrawer). The source
  // (computeExpenseSlicesWithRows) already attached each slice's contributing
  // rows, so a click just hands the clicked slice to the drawer.
  const [selectedSlice, setSelectedSlice] = useState<ExpenseSliceWithRows | null>(null);

  if (slices.length === 0) {
    return (
      <article className="card top-categories-card">
        <div className="card-head">
          <h3>Top Expense Categories</h3>
          {periodControl}
        </div>
        <p className="empty-state">No expense data yet.</p>
      </article>
    );
  }

  // Percentages use the card total as denominator. Slices now include "Other",
  // so the visible set sums to total and percentages add to 100%.
  const getPct = (slice: ExpenseSliceWithRows): number =>
    total > 0 ? Math.round((slice.value / total) * 100) : 0;

  const chartOptions: ApexCharts.ApexOptions = {
    chart: {
      type: 'donut',
      fontFamily: 'Outfit, sans-serif',
      toolbar: { show: false },
      // Apex 5.x paints a #008FFB stroke on click via its keyboard-nav focus
      // class. We don't use Apex's chart-internal keyboard navigation, so
      // disable it explicitly (double-disable documents intent + guards
      // against a future library nuance flipping one but not the other).
      // The drawer is opened via dataPointSelection (a mouse event) below, and
      // active-state paint stays off — clicking opens the drawer, not a focus ring.
      accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
      animations: { enabled: false },
      background: 'transparent',
      sparkline: { enabled: false },
      events: {
        dataPointSelection: (
          _event: unknown,
          _chartContext: unknown,
          config?: { dataPointIndex?: number; seriesIndex?: number }
        ) => {
          // ApexCharts reports the clicked donut slice via seriesIndex (the same
          // field the custom tooltip uses); dataPointIndex is a fallback for
          // version variance.
          const fromSeries = config?.seriesIndex;
          const fromPoint = config?.dataPointIndex;
          const idx =
            typeof fromSeries === 'number' && fromSeries >= 0 && fromSeries < slices.length
              ? fromSeries
              : typeof fromPoint === 'number'
                ? fromPoint
                : -1;
          const clicked = slices[idx];
          if (clicked) setSelectedSlice(clicked);
        },
      },
    },
    colors: slices.map((s) => s.color),
    labels: slices.map((s) => s.name),
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
      custom: ({ seriesIndex }: { seriesIndex: number }) => {
        const slice = slices[seriesIndex];
        if (!slice) return '';
        const pct = getPct(slice);
        const formatted = formatCompact(slice.value);

        return `
          <div class="ec-donut-tooltip">
            <div class="ec-donut-tooltip__title">${slice.name} · ${pct}%</div>
            <div class="ec-donut-tooltip__value">${formatted}</div>
          </div>
        `;
      },
    },
    states: {
      hover: { filter: { type: 'lighten' } },
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
        {periodControl}
      </div>

      <div className="top-categories-layout">
        <div className="top-categories-donut-wrap">
          <ReactApexChart
            type="donut"
            series={slices.map((s) => s.value)}
            options={chartOptions}
            height={200}
          />
        </div>

        <ul className="top-categories-legend">
          {slices.map((slice) => (
            <li key={slice.name} className="top-categories-legend-item">
              <button
                type="button"
                className="top-categories-legend-button"
                onClick={() => setSelectedSlice(slice)}
              >
                <span className="top-categories-legend-dot" style={{ background: slice.color }} aria-hidden="true" />
                <span className="top-categories-legend-name">{slice.name}</span>
                <span className="top-categories-legend-pct">{getPct(slice)}%</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selectedSlice && (
        <TopExpensesTransactionsDrawer slice={selectedSlice} onClose={() => setSelectedSlice(null)} />
      )}
    </article>
  );
}
