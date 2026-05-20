import { describe, it, expect } from 'vitest';
import type { MonthlyRollup } from '../data/contract';
import { computeReserveCoverageDelta } from './compute';

function rollup(month: string, expenses: number): MonthlyRollup {
  return { month, revenue: expenses, expenses, netCashFlow: 0, savingsRate: 0, transactionCount: 0 };
}

// 5 months, all netCashFlow = 0 → in the prior (pre-fix) walk-back model
// the cash-trend series was flat and priorCashBalance === currentCashBalance.
// Post-fix, priorCashBalance is passed in directly; we keep the same value
// (currentCash) so the test intent is preserved exactly. priorAnchor =
// 2026-04, whose trailing-3 expense basis is Jan–Mar; set those to
// `priorTargetExpenses` so fundedPrior = currentCash / priorTargetExpenses.
// fundedNow is the passed reserveTarget: currentCash / reserveTarget.
function fixture(priorTargetExpenses: number): MonthlyRollup[] {
  return [
    rollup('2026-01', priorTargetExpenses),
    rollup('2026-02', priorTargetExpenses),
    rollup('2026-03', priorTargetExpenses),
    rollup('2026-04', priorTargetExpenses),
    rollup('2026-05', priorTargetExpenses),
  ];
}

describe('computeReserveCoverageDelta — absolute coverage move + copy', () => {
  it('prior 0.17 → now 0.66: "↑ 17% → 66% funded since last month"', () => {
    // currentCash 1700, priorTarget 10000 → fundedPrior 0.17;
    // reserveTarget 1700/0.66 → fundedNow 0.66.
    const r = computeReserveCoverageDelta(fixture(10000), 1700, 1700 / 0.66, 1700);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('up');
    expect(r!.label).toBe('17% → 66% funded since last month');
  });

  it('prior 0.654 → now 0.656: "No change since last month" (move < 0.5pp)', () => {
    const r = computeReserveCoverageDelta(fixture(10000), 6540, 6540 / 0.656, 6540);
    expect(r!.direction).toBe('flat');
    expect(r!.label).toBe('No change since last month');
  });

  it('prior 0.654 → now 0.662: "↑ 65% → 66% funded since last month"', () => {
    const r = computeReserveCoverageDelta(fixture(10000), 6540, 6540 / 0.662, 6540);
    expect(r!.direction).toBe('up');
    expect(r!.label).toBe('65% → 66% funded since last month');
  });

  it('prior 0.66 → now 0.46: "↓ 66% → 46% funded since last month"', () => {
    const r = computeReserveCoverageDelta(fixture(10000), 6600, 6600 / 0.46, 6600);
    expect(r!.direction).toBe('down');
    expect(r!.label).toBe('66% → 46% funded since last month');
  });

  it('prior 0.13 → now 2.00: "↑ 13% → above target since last month"', () => {
    const r = computeReserveCoverageDelta(fixture(10000), 1300, 650, 1300);
    expect(r!.direction).toBe('up');
    expect(r!.label).toBe('13% → above target since last month');
  });

  it('single rollup, no prior anchor: "No prior month to compare yet"', () => {
    const r = computeReserveCoverageDelta([rollup('2026-01', 10000)], 6600, 10000, 6600);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('flat');
    expect(r!.label).toBe('No prior month to compare yet');
  });

  it('null only when the current reserve target is unavailable', () => {
    expect(computeReserveCoverageDelta(fixture(10000), 6600, 0, 6600)).toBeNull();
  });

  it('null priorCashBalance: "No prior month to compare yet"', () => {
    const r = computeReserveCoverageDelta(fixture(10000), 6600, 10000, null);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe('flat');
    expect(r!.label).toBe('No prior month to compare yet');
  });

  // Regression: a recovery off a low prior base (≈0.17) must report the
  // absolute before→after pair, NOT the old relative form
  // (fundedNow−fundedPrior)/|fundedPrior|, which produced "+288%". Guards
  // against reintroducing the divide-by-small-prior pattern.
  it('low prior base does not produce a relative-percentage blowup', () => {
    const r = computeReserveCoverageDelta(fixture(10000), 1700, 1700 / 0.66, 1700);
    expect(r!.label).toBe('17% → 66% funded since last month');
    expect('pct' in (r as object)).toBe(false);
    expect(r!.label).not.toMatch(/\d{3,}\s*%/);
  });
});
