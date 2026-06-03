// Silent Churn — deterministic rule layer for the Retention page.
//
// Code decides what is true (AGENTS.md "deterministic + AI layers"): this module
// owns the threshold contract and the at-risk computation. Any owner-facing copy
// only rephrases the numbers this returns; it never authors the at-risk call.

import type { GymMember } from './memberFixture';

export const DEFAULT_SILENT_CHURN_THRESHOLD_DAYS = 21;
const MIN_THRESHOLD_DAYS = 1;
const MAX_THRESHOLD_DAYS = 365;

// Lower edge of the "Watch" recency band (Attendance Health). A member is on
// Watch when they are below the Silent Churn threshold but have been absent at
// least this many whole days. Named so the band math and the helper copy share
// one definition and the floor never silently drifts from the copy. When the
// resolved threshold is <= this floor the Watch band is empty by construction
// (every active member is either Healthy < T or Silent >= T).
export const WATCH_FLOOR_DAYS = 8;

// Single resolver for the threshold — used by both the local settings store and
// any consumer, so the rule has exactly one definition. Clamps to a positive
// integer in [1, 365]; missing / invalid / unset / <= 0 all fall back to the
// default (21). Values above 365 clamp down to 365.
export function resolveSilentChurnThresholdDays(raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_SILENT_CHURN_THRESHOLD_DAYS;
  const int = Math.floor(n);
  if (int < MIN_THRESHOLD_DAYS) return DEFAULT_SILENT_CHURN_THRESHOLD_DAYS;
  if (int > MAX_THRESHOLD_DAYS) return MAX_THRESHOLD_DAYS;
  return int;
}

export type SilentChurnRow = {
  id: string;
  displayName: string;
  daysAbsent: number;
  monthlyDues: number;
};

export type SilentChurnResult = {
  thresholdDays: number;
  count: number;
  monthlyDuesAtRisk: number;
  rows: SilentChurnRow[]; // sorted by daysAbsent desc
};

// Parse a YYYY-MM-DD string into a LOCAL-midnight Date. Returns null on a
// malformed string. new Date(y, m, d) is used deliberately — never
// new Date('YYYY-MM-DD') (parses as UTC, shifts a day in US zones). AGENTS.md.
// Exported so sibling Retention rule modules (e.g. churnRiskByTenure) reuse this
// single definition rather than re-implementing local-date parsing.
export function parseYmdLocal(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

// Whole calendar days between two dates, normalized to local midnight so DST
// transitions can't produce a fractional/off-by-one day. Exported alongside
// parseYmdLocal so tenure math reuses the same day-diff rule as recency math.
export function wholeDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// Recency bucket for a single ACTIVE member. `unknown` means active but with an
// unparseable/missing lastCheckIn — it is NEVER folded into Healthy.
export type AttendanceBucket = 'healthy' | 'watch' | 'silent' | 'unknown';

// Classification of one member against a resolved threshold. The discriminated
// shape ties daysAbsent to the bucket: a Healthy/Watch/Silent member always has
// a real day count, an `unknown` member has none (its date didn't parse).
export type MemberClassification =
  | { bucket: Exclude<AttendanceBucket, 'unknown'>; daysAbsent: number }
  | { bucket: 'unknown'; daysAbsent: null };

// The ONE place the active-member recency rule lives. Both computeSilentChurn
// (silent rows) and computeAttendanceHealth (the H/W/S/unknown tally) build on
// this, so the active-filter + bad-date skip + >= threshold predicate have
// exactly one definition and the two cards can never disagree.
//
// `thresholdDays` MUST already be resolved (see resolveSilentChurnThresholdDays);
// the caller resolves once and passes the resolved value in. Returns null for a
// non-active member (excluded from every bucket — not counted at all).
export function classifyMember(
  member: GymMember,
  thresholdDays: number,
  asOf: Date,
): MemberClassification | null {
  if (member.status !== 'active') return null;
  const lastCheckIn = parseYmdLocal(member.lastCheckIn);
  if (!lastCheckIn) return { bucket: 'unknown', daysAbsent: null };
  const daysAbsent = wholeDaysBetween(lastCheckIn, asOf);
  if (daysAbsent >= thresholdDays) return { bucket: 'silent', daysAbsent };
  if (daysAbsent >= WATCH_FLOOR_DAYS) return { bucket: 'watch', daysAbsent };
  return { bucket: 'healthy', daysAbsent };
}

// The Silent Churn rule (deterministic): a member counts when
//   status === 'active'  AND  daysSinceLastCheckIn >= thresholdDays.
// Returns the count, total monthly dues at risk, and a call-list sorted by days
// absent (most absent first). The threshold is resolved here too, so callers
// can pass a raw stored value safely. The at-risk set is exactly the members
// classifyMember puts in the `silent` bucket.
export function computeSilentChurn(
  members: GymMember[],
  thresholdDays: number,
  asOf: Date,
): SilentChurnResult {
  const resolvedThreshold = resolveSilentChurnThresholdDays(thresholdDays);

  const rows: SilentChurnRow[] = [];
  for (const member of members) {
    const classification = classifyMember(member, resolvedThreshold, asOf);
    if (classification?.bucket !== 'silent') continue;
    rows.push({
      id: member.id,
      displayName: member.displayName,
      daysAbsent: classification.daysAbsent,
      monthlyDues: member.monthlyDues,
    });
  }

  rows.sort((a, b) => b.daysAbsent - a.daysAbsent);

  const monthlyDuesAtRisk = rows.reduce((sum, row) => sum + row.monthlyDues, 0);

  return {
    thresholdDays: resolvedThreshold,
    count: rows.length,
    monthlyDuesAtRisk,
    rows,
  };
}

export type AttendanceHealthResult = {
  thresholdDays: number; // resolved threshold the buckets were cut at
  activeTotal: number; // healthy + watch + silent + unknown (integrity sum)
  healthy: number; // active, 0..WATCH_FLOOR_DAYS-1 days absent
  watch: number; // active, WATCH_FLOOR_DAYS..thresholdDays-1 days absent
  silent: number; // active, >= thresholdDays days absent (== computeSilentChurn count)
  unknown: number; // active but unparseable/missing lastCheckIn (NOT Healthy)
};

// Attendance Health (deterministic): tally ACTIVE members into recency buckets
// at the resolved threshold. Built on the same classifyMember as Silent Churn,
// so `silent` here equals computeSilentChurn's count by construction. The
// returned activeTotal is the sum of the four buckets, so the integrity
// invariant healthy + watch + silent + unknown === activeTotal holds by
// construction — there is no path that drops or double-counts an active member.
export function computeAttendanceHealth(
  members: GymMember[],
  thresholdDays: number,
  asOf: Date,
): AttendanceHealthResult {
  const resolvedThreshold = resolveSilentChurnThresholdDays(thresholdDays);

  let healthy = 0;
  let watch = 0;
  let silent = 0;
  let unknown = 0;

  for (const member of members) {
    const classification = classifyMember(member, resolvedThreshold, asOf);
    if (!classification) continue; // not active — excluded from every bucket
    switch (classification.bucket) {
      case 'healthy':
        healthy += 1;
        break;
      case 'watch':
        watch += 1;
        break;
      case 'silent':
        silent += 1;
        break;
      case 'unknown':
        unknown += 1;
        break;
    }
  }

  return {
    thresholdDays: resolvedThreshold,
    activeTotal: healthy + watch + silent + unknown,
    healthy,
    watch,
    silent,
    unknown,
  };
}
