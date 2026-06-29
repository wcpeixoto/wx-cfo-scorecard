// Churn by Belt — PURE transform layer (no React, no I/O). Projects the per-(segment, belt-band)
// monthly counts from `member_retention_by_belt` onto the segment's own period axis and derives a
// TRAILING-3-MONTH churn rate per band.
//
// WHY ROLLING-3MO (not raw monthly): unlike the gym-wide churn-evolution card (which reads a large
// monthly denominator), a single belt band in a single month is a small panel. A raw lost/active on
// those counts whips around on one or two members. So each plotted point is a trailing-3-month rate,
// computed as Σlost / Σactive over the window — NOT the average of the three noisy monthly rates
// (which would over-weight a tiny-denominator month). Edge months (the first one or two) use whatever
// trailing window is available; an absent (segment, band, month) cell is a GAP, never 0 and never
// interpolated.
//
// DENOMINATOR GUARD: Σactive === 0 over the window → null (a line gap), never 0/0.
//
// BANDING is build-local and locked (mirrors the member_retention_by_belt CHECK constraint):
//   adults → White / Blue / Purple / Brown+Black   ·   kids → White / Grey-family / Yellow+Orange
// The 'unknown' segment is NOT plotted here (it has no belt to attribute) — it stays an aggregate row
// in the table only.

import type { BeltRetentionRow } from './fetchMemberRetentionByBelt';

// The two plotted age segments. 'unknown' is excluded from the card (no belt to attribute).
export type BeltSegmentId = 'adults' | 'kids';

// Locked per-segment band order — also the legend / color order. Keep in sync with the table CHECK.
export const ADULTS_BANDS = ['White', 'Blue', 'Purple', 'Brown+Black'] as const;
export const KIDS_BANDS = ['White', 'Grey-family', 'Yellow+Orange'] as const;

export function bandsForSegment(segment: BeltSegmentId): readonly string[] {
  return segment === 'adults' ? ADULTS_BANDS : KIDS_BANDS;
}

// Number of trailing months in the smoothing window (inclusive of the current month).
export const BELT_ROLLING_WINDOW = 3;

export type BeltBandSeries = {
  band: string; // band label (= legend name)
  // Trailing-3mo churn percent per axis month, one decimal place. null = gap (absent current cell or
  // zero-active window).
  data: (number | null)[];
};

export type BeltSegmentView = {
  axisMonths: string[]; // distinct period months for the segment, ascending
  series: BeltBandSeries[]; // one entry per band in canonical order (4 adults / 3 kids)
};

// A per-axis-position count cell, or null when that (band, month) is absent.
type Cell = { activeCount: number; lostCount: number } | null;

/**
 * Trailing-N-month churn rate over a per-axis cell array.
 *
 * For axis index i: if the CURRENT cell is absent → null (the band had no panel that month). Otherwise
 * sum lost and active over the up-to-N present cells in the trailing window [i-N+1 .. i] and return
 * Σlost / Σactive as a one-decimal percent. Σactive === 0 → null (no 0/0). Absent neighbour cells are
 * simply skipped (they contribute nothing to either sum) — the window is positional, the sums are over
 * what is present.
 *
 * Exported for direct unit testing of the window math.
 */
export function rollingChurnRate(cells: Cell[], window = BELT_ROLLING_WINDOW): (number | null)[] {
  return cells.map((current, i) => {
    if (current === null) return null; // no current panel → gap, never 0
    let sumActive = 0;
    let sumLost = 0;
    const start = Math.max(0, i - window + 1);
    for (let j = start; j <= i; j += 1) {
      const cell = cells[j];
      if (cell === null) continue; // absent neighbour → skip (positional window, present-only sums)
      sumActive += cell.activeCount;
      sumLost += cell.lostCount;
    }
    if (sumActive === 0) return null; // denominator guard — no 0/0
    return Math.round((sumLost / sumActive) * 1000) / 10; // one-decimal percent
  });
}

function indexRows(rows: BeltRetentionRow[]): Map<string, BeltRetentionRow> {
  const map = new Map<string, BeltRetentionRow>();
  for (const r of rows) map.set(`${r.periodMonth}|${r.segment}|${r.beltBand}`, r);
  return map;
}

/**
 * Build the per-band trailing-3mo churn series for one segment.
 *
 * The axis is the segment's OWN distinct period months (ascending) — this card is standalone (it does
 * not borrow another table's axis). Each band is looked up per month; an absent cell becomes a gap in
 * both the line and the smoothing sums.
 */
export function buildBeltSegmentView(
  rows: BeltRetentionRow[],
  segment: BeltSegmentId,
): BeltSegmentView {
  const segRows = rows.filter((r) => r.segment === segment);
  const axisMonths = [...new Set(segRows.map((r) => r.periodMonth))].sort();
  const byKey = indexRows(segRows);

  const series = bandsForSegment(segment).map((band): BeltBandSeries => {
    const cells: Cell[] = axisMonths.map((month) => {
      const row = byKey.get(`${month}|${segment}|${band}`);
      return row ? { activeCount: row.activeCount, lostCount: row.lostCount } : null;
    });
    return { band, data: rollingChurnRate(cells) };
  });

  return { axisMonths, series };
}

// Count of bands with at least one rendered (non-null) point — the "visible series" the card promises
// (4 adults / 3 kids when fully populated). A band that is entirely absent contributes no line.
export function visibleSeriesCount(view: BeltSegmentView): number {
  return view.series.filter((s) => s.data.some((v) => v !== null)).length;
}
