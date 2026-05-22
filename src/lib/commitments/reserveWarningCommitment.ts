import type { DashboardModel } from '../data/contract';
import type { Signal } from '../priorities/types';
import type { CommitmentDraft } from './types';
import { commitmentDeadline } from './anchor';
import { watchMetricForSignal } from './watchMetrics';
import { groundReserveWarningTarget } from './targetGrounding';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

// The reserve_warning generator. The canonical action lives co-located with its
// target math (carry-over #1): one action (#2), denominated in the owner's
// weekly target, framed as a one-week move (#9). The full gap is context only
// (the ceiling shown under "Why this step"), never the committed target.
export function reserveWarningCommitment(
  signal: Signal,
  model: DashboardModel
): CommitmentDraft | null {
  if (signal.type !== 'reserve_warning') return null;

  const watch = watchMetricForSignal('reserve_warning');
  if (!watch) return null;

  const gapContext =
    signal.gapAmount ??
    Math.max(0, model.runway.reserveTarget - model.runway.currentCashBalance);

  return {
    signalType: 'reserve_warning',
    gapContext,
    deadlineISO: commitmentDeadline(),
    watchMetricId: watch.id,
    baseline: watch.captureBaseline(model),
    grounding: groundReserveWarningTarget(gapContext, model),
    buildAction: (target) =>
      `Move ${usd.format(target)} into your operating reserve this week.`,
  };
}
