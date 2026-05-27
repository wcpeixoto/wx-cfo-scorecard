import type { ForecastEvent, ForecastSeasonalityMeta, ScenarioPoint } from '../data/contract';
import { applyEventsOverlay } from '../kpis/applyEventsOverlay';

export type ComposedProjection = {
  points: ScenarioPoint[];
  seasonality: ForecastSeasonalityMeta;
};

function addMonthsToToken(month: string, offset: number): string | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const monthNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null;
  }
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

/**
 * Extends a composer's 12-month projection to a longer horizon by repeating
 * the Year-1 monthly pattern (flat, month-of-year aligned, walking the
 * running balance forward), then applies the Known Events overlay.
 *
 * Composer inputs are capped at 12 months because Cadence doesn't extrapolate
 * beyond its window. This is the caller-layer extension policy. Used by:
 *  - The Forecast page's active/baseline projections
 *  - The Today page's fixed-24m run-out detection
 *
 * When requestedMonths <= composed.points.length, the composer output is
 * returned as-is with events overlay applied (no extension needed).
 */
export function extendComposedProjection(
  composed: ComposedProjection,
  currentCashBalance: number,
  requestedMonths: number,
  events: ForecastEvent[],
): ScenarioPoint[] {
  let points = composed.points;

  if (requestedMonths > composed.points.length && composed.points.length > 0) {
    const sourceByMonthOfYear = new Map<string, ScenarioPoint>();
    for (const p of composed.points) {
      const moy = p.month.slice(5, 7);
      if (!sourceByMonthOfYear.has(moy)) sourceByMonthOfYear.set(moy, p);
    }
    const firstMonth = composed.points[0].month;
    const extended: ScenarioPoint[] = [];
    let prevBalance = currentCashBalance;
    for (let i = 0; i < requestedMonths; i += 1) {
      if (i < composed.points.length) {
        const p = composed.points[i];
        extended.push(p);
        prevBalance = p.endingCashBalance;
        continue;
      }
      const monthToken = addMonthsToToken(firstMonth, i) ?? composed.points[i % composed.points.length].month;
      const sourceMoy = monthToken.slice(5, 7);
      const source = sourceByMonthOfYear.get(sourceMoy);
      if (!source) {
        // Year 1 should always cover all 12 month-of-year keys when
        // composed.points.length === 12. Defensive break.
        break;
      }
      const endingCashBalance = prevBalance + source.netCashFlow;
      extended.push({
        month: monthToken,
        operatingCashIn: source.operatingCashIn,
        operatingCashOut: source.operatingCashOut,
        cashIn: source.cashIn,
        cashOut: source.cashOut,
        netCashFlow: source.netCashFlow,
        endingCashBalance,
      });
      prevBalance = endingCashBalance;
    }
    points = extended;
  }

  return applyEventsOverlay(points, events);
}
