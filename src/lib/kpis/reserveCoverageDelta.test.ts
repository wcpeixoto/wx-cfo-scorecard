import { describe, it, expect } from 'vitest';
import type { MonthlyRollup } from '../data/contract';
import { computeReserveCoverageDelta } from './compute';

function rollup(month: string, expenses: number, netCashFlow: number): MonthlyRollup {
  return { month, revenue: expenses + netCashFlow, expenses, netCashFlow, savingsRate: 0, transactionCount: 0 };
}

describe('computeReserveCoverageDelta', () => {
  // Expenses rise, so the trailing-3 reserve target rises month to month.
  // The coverage delta must account for the moving denominator — it should
  // diverge from a naive cash-only delta.
  const rollups: MonthlyRollup[] = [
    rollup('2026-01', 6000, 0),
    rollup('2026-02', 6000, 0),
    rollup('2026-03', 6000, 0),
    rollup('2026-04', 12000, 0),
    rollup('2026-05', 30000, 6000),
  ];
  const currentCashBalance = 20000;
  const reserveTargetNow = 8000; // avg expenses Feb–Apr (anchor = May)

  it('measures coverage change, not raw cash change', () => {
    const result = computeReserveCoverageDelta(rollups, currentCashBalance, reserveTargetNow);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('up');
    // fundedNow = 20000/8000 = 2.5; priorCash = 20000 - 6000 = 14000;
    // priorTarget = avg Jan–Mar = 6000; fundedPrior = 14000/6000 = 2.33;
    // coverage delta = (2.5 - 2.33) / 2.33 ≈ 0.0730
    expect(result!.pct).toBeCloseTo(0.073, 2);
    // It must NOT equal the naive cash delta (20000-14000)/14000 ≈ 0.4286.
    expect(result!.pct).not.toBeCloseTo(0.4286, 2);
  });

  it('returns null with insufficient history', () => {
    expect(computeReserveCoverageDelta([rollup('2026-01', 6000, 0)], 20000, 8000)).toBeNull();
  });

  it('returns null when the reserve target is unavailable', () => {
    expect(computeReserveCoverageDelta(rollups, 20000, 0)).toBeNull();
  });
});
