import { describe, it, expect } from 'vitest';
import type { DashboardModel, Txn } from '../data/contract';
import { computeCore } from './efficiencyOpportunities';

// ── Test scaffold ────────────────────────────────────────────────────────────
// computeCore takes a referenceDate so the 24-month lookback is deterministic.
// referenceDate = 2026-02-15 → lastCompleteMonth = 2026-01; with
// latestMonth = 2025-12, windowAnchor = 2025-12. Lookback = Jan 2024 … Dec 2025
// (index 0 … 23). The current ("today") window is the last 3 months: Oct–Dec 2025.
const REF_DATE = new Date('2026-02-15T00:00:00Z');
const MODEL = { latestMonth: '2025-12' } as unknown as DashboardModel;

// Lookback months, index 0 (Jan 2024) … 23 (Dec 2025).
const MONTHS: string[] = Array.from({ length: 24 }, (_, i) => {
  const year = 2024 + Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${year}-${String(m).padStart(2, '0')}`;
});

let idSeq = 0;
function mk(month: string, type: 'income' | 'expense', category: string, amount: number): Txn {
  idSeq += 1;
  return {
    id: `t${idSeq}`,
    date: `${month}-15`,
    month,
    type,
    amount,
    rawAmount: type === 'income' ? amount : -amount,
    category,
  };
}

// A month contributes a "Business Income" income txn when revenue > 0, and a
// "Marketing" expense txn when spend > 0. (Marketing is the only expense
// category in these fixtures, so the result has at most one row.)
function buildTxns(revenue: number[], marketing: number[]): Txn[] {
  const txns: Txn[] = [];
  MONTHS.forEach((month, i) => {
    if (revenue[i] > 0) txns.push(mk(month, 'income', 'Business Income', revenue[i]));
    if (marketing[i] > 0) txns.push(mk(month, 'expense', 'Marketing', marketing[i]));
  });
  return txns;
}

function arr(value: number): number[] {
  return new Array(24).fill(value);
}
function set(base: number[], indices: number[], value: number): number[] {
  const a = base.slice();
  for (const i of indices) a[i] = value;
  return a;
}

function marketingRow(revenue: number[], marketing: number[]) {
  const res = computeCore(MODEL, buildTxns(revenue, marketing), REF_DATE);
  return { res, row: res.rows.find((r) => r.category === 'Marketing') };
}

describe('computeEfficiencyOpportunities — revenue-qualified "Your best" benchmark', () => {
  it('qualified happy path: flat revenue, every window qualifies, best is the spend dip', () => {
    // Revenue flat $30k → floor = 0.7 × $30k = $21k; every window (avg $30k)
    // qualifies. Marketing dips to $1.5k in Apr–Jun 2024 (idx 3–5) → a 5% ratio
    // versus the 10% baseline.
    const revenue = arr(30000);
    const marketing = set(arr(3000), [3, 4, 5], 1500);
    const { res, row } = marketingRow(revenue, marketing);

    expect(res.benchmarkRevenueQualified).toBe(true);
    expect(res.windowLabel).toBe('Oct – Dec 2025');
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(5);
    expect(row!.todayPct).toBe(10);
    expect(row!.bestWindow.label).toBe('Apr – Jun 2024');
    expect(Math.round(row!.extraPerMonth)).toBe(1500);
  });

  it('Floor 1 active: a low-revenue era with a tiny-spend 5% ratio is excluded', () => {
    // Apr–Jun 2024 (idx 3–5) revenue craters to $10k with $500 spend → a tempting
    // 5% ratio; everything else $30k. Floor = 0.7 × $30k = $21k, so the $10k
    // window falls below the floor. Best must come from a revenue-qualified
    // window — never the excluded 5%.
    const revenue = set(arr(30000), [3, 4, 5], 10000);
    const marketing = set(arr(3000), [3, 4, 5], 500);
    const { res, row } = marketingRow(revenue, marketing);

    expect(res.benchmarkRevenueQualified).toBe(true);
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(9); // > 5 ⟹ the low-revenue 5% window was excluded
    expect(row!.bestWindow.label).toBe('Feb – Apr 2024');
  });

  it('Floor 2 active: cratered current revenue; weak history excluded by the median floor', () => {
    // Current 6 months cratered to $8k (idx 18–23). A low-rev historical window
    // Apr–Jun 2024 (idx 3–5) at $12k with $600 spend looks like 5%. Floor 1 alone
    // (0.7 × $8k = $5.6k) would ADMIT the $12k window; Floor 2 (0.7 × median $30k
    // = $21k) excludes it. Best must come from a $30k-revenue window.
    const revenue = set(set(arr(30000), [3, 4, 5], 12000), [18, 19, 20, 21, 22, 23], 8000);
    const marketing = set(arr(3000), [3, 4, 5], 600);
    const { res, row } = marketingRow(revenue, marketing);

    expect(res.benchmarkRevenueQualified).toBe(true);
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(9); // > 5 ⟹ the $12k window was excluded by Floor 2
    expect(row!.bestWindow.label).toBe('Feb – Apr 2024');
  });

  it('fallback: <2 windows qualify → unfiltered best, benchmarkRevenueQualified=false', () => {
    // Revenue is $10k everywhere except a single $50k spike in the final month
    // (idx 23). current6mo avg ≈ $16.7k → floor ≈ $11.7k; only the one window
    // touching the spike clears it (1 < 2 required). Every category falls back to
    // the unfiltered best — here the $500/$10k = 5% dip in Apr–Jun 2024 — and the
    // flag is false. (True "zero qualifying" is unreachable: the current window
    // anchors the floor and tends to qualify, so the reachable edge is <2.)
    const revenue = set(arr(10000), [23], 50000);
    const marketing = set(arr(3000), [3, 4, 5], 500);
    const { res, row } = marketingRow(revenue, marketing);

    expect(res.benchmarkRevenueQualified).toBe(false);
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(5); // unfiltered best returned (the 5% dip)
    expect(row!.bestWindow.label).toBe('Apr – Jun 2024');
  });

  it('current6mo = 0 (all recent revenue zero): floor falls to the median, result is well-defined', () => {
    // Last 6 months have zero revenue → current6moAvgRevenue = 0, so the floor is
    // carried entirely by Floor 2 (0.7 × median) with no NaN/Infinity. With no
    // revenue in the current window there is no valid "today" window, so the
    // function returns a clean empty result rather than throwing.
    const revenue = set(arr(30000), [18, 19, 20, 21, 22, 23], 0);
    const marketing = arr(3000);

    let res!: ReturnType<typeof computeCore>;
    expect(() => {
      res = computeCore(MODEL, buildTxns(revenue, marketing), REF_DATE);
    }).not.toThrow();
    expect(res.rows).toHaveLength(0);
    expect(res.windowLabel).toBe('');
    expect(res.benchmarkRevenueQualified).toBe(false);
  });
});
