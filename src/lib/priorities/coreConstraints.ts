import type { DashboardModel, ScenarioPoint } from '../data/contract';

const TODAY_FORWARD_CASH_WINDOW_MONTHS = 12;

export interface CoreConstraints {
  reservePercent: number | null;
  forwardCashBalance: number;
  reserveTarget: number;
}

export function getCoreConstraints(
  model: DashboardModel,
  forecastProjection: ScenarioPoint[]
): CoreConstraints {
  const { percentFunded, reserveTarget, currentCashBalance } = model.runway;

  const projected = forecastProjection.slice(0, TODAY_FORWARD_CASH_WINDOW_MONTHS);

  let forwardCashBalance = currentCashBalance;
  if (projected.length > 0) {
    let runningBalance = currentCashBalance;
    let lowest = runningBalance;
    for (const entry of projected) {
      runningBalance += entry.netCashFlow;
      if (runningBalance < lowest) lowest = runningBalance;
    }
    forwardCashBalance = lowest;
  }

  return {
    reservePercent: percentFunded,
    forwardCashBalance,
    reserveTarget,
  };
}
