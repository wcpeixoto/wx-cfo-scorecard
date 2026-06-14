// Segment Explorer — Slice 1a (tenure × recency cross-section).
//
// A PRESENTATION-ONLY view-model over the output of computeChurnRiskByTenure /
// computeChurnRiskByTenureFromAggregate (churnRiskByTenure.ts). This module does
// NOT classify members and reads NO member-level data — it only re-shapes the
// per-band aggregates the existing function already returned into a
// tenure × recency grid. The single arithmetic it performs is:
//   1. the sanctioned Healthy subtraction (MF-1): healthy = knownActiveTotal −
//      watch − silent, over values the function already returned; and
//   2. picking the per-row at-risk rate the existing Churn-by-Tenure card already
//      exposes (SC-1): riskRateKnown (default) or riskRate (includeUnknown ON).
// It never re-derives counts, never calls the classifier, never touches
// deriveBuckets. Pure + unit-tested so the grid can never drift from its source.

import type { ChurnRiskByTenureResult, TenureBandRisk } from './churnRiskByTenure';

// Locked suppression policy: any PUBLISHED cell with a count in
// [1, SUPPRESSION_FLOOR − 1] is masked — small positive groups are never shown as
// a number. A true 0 is shown (it identifies no member, and masking it as "<5"
// would falsely imply 1–4 real members), and a count >= the floor is shown.
export const SUPPRESSION_FLOOR = 5;

export type RecencyStageId = 'healthy' | 'watch' | 'silent' | 'unknownRecency';

// The recency columns, in display order. Only the locked classifier vocabulary
// lives here; the day ranges depend on the resolved threshold T (Watch =
// WATCH_FLOOR..T−1, Silent = >= T) and are composed at render time.
export const RECENCY_STAGES: readonly { id: RecencyStageId; label: string }[] = [
  { id: 'healthy', label: 'Healthy' },
  { id: 'watch', label: 'Watch' },
  { id: 'silent', label: 'Silent' },
  { id: 'unknownRecency', label: 'Unknown recency' },
];

export type SegmentCell = {
  stage: RecencyStageId;
  count: number; // the true count (kept for tests + the complementary guard)
  masked: boolean; // true => render the "<5" marker, never the number
};

export type SegmentRow = {
  id: string;
  label: string;
  isUnknownTenure: boolean;
  cells: SegmentCell[]; // in RECENCY_STAGES order
  activeTotal: number; // full-base active in this tenure band
  knownActiveTotal: number;
  atRisk: number; // watch + silent — straight from the result
  rate: number | null; // includeUnknown ? riskRate : riskRateKnown — straight from the result
};

export type SegmentExplorerView = {
  thresholdDays: number;
  activeTotal: number;
  includeUnknown: boolean;
  rows: SegmentRow[]; // the 5 tenure bands, then the unknown-tenure row (always last)
  unknownRecencyTotal: number; // Σ band unknownRecency (NOT the unknown-tenure row) — for the toggle note
};

// MF-1: the source function does not return `healthy`. Derive it by the single
// approved subtraction over values it already returned. NEVER re-classify or read
// member-level data to get this — that is the failure this slice avoids.
function healthyOf(b: TenureBandRisk): number {
  return b.knownActiveTotal - b.watch - b.silent;
}

function cellCountsOf(b: TenureBandRisk): Record<RecencyStageId, number> {
  return {
    healthy: healthyOf(b),
    watch: b.watch,
    silent: b.silent,
    unknownRecency: b.unknownRecency,
  };
}

// Locked <5 suppression with the complementary-suppression guard. Operates on the
// count matrix (rows = bands, columns = RECENCY_STAGES).
//
// Primary: mask any cell in [1, floor−1]. Complementary: a single masked cell in
// a row OR column can be recovered by subtracting the others from a total — and
// the per-band active total IS published un-suppressed by the shipped
// Churn-by-Tenure card — so whenever a row or column has exactly one masked cell,
// mask the next-smallest cell in that line too. Repeated to a fixed point.
//
// Post-condition (asserted in tests): no row and no column has exactly one masked
// cell, so no suppressed value is recoverable by single-cell subtraction. The
// loop only ever ADDS masks (bounded by rows × columns), so it terminates.
export function suppressMatrix(counts: number[][]): boolean[][] {
  const rowCount = counts.length;
  const colCount = rowCount > 0 ? counts[0].length : 0;
  const masked = counts.map((row) => row.map((v) => v >= 1 && v < SUPPRESSION_FLOOR));

  // Index of the smallest unmasked value among the given cells (−1 if none left).
  const smallestUnmasked = (cells: { v: number; m: boolean }[]): number => {
    let idx = -1;
    let best = Infinity;
    cells.forEach((cell, i) => {
      if (!cell.m && cell.v < best) {
        best = cell.v;
        idx = i;
      }
    });
    return idx;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rowCount; r++) {
      if (masked[r].filter(Boolean).length === 1) {
        const idx = smallestUnmasked(counts[r].map((v, c) => ({ v, m: masked[r][c] })));
        if (idx >= 0) {
          masked[r][idx] = true;
          changed = true;
        }
      }
    }
    for (let c = 0; c < colCount; c++) {
      let maskedInCol = 0;
      for (let r = 0; r < rowCount; r++) if (masked[r][c]) maskedInCol++;
      if (maskedInCol === 1) {
        const col = counts.map((row, r) => ({ v: row[c], m: masked[r][c] }));
        const idx = smallestUnmasked(col);
        if (idx >= 0) {
          masked[idx][c] = true;
          changed = true;
        }
      }
    }
  }
  return masked;
}

// Build the grid view-model. `result` comes from EITHER computeChurnRiskByTenure
// (sample) or computeChurnRiskByTenureFromAggregate (live) — both return the same
// shape, so the adapter is source-agnostic.
export function buildSegmentExplorerView(
  result: ChurnRiskByTenureResult,
  includeUnknown: boolean,
): SegmentExplorerView {
  // The 5 tenure bands, then the unknown-tenure bucket as its own row (SC-2:
  // unknown TENURE is a distinct population from unknown RECENCY — never merged).
  const orderedBands: TenureBandRisk[] = [...result.bands, result.unknownTenure];

  const counts: number[][] = orderedBands.map((b) => {
    const cc = cellCountsOf(b);
    return RECENCY_STAGES.map((s) => cc[s.id]);
  });

  const masked = suppressMatrix(counts);

  const rows: SegmentRow[] = orderedBands.map((b, r) => ({
    id: b.id,
    label: b.label,
    isUnknownTenure: b.id === result.unknownTenure.id,
    cells: RECENCY_STAGES.map((s, c) => ({
      stage: s.id,
      count: counts[r][c],
      masked: masked[r][c],
    })),
    activeTotal: b.activeTotal,
    knownActiveTotal: b.knownActiveTotal,
    atRisk: b.atRisk,
    rate: includeUnknown ? b.riskRate : b.riskRateKnown,
  }));

  // Recency-unknowns held out of the known base, summed across the REAL bands
  // only (the unknown-TENURE row is a separate population — bad start date, not
  // bad attendance — and is never part of any rate denominator).
  const unknownRecencyTotal = result.bands.reduce((sum, b) => sum + b.unknownRecency, 0);

  return {
    thresholdDays: result.thresholdDays,
    activeTotal: result.activeTotal,
    includeUnknown,
    rows,
    unknownRecencyTotal,
  };
}
