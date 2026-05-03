import type { ForecastEvent, ScenarioPoint } from '../data/contract';

/**
 * Apply Known Events to an already-composed posture-aware projection
 * (Reality or Recovery output of the composer layer).
 *
 * Pure function — no I/O, no transactions argument, no date argument,
 * no engine/cadence calls. Composition only.
 *
 * Policy (locked):
 *  - Events affect cashIn / cashOut at the post-composition surface.
 *    Engine, Cadence, Reality composer, and Recovery composer all
 *    continue to receive events: []. The overlay sits OUTSIDE all of
 *    them, applied once after the user's selected posture is built.
 *  - operatingCashIn / operatingCashOut are preserved as-is. Events
 *    are a planning/cash-timing overlay, not a re-statement of the
 *    operating baseline.
 *  - netCashFlow is recomputed from the adjusted cashIn / cashOut so
 *    a single source of truth holds.
 *  - endingCashBalance rolls forward from the event month through all
 *    subsequent points, even points with no event of their own.
 *  - Filter: only enabled === true events apply. The status field
 *    (planned / tentative / committed) is decorative and ignored.
 *  - Multiple events in the same month sum.
 *  - Events whose month is not present in the projected horizon are
 *    silently ignored (e.g., a Jun 2030 event with a 12-month horizon).
 *  - Non-finite cashInImpact / cashOutImpact coerce to 0 defensively.
 *  - Empty events list — return the input unchanged (math invariant).
 *  - Input is not mutated. Returns a new array of new objects when any
 *    events apply.
 *
 * @param points  Composed posture series (Reality or Recovery), already
 *                horizon-extended at the caller layer if 2Y/3Y.
 * @param events  Known Events from React state / Supabase.
 */
export function applyEventsOverlay(
  points: ScenarioPoint[],
  events: ForecastEvent[]
): ScenarioPoint[] {
  if (points.length === 0) return points;

  const monthlyImpact = new Map<string, { cashIn: number; cashOut: number }>();
  let anyEnabled = false;
  for (const event of events) {
    if (event.enabled !== true) continue;
    const cashIn = Number.isFinite(event.cashInImpact) ? event.cashInImpact : 0;
    const cashOut = Number.isFinite(event.cashOutImpact) ? event.cashOutImpact : 0;
    if (cashIn === 0 && cashOut === 0) continue;
    anyEnabled = true;
    const prior = monthlyImpact.get(event.month);
    if (prior) {
      prior.cashIn += cashIn;
      prior.cashOut += cashOut;
    } else {
      monthlyImpact.set(event.month, { cashIn, cashOut });
    }
  }

  if (!anyEnabled) return points;

  // Quick path: if no event month overlaps the projected horizon, skip
  // the rebuild entirely so the math is byte-for-byte identical.
  let anyOverlap = false;
  for (const point of points) {
    if (monthlyImpact.has(point.month)) { anyOverlap = true; break; }
  }
  if (!anyOverlap) return points;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const out: ScenarioPoint[] = [];
  let prevEnding = points[0].endingCashBalance - points[0].netCashFlow;
  for (const point of points) {
    const impact = monthlyImpact.get(point.month);
    if (impact) {
      const cashIn = round2(point.cashIn + impact.cashIn);
      const cashOut = round2(point.cashOut + impact.cashOut);
      const netCashFlow = round2(cashIn - cashOut);
      const endingCashBalance = round2(prevEnding + netCashFlow);
      out.push({
        month: point.month,
        operatingCashIn: point.operatingCashIn,
        operatingCashOut: point.operatingCashOut,
        cashIn,
        cashOut,
        netCashFlow,
        endingCashBalance,
      });
      prevEnding = endingCashBalance;
    } else {
      // No event this month — but balance still needs to roll forward
      // from the previous (possibly adjusted) ending balance.
      const endingCashBalance = round2(prevEnding + point.netCashFlow);
      if (endingCashBalance === point.endingCashBalance) {
        out.push(point);
      } else {
        out.push({ ...point, endingCashBalance });
      }
      prevEnding = endingCashBalance;
    }
  }
  return out;
}
