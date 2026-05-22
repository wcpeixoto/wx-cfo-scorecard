import type { PriorityHistoryRow } from '../priorities/types';

// The during-window follow-up beat (#8), computed on card open from the
// commitment's timestamps and now. Pure ms math — TZ-independent (only the
// templater's deadline formatting is locale-aware) — and kept out of the locked
// sharedPersistence.ts and out of the (clock-free) templater so the templater
// stays deterministic given a beat. No stored "beat shown" state: the beat is a
// render-time function of (committed_at, deadline_date, now), per the locked 2c
// input. Takes the row so the card never reads raw commitment columns itself.

const DAY_MS = 86_400_000;

export type CommitmentPhase = 'day_one' | 'midpoint' | 'day_before' | 'after_deadline';

export interface CommitmentBeat {
  phase: CommitmentPhase;
  daysRemaining: number; // whole days until the deadline (ceil); <= 0 once due
}

export function commitmentBeat(
  row: PriorityHistoryRow,
  now: Date = new Date(),
): CommitmentBeat {
  const nowMs = now.getTime();
  const deadlineMs = row.deadline_date ? Date.parse(row.deadline_date) : NaN;
  const committedMs = row.committed_at ? Date.parse(row.committed_at) : NaN;

  // No usable deadline → don't claim the window is up; treat as freshly opened.
  if (Number.isNaN(deadlineMs)) return { phase: 'day_one', daysRemaining: 0 };

  const daysRemaining = Math.ceil((deadlineMs - nowMs) / DAY_MS);

  if (nowMs >= deadlineMs) return { phase: 'after_deadline', daysRemaining };
  if (deadlineMs - nowMs <= DAY_MS) return { phase: 'day_before', daysRemaining };
  if (!Number.isNaN(committedMs) && nowMs - committedMs < DAY_MS) {
    return { phase: 'day_one', daysRemaining };
  }
  return { phase: 'midpoint', daysRemaining };
}
