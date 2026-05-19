// NextOwnerDistributionCardLab — independent UI Lab replica of the Next
// Owner Distribution card. Fully decoupled from NextOwnerDistributionCard:
// its own component + its own .nodlab-* CSS prefix, so iterating on the Lab
// copy never touches the shipped Today card. Shares only the pure data
// helper (computeNextOwnerDistribution) and design tokens.
//
// Data: a dedicated Reality/Base/9-month forecast (ownerPayProjection) plus
// the effective reserve floor (Settings-fixed-aware, identical to the
// Forecast safety-line rule). All decision logic lives in the pure helper.

import { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { ScenarioPoint } from '../lib/data/contract';
import { chartTokens } from '../lib/ui/chartTokens';
import { formatCompact } from '../lib/utils/formatCompact';
import {
  computeNextOwnerDistribution,
  type NextDistributionBlocker,
} from '../lib/data/nextOwnerDistribution';

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

interface NextOwnerDistributionCardLabProps {
  ownerPayProjection: ScenarioPoint[];
  reserveFloor: number;
}

export function NextOwnerDistributionCardLab({
  ownerPayProjection,
  reserveFloor,
}: NextOwnerDistributionCardLabProps) {
  const result = useMemo(
    () => computeNextOwnerDistribution(ownerPayProjection, reserveFloor),
    [ownerPayProjection, reserveFloor]
  );

  const bars = result.bars;
  const monthLabels = bars.map((b) => b.monthLabel.split(' ')[0]); // "Aug"

  // Negative-cash months: the helper faithfully returns a negative
  // operating-cash segment (true ending cash). A stacked bar can't render a
  // negative floor sensibly, so for display those months clamp to a thin
  // neutral stub at the zero baseline — magnitude is intentionally not shown
  // (the tooltip carries "< $0"). Real values stay in `bars` for the tooltip.
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
    // Axis/grid treatment matches the sibling OwnerDistributionsChart for
    // cross-card consistency on the Today context grid. (This reinstates the
    // visible X labels / Y ticks that #130 had stripped — a deliberate
    // owner decision to align with the neighbour card.)
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
      // Preserved from the prior NOD grid: headroom for the "First payout"
      // annotation label. OwnerDistributionsChart has no annotation so its
      // grid omits this — the only intentional delta from the sibling.
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
      // Custom HTML formatter (pre-approved OwnerDistributionsChart
      // precedent). Rows mirror the stacked bar top-down. Negative-cash
      // months never show a negative figure: "< $0" plus a plain-text
      // redirect, matching the standard tooltip styling.
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

  const isForecast = result.state === 'forecast';
  const badgeClass = isForecast
    ? 'card-status-badge is-healthy'
    : 'card-status-badge is-neutral';
  const badgeLabel =
    result.state === 'forecast'
      ? 'Coming up'
      : BLOCKED_PILL_LABELS[result.blocker];

  return (
    <article className="card nodlab-card" aria-label="Next Owner Distribution (Lab)">
      <div className="nodlab-header">
        <h3 className="nodlab-title">Next Owner Distribution</h3>
        <span className={badgeClass}>{badgeLabel}</span>
      </div>

      {result.state === 'forecast' ? (
        <div className="nodlab-headline-block">
          <p className="nodlab-month">{result.monthLabel}</p>
          <p className="nodlab-amount">
            {formatCompact(result.distributionAmount)} forecast distribution
          </p>
          <p className="nodlab-context">Based on current forecast</p>
        </div>
      ) : (
        <div className="nodlab-headline-block">
          <p className="nodlab-month">No payout forecast</p>
          <p className="nodlab-context">Next 6 months</p>
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

      <p className="nodlab-footnote">
        Simulate revenue and expense changes to see how to get paid sooner
      </p>
    </article>
  );
}
