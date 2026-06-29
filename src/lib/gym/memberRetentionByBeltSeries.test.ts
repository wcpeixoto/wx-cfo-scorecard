import { describe, expect, it } from 'vitest';

import type { BeltRetentionRow } from './fetchMemberRetentionByBelt';
import {
  ADULTS_BANDS,
  KIDS_BANDS,
  bandsForSegment,
  buildBeltSegmentView,
  rollingChurnRate,
  visibleSeriesCount,
} from './memberRetentionByBeltSeries';
import { SAMPLE_BELT_ROWS } from './memberRetentionByBeltFixture';

// Compact row builder.
function row(
  periodMonth: string,
  segment: string,
  beltBand: string,
  activeCount: number,
  lostCount: number,
): BeltRetentionRow {
  return { periodMonth, segment, beltBand, activeCount, lostCount };
}

describe('rollingChurnRate — trailing-3mo window math', () => {
  it('window of 1 (first month) = the raw monthly rate', () => {
    expect(rollingChurnRate([{ activeCount: 50, lostCount: 5 }])).toEqual([10]);
  });

  it('edge months use the available shorter trailing window (1, then 2, then 3)', () => {
    // active 40/60/100, lost 4/6/10 — each window resolves to exactly 10% (Σlost/Σactive).
    const out = rollingChurnRate([
      { activeCount: 40, lostCount: 4 }, // i0: 4/40
      { activeCount: 60, lostCount: 6 }, // i1: 10/100
      { activeCount: 100, lostCount: 10 }, // i2: 20/200
    ]);
    expect(out).toEqual([10, 10, 10]);
  });

  it('slides the window to the trailing 3 — the oldest month drops out', () => {
    const out = rollingChurnRate([
      { activeCount: 10, lostCount: 1 }, // i0
      { activeCount: 10, lostCount: 1 }, // i1
      { activeCount: 10, lostCount: 1 }, // i2
      { activeCount: 100, lostCount: 50 }, // i3 → window {i1,i2,i3}: 52/120 = 43.33% (i0 excluded)
    ]);
    expect(out[3]).toBe(43.3);
  });

  it('is Σlost/Σactive over the window, NOT the average of monthly rates', () => {
    // Monthly rates are 0% and 100%; their average would be 50%. The correct pooled rate is
    // 2 / 102 ≈ 2.0% — a large clean month must dominate a tiny noisy one.
    const out = rollingChurnRate([
      { activeCount: 100, lostCount: 0 },
      { activeCount: 2, lostCount: 2 },
    ]);
    expect(out[1]).toBe(2);
  });

  it('Σactive === 0 over the window → null (never 0/0)', () => {
    expect(rollingChurnRate([{ activeCount: 0, lostCount: 0 }])).toEqual([null]);
  });

  it('absent current cell → null gap (band had no panel that month)', () => {
    const out = rollingChurnRate([{ activeCount: 50, lostCount: 5 }, null]);
    expect(out).toEqual([10, null]);
  });

  it('an absent neighbour is skipped — the window sums only present cells', () => {
    const out = rollingChurnRate([null, { activeCount: 50, lostCount: 5 }]);
    expect(out).toEqual([null, 10]);
  });
});

describe('buildBeltSegmentView — filtering + axis', () => {
  const rows: BeltRetentionRow[] = [
    row('2025-07', 'adults', 'White', 40, 4),
    row('2025-08', 'adults', 'White', 42, 3),
    row('2025-07', 'adults', 'Blue', 30, 2),
    row('2025-08', 'adults', 'Blue', 31, 3),
    // other segment + the unknown segment must be ignored for an 'adults' view.
    row('2025-07', 'kids', 'White', 30, 3),
    row('2025-07', 'unknown', 'unknown', 12, 1),
  ];

  it('keeps only the selected segment and builds a sorted distinct month axis', () => {
    const v = buildBeltSegmentView(rows, 'adults');
    expect(v.axisMonths).toEqual(['2025-07', '2025-08']);
  });

  it('emits one series per band in canonical order (4 adults / 3 kids), even if a band is absent', () => {
    const adults = buildBeltSegmentView(rows, 'adults');
    expect(adults.series.map((s) => s.band)).toEqual([...ADULTS_BANDS]);
    expect(adults.series).toHaveLength(4);

    const kids = buildBeltSegmentView(rows, 'kids');
    expect(kids.series.map((s) => s.band)).toEqual([...KIDS_BANDS]);
    expect(kids.series).toHaveLength(3);
  });

  it('aligns each band series 1:1 to the axis; an absent band-month is a null gap', () => {
    const v = buildBeltSegmentView(rows, 'adults');
    const white = v.series.find((s) => s.band === 'White')!;
    expect(white.data).toEqual([10, /* (4+3)/(40+42)=8.5… */ 8.5]);

    // Purple has no rows at all → its line is entirely gaps.
    const purple = v.series.find((s) => s.band === 'Purple')!;
    expect(purple.data).toEqual([null, null]);
  });

  it('does not leak rows across segments (kids White is independent of adults White)', () => {
    const kids = buildBeltSegmentView(rows, 'kids');
    expect(kids.axisMonths).toEqual(['2025-07']);
    const white = kids.series.find((s) => s.band === 'White')!;
    expect(white.data).toEqual([10]); // 3/30, not adults' 4/40
  });
});

describe('buildBeltSegmentView — zero-denominator guard', () => {
  it('a fully zero-active band renders as gaps, never 0%', () => {
    const rows = [
      row('2025-07', 'adults', 'White', 0, 0),
      row('2025-08', 'adults', 'White', 0, 0),
    ];
    const white = buildBeltSegmentView(rows, 'adults').series.find((s) => s.band === 'White')!;
    expect(white.data).toEqual([null, null]);
  });
});

describe('sample fixture — expected visible series count', () => {
  it('adults renders all 4 bands; kids renders all 3', () => {
    expect(visibleSeriesCount(buildBeltSegmentView(SAMPLE_BELT_ROWS, 'adults'))).toBe(4);
    expect(visibleSeriesCount(buildBeltSegmentView(SAMPLE_BELT_ROWS, 'kids'))).toBe(3);
  });

  it('spans 13 months and every band line is fully painted (no gaps in the sample)', () => {
    const v = buildBeltSegmentView(SAMPLE_BELT_ROWS, 'adults');
    expect(v.axisMonths).toHaveLength(13);
    for (const s of v.series) {
      expect(s.data).toHaveLength(13);
      expect(s.data.every((x) => x !== null)).toBe(true);
    }
  });
});

describe('bandsForSegment', () => {
  it('returns the locked per-segment band lists', () => {
    expect(bandsForSegment('adults')).toEqual([...ADULTS_BANDS]);
    expect(bandsForSegment('kids')).toEqual([...KIDS_BANDS]);
  });
});
