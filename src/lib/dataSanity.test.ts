import { describe, it, expect } from 'vitest';
import { runDataSanityChecks } from './dataSanity';
import type { Txn } from './data/contract';

const WODIFY_CHECK_ID = 'wodify-gross-up-reconciliation';

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
    id: o.id ?? `${o.date}-${o.category}-${o.payee ?? ''}-${o.rawAmount}-${Math.random().toString(36).slice(2, 7)}`,
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

function findWodifyCheck(txns: Txn[]) {
  const report = runDataSanityChecks(txns, []);
  const check = report.checks.find((c) => c.id === WODIFY_CHECK_ID);
  if (!check) throw new Error(`Wodify check ${WODIFY_CHECK_ID} not in report`);
  return check;
}

// Convenience factories matching the canonical Wodify monthly entries.
function wodifyFeesRow(date: string, rawAmount: number, payee = 'Processor Gross-Up - Fees'): Txn {
  return txn({ date, account: 'Wodify', category: 'Business Income:Sales', payee, rawAmount });
}
function wodifyRefundsRow(date: string, rawAmount: number, payee = 'Processor Gross-Up - Refunds'): Txn {
  return txn({ date, account: 'Wodify', category: 'Business Income:Sales', payee, rawAmount });
}
function merchantFeesRow(date: string, rawAmount: number): Txn {
  return txn({ date, account: 'Wodify', category: 'Merchant Fees', payee: 'Stripe', rawAmount });
}
function customerRefundsRow(date: string, rawAmount: number): Txn {
  return txn({ date, account: 'Wodify', category: 'Customer Refunds', payee: 'Stripe', rawAmount });
}
function closingTxn(date: string): Txn {
  return txn({ date, account: 'BofA', category: 'Office Supplies', payee: 'Staples', rawAmount: -50 });
}

describe('Wodify gross-up reconciliation', () => {
  it('balanced closed month passes', () => {
    const txns: Txn[] = [
      wodifyFeesRow('2025-06-30', 1000),
      wodifyRefundsRow('2025-06-30', 500),
      merchantFeesRow('2025-06-30', -1000),
      customerRefundsRow('2025-06-30', -500),
      closingTxn('2025-07-15'),
    ];
    const check = findWodifyCheck(txns);
    expect(check.passed).toBe(true);
    expect(check.detail).toBeUndefined();
  });

  it('closed month missing Wodify gross-up rows warns', () => {
    const txns: Txn[] = [
      // 2025-05: full balanced Wodify activity establishes first-activity month.
      wodifyFeesRow('2025-05-31', 500),
      merchantFeesRow('2025-05-31', -500),
      // 2025-06: present in data via a non-Wodify row, no Wodify rows at all.
      closingTxn('2025-06-15'),
      // 2025-07: later date closes 2025-06 (closed-month detection is
      // independent of Wodify rows).
      closingTxn('2025-07-01'),
    ];
    const check = findWodifyCheck(txns);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain('2025-06');
    expect(check.detail).toMatch(/missing month-end Wodify gross-up/i);
    expect(check.detail).not.toContain('2025-05');
  });

  it('latest open month without gross-up passes as not-yet-grossed-up', () => {
    const txns: Txn[] = [
      // Balanced prior closed month establishes Wodify activity.
      wodifyFeesRow('2025-05-31', 500),
      merchantFeesRow('2025-05-31', -500),
      // 2025-06 is the latest month and is OPEN (maxDate = 2025-06-15,
      // monthEnd('2025-06') = 2025-06-30; maxDate not > monthEnd).
      closingTxn('2025-06-15'),
    ];
    const check = findWodifyCheck(txns);
    expect(check.passed).toBe(true);
    expect(check.detail).toBeUndefined();
  });

  it('cents tolerance: passes at exactly $0.01 diff, fails above', () => {
    const atTolerance: Txn[] = [
      wodifyFeesRow('2025-05-31', 500.0),
      merchantFeesRow('2025-05-31', -500.01),
      closingTxn('2025-06-01'),
    ];
    expect(findWodifyCheck(atTolerance).passed).toBe(true);

    const aboveTolerance: Txn[] = [
      wodifyFeesRow('2025-05-31', 500.0),
      merchantFeesRow('2025-05-31', -500.02),
      closingTxn('2025-06-01'),
    ];
    const above = findWodifyCheck(aboveTolerance);
    expect(above.passed).toBe(false);
    expect(above.detail).toContain('2025-05');
  });

  it('miscategorization-but-net-zero fails (revSide != outSide)', () => {
    // Total Wodify net is $0, but a sign-flipped Customer Refunds row (+500
    // where it should be -500) breaks the side balance. An offsetting extra
    // $500 in Merchant Fees keeps net at zero — exactly the case a naive
    // single-net-sum check would miss but the two-sided check catches
    // because |merchantFees| + |customerRefunds| accounts for each
    // component's magnitude independently.
    const txns: Txn[] = [
      wodifyFeesRow('2025-05-31', 1000),
      wodifyRefundsRow('2025-05-31', 500),
      merchantFeesRow('2025-05-31', -2000),
      customerRefundsRow('2025-05-31', +500), // SIGN-FLIPPED
      closingTxn('2025-06-01'),
    ];

    // Sanity-check the construction: the naive "Wodify total ≈ 0" check
    // would pass this dataset.
    const wodifyNet = txns
      .filter((t) => t.account === 'Wodify')
      .reduce((s, t) => s + t.rawAmount, 0);
    expect(wodifyNet).toBeCloseTo(0, 2);

    const check = findWodifyCheck(txns);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain('2025-05');
    expect(check.detail).toMatch(/do not reconcile/i);
  });

  it('Stripe Transfer rows do not affect the Wodify check', () => {
    // A perfectly balanced Wodify month plus a Stripe-named transfer row in
    // a different account. The transfer must not leak into any of the four
    // Wodify component sums.
    const txns: Txn[] = [
      wodifyFeesRow('2025-05-31', 500),
      merchantFeesRow('2025-05-31', -500),
      txn({
        date: '2025-05-31',
        account: 'BofA',
        category: '[Wodify]',
        payee: 'Stripe Transfer',
        rawAmount: -123.45,
        transferAccount: 'Wodify',
      }),
      closingTxn('2025-06-01'),
    ];
    expect(findWodifyCheck(txns).passed).toBe(true);
  });

  it('dash-normalization: U+2013 in payee classifies as gross-up fees', () => {
    // Canonical Wodify payee uses en-dash (U+2013), not ASCII hyphen. If the
    // classifier did not normalize, the row would not classify as gross-up
    // fees, revenueSide would be 0, and the "revSide > 0.01 with activity
    // present" assertion would fail. Passing here confirms normalization
    // works for the real-world payee string.
    const txns: Txn[] = [
      wodifyFeesRow('2025-05-31', 500, 'Processor Gross-Up – Fees'),
      merchantFeesRow('2025-05-31', -500),
      closingTxn('2025-06-01'),
    ];
    expect(findWodifyCheck(txns).passed).toBe(true);
  });

  it('pre-Wodify historical closed month does not warn', () => {
    // 2025-01 is closed (later dates exist) and has zero Wodify rows. It
    // predates the first Wodify activity (2025-05). It must NOT warn —
    // historical months before Wodify gross-up accounting existed have no
    // expected gross-up rows.
    const txns: Txn[] = [
      closingTxn('2025-01-15'),
      wodifyFeesRow('2025-05-31', 500),
      merchantFeesRow('2025-05-31', -500),
      closingTxn('2025-06-01'),
    ];
    const check = findWodifyCheck(txns);
    expect(check.passed).toBe(true);
    expect(check.detail).toBeUndefined();
  });
});
