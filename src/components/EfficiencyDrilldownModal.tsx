// TODO: wire click trigger from EfficiencyOpportunitiesCard category
// name in next prompt. Modal currently renders open in UI Lab only.

export interface DrilldownRow {
  month: string;     // short label, e.g. "Jan"
  revenue: number;
  spend: number;
  pct: number;       // integer, e.g. 28
}

export interface EfficiencyDrilldownData {
  categoryName: string;
  bestWindowLabel: string;   // "Jan – Mar 2025"
  todayWindowLabel: string;  // "Feb – Apr 2026"
  bestRows: DrilldownRow[];
  todayRows: DrilldownRow[];
  bestAvgRevenue: number;
  bestAvgSpend: number;
  bestAvgPct: number;
  todayAvgRevenue: number;
  todayAvgSpend: number;
  todayAvgPct: number;
  insightText: string;
  footerExtra: string;  // styled number portion only, e.g. "+$4,500"
}

interface Props {
  data: EfficiencyDrilldownData;
  onClose: () => void;
}

// formatCompact — thresholds match spec mock data table output.
// Note: spec text says "10K+ no decimal" but mock data shows one decimal
// for all K values (e.g. $38.2K, $10.7K). Implemented to match the data.
function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1000) return `${sign}$${Math.round(abs)}`;
  if (abs < 100000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

export function EfficiencyDrilldownModal({ data, onClose }: Props) {
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="eff-drill-overlay" onClick={handleOverlayClick}>
      <div className="eff-drill-panel" role="dialog" aria-modal="true" aria-label={data.categoryName}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="eff-drill-header">
          <div className="eff-drill-kpi-line">
            <h2 className="eff-drill-title">{data.categoryName}</h2>
            <span className="eff-drill-kpi-stat">
              <span className="eff-drill-kpi-amount">{data.footerExtra}/mo</span>
              <span className="eff-drill-kpi-label">extra spend vs your best</span>
            </span>
          </div>
          <button className="eff-drill-close" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>

        {/* ── Comparison table ────────────────────────────────────────── */}
        <div className="eff-drill-table-wrap">
          <table className="eff-drill-table">
            {/* colgroup — equidistant Revenue·Spend·% within each group */}
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
              {/* Group header row */}
              <tr>
                <th className="eff-drill-group-th" colSpan={4}>
                  <span className="eff-drill-group-name">YOUR BEST</span>
                  <span className="eff-drill-group-period">{data.bestWindowLabel}</span>
                </th>
                <th className="eff-drill-group-th eff-drill-group-th--right" colSpan={4}>
                  <span className="eff-drill-group-name">TODAY</span>
                  <span className="eff-drill-group-period">{data.todayWindowLabel}</span>
                </th>
              </tr>
              {/* Column header row — month headers intentionally empty */}
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
              {data.bestRows.map((bestRow, i) => {
                const todayRow = data.todayRows[i];
                return (
                  <tr key={i} className="eff-drill-data-row">
                    <td className="eff-drill-td eff-drill-td-month">{bestRow.month}</td>
                    <td className="eff-drill-td eff-drill-td-right">{formatCompact(bestRow.revenue)}</td>
                    <td className="eff-drill-td eff-drill-td-right">{formatCompact(bestRow.spend)}</td>
                    <td className="eff-drill-td eff-drill-td-right eff-drill-col-divider">
                      <span className="eff-drill-pct-best">{bestRow.pct}%</span>
                    </td>
                    <td className="eff-drill-td eff-drill-td-month">{todayRow.month}</td>
                    <td className="eff-drill-td eff-drill-td-right">{formatCompact(todayRow.revenue)}</td>
                    <td className="eff-drill-td eff-drill-td-right">{formatCompact(todayRow.spend)}</td>
                    <td className="eff-drill-td eff-drill-td-right">
                      <span className="eff-drill-pct-today">{todayRow.pct}%</span>
                    </td>
                  </tr>
                );
              })}

              {/* Average row — TailAdmin summary row pattern */}
              <tr className="eff-drill-avg-row eff-drill-avg-row--summary">
                <td className="eff-drill-td eff-drill-td-avg-label">Avg</td>
                <td className="eff-drill-td eff-drill-td-right">{formatCompact(data.bestAvgRevenue)}</td>
                <td className="eff-drill-td eff-drill-td-right">{formatCompact(data.bestAvgSpend)}</td>
                <td className="eff-drill-td eff-drill-td-right eff-drill-col-divider">
                  <span className="eff-drill-pct-best">{data.bestAvgPct}%</span>
                </td>
                <td className="eff-drill-td eff-drill-td-avg-label">Avg</td>
                <td className="eff-drill-td eff-drill-td-right">{formatCompact(data.todayAvgRevenue)}</td>
                <td className="eff-drill-td eff-drill-td-right">{formatCompact(data.todayAvgSpend)}</td>
                <td className="eff-drill-td eff-drill-td-right">
                  <span className="eff-drill-pct-today">{data.todayAvgPct}%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
