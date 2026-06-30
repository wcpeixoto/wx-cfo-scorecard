import { describe, expect, it } from 'vitest';
import { FIXTURE_TODAY, SAMPLE_GYM_MEMBERS } from './memberFixture';
import {
  computeChurnRiskByTenure,
  type ChurnRiskByTenureResult,
  type TenureBandRisk,
} from './churnRiskByTenure';
import { TENURE_BANDS, UNKNOWN_TENURE_ID } from './tenureBands';
import { RECENCY_STAGES, buildSegmentExplorerView } from './segmentExplorer';

// The Segment Explorer (1a) is a PURE view over the SAME aggregates
// computeChurnRiskByTenure(FromAggregate) returns. These tests lock the
// presentation arithmetic the adapter is allowed to do — the Healthy subtraction
// (MF-1), the per-row rate selection (SC-1), and the two distinct Unknown axes
// (SC-2) — so the grid can never silently drift from its source. Per the
// owner-dashboard aggregate-count policy (AGENTS.md), cells render their real
// count including small counts; there is no <5 suppression.

// Build a TenureBandRisk from the four leaf counts exactly the way the source
// modules do, so test fixtures obey the same field relationships as real results.
function mkBand(
  id: string,
  label: string,
  { healthy = 0, watch = 0, silent = 0, unknownRecency = 0 } = {},
): TenureBandRisk {
  const knownActiveTotal = healthy + watch + silent;
  const activeTotal = knownActiveTotal + unknownRecency;
  const atRisk = watch + silent;
  return {
    id,
    label,
    activeTotal,
    unknownRecency,
    knownActiveTotal,
    watch,
    silent,
    atRisk,
    riskRate: activeTotal === 0 ? null : atRisk / activeTotal,
    riskRateKnown: knownActiveTotal === 0 ? null : atRisk / knownActiveTotal,
  };
}

function mkResult(
  bands: TenureBandRisk[],
  unknownTenure: TenureBandRisk,
  thresholdDays = 21,
): ChurnRiskByTenureResult {
  const activeTotal =
    bands.reduce((sum, b) => sum + b.activeTotal, 0) + unknownTenure.activeTotal;
  return { thresholdDays, activeTotal, bands, unknownTenure, heroBandId: null, heroBandIdKnown: null };
}

const noUnknownTenure = () => mkBand(UNKNOWN_TENURE_ID, 'Unknown');

describe('buildSegmentExplorerView — partition + Healthy subtraction (MF-1)', () => {
  it('derives Healthy as knownActiveTotal − watch − silent over returned aggregates', () => {
    const b = mkBand('lt3m', '< 3 mo', { healthy: 12, watch: 4, silent: 5, unknownRecency: 3 });
    const view = buildSegmentExplorerView(mkResult([b], noUnknownTenure()));
    const healthyCell = view.rows[0].cells.find((c) => c.stage === 'healthy')!;
    // knownActiveTotal = 21; 21 − 4 − 5 = 12
    expect(healthyCell.count).toBe(view.rows[0].knownActiveTotal - 4 - 5);
    expect(healthyCell.count).toBe(12);
  });

  it('every row partitions: healthy + watch + silent + unknownRecency === activeTotal', () => {
    const bands = [
      mkBand('lt3m', '< 3 mo', { healthy: 10, watch: 3, silent: 2, unknownRecency: 4 }),
      mkBand('3to6m', '3–6 mo', { healthy: 0, watch: 0, silent: 0, unknownRecency: 0 }),
      mkBand('6to12m', '6–12 mo', { healthy: 30, watch: 6, silent: 7, unknownRecency: 0 }),
      mkBand('1to2y', '1–2 yr', { healthy: 8, watch: 1, silent: 9, unknownRecency: 2 }),
      mkBand('2yplus', '2 yr+', { healthy: 40, watch: 0, silent: 5, unknownRecency: 11 }),
    ];
    const unknown = mkBand(UNKNOWN_TENURE_ID, 'Unknown', { healthy: 1, watch: 1, silent: 0, unknownRecency: 1 });
    const view = buildSegmentExplorerView(mkResult(bands, unknown));
    for (const row of view.rows) {
      const sum = row.cells.reduce((s, c) => s + c.count, 0);
      expect(sum).toBe(row.activeTotal);
    }
  });

  it('Healthy is never negative (known base = healthy + watch + silent by construction)', () => {
    const b = mkBand('lt3m', '< 3 mo', { healthy: 0, watch: 3, silent: 2, unknownRecency: 5 });
    const view = buildSegmentExplorerView(mkResult([b], noUnknownTenure()));
    expect(view.rows[0].cells.find((c) => c.stage === 'healthy')!.count).toBe(0);
  });
});

describe('buildSegmentExplorerView — per-row rate selection (SC-1)', () => {
  it('always uses riskRateKnown (the attendance-known base) — there is no full-base view', () => {
    // knownActiveTotal 20, activeTotal 30, atRisk 10
    const b = mkBand('lt3m', '< 3 mo', { healthy: 10, watch: 5, silent: 5, unknownRecency: 10 });
    const view = buildSegmentExplorerView(mkResult([b], noUnknownTenure()));
    expect(view.rows[0].rate).toBe(b.riskRateKnown);
    expect(view.rows[0].rate).toBeCloseTo(10 / 20); // known base, NOT 10/30 full base
  });

  it('reports a null rate for an empty band rather than dividing by zero', () => {
    const empty = mkBand('3to6m', '3–6 mo');
    const view = buildSegmentExplorerView(mkResult([empty], noUnknownTenure()));
    expect(view.rows[0].rate).toBeNull();
  });
});

describe('buildSegmentExplorerView — small aggregate counts render as real numbers (no <5 suppression)', () => {
  it('keeps a small positive cell (including 1) as its real count, with no masked flag', () => {
    const bands = [
      mkBand('lt3m', '< 3 mo', { healthy: 20, watch: 10, silent: 3, unknownRecency: 8 }),
      mkBand('3to6m', '3–6 mo', { healthy: 9, watch: 7, silent: 1, unknownRecency: 5 }),
      mkBand('6to12m', '6–12 mo', { healthy: 10, watch: 11, silent: 12, unknownRecency: 13 }),
    ];
    const view = buildSegmentExplorerView(mkResult(bands, noUnknownTenure()));

    const silent1 = view.rows[0].cells.find((c) => c.stage === 'silent')!;
    expect(silent1.count).toBe(3); // a 3 shows as 3, not "<5"
    const silentOne = view.rows[1].cells.find((c) => c.stage === 'silent')!;
    expect(silentOne.count).toBe(1); // a count of 1 shows as 1

    // No cell carries a masked flag any more — the property is gone from the shape.
    for (const row of view.rows) {
      for (const cell of row.cells) {
        expect(cell).not.toHaveProperty('masked');
      }
    }
  });

  it('renders a true 0 as 0 and a large count as itself', () => {
    const b = mkBand('lt3m', '< 3 mo', { healthy: 0, watch: 0, silent: 12, unknownRecency: 0 });
    const view = buildSegmentExplorerView(mkResult([b], noUnknownTenure()));
    const cells = view.rows[0].cells;
    expect(cells.find((c) => c.stage === 'healthy')!.count).toBe(0);
    expect(cells.find((c) => c.stage === 'silent')!.count).toBe(12);
  });
});

describe('buildSegmentExplorerView — the two Unknown axes are distinct (SC-2)', () => {
  it('keeps the unknown-tenure ROW and the unknown-recency COLUMN as separate things', () => {
    const bands = [mkBand('lt3m', '< 3 mo', { healthy: 10, watch: 5, silent: 6, unknownRecency: 7 })];
    const unknown = mkBand(UNKNOWN_TENURE_ID, 'Unknown', {
      healthy: 2,
      watch: 1,
      silent: 1,
      unknownRecency: 1,
    });
    const view = buildSegmentExplorerView(mkResult(bands, unknown));

    // Unknown-tenure is its own (last) row, flagged, exactly once.
    const last = view.rows[view.rows.length - 1];
    expect(last.id).toBe(UNKNOWN_TENURE_ID);
    expect(last.isUnknownTenure).toBe(true);
    expect(view.rows.filter((r) => r.isUnknownTenure)).toHaveLength(1);

    // Unknown-recency is its own column on EVERY row.
    for (const row of view.rows) {
      expect(row.cells.map((c) => c.stage)).toEqual(RECENCY_STAGES.map((s) => s.id));
    }

    // The toggle-note total counts BAND recency-unknowns only (7), never the
    // unknown-tenure row's own recency-unknowns (1).
    expect(view.unknownRecencyTotal).toBe(7);
  });
});

describe('buildSegmentExplorerView — against the real sample compute', () => {
  it('produces 5 tenure-band rows + the unknown-tenure row and holds the partition', () => {
    const result = computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, 21, FIXTURE_TODAY);
    const view = buildSegmentExplorerView(result);

    expect(view.rows).toHaveLength(TENURE_BANDS.length + 1);
    expect(view.rows.slice(0, TENURE_BANDS.length).map((r) => r.id)).toEqual(
      TENURE_BANDS.map((b) => b.id),
    );

    for (const row of view.rows) {
      expect(row.cells.reduce((s, c) => s + c.count, 0)).toBe(row.activeTotal);
    }
    const total = view.rows.reduce((s, r) => s + r.activeTotal, 0);
    expect(total).toBe(result.activeTotal);
  });
});
