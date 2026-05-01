import type { BacktestMetrics, ForecastSeries, TruthSeries } from './types';

const EPSILON = 1e-9;

function safeMape(forecast: number, actual: number): number {
  const denom = Math.abs(actual);
  if (denom < EPSILON) return Math.abs(forecast) < EPSILON ? 0 : 1;
  return Math.abs(forecast - actual) / denom;
}

export function computeMetrics(
  forecast: ForecastSeries,
  truth: TruthSeries,
  reserveTarget = 0
): BacktestMetrics {
  const n = Math.min(forecast.points.length, truth.points.length);

  // Directional accuracy: share of months where forecast and truth agree on
  // the sign of the monthly net change (ending balance minus prior ending).
  let directionalHits = 0;
  let directionalCount = 0;
  let priorF = forecast.startingCash;
  let priorT = truth.startingCash;
  for (let i = 0; i < n; i += 1) {
    const f = forecast.points[i].endingCashBalance;
    const t = truth.points[i].endingCashBalance;
    const fSign = Math.sign(f - priorF);
    const tSign = Math.sign(t - priorT);
    if (fSign === tSign) directionalHits += 1;
    directionalCount += 1;
    priorF = f;
    priorT = t;
  }
  const directionalAccuracy = directionalCount > 0 ? directionalHits / directionalCount : 0;

  // Trough comparison.
  let forecastTrough = Number.POSITIVE_INFINITY;
  let truthTrough = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    if (forecast.points[i].endingCashBalance < forecastTrough) forecastTrough = forecast.points[i].endingCashBalance;
    if (truth.points[i].endingCashBalance < truthTrough) truthTrough = truth.points[i].endingCashBalance;
  }
  const lowestBalanceError = Number.isFinite(forecastTrough) && Number.isFinite(truthTrough) ? forecastTrough - truthTrough : 0;

  const mapeAt = (idx: number): number => {
    if (idx >= n) return Number.NaN;
    return safeMape(forecast.points[idx].endingCashBalance, truth.points[idx].endingCashBalance);
  };

  const endpointError =
    n > 0 ? forecast.points[n - 1].endingCashBalance - truth.points[n - 1].endingCashBalance : 0;

  let worstSingleMonthMiss = 0;
  for (let i = 0; i < n; i += 1) {
    const miss = Math.abs(forecast.points[i].endingCashBalance - truth.points[i].endingCashBalance);
    if (miss > worstSingleMonthMiss) worstSingleMonthMiss = miss;
  }

  const forecastBreached = forecast.points.some((p) => p.endingCashBalance < reserveTarget - EPSILON);
  const truthBreached = truth.points.some((p) => p.endingCashBalance < reserveTarget - EPSILON);
  const safetyLineHit = forecastBreached === truthBreached;

  return {
    asOfDate: forecast.asOfDate,
    directionalAccuracy,
    lowestBalanceError,
    mape30: mapeAt(0),
    mape60: mapeAt(1),
    mape90: mapeAt(2),
    endpointError,
    safetyLineHit,
    worstSingleMonthMiss,
  };
}
