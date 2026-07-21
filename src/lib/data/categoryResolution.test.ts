import { describe, expect, it } from 'vitest';

import { CATEGORY_REGISTRY } from './categoryRegistry';
import {
  resolveCategory,
  summarizeUnclassifiedCategories,
} from './categoryResolution';
import type { Txn } from './contract';

function txn(category: string, overrides: Partial<Txn> = {}): Txn {
  return {
    id: `t-${category}-${overrides.date ?? '2026-06-15'}`,
    date: '2026-06-15',
    month: '2026-06',
    type: 'expense',
    amount: 100,
    category,
    account: 'Checking',
    rawAmount: -100,
    ...overrides,
  };
}

describe('resolveCategory — Tier-1 reserved', () => {
  it('resolves the four reserved parents as tier1 + reserved', () => {
    expect(resolveCategory('Transfer')).toEqual({
      parent: 'Transfer',
      effective: 'suppressed',
      source: 'tier1',
      reserved: true,
    });
    expect(resolveCategory('Loan')).toEqual({
      parent: 'Loan',
      effective: 'suppressed',
      source: 'tier1',
      reserved: true,
    });
    expect(resolveCategory('Owner Distributions')).toEqual({
      parent: 'Owner Distributions',
      effective: 'capital',
      source: 'tier1',
      reserved: true,
    });
    expect(resolveCategory('Business Income')).toEqual({
      parent: 'Business Income',
      effective: 'income',
      source: 'tier1',
      reserved: true,
    });
  });

  it('reserves entire subtrees, not just the parents', () => {
    expect(resolveCategory('Business Income:Sales')).toMatchObject({
      parent: 'Business Income',
      effective: 'income',
      reserved: true,
    });
    expect(resolveCategory('Business Income:Other Income')).toMatchObject({
      effective: 'income',
      reserved: true,
    });
    expect(resolveCategory('Transfer:To Savings')).toMatchObject({
      effective: 'suppressed',
      reserved: true,
    });
    expect(resolveCategory('Loan:Interest')).toMatchObject({
      effective: 'suppressed',
      reserved: true,
    });
  });

  it('matches capital-distribution normalized variants like cashFlow does', () => {
    expect(resolveCategory("Owner's Distribution")).toMatchObject({
      effective: 'capital',
      source: 'tier1',
      reserved: true,
    });
    expect(resolveCategory('owner distribution')).toMatchObject({
      effective: 'capital',
      reserved: true,
    });
    expect(resolveCategory('Draws:Capital Distribution')).toMatchObject({
      effective: 'capital',
      reserved: true,
    });
  });

  it('is case-insensitive for parent-based reserved names, like cashFlow', () => {
    expect(resolveCategory('transfer').reserved).toBe(true);
    expect(resolveCategory('LOAN').reserved).toBe(true);
    expect(resolveCategory('business income:sales').effective).toBe('income');
  });

  it('mirrors classifyTxn precedence when reserved families collide', () => {
    // Transfer is checked before capital in classifyTxn; the resolver must agree.
    expect(resolveCategory('Transfer:Owner Distributions')).toMatchObject({
      effective: 'suppressed',
      source: 'tier1',
    });
  });

  it('agrees with the registry bucket for every reserved name present in the registry', () => {
    for (const name of ['Business Income', 'Owner Distributions', 'Transfer', 'Loan']) {
      const viaResolver = resolveCategory(name);
      expect(viaResolver.source).toBe('tier1');
      expect(viaResolver.effective).toBe(CATEGORY_REGISTRY[name].bucket);
    }
  });
});

describe('resolveCategory — registry layer', () => {
  it('resolves registry entries with their bucket, source registry, not reserved', () => {
    expect(resolveCategory('Payroll')).toEqual({
      parent: 'Payroll',
      effective: 'fixed',
      source: 'registry',
      reserved: false,
    });
    expect(resolveCategory('Marketing').effective).toBe('variable');
    expect(resolveCategory('Misc. Expense').effective).toBe('suppressed');
  });

  it('resolves subcategories through their parent registry entry', () => {
    expect(resolveCategory('Payroll:Coaches')).toMatchObject({
      parent: 'Payroll',
      effective: 'fixed',
      source: 'registry',
    });
  });

  it('resolves every registry name to a non-unclassified bucket', () => {
    for (const name of Object.keys(CATEGORY_REGISTRY)) {
      const resolution = resolveCategory(name);
      expect(resolution.effective, name).not.toBe('unclassified');
    }
  });

  it('is case-sensitive for registry names (exact-match contract)', () => {
    expect(resolveCategory('payroll').effective).toBe('unclassified');
  });
});

describe('resolveCategory — unclassified', () => {
  it('resolves unknown categories to unclassified with source none', () => {
    expect(resolveCategory('Donations')).toEqual({
      parent: 'Donations',
      effective: 'unclassified',
      source: 'none',
      reserved: false,
    });
    expect(resolveCategory('Donations:GoFundMe').parent).toBe('Donations');
  });

  it("does NOT reserve 'Customer Refunds' via the refund substring heuristic", () => {
    // cashFlow's isRefundCategory only gates the Business Income revenue branch;
    // it must not make a standalone refund category reserved or classified.
    expect(resolveCategory('Customer Refunds')).toEqual({
      parent: 'Customer Refunds',
      effective: 'unclassified',
      source: 'none',
      reserved: false,
    });
  });

  it("resolves 'Uncategorized' (blank-category import default) to unclassified", () => {
    expect(resolveCategory('Uncategorized').effective).toBe('unclassified');
  });
});

describe('summarizeUnclassifiedCategories', () => {
  it('groups by parent with txn counts and distinct raw names', () => {
    const txns: Txn[] = [
      txn('Customer Refunds'),
      txn('Customer Refunds', { date: '2026-06-16' }),
      txn('Donations:GoFundMe'),
      txn('Donations'),
      txn('Payroll'),
      txn('Business Income:Sales', { type: 'income', rawAmount: 500 }),
      txn('Uncategorized'),
    ];

    expect(summarizeUnclassifiedCategories(txns)).toEqual([
      { parent: 'Customer Refunds', txnCount: 2, rawCategories: ['Customer Refunds'] },
      { parent: 'Donations', txnCount: 2, rawCategories: ['Donations', 'Donations:GoFundMe'] },
      { parent: 'Uncategorized', txnCount: 1, rawCategories: ['Uncategorized'] },
    ]);
  });

  it('sorts by count desc then parent asc', () => {
    const txns: Txn[] = [
      txn('Zeta Fund'),
      txn('Alpha Fund'),
      txn('Donations'),
      txn('Donations', { date: '2026-06-17' }),
    ];
    expect(summarizeUnclassifiedCategories(txns).map((s) => s.parent)).toEqual([
      'Donations',
      'Alpha Fund',
      'Zeta Fund',
    ]);
  });

  it('returns [] when every category classifies', () => {
    const txns: Txn[] = [
      txn('Payroll'),
      txn('Marketing'),
      txn('Transfer'),
      txn('Business Income:Sales', { type: 'income', rawAmount: 500 }),
    ];
    expect(summarizeUnclassifiedCategories(txns)).toEqual([]);
  });

  it('returns [] for an empty transaction set', () => {
    expect(summarizeUnclassifiedCategories([])).toEqual([]);
  });

  it("groups a blank category under 'Uncategorized'", () => {
    // The import layer defaults blanks to 'Uncategorized' before txns exist,
    // but the summarizer must stay robust if a blank ever reaches it.
    expect(summarizeUnclassifiedCategories([txn('')])).toEqual([
      { parent: 'Uncategorized', txnCount: 1, rawCategories: ['Uncategorized'] },
    ]);
  });

  it('mirrors the pre-registered live acceptance shape (three groups)', () => {
    // Live-store acceptance check (2026-07-21): exactly Customer Refunds,
    // Uncategorized, Donations resolve unclassified. Counts are synthetic here —
    // the live counts are asserted by the out-of-repo probe, not this fixture.
    const txns: Txn[] = [
      txn('Customer Refunds'),
      txn('Uncategorized'),
      txn('Donations'),
      txn('Payroll'),
      txn('Rent or Lease'),
      txn('Misc. Expense'),
    ];
    expect(summarizeUnclassifiedCategories(txns).map((s) => s.parent)).toEqual([
      'Customer Refunds',
      'Donations',
      'Uncategorized',
    ]);
  });
});
