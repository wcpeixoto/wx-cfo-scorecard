// NextOwnerDistributionCard — when can the owner next take a distribution
// without breaching the operating reserve safety line?
//
// Data: a dedicated Reality/Base/15-month forecast (ownerPayProjection) plus
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
  BLOCKER_LABELS,
} from '../lib/data/nextOwnerDistribution';

// Segment colors. Reserve floor reads as the structural/neutral base; safe
// cash is the lighter brand tint; the carved-out distribution slice is full
// brand saturation so it stands out as "what you can take."
const RESERVE_COLOR = '#E4E7EC';
const SAFE_CASH_COLOR = chartTokens.brandSecondary; // #9CB9FF
const DISTRIBUTION_COLOR = chartTokens.brand; // #465FFF

interface NextOwnerDistributionCardProps {
  ownerPayProjection: ScenarioPoint[];
  reserveFloor: number;
}

export function NextOwnerDistributionCard({
  ownerPayProjection,
  reserveFloor,
}: NextOwnerDistributionCardProps) {
  const result = useMemo(
    () => computeNextOwnerDistribution(ownerPayProjection, reserveFloor),
    [ownerPayProjection, reserveFloor]
  );

  const bars = result.bars;
  const monthLabels = bars.map((b) => b.monthLabel.split(' ')[0]); // "Aug"

  const series = [
    { name: 'Reserve floor', data: bars.map((b) => b.reserveSegment) },
    { name: 'Safe cash', data: bars.map((b) => b.safeCashSegment) },
    { name: 'Owner distribution', data: bars.map((b) => b.distributionSegment) },
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
    colors: [RESERVE_COLOR, SAFE_CASH_COLOR, DISTRIBUTION_COLOR],
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
        () => RESERVE_COLOR,
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
    yaxis: { show: false },
    grid: {
      show: false,
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
      // Line 2 ("Ending cash before payout") is a computed total
      // incompatible with the standard per-series tooltip. Custom HTML
      // formatter follows the pre-approved OwnerDistributionsChart precedent.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const bar = bars[dataPointIndex];
        if (!bar) return '';
        const rows: string[] = [];
        rows.push(
          `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">Ending cash before payout</span>
              <span class="apexcharts-tooltip-text-y-value">${formatCompact(bar.endingCashBeforePayout)}</span>
            </div>
          </div>`
        );
        rows.push(
          `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
            <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
              <span class="apexcharts-tooltip-text-y-label">Reserve floor</span>
              <span class="apexcharts-tooltip-text-y-value">${formatCompact(reserveFloor)}</span>
            </div>
          </div>`
        );
        const distRow =
          bar.distributionSegment > 0
            ? `<div class="apexcharts-tooltip-series-group" style="display:flex;align-items:center;padding:2px 0;">
                <div class="apexcharts-tooltip-text" style="display:flex;justify-content:space-between;width:100%;gap:12px;">
                  <span class="apexcharts-tooltip-text-y-label">Distribution</span>
                  <span class="apexcharts-tooltip-text-y-value">${formatCompact(bar.distributionSegment)}</span>
                </div>
              </div>`
            : '';
        return `<div class="owl-tooltip-inner nod-tooltip-inner">
          <div class="apexcharts-tooltip-title">${bar.monthLabel}</div>
          ${rows.join('')}
          ${distRow}
        </div>`;
      },
    },
  };

  const isForecast = result.state === 'forecast';
  const badgeClass = isForecast
    ? 'card-status-badge is-healthy'
    : 'card-status-badge is-neutral';
  const badgeLabel = isForecast ? 'Forecast' : 'Blocked';

  return (
    <article className="card nod-card" aria-label="Next Owner Distribution">
      <div className="nod-header">
        <h3 className="nod-title">Next Owner Distribution</h3>
        <span className={badgeClass}>{badgeLabel}</span>
      </div>

      {result.state === 'forecast' ? (
        <div className="nod-headline-block">
          <p className="nod-month">{result.monthLabel}</p>
          <p className="nod-amount">
            {formatCompact(result.distributionAmount)} forecast distribution
          </p>
          <p className="nod-context">Based on current forecast</p>
        </div>
      ) : (
        <div className="nod-headline-block">
          <p className="nod-month">No payout forecast</p>
          <p className="nod-context">Next 12 months</p>
          <p className="nod-blocker">{BLOCKER_LABELS[result.blocker]}</p>
        </div>
      )}

      <p className="nod-legend">
        <span className="nod-legend-word nod-legend-reserve">Reserve floor</span>
        <span className="nod-legend-sep"> · </span>
        <span className="nod-legend-word nod-legend-safe">Safe cash</span>
        <span className="nod-legend-sep"> · </span>
        <span className="nod-legend-word nod-legend-dist">Owner distribution</span>
      </p>

      <div className="nod-chart">
        <ReactApexChart
          options={options}
          series={series}
          type="bar"
          height={200}
        />
      </div>

      <p className="nod-footnote">
        Adjust revenue and expenses to see how to get paid sooner.
      </p>
    </article>
  );
}
