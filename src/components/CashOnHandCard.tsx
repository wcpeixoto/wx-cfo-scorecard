// CashOnHandCard — the wired "Cash on Hand" priority card.
// Extracted verbatim from the UI Lab priority-card-v2 mock so the same
// component renders in UI Lab and as the Today page's lead card (the
// promotion is a JSX swap, not a re-wire).

import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import type { CashTrendDeltaResult } from '../lib/data/cashTrendDelta';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import { chartTokens } from '../lib/ui/chartTokens';

const SPARKLINE_OPTIONS: ApexOptions = {
  chart: {
    type: 'area',
    height: 70,
    fontFamily: 'Outfit, sans-serif',
    sparkline: { enabled: true },
    toolbar: { show: false },
    accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
    animations: { enabled: false },
  },
  stroke: {
    curve: 'smooth',
    width: 1.5,
    colors: [chartTokens.brand],
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.45,
      opacityTo: 0,
      stops: [0, 100],
    },
  },
  colors: [chartTokens.brand],
  dataLabels: { enabled: false },
  markers: { size: 0 },
  grid: { show: false },
  xaxis: { labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: { show: false } },
  tooltip: { enabled: false },
  legend: { show: false },
};

function formatCashOnHand(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function severityLabelText(severity: 'critical' | 'warning' | 'healthy'): string {
  switch (severity) {
    case 'critical': return '↓ Needs attention';
    case 'warning':  return 'Watch';
    case 'healthy':  return '✓ Healthy';
  }
}

interface CashOnHandCardProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
  cashTrendData: CashTrendDeltaResult;
  /**
   * First month the Forecast's projected ending cash balance goes below zero
   * (ForecastDecisionSignals.negativeCashMonth, format YYYY-MM), or null when
   * cash never goes negative across the forecast. Canonical run-out date,
   * shared with the Forecast page so the two surfaces cannot disagree.
   */
  negativeCashMonth: string | null;
}

export function CashOnHandCard({ model, txns, forecastProjection, cashTrendData, negativeCashMonth }: CashOnHandCardProps) {
  const signals = useMemo(
    () => detectSignals(model, txns, forecastProjection),
    [model, txns, forecastProjection]
  );
  const hero = useMemo(() => rankPriorities(signals).hero, [signals]);

  // Cash-run-out date. Sourced from the Forecast's canonical negativeCashMonth
  // (first month projected ending cash goes below zero) so the Today card and
  // the Forecast page can never show different run-out dates. Rendered as
  // month + year to match the Forecast page. null when cash never goes
  // negative — the row is hidden, not replaced with a positive message.
  const cashRunOut = useMemo(() => {
    if (!negativeCashMonth) return null;
    const match = negativeCashMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const runOutYear = Number.parseInt(match[1], 10);
    const runOutMonthIndex = Number.parseInt(match[2], 10) - 1;
    if (!Number.isFinite(runOutYear) || runOutMonthIndex < 0 || runOutMonthIndex > 11) return null;
    const date = new Date(Date.UTC(runOutYear, runOutMonthIndex, 1)).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return { date };
  }, [negativeCashMonth]);

  // True end-of-month cash balances (up to 6 points feed the sparkline)
  // plus the 30-day rolling-average delta that drives the trend label/arrow.
  // Computed upstream in Dashboard.tsx from the daily balance series so the
  // Cash on Hand and Operating Reserve cards stay aligned on the same prior
  // anchor. Direction-tinted (down = critical, up = healthy), distinct from
  // the severity pill which reflects the overall signal.
  const cashReserveSeries = cashTrendData.series;
  const cashDelta = cashTrendData.delta;

  // Break-even gap — avg monthly expenses minus revenue over the last 3
  // COMPLETED months. Anchor = latest rollup month, excluded as the
  // in-progress month, mirroring the Operating Reserve window so this number
  // stays consistent with the reserve target. Threshold (2% of avg expenses,
  // clamped $500–$2K) is internal. null when <3 completed months.
  const cashBreakEven = useMemo<{ gap: number; state: 'deficit' | 'flat' | 'surplus' } | null>(() => {
    const sorted = [...model.monthlyRollups].sort((a, b) => a.month.localeCompare(b.month));
    const anchorMonth = sorted[sorted.length - 1]?.month;
    if (!anchorMonth) return null;
    const window = sorted.filter(r => r.month < anchorMonth).slice(-3);
    if (window.length < 3) return null;
    const avgMonthlyRevenue = window.reduce((sum, r) => sum + r.revenue, 0) / window.length;
    const avgMonthlyExpenses = window.reduce((sum, r) => sum + r.expenses, 0) / window.length;
    const gap = avgMonthlyExpenses - avgMonthlyRevenue;
    const threshold = Math.min(Math.max(avgMonthlyExpenses * 0.02, 500), 2000);
    const state =
      gap > threshold ? 'deficit' as const
      : Math.abs(gap) <= threshold ? 'flat' as const
      : 'surplus' as const;
    return { gap, state };
  }, [model.monthlyRollups]);

  return (
    <article className="priority-card-v2">
      <div className="priority-card-v2__header">
        <div className="priority-card-v2__title-block">
          <h3 className="priority-card-v2__title">Cash on Hand</h3>
        </div>
        <span className={`card-status-badge is-${hero.severity}`}>
          {severityLabelText(hero.severity)}
        </span>
      </div>

      <div className="priority-card-v2__amount-row">
        <div className="priority-card-v2__amount-block">
          <h2 className="priority-card-v2__amount">{formatCashOnHand(model.runway.currentCashBalance)}</h2>
          {/*
            Delta semantics: trailing 30-day mean cash balance vs the prior
            30-day mean, anchored to latestAvailableTxnDate. If a tooltip is
            ever added, suggested copy:
              "Compares your average cash balance over the latest 30 days
               with the average from the 30 days before that."
          */}
          <div className="priority-card-v2__trend">
            {cashDelta ? (
              <>
                <span className={`priority-card-v2__trend-delta priority-card-v2__trend-delta--${cashDelta.direction === 'up' ? 'healthy' : 'critical'}`}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    {cashDelta.direction === 'up'
                      ? <path d="M8 13.333V2.667M4 6.663l4-3.996 4 3.996" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      : <path d="M8 2.667V13.333M4 9.337l4 3.996 4-3.996" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    }
                  </svg>
                  {`${Math.abs(cashDelta.pct * 100).toFixed(1)}%`}
                </span>
                <span className="priority-card-v2__trend-text">vs prior 30 days</span>
              </>
            ) : (
              <span className="priority-card-v2__trend-text">Not enough history for a 30-day comparison</span>
            )}
          </div>
        </div>
        <div className="priority-card-v2__sparkline-slot" aria-hidden="true">
          <ReactApexChart
            options={SPARKLINE_OPTIONS}
            series={[{ name: 'cashReserve', data: cashReserveSeries }]}
            type="area"
            height={70}
            width="100%"
          />
        </div>
      </div>

      <div className="priority-card-v2__body">
        {cashRunOut !== null && (
          <p className="priority-card-v2__body-row">
            <span className="priority-card-v2__body-row-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" stroke="currentColor" />
                <polyline points="16 17 22 17 22 11" stroke="currentColor" />
              </svg>
            </span>
            <span>
              At this pace, you are projected to run out of cash in {cashRunOut.date}.
            </span>
          </p>
        )}
        {cashBreakEven && (
          <p className="priority-card-v2__body-row">
            <span className="priority-card-v2__body-row-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" stroke="currentColor" />
                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" stroke="currentColor" />
                <path d="M12 18V6" stroke="currentColor" />
              </svg>
            </span>
            <span>
              {(() => {
                const { gap, state } = cashBreakEven;
                if (state === 'flat') return "You're operating right around break-even.";
                const amount = `$${Math.round(Math.abs(gap) / 1000)}K`;
                if (state === 'deficit') return `At your current margins and spending levels, you need ${amount} more per month to break even.`;
                return `You're running a ${amount} monthly surplus above break-even.`;
              })()}
            </span>
          </p>
        )}
      </div>
    </article>
  );
}
