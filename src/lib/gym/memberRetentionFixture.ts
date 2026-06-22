// SAMPLE (synthetic) Class Plan Member Retention series — renders the evolution chart with a
// "Sample data" badge until the live Supabase table is seeded. These numbers are FABRICATED and
// internally consistent (returning = prior − lost; current = prior − lost + new); they are NOT the
// real gym figures. The real monthly aggregate is business-sensitive and lives only in Supabase
// (anon-readable, never committed) — see scripts/wodify/seedMemberRetentionRates.ts.

import type { RetentionMonth } from './memberRetentionSeries';

function row(periodMonth: string, prior: number, lost: number, gained: number, isSeedBoundary = false): RetentionMonth {
  const returning = prior - lost;
  return {
    periodMonth,
    priorMembers: prior,
    lostMembers: lost,
    newMembers: gained,
    returningMembers: returning,
    currentMembers: prior - lost + gained,
    retentionRate: prior > 0 ? Math.round((returning / prior) * 100) / 100 : 0,
    isSeedBoundary,
  };
}

export const SAMPLE_MEMBER_RETENTION_MONTHS: RetentionMonth[] = [
  row('2025-06', 100, 2, 90, true), // synthetic onboarding boundary — excluded from the trend
  row('2025-07', 188, 17, 22),
  row('2025-08', 193, 21, 18),
  row('2025-09', 190, 16, 20),
  row('2025-10', 194, 22, 17),
  row('2025-11', 189, 14, 23),
  row('2025-12', 198, 12, 16),
  row('2026-01', 202, 19, 21),
  row('2026-02', 204, 15, 25),
  row('2026-03', 214, 20, 18),
  row('2026-04', 212, 23, 26),
  row('2026-05', 215, 13, 19),
  row('2026-06', 221, 18, 20),
];
