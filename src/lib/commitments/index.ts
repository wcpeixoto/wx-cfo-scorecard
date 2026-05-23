import type { DashboardModel } from '../data/contract';
import type { Signal } from '../priorities/types';
import type { CommitmentDraft } from './types';
import { reserveWarningCommitment } from './reserveWarningCommitment';

export type {
  CommitmentDraft,
  Commitment,
  WatchMetricId,
  WatchMetricSpec,
} from './types';
export { WATCH_METRICS, watchMetricForSignal } from './watchMetrics';
export { commitmentDeadline } from './anchor';
export { commitmentTemplate, executeLabelFor } from './templater';
export type { CommitmentCopy } from './templater';
export { generateGroundedDayOneSummary } from './groundedSummary';
export { commitmentBeat } from './cadence';
export type { CommitmentBeat, CommitmentPhase } from './cadence';
export { reserveGroundingHint, groundingConsentMode, RESERVE_STOP_MESSAGE } from './targetGrounding';
export type { ReserveGroundingHint, GroundingConsentMode } from './targetGrounding';
export { buildExecuteHelp } from './execute';
export type { ExecuteHelp, ExecuteLever } from './execute';

// The single factory choke point (Fork A/B). reserve_warning is the only
// commitment-ready signal this slice; every other type returns null, which IS
// the STOP rule (#3) expressed as the absence of the object.
export function commitmentFromSignal(
  signal: Signal,
  model: DashboardModel
): CommitmentDraft | null {
  switch (signal.type) {
    case 'reserve_warning':
      return reserveWarningCommitment(signal, model);
    default:
      return null;
  }
}
