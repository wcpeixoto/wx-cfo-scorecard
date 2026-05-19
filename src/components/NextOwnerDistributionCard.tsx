// NextOwnerDistributionCard — when can the owner next take a distribution
// without breaching the operating reserve safety line?
//
// Data: a dedicated Reality/Base/9-month forecast (ownerPayProjection) plus
// the effective reserve floor (Settings-fixed-aware, identical to the
// Forecast safety-line rule). All decision logic lives in the pure helper.

import { useMemo } from 'react';
import type { ScenarioPoint } from '../lib/data/contract';
import { formatCompact } from '../lib/utils/formatCompact';
import {
  computeNextOwnerDistribution,
  type NextDistributionBlocker,
} from '../lib/data/nextOwnerDistribution';

// Owner-facing blocked-state pill copy. reserve_shortfall and
// negative_distributable_cash intentionally collapse to the same message.
const BLOCKED_PILL_LABELS: Record<NextDistributionBlocker, string> = {
  reserve_shortfall: 'No payout room',
  negative_distributable_cash: 'No payout room',
  below_minimum_payout: 'Almost there',
};

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

  const isForecast = result.state === 'forecast';
  const badgeClass = isForecast
    ? 'card-status-badge is-healthy'
    : 'card-status-badge is-neutral';
  const badgeLabel =
    result.state === 'forecast'
      ? 'Coming up'
      : BLOCKED_PILL_LABELS[result.blocker];

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
          <p className="nod-context">Next 6 months</p>
        </div>
      )}

      <p className="nod-footnote">
        Simulate revenue and expense changes to see how to get paid sooner
      </p>
    </article>
  );
}
