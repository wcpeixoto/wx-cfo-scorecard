// Right-side drawer opened by the header "See Transactions" button. Owns its
// own period window, search, account filter, and category filter. The fourth
// drawer-style surface to reuse <DrawerShell> + <TransactionTable> + exportCsv.
//
// PR2: timeframe options are LITERAL WALL-CLOCK windows — Last 7 Days
// (default), This Month, Last Month, Year to Date, Last 12 Months, Custom
// Range. The data-anchored "latest completed month" default from PR1 was
// owner-authorized to be reversed here because PR2 ships an honest empty
// state for stale-data days: when the active window has no imported
// transactions, the drawer surfaces the latest activity date plus a
// "Jump to latest" CTA that snaps to the natural window containing the
// latest transaction (This/Last Month if it aligns with the wall clock;
// otherwise Custom Range over that month).
//
// A nested Parent:Child category dropdown lets the owner filter to a parent
// group ("All Operating Expenses") or one exact child category, using the
// existing colon convention on `txn.category`. The dropdown is intentionally
// drawer-local — not promoted to a shared primitive — to keep this surface
// the only consumer until a second case actually appears.
//
// Unlike the slice-derived drawers (Top Expenses, Income & Expense), this
// one owns its own period window — there's no chart bar or donut slice
// anchoring the row set. The header total is the sum of currently visible
// rows.
import { useMemo, useState } from 'react';
import type { Txn } from '../lib/data/contract';
import { parentCategoryName } from '../lib/cashFlow';
import { DrawerShell } from './DrawerShell';
import {
  TransactionTable,
  compareTransactionRows,
  formatDate,
  formatUsd,
  nextSort,
  round2,
  vendorMemo,
  type SortKey,
  type SortState,
} from './TransactionTable';
import { exportCsv } from '../lib/csvExport';

export type Period =
  | 'last7Days'
  | 'thisMonth'
  | 'lastMonth'
  | 'ytd'
  | 'last12Months'
  | 'custom';

interface PeriodOption {
  value: Period;
  label: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: 'last7Days', label: 'Last 7 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'last12Months', label: 'Last 12 Months' },
  { value: 'custom', label: 'Custom Range' },
];

const DEFAULT_PERIOD: Period = 'last7Days';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Date helpers ────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

function isoDate(year: number, month1: number, day: number): string {
  return `${year}-${pad2(month1)}-${pad2(day)}`;
}

// Last day of the given calendar month (1-indexed). Day 0 of the next month
// resolves to the last day of the requested one.
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

// "YYYY-MM" → human "Month YYYY". Falls back to the raw token if malformed.
function monthLabel(token: string): string {
  const [y, m] = token.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return token;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Wall-clock "today" as "YYYY-MM-DD" (local time).
function todayIso(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// Shift "YYYY-MM-DD" by N days. Local-time arithmetic so DST transitions
// don't bump days by an hour.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

// Shift "YYYY-MM" by N months.
function shiftMonth(token: string, delta: number): string {
  const [y, m] = token.split('-').map(Number);
  const zeroBased = y * 12 + (m - 1) + delta;
  const ny = Math.floor(zeroBased / 12);
  const nm = (zeroBased % 12 + 12) % 12 + 1;
  return `${ny}-${pad2(nm)}`;
}

interface PeriodRange {
  start: string;
  end: string;
}

interface CustomRange {
  start: string;
  end: string;
}

// Resolve the inclusive ISO window for a wall-clock period. `today` is pinned
// once on mount; `custom` only matters when period === 'custom'.
export function resolvePeriodRange(period: Period, today: string, custom: CustomRange): PeriodRange {
  const [ty, tm] = today.split('-').map(Number);
  switch (period) {
    case 'last7Days':
      // Inclusive 7 days ending today (today + 6 prior days).
      return { start: addDaysIso(today, -6), end: today };
    case 'thisMonth':
      return { start: isoDate(ty, tm, 1), end: today };
    case 'lastMonth': {
      const prev = shiftMonth(`${ty}-${pad2(tm)}`, -1);
      const [py, pm] = prev.split('-').map(Number);
      return {
        start: isoDate(py, pm, 1),
        end: isoDate(py, pm, lastDayOfMonth(py, pm)),
      };
    }
    case 'ytd':
      return { start: isoDate(ty, 1, 1), end: today };
    case 'last12Months': {
      // 12 calendar months ending in (and including) the current one.
      const start = shiftMonth(`${ty}-${pad2(tm)}`, -11);
      const [sy, sm] = start.split('-').map(Number);
      return { start: isoDate(sy, sm, 1), end: today };
    }
    case 'custom':
      return { start: custom.start, end: custom.end };
  }
}

// Short label for the active range — used in the CSV filename slug. The
// month-named presets (This/Last Month) name the concrete month so the
// exported file is self-documenting.
function formatRangeLabel(period: Period, range: PeriodRange): string {
  switch (period) {
    case 'last7Days':
      return 'Last 7 Days';
    case 'thisMonth':
    case 'lastMonth': {
      const [y, m] = range.start.split('-').map(Number);
      return monthLabel(`${y}-${pad2(m)}`);
    }
    case 'ytd':
      return 'Year to Date';
    case 'last12Months':
      return 'Last 12 Months';
    case 'custom':
      return `${range.start} to ${range.end}`;
  }
}

// ─── Category filter ─────────────────────────────────────────────────────────

export type CategoryFilter =
  | { mode: 'all' }
  | { mode: 'parent'; parent: string }
  | { mode: 'exact'; category: string };

// `<option>` value strings encode the filter shape. The delimiter is the
// ASCII Unit Separator (0x1F), which won't appear in category strings.
const CATEGORY_DELIM = '';
const CATEGORY_PARENT = 'P';
const CATEGORY_EXACT = 'E';

export function encodeCategory(filter: CategoryFilter): string {
  if (filter.mode === 'all') return '';
  if (filter.mode === 'parent') return `${CATEGORY_PARENT}${CATEGORY_DELIM}${filter.parent}`;
  return `${CATEGORY_EXACT}${CATEGORY_DELIM}${filter.category}`;
}

export function decodeCategory(value: string): CategoryFilter {
  if (!value) return { mode: 'all' };
  const idx = value.indexOf(CATEGORY_DELIM);
  if (idx === -1) return { mode: 'all' };
  const tag = value.slice(0, idx);
  const payload = value.slice(idx + 1);
  if (tag === CATEGORY_PARENT) return { mode: 'parent', parent: payload };
  if (tag === CATEGORY_EXACT) return { mode: 'exact', category: payload };
  return { mode: 'all' };
}

interface CategoryGroup {
  parent: string;
  /** Exact category strings under this parent, sorted alphabetically. */
  children: string[];
  /** True when the group has a single child equal to the parent name (bare
   *  category with no ":"). Rendered as a standalone option instead of an
   *  optgroup so the "All [Parent]" synthetic entry isn't redundant. */
  isBareLeaf: boolean;
}

export function buildCategoryGroups(txns: Txn[]): CategoryGroup[] {
  const byParent = new Map<string, Set<string>>();
  for (const txn of txns) {
    const cat = txn.category?.trim();
    if (!cat) continue;
    const parent = parentCategoryName(cat);
    if (!byParent.has(parent)) byParent.set(parent, new Set());
    byParent.get(parent)!.add(cat);
  }
  const groups: CategoryGroup[] = [];
  for (const [parent, set] of byParent) {
    const children = [...set].sort((a, b) => a.localeCompare(b));
    const isBareLeaf = children.length === 1 && children[0] === parent;
    groups.push({ parent, children, isBareLeaf });
  }
  return groups.sort((a, b) => a.parent.localeCompare(b.parent));
}

export function categoryFilterMatches(filter: CategoryFilter, category: string): boolean {
  if (filter.mode === 'all') return true;
  if (filter.mode === 'parent') return parentCategoryName(category) === filter.parent;
  return category === filter.category;
}

// Strip the parent prefix from a category for the dropdown label, e.g.
// "Operating Expenses:Software" → "Software". Bare categories stay intact.
function categoryShortLabel(category: string): string {
  const idx = category.indexOf(':');
  if (idx === -1) return category.trim();
  return category.slice(idx + 1).trim() || category.trim();
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  /** The full transaction set. The drawer narrows by period in-component. */
  txns: Txn[];
  onClose: () => void;
}

export function TransactionSearchDrawer({ txns, onClose }: Props) {
  // "Today" pinned on mount — short-lived drawer; we don't try to handle
  // midnight rollovers while it's open.
  const today = useMemo(() => todayIso(), []);

  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [customRange, setCustomRange] = useState<CustomRange>(() => ({
    start: addDaysIso(today, -6),
    end: today,
  }));
  const [search, setSearch] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>({ mode: 'all' });
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' });

  const range = useMemo(
    () => resolvePeriodRange(period, today, customRange),
    [period, today, customRange],
  );
  const rangeLabel = useMemo(() => formatRangeLabel(period, range), [period, range]);

  // Pool to narrow over — every txn within the active period window.
  const periodTxns = useMemo(
    () => txns.filter((txn) => txn.date >= range.start && txn.date <= range.end),
    [txns, range.start, range.end],
  );

  // Latest txn date across the full pool (not the active window) — drives the
  // Jump-to-Latest behaviour and the empty-state metadata line.
  const latestTxnDate = useMemo(() => {
    let latest: string | null = null;
    for (const txn of txns) {
      const d = txn.date;
      if (!d) continue;
      if (latest === null || d > latest) latest = d;
    }
    return latest;
  }, [txns]);

  const accountOptions = useMemo(() => {
    const names = new Set<string>();
    periodTxns.forEach((txn) => {
      const name = txn.account?.trim();
      if (name) names.add(name);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [periodTxns]);

  const categoryGroups = useMemo(() => buildCategoryGroups(periodTxns), [periodTxns]);

  // Narrow by account + category + search, then order by the active column.
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = periodTxns.filter((txn) => {
      if (accountFilter && txn.account?.trim() !== accountFilter) return false;
      if (!categoryFilterMatches(categoryFilter, txn.category ?? '')) return false;
      if (!needle) return true;
      const haystack = [txn.payee, txn.memo, txn.category, txn.account]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    const rows = filtered.map((txn) => ({ txn }));
    return rows.slice().sort((a, b) => compareTransactionRows(a, b, sort));
  }, [periodTxns, accountFilter, categoryFilter, search, sort]);

  // "Narrowed within the period" drives the table footer's "Showing X of Y"
  // copy — only the in-window narrows count, not the period selection itself.
  const isNarrowedWithinPeriod =
    accountFilter !== '' ||
    search.trim() !== '' ||
    categoryFilter.mode !== 'all';

  // Clear is enabled whenever any of the four PR2 defaults are non-default.
  const isClearable = isNarrowedWithinPeriod || period !== DEFAULT_PERIOD;

  const isPeriodEmpty = periodTxns.length === 0;
  const hasAnyTxns = txns.length > 0;
  const total = periodTxns.length;
  const isEmpty = visibleRows.length === 0;

  const visibleSum = useMemo(
    () => round2(visibleRows.reduce((sum, row) => sum + row.txn.rawAmount, 0)),
    [visibleRows],
  );

  // Title is always the plain noun — the active window is conveyed by the
  // timeframe dropdown, not the title. `rangeLabel` still drives the CSV slug.
  const title = 'Transactions';
  const ariaLabel = 'Transactions';

  const handleClear = () => {
    setAccountFilter('');
    setSearch('');
    setCategoryFilter({ mode: 'all' });
    setPeriod(DEFAULT_PERIOD);
  };

  const handleSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));

  const handlePeriodChange = (next: Period) => {
    if (next === 'custom' && period !== 'custom') {
      // Carry the currently-resolved range into the date inputs so switching
      // to Custom feels like "now editable" rather than a hard reset.
      setCustomRange({ start: range.start, end: range.end });
    }
    setPeriod(next);
  };

  // Snap to the natural window containing the latest imported transaction.
  // Promotes to thisMonth or lastMonth when that month aligns with the wall
  // clock; otherwise falls back to a Custom Range covering the latest month.
  const handleJumpToLatest = () => {
    if (!latestTxnDate) return;
    const [ly, lm] = latestTxnDate.split('-').map(Number);
    const [ty, tm] = today.split('-').map(Number);
    if (ly === ty && lm === tm) {
      setPeriod('thisMonth');
      return;
    }
    const prev = shiftMonth(`${ty}-${pad2(tm)}`, -1);
    const [py, pm] = prev.split('-').map(Number);
    if (ly === py && lm === pm) {
      setPeriod('lastMonth');
      return;
    }
    setCustomRange({
      start: isoDate(ly, lm, 1),
      end: isoDate(ly, lm, lastDayOfMonth(ly, lm)),
    });
    setPeriod('custom');
  };

  const handleCustomStart = (value: string) =>
    setCustomRange((prev) => ({ ...prev, start: value }));
  const handleCustomEnd = (value: string) =>
    setCustomRange((prev) => ({ ...prev, end: value }));

  const handleCategoryChange = (value: string) => setCategoryFilter(decodeCategory(value));

  const handleExport = () => {
    const slug = rangeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'transactions';
    exportCsv({
      filename: `transactions-${slug}.csv`,
      headers: ['Date', 'Vendor / Memo', 'Category', 'Account', 'Amount'],
      rows: visibleRows.map((row) => [
        row.txn.date,
        vendorMemo(row.txn.payee, row.txn.memo),
        row.txn.category ?? '',
        row.txn.account ?? '',
        String(row.txn.rawAmount),
      ]),
    });
  };

  const categorySelectValue = encodeCategory(categoryFilter);

  return (
    <DrawerShell
      classPrefix="txn-search-drawer"
      ariaLabel={ariaLabel}
      onClose={onClose}
      panelAs="aside"
      panelDataState={isEmpty ? 'empty' : 'populated'}
    >
      <header className="txn-search-drawer-header">
        <div className="txn-search-drawer-titlerow">
          <h2 className="txn-search-drawer-title">{title}</h2>
          <button className="txn-search-drawer-close" type="button" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p className="txn-search-drawer-summary">
          {visibleRows.length} transaction{visibleRows.length === 1 ? '' : 's'}
          <span className="txn-search-drawer-sum-sep" aria-hidden="true">·</span>
          <span className="txn-search-drawer-sum-num">{formatUsd(visibleSum)}</span>
        </p>
        <div className="txn-search-drawer-headeractions">
          <div className="txn-search-drawer-search-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="txn-search-drawer-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Search transactions"
            />
          </div>
          <button className="txn-search-drawer-btn" type="button" onClick={handleExport} disabled={isEmpty}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        </div>
      </header>

      <div className="txn-search-drawer-controls">
        <select
          className="txn-search-drawer-select txn-search-drawer-select--period"
          value={period}
          onChange={(e) => handlePeriodChange(e.target.value as Period)}
          aria-label="Timeframe"
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          className="txn-search-drawer-select txn-search-drawer-select--category"
          value={categorySelectValue}
          onChange={(e) => handleCategoryChange(e.target.value)}
          aria-label="Filter by category"
          disabled={categoryGroups.length === 0}
        >
          <option value="">All categories</option>
          {categoryGroups.map((group) => {
            if (group.isBareLeaf) {
              return (
                <option
                  key={group.parent}
                  value={`${CATEGORY_EXACT}${CATEGORY_DELIM}${group.children[0]}`}
                >
                  {group.parent}
                </option>
              );
            }
            return (
              <optgroup key={group.parent} label={group.parent}>
                <option value={`${CATEGORY_PARENT}${CATEGORY_DELIM}${group.parent}`}>
                  All {group.parent}
                </option>
                {group.children.map((cat) => (
                  <option key={cat} value={`${CATEGORY_EXACT}${CATEGORY_DELIM}${cat}`}>
                    {categoryShortLabel(cat)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <select
          className="txn-search-drawer-select txn-search-drawer-select--account"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {accountOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button className="txn-search-drawer-btn" type="button" onClick={handleClear} disabled={!isClearable}>
          Clear
        </button>
      </div>

      {period === 'custom' && (
        <div className="txn-search-drawer-custom-range" aria-label="Custom date range">
          <input
            className="txn-search-drawer-date"
            type="date"
            value={customRange.start}
            onChange={(e) => handleCustomStart(e.target.value)}
            aria-label="Start date"
          />
          <span className="txn-search-drawer-custom-sep" aria-hidden="true">to</span>
          <input
            className="txn-search-drawer-date"
            type="date"
            value={customRange.end}
            onChange={(e) => handleCustomEnd(e.target.value)}
            aria-label="End date"
          />
        </div>
      )}

      {isPeriodEmpty ? (
        <div className="txn-search-drawer-empty">
          <div className="txn-search-drawer-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </div>
          {hasAnyTxns && latestTxnDate ? (
            <>
              <p className="txn-search-drawer-empty-primary">No transactions in this window.</p>
              <p className="txn-search-drawer-empty-meta">
                Latest activity:{' '}
                <span className="txn-search-drawer-empty-meta-date">{formatDate(latestTxnDate)}</span>
              </p>
              <button
                type="button"
                className="txn-search-drawer-btn txn-search-drawer-empty-cta"
                onClick={handleJumpToLatest}
              >
                Jump to latest
              </button>
            </>
          ) : (
            <>
              <p className="txn-search-drawer-empty-primary">No transactions imported yet.</p>
              <p className="txn-search-drawer-empty-secondary">
                Use the Settings page to import transactions.
              </p>
            </>
          )}
        </div>
      ) : (
        <TransactionTable
          classPrefix="txn-search-drawer"
          rows={visibleRows}
          totalCount={total}
          isNarrowed={isNarrowedWithinPeriod}
          sort={sort}
          onSort={handleSort}
          emptyPrimary="No matching transactions for these filters."
          emptySecondary="Try clearing the search, account, or category."
        />
      )}
    </DrawerShell>
  );
}
