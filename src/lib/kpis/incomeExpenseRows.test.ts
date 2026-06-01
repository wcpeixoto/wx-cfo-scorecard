import { describe, it, expect } from 'vitest';
import { computeIncomeExpenseRows, computeMonthlyRollups } from './compute';
import type { Txn } from '../data/contract';

// Fixture factory mirroring dataSanity.test.ts — keep `type` consistent with
// the sign of rawAmount so the predicate helpers (which gate primarily on
// category, not type) see realistic inputs.
type TxnOverrides = Partial<Txn> & {
  date: string;
  rawAmount: number;
  category: string;
};

function txn(o: TxnOverrides): Txn {
  const month = o.month ?? o.date.slice(0, 7);
  const amount = o.amount ?? Math.abs(o.rawAmount);
  const type: Txn['type'] = o.type ?? (o.rawAmount >= 0 ? 'income' : 'expense');
  return {
    id: o.id ?? `${o.date}-${o.category}-${o.rawAmount}-${Math.random().toString(36).slice(2, 7)}`,
    date: o.date,
    month,
    type,
    amount,
    rawAmount: o.rawAmount,
    category: o.category,
    payee: o.payee,
    memo: o.memo,
    account: o.account,
    transferAccount: o.transferAccount,
    tags: o.tags,
    balance: o.balance,
  };
}

describe('computeIncomeExpenseRows', () => {
  it('routes a business-income txn into income rows', () => {
    const txns = [txn({ date: '2024-03-15', rawAmount: 500, category: 'Business Income:Membership' })];
    const { income, expense } = computeIncomeExpenseRows(txns, '2024-03', '2024-03', 'operating');
    expect(income.rows).toHaveLength(1);
    expect(income.value).toBe(500);
    expect(expense.rows).toHaveLength(0);
  });

  it('routes an operating-expense txn into expense rows', () => {
    const txns = [txn({ date: '2024-03-15', rawAmount: -300, category: 'Rent' })];
    const { income, expense } = computeIncomeExpenseRows(txns, '2024-03', '2024-03', 'operating');
    expect(income.rows).toHaveLength(0);
    expect(expense.rows).toHaveLength(1);
    expect(expense.value).toBe(300);
  });

  it('excludes transfers (transferAccount set) from both sides', () => {
    const txns = [
      txn({ date: '2024-03-15', rawAmount: -1000, category: 'Owner Transfer', transferAccount: 'Savings' }),
      txn({ date: '2024-03-15', rawAmount: 1000, category: 'Owner Transfer', transferAccount: 'Checking' }),
    ];
    const { income, expense } = computeIncomeExpenseRows(txns, '2024-03', '2024-03', 'operating');
    expect(income.rows).toHaveLength(0);
    expect(expense.rows).toHaveLength(0);
  });

  it('excludes refunds from income rows (refundContribution rule)', () => {
    const txns = [txn({ date: '2024-03-15', rawAmount: 50, category: 'Business Income:Refund' })];
    const { income, expense } = computeIncomeExpenseRows(txns, '2024-03', '2024-03', 'operating');
    expect(income.rows).toHaveLength(0);
    expect(expense.rows).toHaveLength(0);
  });

  it('excludes capital distributions in operating mode', () => {
    const txns = [txn({ date: '2024-03-15', rawAmount: -2000, category: 'Owner Distribution' })];
    const { income, expense } = computeIncomeExpenseRows(txns, '2024-03', '2024-03', 'operating');
    expect(income.rows).toHaveLength(0);
    expect(expense.rows).toHaveLength(0);
  });

  it('INCLUDES capital distributions as expense rows in total mode (matches rollup effective expenses)', () => {
    const txns = [txn({ date: '2024-03-15', rawAmount: -2000, category: 'Owner Distribution' })];
    const { expense } = computeIncomeExpenseRows(txns, '2024-03', '2024-03', 'total');
    expect(expense.rows).toHaveLength(1);
    expect(expense.value).toBe(2000);
  });

  it('filters by window: only txns inside [startMonth, endMonth]', () => {
    const txns = [
      txn({ date: '2024-02-15', rawAmount: 100, category: 'Business Income:Membership' }),
      txn({ date: '2024-03-15', rawAmount: 200, category: 'Business Income:Membership' }),
      txn({ date: '2024-04-15', rawAmount: 300, category: 'Business Income:Membership' }),
    ];
    const { income } = computeIncomeExpenseRows(txns, '2024-03', '2024-03', 'operating');
    expect(income.rows).toHaveLength(1);
    expect(income.value).toBe(200);
  });

  it('handles multi-month windows (yearly granularity)', () => {
    const txns = [
      txn({ date: '2024-01-15', rawAmount: 100, category: 'Business Income:Membership' }),
      txn({ date: '2024-06-15', rawAmount: 200, category: 'Business Income:Membership' }),
      txn({ date: '2024-12-15', rawAmount: 300, category: 'Business Income:Membership' }),
      txn({ date: '2025-01-15', rawAmount: 999, category: 'Business Income:Membership' }),
    ];
    const { income } = computeIncomeExpenseRows(txns, '2024-01', '2024-12', 'operating');
    expect(income.rows).toHaveLength(3);
    expect(income.value).toBe(600);
  });

  it('reconciles to monthlyRollups for a single-month window (operating mode)', () => {
    const txns = [
      txn({ date: '2024-03-01', rawAmount: 1000, category: 'Business Income:Membership' }),
      txn({ date: '2024-03-05', rawAmount: 500, category: 'Business Income:Drop-in' }),
      txn({ date: '2024-03-10', rawAmount: -200, category: 'Rent' }),
      txn({ date: '2024-03-15', rawAmount: -50, category: 'Supplies' }),
      // Excluded: transfer + capital distribution + refund
      txn({ date: '2024-03-20', rawAmount: -100, category: 'Owner Transfer', transferAccount: 'Savings' }),
      txn({ date: '2024-03-22', rawAmount: -500, category: 'Owner Distribution' }),
      txn({ date: '2024-03-25', rawAmount: 10, category: 'Business Income:Refund' }),
    ];
    const rollups = computeMonthlyRollups(txns, 'operating');
    const march = rollups.find((r) => r.month === '2024-03');
    if (!march) throw new Error('March rollup missing');

    const { income, expense } = computeIncomeExpenseRows(txns, '2024-03', '2024-03', 'operating');
    expect(income.value).toBe(march.revenue);
    expect(expense.value).toBe(march.expenses);
  });
});
