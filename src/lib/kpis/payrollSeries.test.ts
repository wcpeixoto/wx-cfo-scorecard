import { describe, it, expect } from 'vitest';
import type { MonthlyRollup, Txn } from '../data/contract';
import { selectPayrollHealth } from './payrollSeries';

let idc = 0;
const tx = (month: string, category: string, rawAmount: number, extra: Partial<Txn> = {}): Txn => ({
  id: `t${idc++}`,
  date: `${month}-15`,
  month,
  type: rawAmount >= 0 ? 'income' : 'expense',
  amount: Math.abs(rawAmount),
  category,
  rawAmount,
  ...extra,
});

const mr = (month: string, revenue: number): MonthlyRollup => ({
  month,
  revenue,
  expenses: 0,
  netCashFlow: revenue,
  savingsRate: 0,
  transactionCount: 0,
});

const fullYear = (year: number, monthlyRevenue: number): MonthlyRollup[] =>
  Array.from({ length: 12 }, (_, i) => mr(`${year}-${String(i + 1).padStart(2, '0')}`, monthlyRevenue));

const partialYear = (year: number, months: number, monthlyRevenue: number): MonthlyRollup[] =>
  Array.from({ length: months }, (_, i) => mr(`${year}-${String(i + 1).padStart(2, '0')}`, monthlyRevenue));

describe('selectPayrollHealth', () => {
  it('computes payroll % of revenue per year and reconciles revenue with rollups', () => {
    const rollups = [...fullYear(2024, 1000), ...fullYear(2025, 1000)];
    const txns = [tx('2024-06', 'Payroll', -4800), tx('2025-06', 'Payroll', -6000)];

    const { points, current } = selectPayrollHealth(txns, rollups);

    expect(points.map((p) => p.year)).toEqual(['2024', '2025']);
    expect(points[0]).toMatchObject({ revenue: 12000, payroll: 4800, payrollPct: 40 });
    expect(points[1]).toMatchObject({ revenue: 12000, payroll: 6000, payrollPct: 50 });
    // Revenue base equals the sum of MonthlyRollup.revenue for the year (Part 6B).
    expect(points[0].revenue).toBe(rollups.filter((r) => r.month.startsWith('2024')).reduce((s, r) => s + r.revenue, 0));
    expect(current?.year).toBe('2025');
    expect(current?.isCurrent).toBe(true);
    expect(current?.isPartial).toBe(false);
  });

  it('rolls subcategories up to the Payroll parent', () => {
    const rollups = fullYear(2024, 1000); // revenue 12000
    const txns = [
      tx('2024-03', 'Payroll:W-2 Staff', -3000),
      tx('2024-04', 'Payroll:Payroll Taxes', -1800),
    ];

    const { points } = selectPayrollHealth(txns, rollups);

    expect(points[0].payroll).toBe(4800);
    expect(points[0].payrollPct).toBe(40);
  });

  it('excludes Owner Distributions and non-payroll categories', () => {
    const rollups = fullYear(2024, 1000); // revenue 12000
    const txns = [
      tx('2024-03', 'Payroll', -4800),
      tx('2024-05', 'Owner Distributions', -5000),
      tx('2024-06', 'Rent or Lease', -2000),
    ];

    const { points } = selectPayrollHealth(txns, rollups);

    expect(points[0].payroll).toBe(4800);
    expect(points[0].payrollPct).toBe(40);
  });

  it('nets refund/reversal rows via expenseContribution', () => {
    const rollups = fullYear(2024, 1000); // revenue 12000
    const txns = [
      tx('2024-02', 'Payroll', -1000),
      tx('2024-03', 'Payroll:Payroll Fees', 200), // refund/reversal: positive rawAmount nets out
    ];

    const { points } = selectPayrollHealth(txns, rollups);

    expect(points[0].payroll).toBe(800);
    expect(points[0].payrollPct).toBe(6.7);
  });

  it('drops a leading single-month stub year and keeps the rest', () => {
    const rollups = [mr('2021-12', 1000), ...fullYear(2022, 1000), ...fullYear(2023, 1000)];
    const txns = [
      tx('2021-12', 'Payroll', -500),
      tx('2022-06', 'Payroll', -4800),
      tx('2023-06', 'Payroll', -5000),
    ];

    const { points } = selectPayrollHealth(txns, rollups);

    expect(points.map((p) => p.year)).toEqual(['2022', '2023']);
  });

  it('flags the latest year current and partial when under 12 months (YTD)', () => {
    const rollups = [...fullYear(2024, 1000), ...partialYear(2025, 5, 1000)];
    const txns = [tx('2024-06', 'Payroll', -4800), tx('2025-03', 'Payroll', -2000)];

    const { points, current } = selectPayrollHealth(txns, rollups);

    expect(points[0]).toMatchObject({ year: '2024', isPartial: false, isCurrent: false });
    expect(current).toMatchObject({ year: '2025', isPartial: true, isCurrent: true, monthCount: 5 });
  });

  it('returns null payrollPct when revenue is zero', () => {
    const rollups = fullYear(2024, 0);
    const txns = [tx('2024-06', 'Payroll', -1000)];

    const { points } = selectPayrollHealth(txns, rollups);

    expect(points[0].revenue).toBe(0);
    expect(points[0].payroll).toBe(1000);
    expect(points[0].payrollPct).toBeNull();
  });

  it('caps the series to the most recent 6 years', () => {
    const rollups = Array.from({ length: 8 }, (_, i) => fullYear(2019 + i, 1000)).flat();
    const txns = Array.from({ length: 8 }, (_, i) => tx(`${2019 + i}-06`, 'Payroll', -3000));

    const { points } = selectPayrollHealth(txns, rollups);

    expect(points).toHaveLength(6);
    expect(points[0].year).toBe('2021');
    expect(points[5].year).toBe('2026');
  });
});
