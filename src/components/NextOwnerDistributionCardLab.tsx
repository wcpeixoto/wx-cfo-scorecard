// NextOwnerDistributionCardLab — independent UI Lab replica of the Next
// Owner Distribution card. Fully decoupled from NextOwnerDistributionCard:
// its own component + its own .nodlab-* CSS prefix, so iterating on the Lab
// copy never touches the shipped Today card. Shares only the pure data
// helper (computeNextOwnerDistribution) and design tokens.
//
// Data: a dedicated Reality/Base/9-month forecast (ownerPayProjection) plus
// the effective reserve floor (Settings-fixed-aware, identical to the
// Forecast safety-line rule). All decision logic lives in the pure helper.

import { useMemo, useState } from 'react';
import { useId } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { ScenarioPoint } from '../lib/data/contract';
import { chartTokens } from '../lib/ui/chartTokens';
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

// TailAdmin brand ramp (preserved from #132): darkest at the base,
// medium in the middle, lightest on top.
const OPERATING_CASH_COLOR = chartTokens.brand; // #465FFF
const SAFE_CASH_COLOR = chartTokens.brand400; // #637AEA
const DISTRIBUTION_COLOR = chartTokens.brandSecondary; // #9CB9FF

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

/** Thumb position percentage for left-offset of the floating value label. */
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

  const prefix = `At ${dollarLabel} revenue,`;

  if (sliderState === 'forecast' && sliderMonthLabel) {
    if (baseState === 'forecast' && baseMonthLabel === sliderMonthLabel) {
      return `${prefix} first payout stays ${sliderMonthLabel}.`;
    }
    return `${prefix} first payout moves to ${sliderMonthLabel}.`;
  }

  return `${prefix} payout stays outside the window.`;
}

interface NextOwnerDistributionCardLabProps {
  ownerPayProjection: ScenarioPoint[];
  reserveFloor: number;
  reprojectOwnerPay?: (revenueGrowthPct: number) => ScenarioPoint[];
}

export function NextOwnerDistributionCardLab({
  ownerPayProjection,
  reserveFloor,
  reprojectOwnerPay,
}: NextOwnerDistributionCardLabProps) {
  const tooltipId = useId();
  const [sliderValue, setSliderValue] = useState<number>(SLIDER_NEUTRAL);

  // Baseline (0% growth) result — the unmodified projection.
  const baseResult = useMemo(
    () => computeNextOwnerDistribution(ownerPayProjection, reserveFloor),
    [ownerPayProjection, reserveFloor]
  );

  // Baseline $/mo: average operatingCashIn across the unmodified projection.
  const baselineMonthlyRevenue = useMemo(() => {
    if (!ownerPayProjection || ownerPayProjection.length === 0) return 0;
    const total = ownerPayProjection.reduce((sum, p) => sum + (p.operatingCashIn ?? 0), 0);
    return total / ownerPayProjection.length;
  }, [ownerPayProjection]);

  // Slider re-projection — only when reprojectOwnerPay is available and
  // slider is non-zero.
  const slidedProjection = useMemo((): ScenarioPoint[] | null => {
    if (sliderValue === 0 || !reprojectOwnerPay) return null;
    const proj = reprojectOwnerPay(sliderValue);
    if (!proj || proj.length < REQUIRED_SERIES_LENGTH) return null;
    return proj;
  }, [sliderValue, reprojectOwnerPay]);

  const slidedResult = useMemo(() => {
    if (!slidedProjection) return null;
    return computeNextOwnerDistribution(slidedProjection, reserveFloor);
  }, [slidedProjection, reserveFloor]);

  // Active display result: slided if available, else base.
  const displayResult = slidedResult ?? baseResult;

  // Chart uses baseResult bars always (chart shows baseline, not the slider overlay).
  const bars = baseResult.bars;
  const monthLabels = bars.map((b) => b.monthLabel.split(' ')[0]); // "Aug"

  const maxPositiveTotal = Math.max(
    0,
    ...bars
      .filter((b) => b.endingCashBeforePayout >= 0)
      .map((b) => b.reserveSegment + b.safeCashSegment + b.distributionSegment)
  );
  const negativeStub = maxPositiveTotal > 0 ? maxPositiveTotal * 0.02 : 1;

  const series = [
    {
      name: 'Operating cash',
      data: bars.map((b) =>
        b.endingCashBeforePayout < 0 ? negativeStub : b.reserveSegment
      ),
    },
    {
      name: 'Safe cash',
      data: bars.map((b) =>
        b.endingCashBeforePayout < 0 ? 0 : b.safeCashSegment
      ),
    },
    {
      name: 'Owner distribution',
      data: bars.map((b) =>
        b.endingCashBeforePayout < 0 ? 0 : b.distributionSegment
      ),
    },
  ];

  const firstPayoutIndex = bars.findIndex((b) => b.isFirstPayout);

  const options: ApexOptions = {
    chart: {
      type: 'bar',
      stacked: true,
      toolbar: { show: false },
      fontFamily: 'Outfit, sans-serif',
      background: 'transparent',
      animations: { enabled: false },
    },
    colors: [OPERATING_CASH_COLOR, SAFE_CASH_COLOR, DISTRIBUTION_COLOR],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '39%',
        borderRadius: 5,
        borderRadiusApplication: 'end',
        borderRadiusWhenStacked: 'last',
      },
    },
    fill: {
      colors: [
        () => OPERATING_CASH_COLOR,
        () => SAFE_CASH_COLOR,
        () => DISTRIBUTION_COLOR,
      ],
    },
    dataLabels: { enabled: false },
    stroke: { show: true, width: 2, colors: ['transparent'] },
    xaxis: {
      categories: monthLabels,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { fontSize: '12px', colors: chartTokens.axisText } },
      crosshairs: { show: false },
    },
    yaxis: {
      tickAmount: 4,
      forceNiceScale: true,
      labels: {
        formatter: (val: number) => '$' + (val / 1000).toFixed(0) + 'k',
        style: { fontSize: '12px', colors: chartTokens.axisText },
      },
    },
    grid: {
      borderColor: chartTokens.gridBorder,
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
      padding: { top: firstPayoutIndex >= 0 ? 20 : 0, right: 0, bottom: 0, left: 0 },
    },
    states: {
      hover: { filter: { type: 'none' } },
      active: { filter: { type: 'none' } },
    },
    legend: { show: false },
    annotations:
      firstPayoutIndex >= 0
        ? {
            points: [
              {
                x: monthLabels[firstPayoutIndex],
                y: bars[firstPayoutIndex].endingCashBeforePayout,
                marker: { size: 0 },
                label: {
                  text: 'First payout',
                  borderColor: 'transparent',
                  offsetY: -6,
                  style: {
                    background: chartTokens.brand,
                    color: '#FFFFFF',
                    fontSize: '11px',
                    fontFamily: 'Outfit, sans-serif',
                    fontWeight: 600,
                    padding: { left: 8, right: 8, top: 3, bottom: 3 },
                  },
                },
              },
            ],
          }
        : {},
    tooltip: {
      theme: 'light',
      shared: true,
      intersect: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const bar = bars[dataPointIndex];
        if (!bar) return '';
        const row = (label: string, value: string) =>
          `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">${label}</span>
              <span class="apexcharts-tooltip-text-y-value">${value}</span>
            </div>
          </div>`;
        const isNegative = bar.endingCashBeforePayout < 0;
        const rows = isNegative
          ? [
              row('Owner distribution', '$0'),
              row('Safe cash', '$0'),
              row('Operating cash', '&lt; $0'),
            ]
          : [
              row('Owner distribution', formatCompact(bar.distributionSegment)),
              row('Safe cash', formatCompact(bar.safeCashSegment)),
              row('Operating cash', formatCompact(bar.reserveSegment)),
            ];
        const note = isNegative
          ? `<div class="nodlab-tooltip-note">Cash is forecast to run out.<br />Review Cash Forecast.</div>`
          : '';
        return `<div class="owl-tooltip-inner nodlab-tooltip-inner">
          <div class="apexcharts-tooltip-title">${bar.monthLabel}</div>
          ${rows.join('')}
          ${note}
        </div>`;
      },
    },
  };

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

  const thumbPct = thumbPercent(sliderValue, SLIDER_MIN, SLIDER_MAX);
  const labelLeft = `clamp(0px, calc(${thumbPct}% - 22px), calc(100% - 60px))`;

  const hasSlider = reprojectOwnerPay != null;

  return (
    <article className="card nodlab-card" aria-label="Next Owner Distribution (Lab)">
      <div className="nodlab-header">
        <div className="nodlab-title-row">
          <h3 className="nodlab-title">Next Owner Distribution</h3>
          <span className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="Next Owner Distribution explanation"
              aria-describedby={tooltipId}
            >
              &#9432;
            </button>
            <div id={tooltipId} role="tooltip" className="db-tooltip-panel nodlab-tooltip-panel">
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
        <div className="nodlab-headline-block">
          <p className="nodlab-month">{displayResult.monthLabel}</p>
          <p className="nodlab-subhead">First expected owner payout</p>
        </div>
      ) : (
        <div className="nodlab-headline-block">
          <p className="nodlab-month">Not in next 6 months</p>
          <p className="nodlab-subhead">Forecast leaves no room for owner payout.</p>
        </div>
      )}

      {/* Dot + neutral-label row, matching the sibling
          OwnerDistributionsChart legend for cross-card consistency. */}
      <div className="nodlab-legend">
        <span className="nodlab-legend-item">
          <span className="nodlab-legend-dot nodlab-legend-operating"></span>
          Operating cash
        </span>
        <span className="nodlab-legend-item">
          <span className="nodlab-legend-dot nodlab-legend-safe"></span>
          Safe cash
        </span>
        <span className="nodlab-legend-item">
          <span className="nodlab-legend-dot nodlab-legend-dist"></span>
          Owner distribution
        </span>
      </div>

      <div className="nodlab-chart">
        <ReactApexChart
          options={options}
          series={series}
          type="bar"
          height={200}
        />
      </div>

      {hasSlider && (
        <>
          <hr className="nodlab-divider" aria-hidden="true" />

          <div className="nodlab-scenario-section">
            <p className="nodlab-scenario-label">What if revenue changes?</p>

            <div className="nodlab-slider-control">
              <div className="nodlab-slider-track-wrap">
                <span
                  className="nodlab-slider-thumb-value"
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
                  className="nodlab-slider-input"
                  aria-label="Revenue growth adjustment"
                />
              </div>
              <div className="nodlab-slider-tick-label-row" aria-hidden="true">
                <span>−10%</span>
                <span>0</span>
                <span>+25%</span>
              </div>
            </div>

            <p className="nodlab-result-sentence">{resultSentence}</p>
          </div>
        </>
      )}

      <a href="#/forecast" className="nodlab-forecast-link">
        Plan this in Forecast →
      </a>
    </article>
  );
}
