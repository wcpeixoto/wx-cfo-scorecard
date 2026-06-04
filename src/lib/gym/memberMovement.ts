// Member Movement — deterministic rule layer for the Retention page (Patterns).
//
// Code decides what is true (AGENTS.md "deterministic + AI layers"): this module
// owns two HONEST, snapshot-only facts about the member base —
//   1. Census   — the current active / paused / ended head-count (a RAW status tally).
//   2. Intake   — how many members joined in each half-year, by membershipStart.
//
// What this module deliberately does NOT do: any movement-over-time, net flow,
// cancellation trend, or churn-flow series. The fixture carries only a CURRENT
// `status` and a `membershipStart` — no endedAt / pausedAt / statusChangedAt — so
// a movement time-series would require inventing dated status changes. An honest
// empty beats an invented trend (RETENTION_FINISH_PLAN items 5–6).
//
// This card classifies NO risk. It does not import classifyMember /
// computeSilentChurn / the threshold resolver, and there is no at-risk figure to
// cross-check, so there is nothing to drift against — by design.
//   - Census is a RAW status tally: classifyMember returns null for non-active
//     members and so cannot produce the paused / ended counts this card needs.
//   - Intake counts ALL members (not active-only): an active-only intake would
//     silently drop members who joined and later paused/ended, understating past
//     intake. All-members is the honest, deterministic answer.
//
// Both facts are independent of the current clock — a census is "right now by
// status" and intake is anchored to membershipStart — so this module takes no
// `asOf`/threshold, unlike its risk-classifying siblings.

import type { GymMember } from './memberFixture';
import { parseYmdLocal } from './silentChurn';

export type MemberStatusCensus = {
  active: number;
  paused: number;
  ended: number;
  total: number; // active + paused + ended — the integrity sum over all members
};

export type JoinCohort = {
  id: string; // stable key, e.g. '2021-H1'
  label: string; // display, e.g. 'H1 2021'
  year: number;
  half: 1 | 2; // 1 = Jan–Jun, 2 = Jul–Dec
  count: number; // members of ANY status whose membershipStart falls in this half-year
};

export type MemberMovementResult = {
  census: MemberStatusCensus;
  cohorts: JoinCohort[]; // contiguous half-years, earliest join first (a join timeline)
  totalJoined: number; // Σ cohort.count — members with a parseable membershipStart
  unknownJoin: number; // members with missing/unparseable membershipStart (not in fixture)
};

// A half-year ordinal: year*2 + (half-1). Lets us walk a contiguous timeline and
// recover (year, half) without date math. 2021-H1 → 4042, 2021-H2 → 4043, …
function cohortId(year: number, half: 1 | 2): string {
  return `${year}-H${half}`;
}

function cohortLabel(year: number, half: 1 | 2): string {
  return `H${half} ${year}`;
}

// Member Movement (deterministic, snapshot-only). See file header for the scope
// boundary: census is a raw status tally; intake buckets ALL members by the
// half-year of membershipStart. No risk classification, no time-series.
//
// Invariants asserted in the tests:
//   - census.active + census.paused + census.ended === census.total === members.length
//     (raw status tally — no member dropped or double-counted).
//   - totalJoined + unknownJoin === members.length, and Σ cohort.count === totalJoined
//     (intake counts every member exactly once; bad join dates surface as
//     unknownJoin rather than vanishing).
export function computeMemberMovement(members: GymMember[]): MemberMovementResult {
  // ── Census: a raw tally of the CURRENT status field, nothing derived. ──────
  let active = 0;
  let paused = 0;
  let ended = 0;
  for (const member of members) {
    switch (member.status) {
      case 'active':
        active += 1;
        break;
      case 'paused':
        paused += 1;
        break;
      case 'ended':
        ended += 1;
        break;
    }
  }
  const census: MemberStatusCensus = {
    active,
    paused,
    ended,
    total: active + paused + ended,
  };

  // ── Intake: bucket ALL members by the half-year of membershipStart. ────────
  // Unparseable/missing starts are counted as unknownJoin — never silently
  // dropped and never forced into a cohort (defensive for real Wodify data; the
  // sample has clean dates so unknownJoin is 0 there).
  const counts = new Map<string, number>();
  let unknownJoin = 0;
  let minOrd = Number.POSITIVE_INFINITY;
  let maxOrd = Number.NEGATIVE_INFINITY;

  for (const member of members) {
    const start = parseYmdLocal(member.membershipStart);
    if (!start) {
      unknownJoin += 1;
      continue;
    }
    const year = start.getFullYear();
    const half: 1 | 2 = start.getMonth() < 6 ? 1 : 2; // getMonth() is 0–11
    const id = cohortId(year, half);
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const ord = year * 2 + (half - 1);
    if (ord < minOrd) minOrd = ord;
    if (ord > maxOrd) maxOrd = ord;
  }

  // Build a CONTIGUOUS timeline from the earliest to the latest join half-year,
  // so an interior half-year with no joins renders as an honest 0 rather than a
  // hidden gap. (The fixture has no interior gaps; this is correct in general.)
  const cohorts: JoinCohort[] = [];
  if (Number.isFinite(minOrd)) {
    for (let ord = minOrd; ord <= maxOrd; ord++) {
      const year = Math.floor(ord / 2);
      const half: 1 | 2 = ord % 2 === 0 ? 1 : 2;
      const id = cohortId(year, half);
      cohorts.push({ id, label: cohortLabel(year, half), year, half, count: counts.get(id) ?? 0 });
    }
  }

  const totalJoined = cohorts.reduce((sum, cohort) => sum + cohort.count, 0);

  return { census, cohorts, totalJoined, unknownJoin };
}
