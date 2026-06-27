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

// Owner-dashboard aggregate-count policy (AGENTS.md — "Retention page data policy"):
// these tenure × recency cells are aggregate counts of active members, with no
// identity-level data behind them, so every cell renders its real number —
// including small counts and counts of 1. There is no <5 cell suppression here.

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
  count: number; // the aggregate count for this tenure × recency cell
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

  const rows: SegmentRow[] = orderedBands.map((b, r) => ({
    id: b.id,
    label: b.label,
    isUnknownTenure: b.id === result.unknownTenure.id,
    cells: RECENCY_STAGES.map((s, c) => ({
      stage: s.id,
      count: counts[r][c],
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
