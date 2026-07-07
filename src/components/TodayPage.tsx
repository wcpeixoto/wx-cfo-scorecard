import { useMemo, useState } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import type { CashTrendDeltaResult } from '../lib/data/cashTrendDelta';
import type { ReserveCoverageDelta } from '../lib/kpis/compute';
import { computeOwnerDistributionStatus } from '../lib/data/ownerDistributionStatus';
import { CashOnHandCard } from './CashOnHandCard';
import { OperatingReserveCard } from './OperatingReserveCard';
import { OwnerDistributionsCard } from './OwnerDistributionsCard';
import { NextOwnerDistributionCard } from './NextOwnerDistributionCard';
import { REQUIRED_SERIES_LENGTH } from '../lib/data/nextOwnerDistribution';

type ReprojectOwnerPay = (revenueGrowthPct: number) => ScenarioPoint[];

interface TodayPageProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
  /** Forecast's canonical first-negative-cash month (YYYY-MM) or null. */
  negativeCashMonth: string | null;
  ownerPayProjection: ScenarioPoint[];
  ownerPayReserveFloor: number;
  targetNetMargin?: number;
  onCompareYear?: (year: number) => void;
  reprojectOwnerPay?: ReprojectOwnerPay;
  cashTrendData: CashTrendDeltaResult;
  reserveCoverageDelta: ReserveCoverageDelta | null;
}

export function TodayPage({ model, txns, forecastProjection, negativeCashMonth, ownerPayProjection, ownerPayReserveFloor, targetNetMargin, onCompareYear, reprojectOwnerPay, cashTrendData, reserveCoverageDelta }: TodayPageProps) {
  // Owner-pay slider state — session-only, lifted from NextOwnerDistributionCard
  // so the OwnerDistributions chart can react to the same simulation. Refresh
  // wipes it back to neutral by design.
  const [ownerPaySliderValue, setOwnerPaySliderValue] = useState<number>(0);

  // Active owner-pay projection: base at neutral OR when reproject yields too
  // few points to satisfy the helper's invariant; otherwise the simulated one.
  // The neutral fallback is the same shape (ScenarioPoint[]) so downstream
  // consumers never branch on "simulated vs not."
  const activeOwnerPayProjection = useMemo<ScenarioPoint[]>(() => {
    if (ownerPaySliderValue === 0 || !reprojectOwnerPay) return ownerPayProjection;
    const proj = reprojectOwnerPay(ownerPaySliderValue);
    if (!proj || proj.length < REQUIRED_SERIES_LENGTH) return ownerPayProjection;
    return proj;
  }, [ownerPaySliderValue, reprojectOwnerPay, ownerPayProjection]);

  // True only when the user is actively simulating AND the reproject succeeded.
  const isOwnerPaySimulated =
    ownerPaySliderValue !== 0 && activeOwnerPayProjection !== ownerPayProjection;

  // Trailing-12 owner-draw actual-vs-target. Extracted to a pure helper so the Today page and the
  // monthly-source export share ONE source of truth (parity proven in ownerDistributionStatus.test.ts).
  const distributionStatus = useMemo(
    () => computeOwnerDistributionStatus(model, txns, targetNetMargin),
    [model, txns, targetNetMargin],
  );

  return (
    <div className="today-page">
      <div className="today-top-grid">
        <CashOnHandCard
          model={model}
          txns={txns}
          forecastProjection={forecastProjection}
          negativeCashMonth={negativeCashMonth}
          cashTrendData={cashTrendData}
        />
        <OperatingReserveCard
          currentCashBalance={model.runway.currentCashBalance}
          reserveTarget={model.runway.reserveTarget}
          reserveCoverageDelta={reserveCoverageDelta}
        />
      </div>

      {/* Context section */}
      <div className="today-context-section">
        <div className="today-context-grid">
          <NextOwnerDistributionCard
            ownerPayProjection={ownerPayProjection}
            activeOwnerPayProjection={activeOwnerPayProjection}
            reserveFloor={ownerPayReserveFloor}
            sliderValue={ownerPaySliderValue}
            onSliderValueChange={reprojectOwnerPay ? setOwnerPaySliderValue : undefined}
          />
          <OwnerDistributionsCard
            transactions={txns}
            distributionStatus={distributionStatus.status}
            distributionTargetAmount={distributionStatus.targetAmount}
            distributionActualAmount={distributionStatus.actualAmount}
            targetNetMargin={targetNetMargin}
            forecastProjection={ownerPayProjection}
            simulatedProjection={isOwnerPaySimulated ? activeOwnerPayProjection : undefined}
            reserveTarget={ownerPayReserveFloor}
            onCompareYear={onCompareYear}
          />
        </div>
      </div>
    </div>
  );
}
