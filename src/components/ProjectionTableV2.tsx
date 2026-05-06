import React from 'react';
import type { ScenarioPoint } from '../lib/data/contract';
import type { PriorYearActualsResult } from '../lib/kpis/priorYearActuals';

type Props = {
  visibleScenarioProjection: ScenarioPoint[];
  priorYearActuals: PriorYearActualsResult;
  projectionActiveYears: number[];
  currentForecastYear: number;
  hasForecastCurrentCashBalance: boolean;
  formatCurrency: (value: number) => string;
  toMonthLabel: (month: string) => string;
};

export default function ProjectionTableV2({
  visibleScenarioProjection,
  priorYearActuals,
  projectionActiveYears,
  currentForecastYear,
  hasForecastCurrentCashBalance,
  formatCurrency,
  toMonthLabel,
}: Props) {
  const sortedActiveDesc = [...projectionActiveYears].sort((a, b) => b - a);
  const hasActive = sortedActiveDesc.length > 0;
  const hasSingleYear = sortedActiveDesc.length === 1;
  const forecastYear = currentForecastYear;
  const yearDataMap = new Map(priorYearActuals.years.map((ya) => [ya.year, ya]));
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const totalForecastCI  = visibleScenarioProjection.reduce((s, r) => s + r.cashIn, 0);
  const totalForecastCO  = visibleScenarioProjection.reduce((s, r) => s + r.cashOut, 0);
  const totalForecastNet = visibleScenarioProjection.reduce((s, r) => s + r.netCashFlow, 0);

  const fmtVarPct = (pct: number) => {
    const sign = pct >= 0 ? '+' : '-';
    const abs = Math.abs(pct).toLocaleString('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${sign}${abs}%`;
  };

  const fmtDiff = (val: number): string =>
    val > 0 ? `+${formatCurrency(val)}` : formatCurrency(val);

  // Comparison mode totals
  const totalActuals = new Map<number, { cashIn: number; cashOut: number; net: number }>();
  if (hasActive) {
    for (const year of sortedActiveDesc) {
      let ci = 0, co = 0, net = 0;
      for (const row of visibleScenarioProjection) {
        const m = Number.parseInt(row.month.slice(5, 7), 10);
        const ma = yearDataMap.get(year)?.months[m] ?? { cashIn: 0, cashOut: 0, net: 0 };
        ci += ma.cashIn; co += ma.cashOut; net += ma.net;
      }
      totalActuals.set(year, { cashIn: ci, cashOut: co, net });
    }
  }

  const varColCount  = hasSingleYear ? 2 : 0;
  const cashInCols   = 1 + sortedActiveDesc.length + varColCount;
  const cashOutCols  = 1 + sortedActiveDesc.length + varColCount;
  const netCols      = 1 + sortedActiveDesc.length + varColCount;

  // ui-lab-projection-table-shell is kept as a CSS scope marker so left-align
  // rules scoped to that class continue to fire without touching shared .table-card rules.
  return (
    <div className="projection-table-scroll ui-lab-projection-table-shell">
      {!hasActive ? (

        // ── Simple mode ──────────────────────────────────────────────
        <table className="projection-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Cash In</th>
              <th>Cash Out</th>
              <th>Net</th>
              <th>{hasForecastCurrentCashBalance ? 'Balance' : 'Cumulative Net'}</th>
            </tr>
          </thead>
          <tbody>
            {visibleScenarioProjection.map((row) => (
              <tr key={row.month}>
                <td>{toMonthLabel(row.month)}</td>
                <td>{formatCurrency(row.cashIn)}</td>
                <td>{formatCurrency(row.cashOut)}</td>
                <td className={row.netCashFlow < 0 ? 'is-negative' : undefined}>
                  {formatCurrency(row.netCashFlow)}
                </td>
                <td className={row.endingCashBalance < 0 ? 'is-negative' : undefined}>
                  {formatCurrency(row.endingCashBalance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="total-label">Period total</td>
              <td>{formatCurrency(totalForecastCI)}</td>
              <td>{formatCurrency(totalForecastCO)}</td>
              <td className={totalForecastNet < 0 ? 'is-negative' : undefined}>
                {formatCurrency(totalForecastNet)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>

      ) : (

        // ── Comparison mode ───────────────────────────────────────────
        <table className="projection-table comparison-mode">
          <thead>
            <tr className="projection-group-row">
              <th rowSpan={2} className="projection-month-header">Month</th>
              <th colSpan={cashInCols} className="proj-group-start">Cash In</th>
              <th colSpan={cashOutCols} className="proj-group-start">Cash Out</th>
              <th colSpan={netCols} className="proj-group-start">Net</th>
            </tr>
            <tr className="projection-sub-row">
              <th className="projection-sub-forecast proj-group-start">{forecastYear}</th>
              {sortedActiveDesc.map((y) => <th key={`ci-${y}`} className="projection-sub-actual">{y}</th>)}
              {hasSingleYear && <th className="projection-sub-actual">Change</th>}
              {hasSingleYear && <th className="projection-sub-actual">%</th>}
              <th className="projection-sub-forecast proj-group-start">{forecastYear}</th>
              {sortedActiveDesc.map((y) => <th key={`co-${y}`} className="projection-sub-actual">{y}</th>)}
              {hasSingleYear && <th className="projection-sub-actual">Change</th>}
              {hasSingleYear && <th className="projection-sub-actual">%</th>}
              <th className="projection-sub-forecast proj-group-start">{forecastYear}</th>
              {sortedActiveDesc.map((y) => <th key={`n-${y}`} className="projection-sub-actual">{y}</th>)}
              {hasSingleYear && <th className="projection-sub-actual">Change</th>}
              {hasSingleYear && <th className="projection-sub-actual">%</th>}
            </tr>
          </thead>
          <tbody>
            {visibleScenarioProjection.map((row) => {
              const monthNum = Number.parseInt(row.month.slice(5, 7), 10);
              const ma1 = hasSingleYear
                ? yearDataMap.get(sortedActiveDesc[0])?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 }
                : null;
              return (
                <tr key={row.month}>
                  <td>{MONTH_NAMES[monthNum - 1]}</td>
                  {/* Cash In group */}
                  <td className="proj-group-start proj-forecast-value">{formatCurrency(row.cashIn)}</td>
                  {sortedActiveDesc.map((year) => {
                    const ma = yearDataMap.get(year)?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 };
                    return <td key={`ci-${year}-${row.month}`} className={ma.cashIn < 0 ? 'proj-actuals-negative' : 'proj-actuals-value'}>{formatCurrency(ma.cashIn)}</td>;
                  })}
                  {hasSingleYear && (() => {
                    if (!ma1 || ma1.cashIn === 0) return <td className="projection-var-neutral">&mdash;</td>;
                    const diff = row.cashIn - ma1.cashIn;
                    return <td className={diff > 0 ? 'projection-var-positive' : diff < 0 ? 'projection-var-negative' : 'projection-var-neutral'}>{fmtDiff(diff)}</td>;
                  })()}
                  {hasSingleYear && (() => {
                    if (!ma1 || ma1.cashIn === 0) return <td className="projection-var-neutral">&mdash;</td>;
                    const pct = ((row.cashIn - ma1.cashIn) / Math.abs(ma1.cashIn)) * 100;
                    return <td className={pct > 0 ? 'projection-var-positive' : 'projection-var-negative'}>{fmtVarPct(pct)}</td>;
                  })()}
                  {/* Cash Out group */}
                  <td className="proj-group-start proj-forecast-value">{formatCurrency(row.cashOut)}</td>
                  {sortedActiveDesc.map((year) => {
                    const ma = yearDataMap.get(year)?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 };
                    return <td key={`co-${year}-${row.month}`} className={ma.cashOut < 0 ? 'proj-actuals-negative' : 'proj-actuals-value'}>{formatCurrency(ma.cashOut)}</td>;
                  })}
                  {hasSingleYear && (() => {
                    if (!ma1 || ma1.cashOut === 0) return <td className="projection-var-neutral">&mdash;</td>;
                    const diff = row.cashOut - ma1.cashOut;
                    return <td className={diff > 0 ? 'projection-var-cashout-positive' : diff < 0 ? 'projection-var-cashout-negative' : 'projection-var-neutral'}>{fmtDiff(diff)}</td>;
                  })()}
                  {hasSingleYear && (() => {
                    if (!ma1 || ma1.cashOut === 0) return <td className="projection-var-neutral">&mdash;</td>;
                    const pct = ((row.cashOut - ma1.cashOut) / Math.abs(ma1.cashOut)) * 100;
                    return <td className={pct > 0 ? 'projection-var-cashout-positive' : 'projection-var-cashout-negative'}>{fmtVarPct(pct)}</td>;
                  })()}
                  {/* Net group */}
                  <td className={`proj-group-start proj-forecast-value${row.netCashFlow < 0 ? ' is-negative' : ''}`}>{formatCurrency(row.netCashFlow)}</td>
                  {sortedActiveDesc.map((year) => {
                    const ma = yearDataMap.get(year)?.months[monthNum] ?? { cashIn: 0, cashOut: 0, net: 0 };
                    return <td key={`n-${year}-${row.month}`} className={ma.net < 0 ? 'proj-actuals-negative' : 'proj-actuals-value'}>{formatCurrency(ma.net)}</td>;
                  })}
                  {hasSingleYear && (() => {
                    if (!ma1 || ma1.net === 0) return <td className="projection-var-neutral">&mdash;</td>;
                    const diff = row.netCashFlow - ma1.net;
                    return <td className={diff > 0 ? 'projection-var-positive' : diff < 0 ? 'projection-var-negative' : 'projection-var-neutral'}>{fmtDiff(diff)}</td>;
                  })()}
                  {hasSingleYear && (() => {
                    if (!ma1 || ma1.net === 0) return <td className="projection-var-neutral">&mdash;</td>;
                    const pct = ((row.netCashFlow - ma1.net) / Math.abs(ma1.net)) * 100;
                    return <td className={pct > 0 ? 'projection-var-positive' : 'projection-var-negative'}>{fmtVarPct(pct)}</td>;
                  })()}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="total-label">Period total</td>
              {/* Cash In totals */}
              <td className="proj-group-start proj-forecast-value">{formatCurrency(totalForecastCI)}</td>
              {sortedActiveDesc.map((year) => {
                const tot = totalActuals.get(year) ?? { cashIn: 0, cashOut: 0, net: 0 };
                return <td key={`tot-ci-${year}`} className={tot.cashIn < 0 ? 'proj-actuals-negative' : 'proj-actuals-value'}>{formatCurrency(tot.cashIn)}</td>;
              })}
              {hasSingleYear && (() => {
                const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                if (tot.cashIn === 0) return <td className="proj-actuals-value">&mdash;</td>;
                const diff = totalForecastCI - tot.cashIn;
                return <td className={diff > 0 ? 'projection-var-positive' : diff < 0 ? 'projection-var-negative' : 'projection-var-neutral'}>{fmtDiff(diff)}</td>;
              })()}
              {hasSingleYear && (() => {
                const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                if (tot.cashIn === 0) return <td className="proj-actuals-value">&mdash;</td>;
                const pct = ((totalForecastCI - tot.cashIn) / Math.abs(tot.cashIn)) * 100;
                return <td className={pct > 0 ? 'projection-var-positive' : 'projection-var-negative'}>{fmtVarPct(pct)}</td>;
              })()}
              {/* Cash Out totals */}
              <td className="proj-group-start proj-forecast-value">{formatCurrency(totalForecastCO)}</td>
              {sortedActiveDesc.map((year) => {
                const tot = totalActuals.get(year) ?? { cashIn: 0, cashOut: 0, net: 0 };
                return <td key={`tot-co-${year}`} className={tot.cashOut < 0 ? 'proj-actuals-negative' : 'proj-actuals-value'}>{formatCurrency(tot.cashOut)}</td>;
              })}
              {hasSingleYear && (() => {
                const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                if (tot.cashOut === 0) return <td className="proj-actuals-value">&mdash;</td>;
                const diff = totalForecastCO - tot.cashOut;
                return <td className={diff > 0 ? 'projection-var-cashout-positive' : diff < 0 ? 'projection-var-cashout-negative' : 'projection-var-neutral'}>{fmtDiff(diff)}</td>;
              })()}
              {hasSingleYear && (() => {
                const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                if (tot.cashOut === 0) return <td className="proj-actuals-value">&mdash;</td>;
                const pct = ((totalForecastCO - tot.cashOut) / Math.abs(tot.cashOut)) * 100;
                return <td className={pct > 0 ? 'projection-var-cashout-positive' : 'projection-var-cashout-negative'}>{fmtVarPct(pct)}</td>;
              })()}
              {/* Net totals */}
              <td className={`proj-group-start proj-forecast-value${totalForecastNet < 0 ? ' is-negative' : ''}`}>{formatCurrency(totalForecastNet)}</td>
              {sortedActiveDesc.map((year) => {
                const tot = totalActuals.get(year) ?? { cashIn: 0, cashOut: 0, net: 0 };
                return <td key={`tot-n-${year}`} className={tot.net < 0 ? 'proj-actuals-negative' : 'proj-actuals-value'}>{formatCurrency(tot.net)}</td>;
              })}
              {hasSingleYear && (() => {
                const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                if (tot.net === 0) return <td className="proj-actuals-value">&mdash;</td>;
                const diff = totalForecastNet - tot.net;
                return <td className={diff > 0 ? 'projection-var-positive' : diff < 0 ? 'projection-var-negative' : 'projection-var-neutral'}>{fmtDiff(diff)}</td>;
              })()}
              {hasSingleYear && (() => {
                const tot = totalActuals.get(sortedActiveDesc[0]) ?? { cashIn: 0, cashOut: 0, net: 0 };
                if (tot.net === 0) return <td className="proj-actuals-value">&mdash;</td>;
                const pct = ((totalForecastNet - tot.net) / Math.abs(tot.net)) * 100;
                return <td className={pct > 0 ? 'projection-var-positive' : 'projection-var-negative'}>{fmtVarPct(pct)}</td>;
              })()}
            </tr>
          </tfoot>
        </table>

      )}
    </div>
  );
}
