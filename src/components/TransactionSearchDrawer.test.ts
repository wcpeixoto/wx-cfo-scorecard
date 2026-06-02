import { describe, expect, it } from 'vitest';
import type { Txn } from '../lib/data/contract';
import {
  buildCategoryGroups,
  categoryFilterMatches,
  decodeCategory,
  encodeCategory,
  resolvePeriodRange,
  type CategoryFilter,
} from './TransactionSearchDrawer';

// Wall-clock period resolution is pure — it takes a pinned "today" and a
// custom-range fallback. These cases lock the contract that drives the
// drawer's default Last 7 Days behaviour and the empty-state safety net.
describe('resolvePeriodRange — wall-clock windows', () => {
  const today = '2026-06-15';
  const customDefault = { start: '2020-01-01', end: '2020-12-31' };

  it('last7Days returns 7 inclusive days ending today', () => {
    expect(resolvePeriodRange('last7Days', today, customDefault)).toEqual({
      start: '2026-06-09',
      end: '2026-06-15',
    });
  });

  it('thisMonth spans first-of-month through today', () => {
    expect(resolvePeriodRange('thisMonth', today, customDefault)).toEqual({
      start: '2026-06-01',
      end: '2026-06-15',
    });
  });

  it('lastMonth covers the full previous calendar month', () => {
    expect(resolvePeriodRange('lastMonth', today, customDefault)).toEqual({
      start: '2026-05-01',
      end: '2026-05-31',
    });
  });

  it('lastMonth handles January correctly (crosses year boundary)', () => {
    expect(resolvePeriodRange('lastMonth', '2026-01-15', customDefault)).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
  });

  it('ytd starts at January 1 of the current year', () => {
    expect(resolvePeriodRange('ytd', today, customDefault)).toEqual({
      start: '2026-01-01',
      end: '2026-06-15',
    });
  });

  it('last12Months covers 12 calendar months ending today', () => {
    expect(resolvePeriodRange('last12Months', today, customDefault)).toEqual({
      start: '2025-07-01',
      end: '2026-06-15',
    });
  });

  it('custom passes through whatever the user set', () => {
    expect(
      resolvePeriodRange('custom', today, { start: '2024-03-01', end: '2024-09-30' }),
    ).toEqual({ start: '2024-03-01', end: '2024-09-30' });
  });

  it('handles short month transitions on lastMonth (March → February non-leap)', () => {
    expect(resolvePeriodRange('lastMonth', '2025-03-10', customDefault)).toEqual({
      start: '2025-02-01',
      end: '2025-02-28',
    });
  });

  it('handles leap-year February correctly on lastMonth', () => {
    expect(resolvePeriodRange('lastMonth', '2024-03-10', customDefault)).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
  });
});

// ─── Category dropdown options ──────────────────────────────────────────────

function txn(category: string): Txn {
  return {
    id: `id-${category}`,
    date: '2026-06-01',
    month: '2026-06',
    type: 'expense',
    amount: 100,
    category,
    rawAmount: -100,
  };
}

describe('buildCategoryGroups', () => {
  it('groups Parent:Child categories under their parent', () => {
    const txns = [
      txn('Operating Expenses:Rent'),
      txn('Operating Expenses:Software'),
      txn('Business Income:Memberships'),
    ];
    const groups = buildCategoryGroups(txns);
    expect(groups.map((g) => g.parent)).toEqual(['Business Income', 'Operating Expenses']);
    const opEx = groups.find((g) => g.parent === 'Operating Expenses')!;
    expect(opEx.children).toEqual(['Operating Expenses:Rent', 'Operating Expenses:Software']);
    expect(opEx.isBareLeaf).toBe(false);
  });

  it('marks a bare category (no ":") as a leaf so the dropdown skips the "All Parent" synthetic', () => {
    const groups = buildCategoryGroups([txn('Uncategorized')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      parent: 'Uncategorized',
      children: ['Uncategorized'],
      isBareLeaf: true,
    });
  });

  it('treats a parent-named bare entry alongside Parent:Child as a non-leaf group', () => {
    const groups = buildCategoryGroups([
      txn('Operating Expenses'),
      txn('Operating Expenses:Rent'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].parent).toBe('Operating Expenses');
    expect(groups[0].isBareLeaf).toBe(false);
    expect(groups[0].children).toEqual(['Operating Expenses', 'Operating Expenses:Rent']);
  });

  it('dedupes repeated categories', () => {
    const groups = buildCategoryGroups([
      txn('Operating Expenses:Rent'),
      txn('Operating Expenses:Rent'),
      txn('Operating Expenses:Rent'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].children).toEqual(['Operating Expenses:Rent']);
  });

  it('ignores empty / whitespace-only category strings', () => {
    const groups = buildCategoryGroups([txn(''), txn('   ')]);
    expect(groups).toEqual([]);
  });

  it('sorts parents alphabetically, children alphabetically within each parent', () => {
    const groups = buildCategoryGroups([
      txn('Operating Expenses:Rent'),
      txn('Operating Expenses:Software'),
      txn('Business Income:Drop-ins'),
      txn('Business Income:Memberships'),
    ]);
    expect(groups.map((g) => g.parent)).toEqual(['Business Income', 'Operating Expenses']);
    expect(groups[0].children).toEqual(['Business Income:Drop-ins', 'Business Income:Memberships']);
    expect(groups[1].children).toEqual(['Operating Expenses:Rent', 'Operating Expenses:Software']);
  });
});

describe('categoryFilterMatches', () => {
  it('all mode matches every category', () => {
    expect(categoryFilterMatches({ mode: 'all' }, 'Anything')).toBe(true);
    expect(categoryFilterMatches({ mode: 'all' }, '')).toBe(true);
  });

  it('parent mode matches all categories under the same parent', () => {
    const filter: CategoryFilter = { mode: 'parent', parent: 'Operating Expenses' };
    expect(categoryFilterMatches(filter, 'Operating Expenses:Rent')).toBe(true);
    expect(categoryFilterMatches(filter, 'Operating Expenses:Software')).toBe(true);
    expect(categoryFilterMatches(filter, 'Business Income:Memberships')).toBe(false);
  });

  it('parent mode matches a bare category equal to the parent', () => {
    const filter: CategoryFilter = { mode: 'parent', parent: 'Uncategorized' };
    expect(categoryFilterMatches(filter, 'Uncategorized')).toBe(true);
  });

  it('exact mode matches only the literal category string', () => {
    const filter: CategoryFilter = { mode: 'exact', category: 'Operating Expenses:Rent' };
    expect(categoryFilterMatches(filter, 'Operating Expenses:Rent')).toBe(true);
    expect(categoryFilterMatches(filter, 'Operating Expenses:Software')).toBe(false);
  });
});

// The encoded values are passed through native <option value="..."> strings,
// so the round-trip has to survive arbitrary category content — including
// the colon that the Parent:Child convention uses.
describe('encodeCategory / decodeCategory round-trip', () => {
  it('round-trips the all sentinel', () => {
    expect(decodeCategory(encodeCategory({ mode: 'all' }))).toEqual({ mode: 'all' });
  });

  it('round-trips a parent filter', () => {
    const f: CategoryFilter = { mode: 'parent', parent: 'Operating Expenses' };
    expect(decodeCategory(encodeCategory(f))).toEqual(f);
  });

  it('round-trips an exact category containing the Parent:Child colon', () => {
    const f: CategoryFilter = { mode: 'exact', category: 'Operating Expenses:Rent' };
    expect(decodeCategory(encodeCategory(f))).toEqual(f);
  });

  it('decodes an empty string as the all sentinel', () => {
    expect(decodeCategory('')).toEqual({ mode: 'all' });
  });

  it('decodes an unknown tag back to all', () => {
    expect(decodeCategory('X|whatever')).toEqual({ mode: 'all' });
  });
});
