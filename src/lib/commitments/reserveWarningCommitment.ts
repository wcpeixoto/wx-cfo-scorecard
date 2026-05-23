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

// The reserve-funding commitment generator, shared by reserve_warning and
// reserve_critical. They are the same content type (funding the operating
// reserve), differing only in severity, so one widened generator serves both —
// not a premature generic abstraction (a second, different content type would
// force that). The canonical action lives co-located with its target math
// (carry-over #1): one action (#2), denominated in the owner's weekly target,
// framed as a one-week move (#9). The full gap is context only (the ceiling shown
// under "Why this step"), never the committed target.
export function reserveWarningCommitment(
  signal: Signal,
  model: DashboardModel
): CommitmentDraft | null {
  if (signal.type !== 'reserve_warning' && signal.type !== 'reserve_critical') return null;

  const watch = watchMetricForSignal(signal.type);
  if (!watch) return null;

  const gapContext =
    signal.gapAmount ??
    Math.max(0, model.runway.reserveTarget - model.runway.currentCashBalance);

  return {
    signalType: signal.type,
    gapContext,
    deadlineISO: commitmentDeadline(),
    watchMetricId: watch.id,
    baseline: watch.captureBaseline(model),
    grounding: groundReserveWarningTarget(gapContext, model),
    buildAction: (target) =>
      `Move ${usd.format(target)} into your operating reserve this week.`,
  };
}
