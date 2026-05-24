// NextOwnerDistributionCard — when can the owner next take a distribution
// without breaching the operating reserve safety line?
//
// Data: a dedicated Reality/Base/9-month forecast (ownerPayProjection) plus
// the effective reserve floor (Settings-fixed-aware, identical to the
// Forecast safety-line rule). All decision logic lives in the pure helper.
//
// The slider is session-only: useState resets to 0 on reload. It re-feeds
// computeNextOwnerDistribution with a fresh projection at the chosen growth
// rate — the helper itself is never modified.

import { useMemo, useState } from 'react';
import { useId } from 'react';
import type { ScenarioPoint } from '../lib/data/contract';
import { formatCompact } from '../lib/utils/formatCompact';
import {
  computeNextOwnerDistribution,
  REQUIRED_SERIES_LENGTH,
} from '../lib/data/nextOwnerDistribution';

// Slider range constants (revenueGrowthPct, percent units).
const SLIDER_MIN = -10;
const SLIDER_MAX = 25;
const SLIDER_NEUTRAL = 0;

// Track tick marks — mirrors the Projected Cash Balance slider
// (.forecast-slider-tick*). Major ticks at the ends + zero (emphasized);
// minor ticks every 5%.
const SLIDER_MAJOR_TICKS = [SLIDER_MIN, 0, SLIDER_MAX];
const SLIDER_MINOR_TICKS = [-5, 5, 10, 15, 20];

/** Dollar-per-month translation label for the slider thumb. */
function formatSliderDollarLabel(revenueGrowthPct: number, baselineMonthlyRevenue: number): string {
  const delta = Math.round((revenueGrowthPct / 100) * baselineMonthlyRevenue);
  if (delta === 0) return '$0/mo';
  const abs = formatCompact(Math.abs(delta));
  return delta > 0 ? `+${abs}/mo` : `-${abs}/mo`;
}

/** Thumb position percentage for left-offset of the floating value label.
 *  Accounts for browser thumb half-width so the label centres on the thumb. */
function thumbPercent(value: number, min: number, max: number): number {
  return ((value - min) / (max - min)) * 100;
}

/** Tick label: signed percent, "0%" at zero (− = U+2212, matches ticks). */
function formatTickLabel(pct: number): string {
  if (pct === 0) return '0%';
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

/** Edge-snapped horizontal shift so end labels don't overflow the track. */
function edgeTransform(pct: number): string {
  return pct < 8
    ? 'translateX(0%)'
    : pct > 92
      ? 'translateX(-100%)'
      : 'translateX(-50%)';
}

/**
 * Two-state dynamic copy beneath the slider.
 *
 * Outside window: "Still outside the payout window."
 * Inside window:  "At +$X.XK/mo, first payout moves to <Month YYYY>."
 *
 * Degenerate/fallback → outside copy.
 */
function buildResultSentence(
  sliderPct: number,
  sliderState: 'forecast' | 'blocked',
  sliderMonthLabel: string | undefined,
  dollarLabel: string
): string {
  if (sliderState === 'forecast' && sliderMonthLabel) {
    // Payout is inside the window at the current slider position.
    if (sliderPct === 0) {
      // Base state already has a payout in window — no adjustment made.
      return `First payout on track for ${sliderMonthLabel}.`;
    }
    return `At ${dollarLabel}, first payout moves to ${sliderMonthLabel}.`;
  }
  // Payout is outside the window (or degenerate result) — no sentence;
  // the hero ("No Payout") already states this.
  return '';
}

interface NextOwnerDistributionCardProps {
  ownerPayProjection: ScenarioPoint[];
  reserveFloor: number;
  reprojectOwnerPay?: (revenueGrowthPct: number) => ScenarioPoint[];
}

export function NextOwnerDistributionCard({
  ownerPayProjection,
  reserveFloor,
  reprojectOwnerPay,
}: NextOwnerDistributionCardProps) {
  const tooltipId = useId();
  const [sliderValue, setSliderValue] = useState<number>(SLIDER_NEUTRAL);

  // Baseline (0% growth) result — the unmodified projection.
  const baseResult = useMemo(
    () => computeNextOwnerDistribution(ownerPayProjection, reserveFloor),
    [ownerPayProjection, reserveFloor]
  );

  // Baseline $/mo: average operatingCashIn across the unmodified projection.
  // This is the closest proxy to what revenueGrowthPct actually scales inside
  // the engine (baselineCashIn ≈ average monthly revenue), and is already
  // available at the card boundary without touching locked files.
  const baselineMonthlyRevenue = useMemo(() => {
    if (!ownerPayProjection || ownerPayProjection.length === 0) return 0;
    const total = ownerPayProjection.reduce((sum, p) => sum + (p.operatingCashIn ?? 0), 0);
    return total / ownerPayProjection.length;
  }, [ownerPayProjection]);

  // Slider re-projection — only when reprojectOwnerPay is available and
  // slider is non-zero. Falls back to base projection at neutral.
  const slidedProjection = useMemo((): ScenarioPoint[] | null => {
    if (sliderValue === 0 || !reprojectOwnerPay) return null;
    const proj = reprojectOwnerPay(sliderValue);
    // Guard: if the pipeline returns < REQUIRED_SERIES_LENGTH for any reason,
    // fall back to base rather than tripping the throw.
    if (!proj || proj.length < REQUIRED_SERIES_LENGTH) return null;
    return proj;
  }, [sliderValue, reprojectOwnerPay]);

  const slidedResult = useMemo(() => {
    if (!slidedProjection) return null;
    return computeNextOwnerDistribution(slidedProjection, reserveFloor);
  }, [slidedProjection, reserveFloor]);

  // Active display result: slided if available, else base.
  const displayResult = slidedResult ?? baseResult;

  const dollarLabel = formatSliderDollarLabel(sliderValue, baselineMonthlyRevenue);

  const resultSentence = buildResultSentence(
    sliderValue,
    displayResult.state,
    displayResult.state === 'forecast' ? displayResult.monthLabel : undefined,
    dollarLabel
  );

  // Thumb position for floating label (0–100%). Matches the Projected Cash
  // Balance slider: anchor at the thumb %, shift via translateX, and snap the
  // shift at the track edges so the label never overflows.
  const thumbPct = thumbPercent(sliderValue, SLIDER_MIN, SLIDER_MAX);
  const labelTransform =
    thumbPct < 8
      ? 'translateX(0%)'
      : thumbPct > 92
        ? 'translateX(-100%)'
        : 'translateX(-50%)';

  const hasSlider = reprojectOwnerPay != null;

  return (
    <article className="card nod-card" aria-label="Owner Distribution Forecast">
      <div className="nod-header">
        <div className="nod-title-row">
          <h3 className="nod-title">Owner Distribution Forecast</h3>
          <span className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="Owner Distribution Forecast explanation"
              aria-describedby={tooltipId}
            >
              &#9432;
            </button>
            <div id={tooltipId} role="tooltip" className="db-tooltip-panel nod-tooltip-panel">
              <ul className="db-tooltip-list">
                <li>Shows when you can next take an owner distribution without breaching your operating reserve.</li>
                <li>Uses a 4-month safety window: the projected cash must stay above your reserve floor for the payout month plus the next 3 months.</li>
                <li>Slide the revenue lever to see how a change would shift the timeline.</li>
              </ul>
            </div>
          </span>
        </div>
      </div>

      {displayResult.state === 'forecast' ? (
        <div className="nod-headline-block">
          <p className="nod-month">{displayResult.monthLabel}</p>
          <p className="nod-subhead">First expected owner payout</p>
        </div>
      ) : (
        <div className="nod-headline-block">
          <p className="nod-month">No Payout</p>
          <p className="nod-subhead">The next 6 months are too tight for owner payout.</p>
        </div>
      )}

      {hasSlider && (
        <div className="nod-scenario-section">
          <p className="nod-scenario-label">What if revenue changes?</p>

          <div className="nod-slider-control">
            <div className="nod-slider-track-wrap">
              {/* Floating thumb value label */}
              <span
                className="nod-slider-thumb-value"
                style={{ left: `${thumbPct}%`, transform: labelTransform }}
                aria-hidden="true"
              >
                {dollarLabel}
              </span>
              <div className="nod-slider-ticks" aria-hidden="true">
                {SLIDER_MAJOR_TICKS.map((t) => (
                  <span
                    key={`nod-tick-${t}`}
                    className={`nod-slider-tick${t === 0 ? ' is-zero' : ''}`}
                    style={{ left: `${thumbPercent(t, SLIDER_MIN, SLIDER_MAX)}%` }}
                  />
                ))}
                {SLIDER_MINOR_TICKS.map((t) => (
                  <span
                    key={`nod-minor-${t}`}
                    className="nod-slider-tick nod-slider-tick--minor"
                    style={{ left: `${thumbPercent(t, SLIDER_MIN, SLIDER_MAX)}%` }}
                  />
                ))}
              </div>
              <input
                type="range"
                min={SLIDER_MIN}
                max={SLIDER_MAX}
                step={1}
                value={sliderValue}
                onChange={(e) => setSliderValue(Number(e.target.value))}
                className="nod-slider-input"
                aria-label="Revenue growth adjustment"
              />
            </div>
            <div className="nod-slider-tick-label-row" aria-hidden="true">
              {SLIDER_MAJOR_TICKS.map((t) => {
                const pct = thumbPercent(t, SLIDER_MIN, SLIDER_MAX);
                return (
                  <span
                    key={`nod-ticklabel-${t}`}
                    style={{ left: `${pct}%`, transform: edgeTransform(pct) }}
                  >
                    {formatTickLabel(t)}
                  </span>
                );
              })}
            </div>
          </div>

          {resultSentence && (
            <p className="nod-result-sentence">{resultSentence}</p>
          )}
        </div>
      )}
    </article>
  );
}
