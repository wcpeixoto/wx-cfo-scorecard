/**
 * Hybrid local/zero-based y-axis snap for cash-level metrics.
 *
 * Cash balance is a level metric, not a volume metric. A zero-based
 * axis on short horizons (e.g. 30d, 60d) visually flattens cash
 * movement near the current cash level, understating short-term
 * volatility — the very signal the operator needs to read. A local
 * axis (snapped just below dataMin and just above dataMax) keeps
 * that movement visible.
 *
 * Decision rule:
 *   range = dataMax - dataMin
 *   if dataMin > 0 AND range / dataMax < FLATTEN_THRESHOLD
 *     → local axis  (data lives far above zero; zero-anchor would flatten)
 *   else
 *     → zero-based axis  (range is wide relative to level, or data
 *                         crosses zero, or dataMin is already at zero)
 *
 * FLATTEN_THRESHOLD = 0.35 is a product decision, tuneable here. It
 * is the only branch knob; tick counts are product decisions too.
 *
 * Step sizing uses the standard 1-2-5 × 10ⁿ progression, which produces
 * only integer-K labels at this product's cash magnitudes (single-
 * location BJJ gym, low-millions annual). MIN_STEP = $1,000 is the
 * label cleanliness floor — finer would surface sub-thousand or
 * .5K-style labels.
 *
 * Algorithm: pick an initial step from `roundToNiceStep(range / 5)`
 * (or `dataMax / 5` for zero-based), snap min/max to that step, then
 * walk the 1-2-5 progression coarser if too crowded or pad outward
 * if too sparse. Tick-count ceilings are tighter for the local axis
 * (6) than the zero-based axis (7) because local axes occupy a
 * narrower visual band.
 *
 * Pure module. No imports from app code. No I/O. No globals.
 */

const MIN_STEP = 1_000;
const TARGET_TICKS = 5;
const MAX_TICKS_LOCAL = 6;
const MAX_TICKS_ZERO = 7;
const FLATTEN_THRESHOLD = 0.35;

export interface NiceTicks {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/**
 * Snap a positive number to the nearest 1-2-5 × 10ⁿ value.
 * Returns one of {1, 2, 5, 10} × 10^floor(log10(raw)).
 */
export function roundToNiceStep(raw: number): number {
  if (raw <= 0) return MIN_STEP;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  let multiplier: number;
  if (normalized < 1.5)      multiplier = 1;
  else if (normalized < 3.5) multiplier = 2;
  else if (normalized < 7.5) multiplier = 5;
  else                       multiplier = 10;
  return multiplier * magnitude;
}

/**
 * Walk one notch up the 1-2-5 progression (1→2→5→10→20→50→…).
 * Used by the "too crowded" coarsen loop.
 */
export function nextCoarserStep(step: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(step)));
  const normalized = Math.round(step / magnitude);
  if (normalized === 1) return 2 * magnitude;
  if (normalized === 2) return 5 * magnitude;
  if (normalized === 5) return 10 * magnitude;
  return 20 * magnitude; // normalized === 10 (or fallback)
}

/**
 * Generate inclusive tick array from `min` to `max` in steps of `step`.
 * Uses integer-multiple computation (min + i*step) to avoid floating-
 * point drift across many iterations.
 */
function generateTicks(min: number, max: number, step: number): number[] {
  const ticks: number[] = [];
  const count = Math.round((max - min) / step) + 1;
  for (let i = 0; i < count; i += 1) {
    ticks.push(min + i * step);
  }
  return ticks;
}

/**
 * Snap [dataMin, dataMax] to a nice y-axis. Picks local (non-zero)
 * or zero-based anchor per the FLATTEN_THRESHOLD rule. Returns the
 * snapped min/max, the chosen step, and the inclusive tick array.
 *
 * Consumers should set the chart's yMin/yMax to the returned `min`/
 * `max` so the rendered labels align with the plot area.
 */
export function niceTicks(dataMin: number, dataMax: number): NiceTicks {
  // Guard: no positive data — return a small visible band rather than
  // collapsing to a single tick or descending into negative territory.
  if (dataMax <= 0) {
    return { min: 0, max: 5_000, step: 5_000, ticks: [0, 5_000] };
  }

  // Flat-data guard: expand by one step on each side so the data point
  // sits in the middle of a visible band. Then proceed normally.
  if (dataMin === dataMax) {
    dataMin = dataMin - 1_000;
    dataMax = dataMax + 1_000;
  }

  const range = dataMax - dataMin;
  const zeroWouldFlatten = dataMin > 0 && range / dataMax < FLATTEN_THRESHOLD;

  if (zeroWouldFlatten) {
    // ─── BRANCH A: local axis ─────────────────────────────────────────
    let step = Math.max(MIN_STEP, roundToNiceStep(range / TARGET_TICKS));
    let niceMin = Math.floor(dataMin / step) * step;
    let niceMax = Math.ceil(dataMax / step) * step;
    let ticks = generateTicks(niceMin, niceMax, step);

    // Coarsen if too crowded.
    while (ticks.length > MAX_TICKS_LOCAL) {
      step = nextCoarserStep(step);
      niceMin = Math.floor(dataMin / step) * step;
      niceMax = Math.ceil(dataMax / step) * step;
      ticks = generateTicks(niceMin, niceMax, step);
    }

    // Pad outward if too sparse. Prefer padding bottom unless doing so
    // would cross zero (zero-based axis was rejected; don't sneak
    // back to it via padding) or would push niceMin further from
    // dataMin than necessary (avoid wasted bottom whitespace).
    while (ticks.length < TARGET_TICKS) {
      const canPadBottom =
        niceMin - step >= 0 && niceMin > dataMin - step;
      if (canPadBottom) {
        niceMin -= step;
      } else {
        niceMax += step;
      }
      ticks = generateTicks(niceMin, niceMax, step);
    }

    return { min: niceMin, max: niceMax, step, ticks };
  }

  // ─── BRANCH B: zero-based axis ───────────────────────────────────────
  let step = Math.max(MIN_STEP, roundToNiceStep(dataMax / TARGET_TICKS));
  let niceMax = Math.ceil(dataMax / step) * step;
  let ticks = generateTicks(0, niceMax, step);

  // Coarsen if too crowded.
  while (ticks.length > MAX_TICKS_ZERO) {
    step = nextCoarserStep(step);
    niceMax = Math.ceil(dataMax / step) * step;
    ticks = generateTicks(0, niceMax, step);
  }

  // Pad top if too sparse (min is anchored at 0).
  while (ticks.length < TARGET_TICKS) {
    niceMax += step;
    ticks = generateTicks(0, niceMax, step);
  }

  return { min: 0, max: niceMax, step, ticks };
}

/**
 * Format an axis tick value as a compact currency label.
 *
 *   0                       → "$0"
 *   |v| < 1,000             → "$<v>"        (whole numbers)
 *   1,000 ≤ |v| < 1,000,000 → "$<v/1000>K"  (integer K — steps are
 *                                            integer multiples of
 *                                            MIN_STEP $1K. Defensive
 *                                            one-decimal fallback if a
 *                                            non-integer slips through.)
 *   |v| ≥ 1,000,000         → "$<v/1M>M"    (integer M when whole;
 *                                            one decimal when fractional)
 *
 * Negative values use a leading hyphen-minus to match the existing
 * chart label conventions in this project.
 */
export function formatTickLabel(value: number): string {
  if (value === 0) return '$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs < 1_000) {
    return `${sign}$${Math.round(abs)}`;
  }

  if (abs < 1_000_000) {
    const k = abs / 1_000;
    const rendered = Number.isInteger(k) ? String(k) : k.toFixed(1);
    return `${sign}$${rendered}K`;
  }

  const m = abs / 1_000_000;
  const rendered = Number.isInteger(m) ? String(m) : m.toFixed(1);
  return `${sign}$${rendered}M`;
}
