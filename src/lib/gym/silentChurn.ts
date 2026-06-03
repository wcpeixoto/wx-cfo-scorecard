// Silent Churn — deterministic rule layer for the Retention page.
//
// Code decides what is true (AGENTS.md "deterministic + AI layers"): this module
// owns the threshold contract and the at-risk computation. Any owner-facing copy
// only rephrases the numbers this returns; it never authors the at-risk call.

import type { GymMember } from './memberFixture';

export const DEFAULT_SILENT_CHURN_THRESHOLD_DAYS = 21;
const MIN_THRESHOLD_DAYS = 1;
const MAX_THRESHOLD_DAYS = 365;

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
function parseYmdLocal(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

// Whole calendar days between two dates, normalized to local midnight so DST
// transitions can't produce a fractional/off-by-one day.
function wholeDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// The Silent Churn rule (deterministic): a member counts when
//   status === 'active'  AND  daysSinceLastCheckIn >= thresholdDays.
// Returns the count, total monthly dues at risk, and a call-list sorted by days
// absent (most absent first). The threshold is resolved here too, so callers
// can pass a raw stored value safely.
export function computeSilentChurn(
  members: GymMember[],
  thresholdDays: number,
  asOf: Date,
): SilentChurnResult {
  const resolvedThreshold = resolveSilentChurnThresholdDays(thresholdDays);

  const rows: SilentChurnRow[] = [];
  for (const member of members) {
    if (member.status !== 'active') continue;
    const lastCheckIn = parseYmdLocal(member.lastCheckIn);
    if (!lastCheckIn) continue;
    const daysAbsent = wholeDaysBetween(lastCheckIn, asOf);
    if (daysAbsent >= resolvedThreshold) {
      rows.push({
        id: member.id,
        displayName: member.displayName,
        daysAbsent,
        monthlyDues: member.monthlyDues,
      });
    }
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
