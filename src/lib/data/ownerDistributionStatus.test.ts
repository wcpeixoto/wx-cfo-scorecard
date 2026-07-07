import { describe, expect, it } from 'vitest';

import { computeOwnerDistributionStatus } from './ownerDistributionStatus';
import { classifyTxn } from '../cashFlow';
import type { DashboardModel, Txn } from './contract';

// ---- fixtures ----
function rollup(month: string, revenue: number) {
  return { month, revenue, expenses: 0, netCashFlow: 0, savingsRate: 0, transactionCount: 0 };
}

function modelWith(months: { month: string; revenue: number }[]): DashboardModel {
  return { monthlyRollups: months.map((m) => rollup(m.month, m.revenue)) } as unknown as DashboardModel;
}

function ownerTxn(month: string, amount: number, over?: Partial<Txn>): Txn {
  return {
    id: `${month}-${amount}`,
    date: `${month}-15`,
    month,
    type: 'expense',
    amount,
    category: 'Owner Distribution', // classifyTxn → 'owner-distribution'
    rawAmount: amount,
    ...over,
  } as Txn;
}

// The FORMER TodayPage inline logic, copied verbatim, as the parity oracle. If the extraction drifts,
// these three consumed fields diverge and the parity test fails.
const LEGACY_LOW = 0.9;
const LEGACY_HIGH = 1.1;
function legacyDistributionStatus(
  model: DashboardModel,
  txns: Txn[],
  targetNetMargin: number | undefined,
): { status: 'below_target' | 'on_target' | 'above_target'; targetAmount: number; actualAmount: number } {
  if (
    !model.monthlyRollups ||
    model.monthlyRollups.length < 3 ||
    !targetNetMargin ||
    targetNetMargin === 0 ||
    !txns ||
    txns.length === 0
  ) {
    return { status: 'on_target', targetAmount: 0, actualAmount: 0 };
  }
  const recentMonths = model.monthlyRollups.slice(-12);
  const totalRevenue = recentMonths.reduce((sum, m) => sum + (m.revenue ?? 0), 0);
  const targetAmount = totalRevenue * targetNetMargin;
  const cutoffMonth = recentMonths[0].month;
  const actualAmount = txns
    .filter((txn) => classifyTxn(txn) === 'owner-distribution')
    .filter((txn) => txn.month >= cutoffMonth)
    .reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
  let status: 'below_target' | 'on_target' | 'above_target';
  if (actualAmount < targetAmount * LEGACY_LOW) status = 'below_target';
  else if (actualAmount > targetAmount * LEGACY_HIGH) status = 'above_target';
  else status = 'on_target';
  return { status, targetAmount, actualAmount };
}

// 15 months (2025-01 … 2026-03) so slice(-12) drops the earliest 3 → window 2025-04 … 2026-03.
const MONTHS_15 = Array.from({ length: 15 }, (_, i) => ({
  month: i < 12 ? `2025-${String(i + 1).padStart(2, '0')}` : `2026-${String(i - 11).padStart(2, '0')}`,
  revenue: 10000,
}));

describe('computeOwnerDistributionStatus — parity with former TodayPage inline logic', () => {
  const scenarios: { name: string; model: DashboardModel; txns: Txn[]; margin: number | undefined }[] = [
    {
      name: 'below_target (actual well under target)',
      model: modelWith(MONTHS_15),
      txns: [ownerTxn('2025-06', 5000)],
      margin: 0.25,
    },
    {
      name: 'on_target (actual within band)',
      model: modelWith([
        { month: '2025-04', revenue: 10000 },
        { month: '2025-05', revenue: 10000 },
        { month: '2025-06', revenue: 10000 },
      ]),
      txns: [ownerTxn('2025-06', 7500)], // target = 30000 × 0.25 = 7500 → on_target
      margin: 0.25,
    },
    {
      name: 'above_target (actual over 1.1× target)',
      model: modelWith([
        { month: '2025-04', revenue: 10000 },
        { month: '2025-05', revenue: 10000 },
        { month: '2025-06', revenue: 10000 },
      ]),
      txns: [ownerTxn('2025-06', 20000)],
      margin: 0.25,
    },
    {
      name: 'degenerate — margin unset',
      model: modelWith(MONTHS_15),
      txns: [ownerTxn('2025-06', 5000)],
      margin: 0,
    },
    {
      name: 'degenerate — < 3 rollups',
      model: modelWith([{ month: '2026-05', revenue: 10000 }, { month: '2026-06', revenue: 10000 }]),
      txns: [ownerTxn('2026-06', 5000)],
      margin: 0.25,
    },
    {
      name: 'degenerate — no txns',
      model: modelWith(MONTHS_15),
      txns: [],
      margin: 0.25,
    },
    {
      name: 'window cutoff excludes txns before the trailing-12 start',
      model: modelWith(MONTHS_15), // window start = 2025-04 (slice(-12) of 2025-01..2026-03)
      txns: [ownerTxn('2025-01', 9999), ownerTxn('2025-06', 5000)], // the 2025-01 draw is before cutoff
      margin: 0.25,
    },
  ];

  for (const s of scenarios) {
    it(`matches legacy: ${s.name}`, () => {
      const got = computeOwnerDistributionStatus(s.model, s.txns, s.margin);
      const legacy = legacyDistributionStatus(s.model, s.txns, s.margin);
      expect(got.status).toBe(legacy.status);
      expect(got.targetAmount).toBe(legacy.targetAmount);
      expect(got.actualAmount).toBe(legacy.actualAmount);
    });
  }
});

describe('computeOwnerDistributionStatus — window bounds (new, additive)', () => {
  it('exposes the actual slice(-12) window; end can be the partial current month', () => {
    // 13 rollups: slice(-12) → 2025-02 … 2026-01. The last entry (2026-01) may be a partial current
    // month; the helper reports it as windowEnd rather than assuming the last complete month.
    const months = Array.from({ length: 13 }, (_, i) => {
      const idx = i + 1; // 1..13
      return idx <= 12
        ? { month: `2025-${String(idx).padStart(2, '0')}`, revenue: 10000 }
        : { month: '2026-01', revenue: 3000 };
    });
    const out = computeOwnerDistributionStatus(modelWith(months), [ownerTxn('2025-06', 5000)], 0.25);
    expect(out.windowStart).toBe('2025-02');
    expect(out.windowEnd).toBe('2026-01');
  });

  it('degenerate → null window', () => {
    const out = computeOwnerDistributionStatus(modelWith(MONTHS_15), [ownerTxn('2025-06', 5000)], 0);
    expect(out.windowStart).toBeNull();
    expect(out.windowEnd).toBeNull();
  });
});
