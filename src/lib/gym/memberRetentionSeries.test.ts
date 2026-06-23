import { describe, expect, it } from 'vitest';

import {
  averageMetricPct,
  buildRetentionEvolutionView,
  churnPctOf,
  formatMonthLong,
  formatMonthShort,
  realRetentionMonths,
  selectionFor,
  type RetentionEvolutionPoint,
  type RetentionMonth,
} from './memberRetentionSeries';

// Synthetic, internally-consistent fixture (returning = prior − lost; current = prior − lost + new).
// 1 boundary row (2025-06) + 12 real months (2025-07 … 2026-06).
function m(periodMonth: string, prior: number, lost: number, gained: number, isSeedBoundary = false): RetentionMonth {
  const returning = prior - lost;
  return {
    periodMonth,
    priorMembers: prior,
    lostMembers: lost,
    newMembers: gained,
    returningMembers: returning,
    currentMembers: prior - lost + gained,
    retentionRate: prior > 0 ? returning / prior : 0,
    isSeedBoundary,
  };
}

// Synthetic counts — NOT the real gym figures (those are business-sensitive and live only in
// Supabase). The assertions below depend on the month labels, the boundary flag, and one row's
// rounding — never on a real member count.
const MONTHS: RetentionMonth[] = [
  m('2025-06', 90, 3, 80, true), // seed/onboarding boundary — must never appear in the trend
  m('2025-07', 180, 17, 20),
  m('2025-08', 183, 19, 18),
  m('2025-09', 182, 15, 22),
  m('2025-10', 189, 21, 16),
  m('2025-11', 184, 13, 24),
  m('2025-12', 195, 12, 17),
  m('2026-01', 200, 18, 23),
  m('2026-02', 205, 16, 26),
  m('2026-03', 215, 22, 19),
  m('2026-04', 212, 20, 25),
  m('2026-05', 217, 14, 18),
  m('2026-06', 221, 19, 21),
];

describe('realRetentionMonths', () => {
  it('drops the seed-boundary month and sorts ascending', () => {
    const real = realRetentionMonths([...MONTHS].reverse());
    expect(real).toHaveLength(12);
    expect(real[0].periodMonth).toBe('2025-07');
    expect(real.some((r) => r.periodMonth === '2025-06')).toBe(false);
  });
});

describe('buildRetentionEvolutionView', () => {
  it('6 months → last 6 real months, no exceed flag', () => {
    const v = buildRetentionEvolutionView(MONTHS, selectionFor('6m'));
    expect(v.points.map((p) => p.periodMonth)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    ]);
    expect(v.windowExceedsData).toBe(false);
    expect(v.dataBeginsMonth).toBe('2025-07');
  });

  it('1 year → all 12 real months, exactly fits (no exceed flag)', () => {
    const v = buildRetentionEvolutionView(MONTHS, selectionFor('1y'));
    expect(v.points).toHaveLength(12);
    expect(v.points[0].periodMonth).toBe('2025-07');
    expect(v.windowExceedsData).toBe(false);
  });

  it('2 years → available window only, exceed flag set (never fabricates pre-history)', () => {
    const v = buildRetentionEvolutionView(MONTHS, selectionFor('2y'));
    expect(v.points).toHaveLength(12); // only the 12 real months exist
    expect(v.points[0].periodMonth).toBe('2025-07');
    expect(v.windowExceedsData).toBe(true);
  });

  it('all → every real month, boundary excluded', () => {
    const v = buildRetentionEvolutionView(MONTHS, selectionFor('all'));
    expect(v.points).toHaveLength(12);
    expect(v.points.some((p) => p.periodMonth === '2025-06')).toBe(false);
  });

  it('custom range filters to [start,end]; start before data sets the exceed flag', () => {
    const v = buildRetentionEvolutionView(
      MONTHS,
      selectionFor('custom', { startMonth: '2024-01', endMonth: '2025-09' }),
    );
    expect(v.points.map((p) => p.periodMonth)).toEqual(['2025-07', '2025-08', '2025-09']);
    expect(v.windowExceedsData).toBe(true);
  });

  it('custom with no range falls back to the full window (never a 1-month default)', () => {
    const v = buildRetentionEvolutionView(MONTHS, selectionFor('custom'));
    expect(v.points).toHaveLength(12);
  });

  it("retentionPct = rate*100 to 1 decimal, from the report's own returning/prior", () => {
    const v = buildRetentionEvolutionView(MONTHS, selectionFor('1y'));
    const jul = v.points.find((p) => p.periodMonth === '2025-07');
    expect(jul?.returningMembers).toBe(163); // 180 − 17
    expect(jul?.priorMembers).toBe(180);
    expect(jul?.retentionPct).toBe(90.6); // 163/180 = 0.9055… → 90.6
  });

  it('empty input → isEmpty, no fabricated points', () => {
    const v = buildRetentionEvolutionView([], selectionFor('all'));
    expect(v.isEmpty).toBe(true);
    expect(v.points).toHaveLength(0);
    expect(v.dataBeginsMonth).toBeNull();
  });

  it('a series of ONLY the boundary month renders empty (never trends a single onboarding row)', () => {
    const v = buildRetentionEvolutionView([m('2025-06', 90, 3, 80, true)], selectionFor('all'));
    expect(v.isEmpty).toBe(true);
  });
});

describe('month formatters', () => {
  it('formats short + long', () => {
    expect(formatMonthShort('2025-07')).toBe('Jul 25');
    expect(formatMonthLong('2026-06')).toBe('Jun 2026');
  });
});

const point = (priorMembers: number, lostMembers: number): RetentionEvolutionPoint => ({
  periodMonth: '2026-01',
  retentionPct: Math.round(((priorMembers - lostMembers) / priorMembers) * 1000) / 10,
  returningMembers: priorMembers - lostMembers,
  priorMembers,
  lostMembers,
  newMembers: 0,
  currentMembers: priorMembers - lostMembers,
});

describe('churnPctOf', () => {
  it('is lost ÷ prior to one decimal', () => {
    expect(churnPctOf(point(200, 18))).toBe(9);
    expect(churnPctOf(point(243, 24))).toBe(9.9);
  });

  it('guards a zero prior (no NaN)', () => {
    expect(churnPctOf(point(0, 5))).toBe(0);
  });

  it('is the complement of retentionPct across the real series', () => {
    const v = buildRetentionEvolutionView(MONTHS, selectionFor('1y'));
    for (const p of v.points) {
      expect(churnPctOf(p)).toBeCloseTo(100 - p.retentionPct, 1);
    }
  });
});

describe('averageMetricPct', () => {
  it('returns null for an empty window', () => {
    expect(averageMetricPct([], 'churn')).toBeNull();
  });

  it('averages the per-month rate over the window, and churn ≈ 100 − retention', () => {
    const v = buildRetentionEvolutionView(MONTHS, selectionFor('6m'));
    const meanChurn = v.points.reduce((a, p) => a + churnPctOf(p), 0) / v.points.length;
    const churn = averageMetricPct(v.points, 'churn');
    const retention = averageMetricPct(v.points, 'retention');
    expect(churn).toBeCloseTo(meanChurn, 5);
    expect((churn ?? 0) + (retention ?? 0)).toBeCloseTo(100, 0);
  });
});
