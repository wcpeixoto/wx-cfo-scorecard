import { describe, expect, it } from 'vitest';
import type { Txn } from '../lib/data/contract';
import {
  buildCategoryGroups,
  categoryFilterMatches,
  decodeCategory,
  encodeCategory,
  formatWindowLabel,
  rangeSubtitle,
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

  // A custom range with one side blank is opened on that side, so a single
  // date entered behaves consistently ("from X onward" / "up to Y") instead of
  // the asymmetric all-vs-nothing a bare lexical compare produced pre-fix.
  it('opens the start bound when the custom start is blank', () => {
    expect(resolvePeriodRange('custom', today, { start: '', end: '2026-04-30' })).toEqual({
      start: '0000-01-01',
      end: '2026-04-30',
    });
  });

  it('opens the end bound when the custom end is blank', () => {
    expect(resolvePeriodRange('custom', today, { start: '2026-04-01', end: '' })).toEqual({
      start: '2026-04-01',
      end: '9999-12-31',
    });
  });

  it('opens both bounds when the custom range is empty', () => {
    expect(resolvePeriodRange('custom', today, { start: '', end: '' })).toEqual({
      start: '0000-01-01',
      end: '9999-12-31',
    });
  });
});

// ─── Concrete-dates window label + subtitle ─────────────────────────────────

describe('formatWindowLabel', () => {
  it('collapses a full calendar month to "Mon YYYY"', () => {
    expect(formatWindowLabel('2026-04-01', '2026-04-30')).toBe('Apr 2026');
  });

  it('collapses a leap-year February (29 days) to the month label', () => {
    expect(formatWindowLabel('2024-02-01', '2024-02-29')).toBe('Feb 2024');
  });

  it('does NOT collapse a near-full month that stops short of the last day', () => {
    expect(formatWindowLabel('2026-04-01', '2026-04-29')).toBe('Apr 1 – 29, 2026');
  });

  it('renders a single day', () => {
    expect(formatWindowLabel('2026-06-01', '2026-06-01')).toBe('Jun 1, 2026');
  });

  it('renders a same-year cross-month range', () => {
    expect(formatWindowLabel('2026-05-26', '2026-06-01')).toBe('May 26 – Jun 1, 2026');
  });

  it('renders a cross-year range with both years', () => {
    expect(formatWindowLabel('2025-07-01', '2026-06-01')).toBe('Jul 1, 2025 – Jun 1, 2026');
  });

  it('reads an open end bound as "From … onward"', () => {
    expect(formatWindowLabel('2026-04-01', '9999-12-31')).toBe('From Apr 1, 2026 onward');
  });

  it('reads an open start bound as "Through …"', () => {
    expect(formatWindowLabel('0000-01-01', '2026-04-30')).toBe('Through Apr 30, 2026');
  });

  it('reads both bounds open as "All dates"', () => {
    expect(formatWindowLabel('0000-01-01', '9999-12-31')).toBe('All dates');
  });
});

describe('rangeSubtitle', () => {
  it('names the month for This Month even when the window is only month-to-date', () => {
    expect(rangeSubtitle('thisMonth', { start: '2026-06-01', end: '2026-06-01' })).toBe('Jun 2026');
    expect(rangeSubtitle('thisMonth', { start: '2026-06-01', end: '2026-06-15' })).toBe('Jun 2026');
  });

  it('names the month for Last Month', () => {
    expect(rangeSubtitle('lastMonth', { start: '2026-05-01', end: '2026-05-31' })).toBe('May 2026');
  });

  it('shows concrete dates for Last 7 Days', () => {
    expect(rangeSubtitle('last7Days', { start: '2026-05-26', end: '2026-06-01' })).toBe('May 26 – Jun 1, 2026');
  });

  it('shows concrete dates for YTD', () => {
    expect(rangeSubtitle('ytd', { start: '2026-01-01', end: '2026-06-01' })).toBe('Jan 1 – Jun 1, 2026');
  });

  it('shows concrete dates for Last 12 Months', () => {
    expect(rangeSubtitle('last12Months', { start: '2025-07-01', end: '2026-06-01' })).toBe('Jul 1, 2025 – Jun 1, 2026');
  });

  it('collapses a Jump-to-Latest custom month window to "Mon YYYY"', () => {
    expect(rangeSubtitle('custom', { start: '2026-04-01', end: '2026-04-30' })).toBe('Apr 2026');
  });

  it('shows a compact range for a non-month custom window', () => {
    expect(rangeSubtitle('custom', { start: '2026-04-01', end: '2026-04-29' })).toBe('Apr 1 – 29, 2026');
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
