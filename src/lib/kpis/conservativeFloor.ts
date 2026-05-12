import type { ForecastProjectionResult, ScenarioPoint } from '../data/contract';

/**
 * Compose a Conservative Floor forecast by taking, per aligned month, the
 * lower of the two component cash-in values and the higher of the two
 * component cash-out values.
 *
 * Conservative Floor = min(Engine cash-in, Cadence cash-in)
 *                    − max(Engine cash-out, Cadence cash-out)
 *
 * PRODUCT NAMING — the user-facing name for this output is **Reality
 * Forecast**. Reality Forecast is the main/default forecast for the
 * product. The internal module name (`conservativeFloor`) describes the
 * mathematical construction; the product name describes how the operator
 * sees it.
 *
 * Reality Forecast is intentionally cautious by construction. In
 * retrospective backtests across five 1-year windows, it under-projected
 * actuals in 4 of 5 windows. This is a deliberate property of a planning
 * floor, not a calibration error.
 *
 * Reality Forecast is a cash-flow planning forecast, not a P&L
 * net-income forecast. It models what the operator can rely on for cash
 * planning purposes; reconciling it to a P&L is not its job.
 *
 * Policy notes (revisitable in a later phase):
 *
 * NO AR/AP CARRY — Engine's carry layer (AR/AP days adjustment that
 * shifts operatingCashIn → cashIn and operatingCashOut → cashOut) is
 * intentionally dropped. Cadence has no carry analogue, and applying
 * `min`/`max` to carried values would create asymmetric smoothing across
 * the two component sources. For this reason, cashIn and cashOut are
 * set equal to operatingCashIn and operatingCashOut respectively, and
 * the post-carry fields are not mixed from the two sources.
 *
 * NO KNOWN EVENTS OVERLAY — Cadence does not consistently apply Known
 * Events; applying Engine-side events only would create a one-sided
 * event response on the cash-in side that the cash-out side has no
 * matching awareness of. Callers must pass event-free component
 * projections. A later policy phase will resolve event handling
 * symmetrically across both composed forecasts (Reality and Recovery).
 *
 * ENGINE SEASONALITY — Reality Forecast inherits Engine seasonality
 * metadata. Engine carries the seasonality computation; Cadence is
 * cadence-based and does not produce a comparable seasonality object.
 * Same policy as `composeSplitConservative`.
 *
 * PURE FUNCTION — No transactions argument. No date argument. No
 * projection calls. No I/O. No global state. Composition only. Both
 * component projections are computed by the caller before being passed
 * here.
 *
 * @param engine   Result of `projectScenario` with events=[].
 * @param cadence  Result of `projectCategoryCadenceScenario` with events=[].
 * @param startingCashBalance  Absolute starting cash for the merged series.
 *   Must match the value used for both component projections.
 * @throws If engine.points and cadence.points have different lengths or
 *   any month at position i disagrees between the two series.
 */
export function composeConservativeFloor(
  engine: ForecastProjectionResult,
  cadence: ForecastProjectionResult,
  startingCashBalance: number,
): ForecastProjectionResult {
  const eLen = engine.points.length;
  const cLen = cadence.points.length;

  if (eLen !== cLen) {
    throw new Error(
      `composeConservativeFloor: point-count mismatch — engine has ${eLen} points, cadence has ${cLen} points.`
    );
  }

  // Verify month alignment before any computation.
  for (let i = 0; i < eLen; i += 1) {
    const eMonth = engine.points[i].month;
    const cMonth = cadence.points[i].month;
    if (eMonth !== cMonth) {
      throw new Error(
        `composeConservativeFloor: month mismatch at index ${i} — engine month="${eMonth}", cadence month="${cMonth}".`
      );
    }
  }

  const points: ScenarioPoint[] = [];
  let prevBalance = startingCashBalance;

  for (let i = 0; i < eLen; i += 1) {
    const ep = engine.points[i];
    const cp = cadence.points[i];

    // Pre-carry fields composed via min/max across the two sources.
    // Cadence has no AR/AP carry layer (operatingCashIn === cashIn and
    // operatingCashOut === cashOut on every Cadence point). Engine carry
    // is dropped here — see policy note above.
    const operatingCashIn  = Math.min(ep.operatingCashIn,  cp.operatingCashIn);
    const operatingCashOut = Math.max(ep.operatingCashOut, cp.operatingCashOut);
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
