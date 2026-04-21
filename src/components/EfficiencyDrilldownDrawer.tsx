import { useEffect } from 'react';
import { formatCompact } from '../lib/utils/formatCompact';
import type { EfficiencyRow } from '../lib/kpis/efficiencyOpportunities';

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatKpi(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000;
    return `+$${k.toFixed(1)}K`;
  }
  return `+$${Math.round(amount)}`;
}

interface Props {
  row: EfficiencyRow;
  onClose: () => void;
}

export function EfficiencyDrilldownDrawer({ row, onClose }: Props) {
  // Close on ESC key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const { bestWindow, todayWindow } = row;

  const bestAvgRevenue = avg(bestWindow.months.map((m) => m.revenue));
  const bestAvgSpend = avg(bestWindow.months.map((m) => m.spend));
  const bestAvgPct = Math.round(avg(bestWindow.months.map((m) => m.ratio)) * 100);

  const todayAvgRevenue = avg(todayWindow.months.map((m) => m.revenue));
  const todayAvgSpend = avg(todayWindow.months.map((m) => m.spend));
  const todayAvgPct = Math.round(avg(todayWindow.months.map((m) => m.ratio)) * 100);

  return (
    <div className="eff-drawer-backdrop" onClick={handleBackdropClick}>
      <div
        className="eff-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={row.category}
      >

        {/* ── Header area ──────────────────────────────────────────────── */}
        <div className="eff-drawer-header">
          {/* Close button — top-right, outside the pill */}
          <button className="eff-drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>

          {/* KPI pill — full content width */}
          <div className="eff-drawer-kpi-pill">
            <h2 className="eff-drawer-pill-title">{row.category}</h2>
            <span className="eff-drawer-pill-stat">
              <span className="eff-drawer-pill-amount">{formatKpi(row.extraPerMonth)}/mo</span>
              <span className="eff-drawer-pill-label">extra spend vs your best</span>
            </span>
          </div>
        </div>

        {/* ── Comparison table ─────────────────────────────────────────── */}
        <div className="eff-drill-table-wrap">
          <table className="eff-drill-table">
            <colgroup>
              <col className="eff-drill-col-month" />
              <col className="eff-drill-col-revenue" />
              <col className="eff-drill-col-spend" />
              <col className="eff-drill-col-pct" />
              <col className="eff-drill-col-month" />
              <col className="eff-drill-col-revenue" />
              <col className="eff-drill-col-spend" />
              <col className="eff-drill-col-pct" />
            </colgroup>
            <thead>
              <tr>
                <th className="eff-drill-group-th" colSpan={4}>
                  <span className="eff-drill-group-name">YOUR BEST</span>
                  <span className="eff-drill-group-period">{bestWindow.label}</span>
                </th>
                <th className="eff-drill-group-th eff-drill-group-th--right" colSpan={4}>
                  <span className="eff-drill-group-name">TODAY</span>
                  <span className="eff-drill-group-period">{todayWindow.label}</span>
                </th>
              </tr>
              <tr className="eff-drill-col-header-row">
                <th className="eff-drill-th"></th>
                <th className="eff-drill-th eff-drill-th-right">Revenue</th>
                <th className="eff-drill-th eff-drill-th-right">Spend</th>
                <th className="eff-drill-th eff-drill-th-right eff-drill-col-divider">%</th>
                <th className="eff-drill-th"></th>
                <th className="eff-drill-th eff-drill-th-right">Revenue</th>
                <th className="eff-drill-th eff-drill-th-right">Spend</th>
                <th className="eff-drill-th eff-drill-th-right">%</th>
              </tr>
            </thead>
            <tbody>
              {bestWindow.months.map((bestMonth, i) => {
                const todayMonth = todayWindow.months[i];
                return (
                  <tr key={i} className="eff-drill-data-row">
                    <td className="eff-drill-td eff-drill-td-month">{bestMonth.monthLabel}</td>
                    <td className="eff-drill-td eff-drill-td-right">{formatCompact(bestMonth.revenue)}</td>
                    <td className="eff-drill-td eff-drill-td-right">{formatCompact(bestMonth.spend)}</td>
                    <td className="eff-drill-td eff-drill-td-right eff-drill-col-divider">
                      <span className="eff-drill-pct-best">{Math.round(bestMonth.ratio * 100)}%</span>
                    </td>
                    <td className="eff-drill-td eff-drill-td-month">{todayMonth.monthLabel}</td>
                    <td className="eff-drill-td eff-drill-td-right">{formatCompact(todayMonth.revenue)}</td>
                    <td className="eff-drill-td eff-drill-td-right">{formatCompact(todayMonth.spend)}</td>
                    <td className="eff-drill-td eff-drill-td-right">
                      <span className="eff-drill-pct-today">{Math.round(todayMonth.ratio * 100)}%</span>
                    </td>
                  </tr>
                );
              })}

              <tr className="eff-drill-avg-row eff-drill-avg-row--summary">
                <td className="eff-drill-td eff-drill-td-avg-label">Avg</td>
                <td className="eff-drill-td eff-drill-td-right">{formatCompact(bestAvgRevenue)}</td>
                <td className="eff-drill-td eff-drill-td-right">{formatCompact(bestAvgSpend)}</td>
                <td className="eff-drill-td eff-drill-td-right eff-drill-col-divider">
                  <span className="eff-drill-pct-best">{bestAvgPct}%</span>
                </td>
                <td className="eff-drill-td eff-drill-td-avg-label">Avg</td>
                <td className="eff-drill-td eff-drill-td-right">{formatCompact(todayAvgRevenue)}</td>
                <td className="eff-drill-td eff-drill-td-right">{formatCompact(todayAvgSpend)}</td>
                <td className="eff-drill-td eff-drill-td-right">
                  <span className="eff-drill-pct-today">{todayAvgPct}%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
