import { describe, it, expect } from 'vitest';
import type { MonthlyRollup } from '../data/contract';
import {
  resolveWindow,
  selectMonthlyIncomeExpense,
  selectYearlyIncomeExpense,
  selectIncomeExpense,
  latestRollupMonth,
} from './incomeExpenseSeries';

const mk = (month: string, revenue: number, expenses: number): MonthlyRollup => ({
  month,
  revenue,
  expenses,
  netCashFlow: revenue - expenses,
  savingsRate: revenue ? (revenue - expenses) / revenue : 0,
  transactionCount: 0,
});

function monthsRange(start: string, end: string, fn: (month: string) => MonthlyRollup): MonthlyRollup[] {
  const out: MonthlyRollup[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(fn(`${y}-${String(m).padStart(2, '0')}`));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// 16 months of data: 2025-01 .. 2026-04 → latest month is 2026-04.
const SIXTEEN = monthsRange('2025-01', '2026-04', (month) => mk(month, 1000, 400));

describe('selectMonthlyIncomeExpense', () => {
  it('slices to the window, preserving per-month income/expense and totals', () => {
    const r = [mk('2025-01', 100, 40), mk('2025-02', 200, 50), mk('2025-03', 300, 60), mk('2025-04', 400, 70)];
    const s = selectMonthlyIncomeExpense(r, '2025-02', '2025-03');
    expect(s.labels).toEqual(['2025-02', '2025-03']);
    expect(s.income).toEqual([200, 300]);
    expect(s.expense).toEqual([50, 60]);
    expect(s.totalIncome).toBe(500);
    expect(s.totalExpense).toBe(110);
    expect(s.netIncome).toBe(390);
  });

  it('sorts out-of-order rollups by month', () => {
    const r = [mk('2025-03', 3, 1), mk('2025-01', 1, 1), mk('2025-02', 2, 1)];
    const s = selectMonthlyIncomeExpense(r, '2025-01', '2025-03');
    expect(s.labels).toEqual(['2025-01', '2025-02', '2025-03']);
    expect(s.income).toEqual([1, 2, 3]);
  });

  it('handles a single-month window', () => {
    const s = selectMonthlyIncomeExpense(SIXTEEN, '2025-06', '2025-06');
    expect(s.labels).toEqual(['2025-06']);
    expect(s.income).toEqual([1000]);
    expect(s.expense).toEqual([400]);
    expect(s.netIncome).toBe(600);
  });

  it('handles an empty window safely', () => {
    const s = selectMonthlyIncomeExpense(SIXTEEN, '2030-01', '2030-12');
    expect(s.labels).toEqual([]);
    expect(s.income).toEqual([]);
    expect(s.expense).toEqual([]);
    expect(s.totalIncome).toBe(0);
    expect(s.totalExpense).toBe(0);
    expect(s.netIncome).toBe(0);
  });

  it('reports a negative net when expenses exceed income', () => {
    const s = selectMonthlyIncomeExpense([mk('2025-01', 100, 400)], '2025-01', '2025-01');
    expect(s.totalIncome).toBe(100);
    expect(s.totalExpense).toBe(400);
    expect(s.netIncome).toBe(-300);
  });

  it('caps to the most recent 18 months', () => {
    const twentyFour = monthsRange('2024-01', '2025-12', (month) => mk(month, 1000, 400)); // 24 months
    const s = selectMonthlyIncomeExpense(twentyFour, '2024-01', '2025-12');
    expect(s.labels.length).toBe(18);
    expect(s.labels[0]).toBe('2024-07');
    expect(s.labels[17]).toBe('2025-12');
  });
});

describe('selectYearlyIncomeExpense', () => {
  it('aggregates by calendar year', () => {
    const r = [mk('2024-11', 10, 5), mk('2024-12', 20, 5), mk('2025-01', 30, 10), mk('2025-02', 40, 10), mk('2026-01', 50, 20)];
    const s = selectYearlyIncomeExpense(r, '2024-01', '2026-12');
    expect(s.labels).toEqual(['2024', '2025', '2026']);
    expect(s.income).toEqual([30, 70, 50]);
    expect(s.expense).toEqual([10, 20, 20]);
    expect(s.totalIncome).toBe(150);
    expect(s.totalExpense).toBe(50);
    expect(s.netIncome).toBe(100);
  });

  it('includes partial edge years as-is (no padding)', () => {
    const r = monthsRange('2024-01', '2026-12', (month) => mk(month, 100, 40));
    const s = selectYearlyIncomeExpense(r, '2024-05', '2026-04');
    // 2024: May–Dec = 8 months; 2025: full 12; 2026: Jan–Apr = 4 months.
    expect(s.labels).toEqual(['2024', '2025', '2026']);
    expect(s.income).toEqual([800, 1200, 400]);
    expect(s.expense).toEqual([320, 480, 160]);
    expect(s.netIncome).toBe(800 + 1200 + 400 - (320 + 480 + 160));
  });

  it('caps to the most recent 18 calendar years', () => {
    const many = monthsRange('2000-01', '2026-12', (month) => mk(month, 12, 12)); // 27 calendar years
    const s = selectYearlyIncomeExpense(many, '2000-01', '2026-12');
    expect(s.labels.length).toBe(18);
    expect(s.labels[0]).toBe('2009');
    expect(s.labels[17]).toBe('2026');
  });

  it('handles an empty window safely', () => {
    const s = selectYearlyIncomeExpense(SIXTEEN, '2030-01', '2030-12');
    expect(s.labels).toEqual([]);
    expect(s.netIncome).toBe(0);
  });
});

describe('resolveWindow — latest-month anchoring', () => {
  it('anchors to the latest available rollup month, not real today', () => {
    expect(latestRollupMonth(SIXTEEN)).toBe('2026-04');
    expect(resolveWindow(SIXTEEN, '12m')).toEqual({
      startMonth: '2025-05',
      endMonth: '2026-04',
      granularity: 'monthly',
    });
  });

  it('keeps 6/12/18m monthly and 24/36m/5y yearly', () => {
    expect(resolveWindow(SIXTEEN, '6m')).toMatchObject({ startMonth: '2025-11', granularity: 'monthly' });
    expect(resolveWindow(SIXTEEN, '18m')).toMatchObject({ startMonth: '2024-11', granularity: 'monthly' });
    expect(resolveWindow(SIXTEEN, '24m')).toEqual({ startMonth: '2024-05', endMonth: '2026-04', granularity: 'yearly' });
    expect(resolveWindow(SIXTEEN, '36m')).toMatchObject({ startMonth: '2023-05', granularity: 'yearly' });
    expect(resolveWindow(SIXTEEN, '5y')).toMatchObject({ startMonth: '2021-05', granularity: 'yearly' });
  });

  it('resolves "all" from the earliest month; granularity follows the data span', () => {
    expect(resolveWindow(SIXTEEN, 'all')).toEqual({
      startMonth: '2025-01',
      endMonth: '2026-04',
      granularity: 'yearly', // 16-month span > 12
    });
    const short = monthsRange('2025-01', '2025-08', (month) => mk(month, 1, 1)); // 8-month span
    expect(resolveWindow(short, 'all')).toEqual({
      startMonth: '2025-01',
      endMonth: '2025-08',
      granularity: 'monthly', // ≤12 months
    });
  });

  it('returns null when there are no rollups', () => {
    expect(resolveWindow([], '12m')).toBeNull();
    expect(latestRollupMonth([])).toBeNull();
  });
});

describe('selectIncomeExpense — one-shot resolver', () => {
  it('renders monthly bars for 12m and yearly bars for 24m', () => {
    const twelve = selectIncomeExpense(SIXTEEN, '12m');
    expect(twelve.granularity).toBe('monthly');
    expect(twelve.series.labels).toEqual([
      '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10',
      '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
    ]);

    const twentyFour = selectIncomeExpense(SIXTEEN, '24m');
    expect(twentyFour.granularity).toBe('yearly');
    expect(twentyFour.series.labels).toEqual(['2025', '2026']);
    // 2025: 12 months; 2026: Jan–Apr = 4 months (data starts 2025-01).
    expect(twentyFour.series.income).toEqual([12000, 4000]);
  });

  it('renders 18 monthly bars with totals reconciling to the full 18-month range', () => {
    // 24 months of data → latest is 2025-12; 18m window = 2024-07 .. 2025-12 (no cap loss).
    const data = monthsRange('2024-01', '2025-12', (month) => mk(month, 1000, 400));
    const r = selectIncomeExpense(data, '18m');
    expect(r.granularity).toBe('monthly');
    expect(r.series.labels.length).toBe(18);
    expect(r.series.labels[0]).toBe('2024-07');
    expect(r.series.labels[17]).toBe('2025-12');
    expect(r.series.totalIncome).toBe(18 * 1000);
    expect(r.series.totalExpense).toBe(18 * 400);
    expect(r.series.netIncome).toBe(18 * 600);
  });

  it('returns an empty series (no throw) for empty rollups', () => {
    const empty = selectIncomeExpense([], '12m');
    expect(empty.series.labels).toEqual([]);
    expect(empty.series.netIncome).toBe(0);
    expect(empty.granularity).toBe('monthly');
  });
});
