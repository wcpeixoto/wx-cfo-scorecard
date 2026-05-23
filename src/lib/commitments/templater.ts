import type { DashboardModel } from '../data/contract';
import type { PriorityHistoryRow } from '../priorities/types';
import type { CommitmentBeat, CommitmentPhase } from './cadence';
import { watchMetricForSignal } from './watchMetrics';

// The single source of owner-facing commitment-STATE copy (Phase 2c). Commitment
// Mode (#5) renders strictly from this bundle; the card and chips never assemble
// copy from raw priority_history columns. Pure — (row, beat, model) -> bundle, no
// I/O, no async. A domain helper, so it reads the row's columns directly (the
// "no raw fields" rule binds the UI surfaces, not this file).
//
// As of the constrained-generator Slice 1, the day_one summary line may be
// re-toned by an AI generator (commitments/groundedSummary.ts); the exported
// dayOneSummary below is that generator's deterministic fallback. The other beats
// remain deterministic-only.
//
// Built up across 2c: PR-A migrated the committed summary + watch progress; PR-B
// made the summary beat-aware (during-window cadence); PR-C adds the
// after-deadline check-in state, the attribution prompt, and the close
// consequence.

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

// Honest attribution (Gate 2 / principle #7): the owner attributes the cash
// movement; the system never claims to know intent. Shown only when the outcome
// is unclear (partial/missed). Presentation-only in 2c — not persisted (Phase 3
// decides whether to persist it).
const ATTRIBUTION_PROMPT = 'Did your actions drive this?';
const ATTRIBUTION_OPTIONS = ['Yes, mostly', 'Partly', 'No', 'Not sure'] as const;

export type CheckInState = 'achieved' | 'partial' | 'missed';

export interface CommitmentCopy {
  summary: string;
  watch: { label: string; value: string };
  // Present only after the deadline (the check-in). null during the window.
  checkIn: {
    state: CheckInState;
    // null when achieved (outcome is clear — celebrate, don't ask).
    attribution: { prompt: string; options: readonly string[] } | null;
  } | null;
  // The business consequence shown when the owner taps "Not doing this" before
  // the deadline (#6 — real accountability, not shame).
  closeConsequence: string;
}

export function commitmentTemplate(
  row: PriorityHistoryRow,
  beat: CommitmentBeat,
  model: DashboardModel,
): CommitmentCopy {
  const watch = watchCopy(row, model);
  const state = checkInStateFor(row, model);
  const afterDeadline = beat.phase === 'after_deadline';
  return {
    summary: summaryFor(row, beat, watch, state),
    watch,
    checkIn: afterDeadline
      ? {
          state,
          attribution:
            state === 'achieved'
              ? null
              : { prompt: ATTRIBUTION_PROMPT, options: ATTRIBUTION_OPTIONS },
        }
      : null,
    closeConsequence: closeConsequenceFor(row),
  };
}

// The card-row line, time-aware per the during-window cadence (#8). Day-one
// states the commitment; midpoint and day-before show progress + time remaining
// only (Gate 1: no pace judgment, no execute CTA in this line — the Execute
// affordance is a separate, dev-gated card scaffold as of B-1; content lands in
// B-2); after-deadline shifts to the check-in (#7) — a hit target is
// celebrated, an unclear outcome asks honestly. watch.value is the honest signed
// "$Y of $X" — never a causation claim.
function summaryFor(
  row: PriorityHistoryRow,
  beat: CommitmentBeat,
  watch: { label: string; value: string },
  state: CheckInState,
): string {
  switch (beat.phase) {
    case 'day_one':
      return dayOneSummary(row);
    case 'midpoint':
      return `${watch.label}: ${watch.value} · ${beat.daysRemaining} days left.`;
    case 'day_before':
      return `${watch.label}: ${watch.value} · last day.`;
    case 'after_deadline':
      return state === 'achieved'
        ? `${watch.label}: ${watch.value} · you hit your target.`
        : `${watch.label}: ${watch.value} · time's up — how did it go?`;
  }
}

// The deterministic day_one summary line, extracted so the grounded generator
// (commitments/groundedSummary.ts) can use it verbatim as its fallback. Pure,
// row-only.
export function dayOneSummary(row: PriorityHistoryRow): string {
  return `Committed: ${row.committed_action ?? ''} Checking back ~${formatDeadline(row.deadline_date)}.`;
}

// The "Help me execute" chip label, beat-aware (#8 / B-3). A surface distinct
// from summaryFor: the Execute slot is hidden after the deadline (the check-in
// replaces it), so this offers no after-deadline label. day_one and midpoint
// share the opening offer — midpoint differentiation (a pace nudge) is
// deliberately deferred (Gate 1 forbids during-window pace judgment); day_before
// escalates to the final push. Total over CommitmentPhase (so it is unit-testable
// at every phase); null encodes "no offer here".
export function executeLabelFor(phase: CommitmentPhase): string | null {
  switch (phase) {
    case 'day_one':
    case 'midpoint':
      return 'Help me execute';
    case 'day_before':
      return 'Final push';
    case 'after_deadline':
      return null; // slot hidden post-deadline — no offer
  }
}

// The check-in outcome (#7), computed from the watch progress vs the owner's
// target — never system-claimed as intent (that's what attribution is for).
// achieved: progress reached target; partial: some progress; missed: none.
function checkInStateFor(row: PriorityHistoryRow, model: DashboardModel): CheckInState {
  const spec = watchMetricForSignal(row.signal_type);
  const current = spec ? spec.computeCurrent(model) : model.runway.currentCashBalance;
  const baseline = row.metric_value ?? 0;
  const target = row.target_value ?? 0;
  const progress = current - baseline;
  if (target > 0 && progress >= target) return 'achieved';
  if (progress > 0) return 'partial';
  return 'missed';
}

function closeConsequenceFor(row: PriorityHistoryRow): string {
  const gap = row.gap_amount;
  return gap != null
    ? `Stopping leaves your reserve about ${usd.format(gap)} short of target. Stop anyway?`
    : `Stopping ends this week's reserve push. Stop anyway?`;
}

// "2026-05-29T…" -> "May 29". Short month + day, en-US — the friendly form of
// the stored deadline_date. (Relocated from CfoAssistantCard so deadline copy
// lives with the rest of the commitment-state language.)
function formatDeadline(iso: string | undefined): string {
  if (!iso) return 'soon';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Committed-state watch: progress from the commit baseline toward the owner's
// weekly target, "$Y of $X" (signed — honest at any sign, never "you
// contributed"). baseline (metric_value) and target (target_value) are the
// commitToPriority column mapping; current is recomputed from the live model via
// the same registry entry the baseline came from, so the two can't measure
// different things. The null branches are TS guards for shapes a committed row
// never has (commitToPriority always writes both, and only commitment-ready
// types reach commit).
function watchCopy(
  row: PriorityHistoryRow,
  model: DashboardModel,
): { label: string; value: string } {
  const spec = watchMetricForSignal(row.signal_type);
  if (!spec) {
    return { label: 'Cash on Hand', value: usd.format(model.runway.currentCashBalance) };
  }
  const current = spec.computeCurrent(model);
  const baseline = row.metric_value;
  const target = row.target_value;
  if (baseline != null && target != null) {
    return { label: spec.label, value: `${usd.format(current - baseline)} of ${usd.format(target)}` };
  }
  return { label: spec.label, value: `starting at ${usd.format(current)}` };
}
