import type { DashboardModel } from '../data/contract';
import type { PriorityHistoryRow } from '../priorities/types';
import type { CommitmentBeat } from './cadence';
import { watchMetricForSignal } from './watchMetrics';

// The single source of owner-facing commitment-STATE copy (Phase 2c). Commitment
// Mode (#5) renders strictly from this bundle; the card and chips never assemble
// copy from raw priority_history columns. Pure — (row, model) -> bundle, no I/O,
// no async. A domain helper, so it reads the row's columns directly (the "no raw
// fields" rule binds the UI surfaces, not this file).
//
// The bundle grows across 2c: PR-A migrated the committed summary + watch
// progress; PR-B makes the summary beat-aware (during-window cadence); PR-C adds
// the after-deadline check-in states + attribution prompt.

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export interface CommitmentCopy {
  summary: string;
  watch: { label: string; value: string };
}

export function commitmentTemplate(
  row: PriorityHistoryRow,
  beat: CommitmentBeat,
  model: DashboardModel,
): CommitmentCopy {
  const watch = watchCopy(row, model);
  return { summary: summaryFor(row, beat, watch), watch };
}

// The card-row line, time-aware per the during-window cadence (#8). Day-one
// states the commitment; midpoint and day-before show progress + time remaining
// only (Gate 1: no pace judgment, no execute CTA — Execute is hidden until
// Phase 3); after-deadline states the outcome and hands off to the check-in
// (PR-C adds the resolution affordances). watch.value is the honest signed
// "$Y of $X" — never a causation claim.
function summaryFor(
  row: PriorityHistoryRow,
  beat: CommitmentBeat,
  watch: { label: string; value: string },
): string {
  switch (beat.phase) {
    case 'day_one':
      return `Committed: ${row.committed_action ?? ''} Checking back ~${formatDeadline(row.deadline_date)}.`;
    case 'midpoint':
      return `${watch.label}: ${watch.value} · ${beat.daysRemaining} days left.`;
    case 'day_before':
      return `${watch.label}: ${watch.value} · last day.`;
    case 'after_deadline':
      return `${watch.label}: ${watch.value} · your week's up.`;
  }
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
