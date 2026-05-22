import type { PriorityHistoryRow } from '../priorities/types';

// DEV-only preview seam (Phase 2c PR-D). Every entry is guarded by
// import.meta.env.DEV, so the whole module dead-code-eliminates from prod and the
// prod render path (getOpenCommitment) is untouched. It exists to drive the
// commitment loop in preview WITHOUT Supabase or prod cash: `?devCommitment=<phase>`
// renders a fake open commitment positioned at that cadence beat / check-in
// outcome, so every committed state can be visually verified on demand
// (closes Notion 368ad957 — the consent UI + 2c states no longer wait for prod
// cash to enter the 50–100% band).
//
// phases: day_one | midpoint | day_before | achieved | partial | missed

const DAY = 86_400_000;
const TARGET = 500;

export type DevPhase =
  | 'day_one'
  | 'midpoint'
  | 'day_before'
  | 'achieved'
  | 'partial'
  | 'missed';

// committed_at / deadline_date positioned so commitmentBeat lands on the phase
// (the after-deadline outcomes share one past-deadline window).
function windowFor(phase: DevPhase, now: number): { committedAt: number; deadline: number } {
  switch (phase) {
    case 'day_one':
      return { committedAt: now - 0.5 * DAY, deadline: now + 6.5 * DAY };
    case 'midpoint':
      return { committedAt: now - 3 * DAY, deadline: now + 4 * DAY };
    case 'day_before':
      return { committedAt: now - 6.5 * DAY, deadline: now + 0.5 * DAY };
    default:
      return { committedAt: now - 8 * DAY, deadline: now - DAY };
  }
}

// baseline so that progress (currentCash − baseline) yields the phase's outcome.
function baselineFor(phase: DevPhase, currentCash: number): number {
  switch (phase) {
    case 'achieved':
      return currentCash - TARGET; // progress == target
    case 'missed':
      return currentCash + 100; // progress < 0
    default:
      return currentCash - 200; // some progress ($200) — partial / during-window
  }
}

export function devCommitment(currentCash: number, phase?: DevPhase): PriorityHistoryRow | null {
  if (!import.meta.env.DEV) return null;
  const p =
    phase ?? (new URLSearchParams(location.search).get('devCommitment') as DevPhase | null);
  if (!p) return null;
  const now = Date.now();
  const { committedAt, deadline } = windowFor(p, now);
  return {
    id: 'dev-seam',
    workspace_id: 'default',
    fired_at: new Date(committedAt).toISOString(),
    signal_type: 'reserve_warning',
    severity: 'warning',
    committed_action: 'Move $500 into your operating reserve this week.',
    metric_value: baselineFor(p, currentCash),
    target_value: TARGET,
    gap_amount: 3400,
    deadline_date: new Date(deadline).toISOString(),
    committed_at: new Date(committedAt).toISOString(),
    status: 'open',
  };
}
