import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import type { SignalType } from '../lib/priorities/types';
import { classifyTxn } from '../lib/cashFlow';
import { CashOnHandCard } from './CashOnHandCard';
import { SecondaryPriority } from './SecondaryPriority';
import { OperatingReserveCard } from './OperatingReserveCard';
import { OwnerDistributionsCard } from './OwnerDistributionsCard';

const DIST_ON_TARGET_LOW  = 0.90; // actual >= target × 0.90
const DIST_ON_TARGET_HIGH = 1.10; // actual <= target × 1.10

// Next Owner Distribution — vertical sparkline channel bar.
// Faithful replica of TailAdmin /sales "Sales by Channel" card (chart-30.js, #chartThirty).
// Illustrative fixture — not wired to production data.
const NEXT_OWNER_DIST_CHANNEL_COLORS = [
  ...Array(14).fill('#465FFF'),
  ...Array(14).fill('#36BFFA'),
  ...Array(14).fill('#E4E7EC'),
];

const NEXT_OWNER_DIST_CHANNEL_SERIES = [
  { data: Array(NEXT_OWNER_DIST_CHANNEL_COLORS.length).fill(100) },
];

const NEXT_OWNER_DIST_CHANNEL_OPTIONS: ApexOptions = {
  chart: {
    fontFamily: 'Outfit, sans-serif',
    type: 'bar',
    height: 32,
    sparkline: { enabled: true },
    toolbar: { show: false },
    animations: { enabled: false },
  },
  plotOptions: {
    bar: {
      horizontal: false,
      distributed: true,
      columnWidth: '70%',
      borderRadius: 1,
      borderRadiusApplication: 'around',
    },
  },
  colors: NEXT_OWNER_DIST_CHANNEL_COLORS,
  dataLabels: { enabled: false },
  xaxis: {
    labels: { show: false },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    show: false,
    min: 0,
    max: 100,
  },
  grid: {
    show: false,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  },
  tooltip: { enabled: false },
  legend: { show: false },
};

// Signals intentionally hidden from the Today priority surface. detectSignals
// still produces them — CashOnHandCard reads cash_flow_negative for its
// run-out row — they're just not surfaced as their own priority cards.
const SUPPRESSED_PRIORITY_SIGNALS = new Set<SignalType>([
  'reserve_critical',
  'cash_flow_negative',
  'expense_surge',
]);

interface TodayPageProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
  targetNetMargin?: number;
  onCompareYear?: (year: number) => void;
}

export function TodayPage({ model, txns, forecastProjection, targetNetMargin, onCompareYear }: TodayPageProps) {
  const signals = useMemo(
    () => detectSignals(model, txns, forecastProjection),
    [model, txns, forecastProjection]
  );
  const { secondary } = useMemo(
    () => rankPriorities(signals.filter(s => !SUPPRESSED_PRIORITY_SIGNALS.has(s.type))),
    [signals]
  );

  const distributionStatus = useMemo(() => {
    if (
      !model.monthlyRollups ||
      model.monthlyRollups.length < 3 ||
      !targetNetMargin ||
      targetNetMargin === 0 ||
      !txns ||
      txns.length === 0
    ) {
      return { status: 'on_target' as const, targetAmount: 0, actualAmount: 0 };
    }

    const recentMonths = model.monthlyRollups.slice(-12);
    const totalRevenue = recentMonths.reduce((sum, m) => sum + (m.revenue ?? 0), 0);
    const targetAmount = totalRevenue * targetNetMargin;

    const cutoffMonth = recentMonths[0].month;
    const actualAmount = txns
      .filter(txn => classifyTxn(txn) === 'owner-distribution')
      .filter(txn => txn.month >= cutoffMonth)
      .reduce((sum, txn) => sum + Math.abs(txn.amount), 0);

    let status: 'below_target' | 'on_target' | 'above_target';
    if (actualAmount < targetAmount * DIST_ON_TARGET_LOW) {
      status = 'below_target';
    } else if (actualAmount > targetAmount * DIST_ON_TARGET_HIGH) {
      status = 'above_target';
    } else {
      status = 'on_target';
    }

    return { status, targetAmount, actualAmount };
  }, [model, txns, targetNetMargin]);

  const secondaryClass =
    secondary.length === 2 ? 'today-secondary-row is-pair' : 'today-secondary-row';

  return (
    <div className="today-page">
      <div className="today-top-grid">
        <CashOnHandCard
          model={model}
          txns={txns}
          forecastProjection={forecastProjection}
        />
        <OperatingReserveCard
          currentCashBalance={model.runway.currentCashBalance}
          reserveTarget={model.runway.reserveTarget}
          monthlyRollups={model.monthlyRollups}
        />
      </div>

      {secondary.length > 0 && (
        <div className={secondaryClass}>
          {secondary.map((s, i) => (
            <SecondaryPriority key={`${s.type}-${i}`} signal={s} />
          ))}
        </div>
      )}

      {/* Context section */}
      <div className="today-context-section">
        <div className="today-context-grid today-context-grid--2-1">
          <OwnerDistributionsCard
            transactions={txns}
            distributionStatus={distributionStatus.status}
            distributionTargetAmount={distributionStatus.targetAmount}
            distributionActualAmount={distributionStatus.actualAmount}
            targetNetMargin={targetNetMargin}
            forecastProjection={forecastProjection}
            reserveTarget={model.runway.reserveTarget}
            currentCashBalance={model.runway.currentCashBalance}
            onCompareYear={onCompareYear}
          />
          <article className="card next-owner-dist-card" aria-label="Next Owner Distribution">
            <header className="next-owner-dist-header">
              <h3 className="next-owner-dist-title">Next Owner Distribution</h3>
              <p className="next-owner-dist-subtitle">Your cash and balance for last 30 days</p>
            </header>
            <div className="next-owner-dist-amount-block">
              <h2 className="next-owner-dist-amount">19,857.00</h2>
              <div className="next-owner-dist-trend">
                <span className="next-owner-dist-trend-delta next-owner-dist-trend-delta--up">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 13.333V2.667M4 6.663l4-3.996 4 3.996" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  3.2%
                </span>
                <span className="next-owner-dist-trend-text">than last month</span>
              </div>
            </div>
            <div className="next-owner-dist-channel-bar" aria-hidden="true">
              <ReactApexChart
                options={NEXT_OWNER_DIST_CHANNEL_OPTIONS}
                series={NEXT_OWNER_DIST_CHANNEL_SERIES}
                type="bar"
                height={32}
                width="100%"
              />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
