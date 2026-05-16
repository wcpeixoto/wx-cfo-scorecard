// CashOnHandCard — the wired "Cash on Hand" priority card.
// Extracted verbatim from the UI Lab priority-card-v2 mock so the same
// component renders in UI Lab and as the Today page's lead card (the
// promotion is a JSX swap, not a re-wire).

import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
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
}

export function CashOnHandCard({ model, txns, forecastProjection }: CashOnHandCardProps) {
  const signals = useMemo(
    () => detectSignals(model, txns, forecastProjection),
    [model, txns, forecastProjection]
  );
  const hero = useMemo(() => rankPriorities(signals).hero, [signals]);

  // Cash-run-out projection (when cash is projected to go negative). Picked
  // from the same detectSignals output, regardless of which signal ranked
  // hero. Returns both months-from-now and the long-form date; the JSX layer
  // picks the format based on a 10-month threshold.
  const cashRunOut = useMemo(() => {
    const negative = signals.find(s => s.type === 'cash_flow_negative');
    const month = negative?.troughMonth;
    if (!month) return null;
    const match = month.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const troughYear = Number.parseInt(match[1], 10);
    const troughMonthIndex = Number.parseInt(match[2], 10) - 1;
    if (!Number.isFinite(troughYear) || troughMonthIndex < 0 || troughMonthIndex > 11) return null;
    const now = new Date();
    const months = Math.max(
      0,
      (troughYear * 12 + troughMonthIndex) - (now.getUTCFullYear() * 12 + now.getUTCMonth())
    );
    const date = new Date(Date.UTC(troughYear, troughMonthIndex, 1)).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return { months, date };
  }, [signals]);

  // Walk model.monthlyRollups backward from currentCashBalance to derive
  // month-start cash balances. Last 6 months feed the sparkline.
  const cashReserveSeries = useMemo(() => {
    const sorted = [...model.monthlyRollups].sort((a, b) => a.month.localeCompare(b.month));
    const last6 = sorted.slice(-6);
    if (last6.length === 0) return [] as number[];
    const balances: number[] = new Array(last6.length);
    let balance = model.runway.currentCashBalance;
    balances[last6.length - 1] = balance;
    for (let i = last6.length - 1; i > 0; i--) {
      balance -= last6[i].netCashFlow;
      balances[i - 1] = balance;
    }
    return balances;
  }, [model.monthlyRollups, model.runway.currentCashBalance]);

  // Cash-on-hand month-over-month delta — drives the trend label and arrow
  // direction. Direction-tinted (down = critical, up = healthy), distinct
  // from the severity pill which reflects the overall priority signal.
  const cashDelta = useMemo(() => {
    const s = cashReserveSeries;
    if (s.length < 2) return null;
    const current = s[s.length - 1];
    const prior = s[s.length - 2];
    if (prior === 0 || !Number.isFinite(prior)) return null;
    const pct = (current - prior) / Math.abs(prior);
    return { pct, direction: pct >= 0 ? 'up' as const : 'down' as const };
  }, [cashReserveSeries]);

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
                <span className="priority-card-v2__trend-text">vs end of last month</span>
              </>
            ) : (
              <span className="priority-card-v2__trend-text">— vs end of last month</span>
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
        <p className="priority-card-v2__body-row">
          <span className="priority-card-v2__body-row-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              {cashRunOut === null ? (
                <>
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" stroke="currentColor" />
                  <polyline points="16 7 22 7 22 13" stroke="currentColor" />
                </>
              ) : (
                <>
                  <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" stroke="currentColor" />
                  <polyline points="16 17 22 17 22 11" stroke="currentColor" />
                </>
              )}
            </svg>
          </span>
          <span>
            {(() => {
              if (cashRunOut === null) return 'At your current pace, cash stays positive through the forecast window.';
              const { months, date } = cashRunOut;
              if (months === 0) return 'At this pace, you are projected to run out of cash this month.';
              // Close horizons (<10 months) read as a duration; farther
              // horizons read as an absolute date to keep the sentence
              // from feeling distant or abstract.
              if (months < 10) return `At this pace, you are projected to run out of cash in ${months} ${months === 1 ? 'month' : 'months'}.`;
              return `At this pace, you are projected to run out of cash in ${date}.`;
            })()}
          </span>
        </p>
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

      <div className="priority-card-v2__footer">
        <button type="button" className="priority-card-v2__action">
          What can I do?
        </button>
      </div>
    </article>
  );
}
