import type { ForecastProjectionResult, ScenarioPoint } from '../data/contract';

/**
 * Compose a Split Conservative forecast by merging Engine cash-in with
 * Cadence cash-out, month-aligned.
 *
 * Split Conservative = Engine.operatingCashIn + Cadence.operatingCashOut
 *
 * Policy notes (revisitable in Phase 3):
 *
 * NO AR/AP CARRY — Engine's carry layer (AR/AP days adjustment that shifts
 * operatingCashIn → cashIn and operatingCashOut → cashOut) is intentionally
 * dropped. Cadence has no carry analogue; applying Engine carry on the
 * cash-in side only would create asymmetric smoothing with no matching
 * offset on the cash-out side. For this reason, cashIn and cashOut are
 * set equal to operatingCashIn and operatingCashOut respectively, and the
 * post-carry fields are not mixed from the two sources.
 *
 * NO KNOWN EVENTS OVERLAY — Known Events must not be applied in Phase 2.
 * Cadence does not handle events at all; applying Engine-side events only
 * would create a one-sided event response (events increase cash-in but
 * Cadence's cash-out has no matching event awareness). Callers must pass
 * event-free component projections. Phase 3 will resolve event policy.
 *
 * ENGINE SEASONALITY — Split Conservative inherits Engine seasonality
 * metadata. This is intentional: Engine carries the seasonality computation;
 * Cadence is cadence-based and does not produce a comparable seasonality
 * object. Revisitable in Phase 3.
 *
 * PURE FUNCTION — No transactions argument. No date argument. Composition
 * only. Both component projections are computed by their respective callers
 * before being passed here.
 *
 * @param engine   Result of projectScenario with events=[].
 * @param cadence  Result of projectCategoryCadenceScenario with events=[].
 * @param startingCashBalance  Absolute starting cash for the merged series.
 *   Must match the value used for both component projections.
 * @throws If engine.points and cadence.points have different lengths or any
 *   month at position i disagrees between the two series.
 */
export function composeSplitConservative(
  engine: ForecastProjectionResult,
  cadence: ForecastProjectionResult,
  startingCashBalance: number,
): ForecastProjectionResult {
  const eLen = engine.points.length;
  const cLen = cadence.points.length;

  if (eLen !== cLen) {
    throw new Error(
      `composeSplitConservative: point-count mismatch — engine has ${eLen} points, cadence has ${cLen} points.`
    );
  }

  // Verify month alignment before any computation.
  for (let i = 0; i < eLen; i += 1) {
    const eMonth = engine.points[i].month;
    const cMonth = cadence.points[i].month;
    if (eMonth !== cMonth) {
      throw new Error(
        `composeSplitConservative: month mismatch at index ${i} — engine month="${eMonth}", cadence month="${cMonth}".`
      );
    }
  }

  const points: ScenarioPoint[] = [];
  let prevBalance = startingCashBalance;

  for (let i = 0; i < eLen; i += 1) {
    const ep = engine.points[i];
    const cp = cadence.points[i];

    // Pre-carry fields from each source. Cadence has no AR/AP carry layer
    // (operatingCashIn === cashIn and operatingCashOut === cashOut on every
    // Cadence point). Engine carry is dropped here — see policy note above.
    const operatingCashIn  = ep.operatingCashIn;
    const operatingCashOut = cp.operatingCashOut;
    const cashIn           = operatingCashIn;
    const cashOut          = operatingCashOut;
    const netCashFlow      = cashIn - cashOut;
    const endingCashBalance = prevBalance + netCashFlow;

    points.push({
      month: ep.month,
      operatingCashIn,
      operatingCashOut,
      cashIn,
      cashOut,
      netCashFlow,
      endingCashBalance,
    });

    prevBalance = endingCashBalance;
  }

  // Inherit Engine seasonality — see policy note above.
  return { points, seasonality: engine.seasonality };
}
