import { describe, it, expect } from 'vitest';
import { groundReserveWarningTarget, reserveGroundingHint } from './targetGrounding';
import type { DashboardModel, MonthlyRollup } from '../data/contract';

// Reference date 2026-05-15 → the current (incomplete) month is 2026-05, excluded.
const REF = new Date(2026, 4, 15);

function rollup(month: string, netCashFlow: number): MonthlyRollup {
  return { month, revenue: 0, expenses: 0, netCashFlow, savingsRate: 0, transactionCount: 0 };
}

// `count` consecutive complete months ending 2026-04 (all < 2026-05), oldest first.
function completeMonths(count: number, net: number): MonthlyRollup[] {
  const out: MonthlyRollup[] = [];
  let y = 2026;
  let m = 4; // April 2026 — latest complete month relative to REF
  for (let i = 0; i < count; i++) {
    out.push(rollup(`${y}-${String(m).padStart(2, '0')}`, net));
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out.reverse();
}

function model(
  rollups: MonthlyRollup[],
  runway: Partial<DashboardModel['runway']> = {}
): DashboardModel {
  return {
    monthlyRollups: rollups,
    runway: {
      status: 'ok',
      percentFunded: 0.7,
      currentCashBalance: 7000,
      reserveTarget: 10000,
      ...runway,
    },
  } as unknown as DashboardModel;
}

describe('groundReserveWarningTarget (TG-0 spec)', () => {
  it('grounds recommended = roundTo25(0.33 × weekly capacity), capped by ceiling', () => {
    const g = groundReserveWarningTarget(3000, model(completeMonths(6, 3000)), REF);
    expect(g.classification).toBe('grounded');
    // capacity = 3000/4.33 ≈ 692.84/wk; ×0.33 ≈ 228.6 → roundTo25 → 225
    expect(g.recommended).toBe(225);
    expect(g.weeklyCapacity).toBeCloseTo(692.84, 1);
    expect(g.floor).toBe(25);
    expect(g.ceiling).toBe(3000);
    expect(g.unknownReason).toBeNull();
  });

  it('caps the recommendation at the ceiling without rounding the ceiling', () => {
    const g = groundReserveWarningTarget(120, model(completeMonths(6, 3000)), REF);
    expect(g.classification).toBe('grounded');
    expect(g.recommended).toBe(120); // min(120, 225)
  });

  it('is unknown (insufficient_history) with fewer than 6 complete months', () => {
    const g = groundReserveWarningTarget(3000, model(completeMonths(5, 3000)), REF);
    expect(g.classification).toBe('unknown');
    expect(g.unknownReason).toBe('insufficient_history');
    expect(g.recommended).toBeNull();
    expect(g.weeklyCapacity).toBeNull();
  });

  it('is unknown (nonpositive_capacity) when smoothed surplus ≤ 0', () => {
    const g = groundReserveWarningTarget(3000, model(completeMonths(6, -500)), REF);
    expect(g.classification).toBe('unknown');
    expect(g.unknownReason).toBe('nonpositive_capacity');
    expect(g.recommended).toBeNull();
    expect(g.weeklyCapacity).toBeLessThan(0);
  });

  it('is unknown (below_floor) when the grounded amount rounds below $25/wk', () => {
    // $120/mo → ~27.7/wk × 0.33 ≈ 9.1 → roundTo25 → 0 → below the $25 floor
    const g = groundReserveWarningTarget(3000, model(completeMonths(6, 120)), REF);
    expect(g.classification).toBe('unknown');
    expect(g.unknownReason).toBe('below_floor');
    expect(g.recommended).toBeNull();
  });

  it('excludes the current incomplete month from the capacity', () => {
    const rollups = [...completeMonths(6, 3000), rollup('2026-05', 999999)];
    const g = groundReserveWarningTarget(3000, model(rollups), REF);
    expect(g.classification).toBe('grounded');
    expect(g.recommended).toBe(225); // 999999 in the current month must not skew it
    expect(g.weeklyCapacity).toBeCloseTo(692.84, 1);
  });

  it('uses at most the trailing 12 complete months', () => {
    const rollups = completeMonths(18, 3000);
    // Make the oldest 6 huge — they must fall outside the 12-month window.
    for (let i = 0; i < 6; i++) rollups[i].netCashFlow = 999999;
    const g = groundReserveWarningTarget(3000, model(rollups), REF);
    expect(g.recommended).toBe(225);
    expect(g.weeklyCapacity).toBeCloseTo(692.84, 1);
  });

  it('is unknown when runway reports insufficient history', () => {
    const g = groundReserveWarningTarget(
      3000,
      model(completeMonths(6, 3000), { status: 'insufficient-history' }),
      REF
    );
    expect(g.classification).toBe('unknown');
    expect(g.unknownReason).toBe('insufficient_history');
  });

  it('is unknown when the reserve target is unavailable (percentFunded null)', () => {
    const g = groundReserveWarningTarget(
      3000,
      model(completeMonths(6, 3000), { percentFunded: null }),
      REF
    );
    expect(g.classification).toBe('unknown');
    expect(g.unknownReason).toBe('insufficient_history');
  });
});

describe('reserveGroundingHint (TG-2 consumption contract)', () => {
  it('renders the recommended number with a weeks-to-fund horizon', () => {
    // recommended 225, ceiling 2025 → weeks = ceil(2025/225) = 9
    const g = groundReserveWarningTarget(2025, model(completeMonths(6, 3000)), REF);
    const hint = reserveGroundingHint(g);
    expect(hint).not.toBeNull();
    expect(hint!.text).toBe(
      'Your recent surplus supports about $225/week — that fully funds your reserve in ~9 weeks.'
    );
    expect(hint!.floor).toBe(25);
  });

  it('singularizes the horizon when one week of the recommendation funds the gap', () => {
    // recommended capped to ceiling 120 → weeks = ceil(120/120) = 1
    const g = groundReserveWarningTarget(120, model(completeMonths(6, 3000)), REF);
    const hint = reserveGroundingHint(g);
    expect(hint!.text).toBe(
      'Your recent surplus supports about $120/week — that fully funds your reserve in ~1 week.'
    );
  });

  it('returns null for every unknown classification (no helper, slot unchanged)', () => {
    expect(
      reserveGroundingHint(groundReserveWarningTarget(3000, model(completeMonths(5, 3000)), REF))
    ).toBeNull(); // insufficient_history
    expect(
      reserveGroundingHint(groundReserveWarningTarget(3000, model(completeMonths(6, -500)), REF))
    ).toBeNull(); // nonpositive_capacity
    expect(
      reserveGroundingHint(groundReserveWarningTarget(3000, model(completeMonths(6, 120)), REF))
    ).toBeNull(); // below_floor
  });

  it('keys off recommended, not classification (a stray unknown+number still renders)', () => {
    // Impossible-from-generator combo, asserted on purpose: proves the helper
    // reads `recommended`, never `classification`. TG-3 owns unknown routing, so
    // TG-2 must not consult classification (the #195 trap).
    const hint = reserveGroundingHint({
      classification: 'unknown',
      recommended: 200,
      floor: 25,
      ceiling: 600,
      weeklyCapacity: 700,
      unknownReason: 'below_floor',
    });
    expect(hint).not.toBeNull();
    expect(hint!.text).toContain('$200/week');
  });

  const grounded = (recommended: number, ceiling: number) =>
    reserveGroundingHint({
      classification: 'grounded',
      recommended,
      ceiling,
      floor: 25,
      weeklyCapacity: 700,
      unknownReason: null,
    })!;

  it('keeps the finish-line copy through the 12-week boundary', () => {
    // ceil(1200/100) = 12 → still within ~a quarter
    expect(grounded(100, 1200).text).toBe(
      'Your recent surplus supports about $100/week — that fully funds your reserve in ~12 weeks.'
    );
  });

  it('reframes a far-off horizon to a sustainable pace (no discouraging week count)', () => {
    // ceil(1300/100) = 13 → just past the boundary
    expect(grounded(100, 1300).text).toBe(
      'Your recent surplus supports about $100/week — a sustainable pace toward your reserve.'
    );
    // The real fixture case (gap ~$14.1K, $100/wk → ~141 weeks) takes this branch.
    const farOff = grounded(100, 14100).text;
    expect(farOff).toBe(
      'Your recent surplus supports about $100/week — a sustainable pace toward your reserve.'
    );
    expect(farOff).not.toContain('141');
    expect(farOff).not.toContain('weeks');
  });
});
