// Class Plan Member Retention — AGE-SEGMENT overlay transform.
//
// PURE transform layer (no React, no I/O): projects the per-cohort counts from
// `member_retention_by_cohort` onto the gym-wide All line's axis. The cohort rows are an OVERLAY,
// never the spine of the chart.
//
// WHY PROJECT ONTO THE All AXIS (don't build an independent cohort axis):
//   The cohort table has NO is_seed_boundary column, so it cannot decide seed-exclusion or
//   windowing on its own. The authoritative, seed-excluded, timeframe-windowed list of period months
//   comes from the All view (`buildRetentionEvolutionView` over the live #495 rows). We look up each
//   band's row for those exact months and align 1:1. A month with no published cohort row — because
//   it is the seed month, a privacy-suppressed cell, or simply absent — becomes a `null` GAP. Gaps
//   are never 0 and never interpolated; the chart breaks the line at them.
//
// METRIC SEAM (documented, not a bug): the All line renders #495's STORED retention_rate; the
// segment lines derive returning / (returning + lost) from counts. For CHURN both derive
// lost / (returning + lost), so all three lines AGREE (default metric is churn). For RETENTION the
// stored-vs-derived values differ by <= 0.5pp on the gym-wide line. This is expected; do not "fix"
// it by changing the All line's stored-rate rendering (that is shipped Phase-1 behavior).

import type { CohortRetentionRow } from './fetchMemberRetentionByCohort';
import type { RetentionEvolutionPoint } from './memberRetentionSeries';

// The two plotted age bands. `unknownCohort` is excluded from the overlay (unknown-age members are
// counted in the gym-wide All line but not attributable to a segment).
export const PLOTTED_COHORT_BANDS = ['youth3to15', 'adults16plus'] as const;
export type PlottedCohortBand = (typeof PLOTTED_COHORT_BANDS)[number];

// Per-band arrays of points, aligned 1:1 to the All axis months. A `null` slot is a GAP.
export type CohortOverlay = {
  youth: (RetentionEvolutionPoint | null)[];
  adults: (RetentionEvolutionPoint | null)[];
};

// Local mapper — emits the same RetentionEvolutionPoint shape as the (intentionally internal)
// memberRetentionSeries.toPoint, but from cohort counts. priorMembers := returning + lost so the
// exported churnPctOf and the .retentionPct field both read directly off the point.
//   - suppressed row (counts null) → null gap
//   - returning + lost === 0 (a zero-event band) → null (never 0/0)
function cohortRowToPoint(row: CohortRetentionRow): RetentionEvolutionPoint | null {
  if (row.suppressed) return null;
  const returning = row.returningMembers;
  const lost = row.lostMembers;
  if (returning === null || lost === null) return null; // defensive: half-null can't happen per CHECK
  const prior = returning + lost;
  if (prior === 0) return null; // denominator guard — no 0/0
  const gained = row.newMembers ?? 0;
  return {
    periodMonth: row.periodMonth,
    retentionPct: Math.round((returning / prior) * 1000) / 10,
    returningMembers: returning,
    priorMembers: prior,
    lostMembers: lost,
    newMembers: gained,
    currentMembers: returning + gained,
  };
}

// Index cohort rows by `${period}|${band}` for O(1) axis lookup.
function indexRows(rows: CohortRetentionRow[]): Map<string, CohortRetentionRow> {
  const map = new Map<string, CohortRetentionRow>();
  for (const r of rows) map.set(`${r.periodMonth}|${r.cohortBand}`, r);
  return map;
}

/**
 * Build the Youth/Adults overlay aligned to the All axis.
 *
 * @param axisMonths the period months from the live All view's points, in render order. These carry
 *                   the seed-exclusion + timeframe windowing; the overlay inherits both.
 * @param rows       the cohort fetch (all bands, all periods). Bands other than youth3to15 /
 *                   adults16plus are ignored.
 */
export function buildCohortOverlay(
  axisMonths: string[],
  rows: CohortRetentionRow[],
): CohortOverlay {
  const byKey = indexRows(rows);
  const lookup = (month: string, band: PlottedCohortBand): RetentionEvolutionPoint | null => {
    const row = byKey.get(`${month}|${band}`);
    if (!row) return null; // absent row → gap
    return cohortRowToPoint(row);
  };
  return {
    youth: axisMonths.map((month) => lookup(month, 'youth3to15')),
    adults: axisMonths.map((month) => lookup(month, 'adults16plus')),
  };
}
