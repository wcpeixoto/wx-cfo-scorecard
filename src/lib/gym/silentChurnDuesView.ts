// Silent Churn dues view (RETENTION_FINISH_PLAN.md §6.4, SC $-at-risk slice PR-3).
//
// The honesty gate between the locally-written silent_dues_snapshot aggregate and
// the live Silent Churn card. The dues dollar is THRESHOLD-COUPLED and DATED —
// it was computed once, at a fixed threshold, against a specific CSV export —
// unlike the live silent COUNT, which re-cuts from the histogram at any owner
// threshold. So the dollar renders ONLY when it still corresponds to what the
// card is showing; every other state degrades to a count-only line with an
// explicit reason (never a fabricated $0, never a mislabeled dollar — the same
// fail-closed posture as the tenure bandEdges exact-match rule).
//
// Pure-function on purpose (the silentChurnLiveView convention): the repo has no
// component-render harness, so the gating logic lives here under tests and the
// card only rephrases the returned view.
//
// Consumes (never modifies) silentChurn.ts: parseYmdLocal + wholeDaysBetween are
// the one date-parse / day-diff definition, reused — not forked.

import { parseYmdLocal, wholeDaysBetween } from './silentChurn';

// The validated inner contract of the silent_dues_snapshot jsonb column
// (supabase/wodify_retention_schema.sql — camelCase, verbatim-object convention).
// Coverage % is DERIVED from duesKnownCount / silentMembers, never stored.
export type SilentDuesSnapshot = {
  duesAsOf: string; // YYYY-MM-DD — the Wodify All-Memberships CSV export day (staleness anchor)
  computedAsOf: string; // YYYY-MM-DD — gym-local day the preview run classified members
  thresholdDays: number; // the RESOLVED threshold the $ was cut at (threshold-coupled)
  silentMembers: number; // M — silent actives at thresholdDays on computedAsOf
  duesKnownCount: number; // N — silent members with a derivable monthly-equivalent
  totalMonthly: number; // Σ monthly-equivalent over the N dues-known — an honest FLOOR
};

// Roughly one billing cycle (~30 days): a dues figure and a snapshot more than
// this many days apart no longer describe the same cohort closely enough to show
// side by side. Wide enough that the #474 weekly census-only cron — which advances
// the snapshot as_of ~7 days/run without a paired dues write — no longer hides a
// still-recent dues floor; only a genuinely month-stale aggregate does. (The gate
// is snapshot-anchored, not today-anchored: a frozen census would not age the
// dollar by wall-clock — the as-of badge discloses snapshot age. Out of scope here.)
export const DUES_STALE_AFTER_DAYS = 30;

export type SilentChurnDuesHiddenReason =
  | 'noDues' // column null/absent/malformed → the standing "not available" line
  | 'thresholdMismatch' // $ computed at a different resolved threshold than the card's current cut
  | 'stale' // |duesAsOf − snapshot asOf| > DUES_STALE_AFTER_DAYS (either direction), or unprovable
  | 'noCoverage'; // duesKnownCount === 0 — a "$0 over 0 known" line would read as a real zero

export type SilentChurnDuesView =
  | {
      kind: 'shown';
      totalMonthly: number;
      duesKnownCount: number;
      silentMembers: number;
      duesAsOf: string;
      thresholdDays: number;
    }
  | {
      kind: 'hidden';
      reason: SilentChurnDuesHiddenReason;
      // The raw snapshot when one exists (null only for 'noDues'), so hidden-state
      // copy can cite ITS dates/threshold honestly instead of inventing them.
      dues: SilentDuesSnapshot | null;
    };

// Derive the dues display state. `resolvedThresholdDays` MUST be the resolved
// threshold (deriveBuckets' output / resolveSilentChurnThresholdDays), never the
// raw stored setting — the comparison is exact-match on the resolved value.
// N and M in the shown state come ONLY from the dues snapshot; they are never
// reconciled with the hero's re-cut count (different day, same honesty rule as
// the dues-as-of label that discloses the gap).
export function deriveSilentChurnDuesView(
  dues: SilentDuesSnapshot | null,
  snapshotAsOf: string,
  resolvedThresholdDays: number,
): SilentChurnDuesView {
  if (!dues) return { kind: 'hidden', reason: 'noDues', dues: null };
  if (dues.thresholdDays !== resolvedThresholdDays) {
    return { kind: 'hidden', reason: 'thresholdMismatch', dues };
  }
  // Staleness is DIRECTION-AGNOSTIC (absolute gap): a dues export can be older
  // than the snapshot (no fresh export before a pull) or newer (export refreshed,
  // snapshot pull pending) — both mean the two describe different weeks. Dates
  // that fail to parse make freshness unprovable → fail closed to 'stale'.
  const duesDay = parseYmdLocal(dues.duesAsOf);
  const snapshotDay = parseYmdLocal(snapshotAsOf);
  if (!duesDay || !snapshotDay) return { kind: 'hidden', reason: 'stale', dues };
  if (Math.abs(wholeDaysBetween(duesDay, snapshotDay)) > DUES_STALE_AFTER_DAYS) {
    return { kind: 'hidden', reason: 'stale', dues };
  }
  if (dues.duesKnownCount === 0) return { kind: 'hidden', reason: 'noCoverage', dues };
  return {
    kind: 'shown',
    totalMonthly: dues.totalMonthly, // a real $0 with N>0 is dues-KNOWN at $0 — shown honestly
    duesKnownCount: dues.duesKnownCount,
    silentMembers: dues.silentMembers,
    duesAsOf: dues.duesAsOf,
    thresholdDays: dues.thresholdDays,
  };
}
