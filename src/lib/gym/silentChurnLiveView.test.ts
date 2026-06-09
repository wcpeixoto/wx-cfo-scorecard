// Silent Churn live-count contract (PR3, RETENTION_FINISH_PLAN.md §6).
//
// In live mode the Silent Churn card renders deriveBuckets(snapshot, T).silent as
// its at-risk COUNT — no dollars (monthly dues aren't on /clients yet, §6.4) and no
// call-list (member PII the non-PII aggregate can't carry). This file pins the one
// load-bearing claim that makes the live count honest: that silent COUNT equals the
// canonical computeSilentChurn count at EVERY threshold, so the live Silent Churn
// hero and the live Attendance Health "Silent" bucket — both derived from the same
// page-level snapshot — can never disagree.
//
// Pure-function on purpose: the repo has no component-render harness, and #447's
// view/reader tests are pure-function too. The "no names" and "never $0" guarantees
// are STRUCTURAL — the live branch has neither a member-rows array nor a dollar
// value in scope (asserted below against the aggregate the card reads).

import { describe, it, expect } from 'vitest';
import { deriveBuckets } from './retentionAggregateView';
import { computeRetentionAggregate, type RawWodifyClient } from './wodifyRetentionAggregate';
import { computeSilentChurn } from './silentChurn';
import type { GymMember } from './memberFixture';

// asOf fixed so each member's daysAbsent is exactly `d` whole local days.
const AS_OF = '2026-06-30';
const asOfDate = () => new Date(2026, 5, 30);

function ymdMinus(days: number): string {
  const base = new Date(2026, 5, 30);
  base.setDate(base.getDate() - days);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function mk(id: string, status: GymMember['status'], lastCheckIn: string): GymMember {
  return { id, displayName: id, status, monthlyDues: 100, membershipStart: '2024-01-01', lastCheckIn };
}

function memberToRawRow(m: GymMember): RawWodifyClient {
  const statusWord = { active: 'Active', paused: 'Paused', ended: 'Ended' }[m.status];
  return { client_status: statusWord, last_attendance: m.lastCheckIn };
}

describe('Silent Churn live count == deriveBuckets(snapshot, T).silent == computeSilentChurn count', () => {
  // Spans the watch floor (8), an overflow member (500d), an unknown-date active
  // member, and non-active members (must not be counted).
  const members: GymMember[] = [
    mk('m0', 'active', ymdMinus(0)),
    mk('m6', 'active', ymdMinus(6)),
    mk('m7', 'active', ymdMinus(7)),
    mk('m8', 'active', ymdMinus(8)),
    mk('m14', 'active', ymdMinus(14)),
    mk('m21', 'active', ymdMinus(21)),
    mk('m40', 'active', ymdMinus(40)),
    mk('mOverflow', 'active', ymdMinus(500)),
    mk('mUnknown', 'active', ''),
    mk('mPaused', 'paused', ymdMinus(40)),
    mk('mEnded', 'ended', ymdMinus(40)),
  ];
  const agg = computeRetentionAggregate(members.map(memberToRawRow), {
    asOf: AS_OF,
    fetchedAt: `${AS_OF}T12:00:00Z`,
    pagesFetched: 1,
    reachedPageCap: false,
  });

  it('agrees across thresholds, including the T <= WATCH_FLOOR edge (1..10) and the clamp ceiling', () => {
    for (const T of [1, 5, 6, 7, 8, 9, 10, 21, 365]) {
      const liveCount = deriveBuckets(agg, T).silent; // exactly what the live card renders
      const canonical = computeSilentChurn(members, T, asOfDate()).count;
      expect(liveCount).toBe(canonical);
    }
  });

  it('the live source is counts-only: dues null (card shows "not available", never $0) and no member rows', () => {
    // Why live Silent Churn is honestly count-only: the aggregate carries no dollar
    // and no member-level rows. monthlyDuesAtRisk is null by construction (→ the
    // "not available" note, never a fabricated $0), and there is no names/call-list
    // field for the live branch to surface.
    expect(agg.silentChurn.monthlyDuesAtRisk).toBeNull();
    expect(agg.silentChurn.missingMonthlyDues).toBe(true);
    expect(agg).not.toHaveProperty('rows');
  });
});
