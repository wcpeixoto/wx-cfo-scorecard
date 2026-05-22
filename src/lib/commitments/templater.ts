import type { DashboardModel } from '../data/contract';
import type { PriorityHistoryRow } from '../priorities/types';
import { watchMetricForSignal } from './watchMetrics';

// The single source of owner-facing commitment-STATE copy (Phase 2c). Commitment
// Mode (#5) renders strictly from this bundle; the card and chips never assemble
// copy from raw priority_history columns. Pure — (row, model) -> bundle, no I/O,
// no async. A domain helper, so it reads the row's columns directly (the "no raw
// fields" rule binds the UI surfaces, not this file).
//
// The bundle grows across 2c: PR-A migrates the committed summary + watch
// progress; PR-B adds per-beat during-window copy; PR-C adds the after-deadline
// check-in states + attribution prompt.

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
  model: DashboardModel,
): CommitmentCopy {
  return {
    summary: `Committed: ${row.committed_action ?? ''}. Checking back ~${formatDeadline(row.deadline_date)}.`,
    watch: watchCopy(row, model),
  };
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
