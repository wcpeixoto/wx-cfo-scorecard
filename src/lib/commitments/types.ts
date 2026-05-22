import type { DashboardModel } from '../data/contract';
import type { SignalType, Severity } from '../priorities/types';

export type WatchMetricId = 'reserve_cash_delta';

// A watch metric pairs a baseline captured at commit time with a current value
// recomputed later (Fork C). Both read the same model field, so baseline and
// progress can never measure different things. The registry is the principle-#4
// choke point: a portfolio metric is simply unrepresentable here.
export interface WatchMetricSpec {
  id: WatchMetricId;
  label: string;
  captureBaseline: (model: DashboardModel) => number;
  computeCurrent: (model: DashboardModel) => number;
}

// A commitment-ready proposal derived from a Signal (Fork A: a sibling object,
// not optional fields on Signal). The factory returning null IS the STOP rule
// (#3): a signal that can't honestly produce result + deadline + action-tied
// watch yields no draft and stays awareness-only.
//
// Field names carry the COMMITMENT-domain meaning; the storage adapter
// (commitToPriority) is the only place that translates them to priority_history
// columns. Nothing else touches the raw column names.
export interface CommitmentDraft {
  signalType: SignalType;
  gapContext: number; // full reserve gap $ at commit (ceiling + "Why this step")
  deadlineISO: string; // +7d anchor
  watchMetricId: WatchMetricId;
  baseline: number; // watch baseline (cash at commit)
  buildAction: (target: number) => string; // ONE action, target-denominated
}

// The finalized commitment: a draft plus the owner-entered weekly target and
// the resolved action string. This is what the card hands to commitToPriority,
// which translates these domain fields to columns (see the mapping there).
export interface Commitment {
  signalType: SignalType;
  severity: Severity;
  action: string; // committed_action
  recommendedAction?: string;
  target: number; // owner-entered weekly target $
  baseline: number; // cash at commit
  gapContext: number; // full reserve gap $
  deadlineISO: string; // +7d
  watchMetricId: WatchMetricId; // derived from signalType; not persisted
}
