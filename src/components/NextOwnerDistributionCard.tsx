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
  type NextDistributionBlocker,
  REQUIRED_SERIES_LENGTH,
} from '../lib/data/nextOwnerDistribution';

// Slider range constants (revenueGrowthPct, percent units).
const SLIDER_MIN = -10;
const SLIDER_MAX = 25;
const SLIDER_NEUTRAL = 0;

// Owner-facing blocked-state pill copy. reserve_shortfall and
// negative_distributable_cash intentionally collapse to the same message.
const BLOCKED_PILL_LABELS: Record<NextDistributionBlocker, string> = {
  reserve_shortfall: 'No payout room',
  negative_distributable_cash: 'No payout room',
  below_minimum_payout: 'Almost there',
};

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

/** Result sentence per spec constraint #8. */
function buildResultSentence(
  baseState: 'forecast' | 'blocked',
  baseMonthLabel: string | undefined,
  sliderPct: number,
  sliderState: 'forecast' | 'blocked',
  sliderMonthLabel: string | undefined,
  dollarLabel: string
): string {
  if (sliderPct === 0) {
    if (baseState === 'forecast' && baseMonthLabel) {
      return `No change — first payout stays ${baseMonthLabel}.`;
    }
    return 'No change — payout stays outside the window.';
  }

  // Non-zero slider. dollarLabel already has +/- prefix.
  const prefix = `At ${dollarLabel} revenue,`;

  if (sliderState === 'forecast' && sliderMonthLabel) {
    // Check if it changed from base.
    if (baseState === 'forecast' && baseMonthLabel === sliderMonthLabel) {
      return `${prefix} first payout stays ${sliderMonthLabel}.`;
    }
    return `${prefix} first payout moves to ${sliderMonthLabel}.`;
  }

  // Slider is blocked.
  if (baseState === 'forecast' && baseMonthLabel) {
    return `${prefix} payout stays outside the window.`;
  }
  return `${prefix} payout stays outside the window.`;
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

  const isForecast = displayResult.state === 'forecast';
  const badgeClass = isForecast
    ? 'card-status-badge is-healthy'
    : 'card-status-badge is-neutral';
  const badgeLabel =
    displayResult.state === 'forecast'
      ? 'Coming up'
      : BLOCKED_PILL_LABELS[displayResult.blocker];

  const dollarLabel = formatSliderDollarLabel(sliderValue, baselineMonthlyRevenue);

  const resultSentence = buildResultSentence(
    baseResult.state,
    baseResult.state === 'forecast' ? baseResult.monthLabel : undefined,
    sliderValue,
    displayResult.state,
    displayResult.state === 'forecast' ? displayResult.monthLabel : undefined,
    dollarLabel
  );

  // Thumb position for floating label (0–100%).
  const thumbPct = thumbPercent(sliderValue, SLIDER_MIN, SLIDER_MAX);
  // Nudge the label left so it doesn't overflow the right edge.
  const labelLeft = `clamp(0px, calc(${thumbPct}% - 22px), calc(100% - 60px))`;

  const hasSlider = reprojectOwnerPay != null;

  return (
    <article className="card nod-card" aria-label="Next Owner Distribution">
      <div className="nod-header">
        <div className="nod-title-row">
          <h3 className="nod-title">Next Owner Distribution</h3>
          <span className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="Next Owner Distribution explanation"
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
        <span className={badgeClass}>{badgeLabel}</span>
      </div>

      {displayResult.state === 'forecast' ? (
        <div className="nod-headline-block">
          <p className="nod-month">{displayResult.monthLabel}</p>
          <p className="nod-subhead">First expected owner payout</p>
        </div>
      ) : (
        <div className="nod-headline-block">
          <p className="nod-month">Not in next 6 months</p>
          <p className="nod-subhead">Forecast leaves no room for owner payout.</p>
        </div>
      )}

      {hasSlider && (
        <>
          <hr className="nod-divider" aria-hidden="true" />

          <div className="nod-scenario-section">
            <p className="nod-scenario-label">What if revenue changes?</p>

            <div className="nod-slider-control">
              <div className="nod-slider-track-wrap">
                {/* Floating thumb value label */}
                <span
                  className="nod-slider-thumb-value"
                  style={{ left: labelLeft }}
                  aria-hidden="true"
                >
                  {dollarLabel}
                </span>
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
                <span>−10%</span>
                <span>0</span>
                <span>+25%</span>
              </div>
            </div>

            <p className="nod-result-sentence">{resultSentence}</p>
          </div>
        </>
      )}

      <a href="#/forecast" className="nod-forecast-link">
        Plan this in Forecast →
      </a>
    </article>
  );
}
