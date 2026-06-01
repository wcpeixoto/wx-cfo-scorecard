// Right-side drawer that drills a Top Expense Categories slice down to the
// exact transactions behind it (reconciled mode, Phase 1).
//
// Visual treatment follows the Claude Design "Transactions Drawer" spec: a
// 640px flex-column shell (fixed header + controls + footer; the table scrolls
// with a sticky header), a subtle count·sum verification line with Export in
// the header, sortable columns, and vendor name/memo truncation. The shell
// chrome (backdrop, Escape, dialog ARIA) lives in <DrawerShell>; this file
// keeps the `txn-drawer-*` CSS prefix and owns everything inside the panel
// (header, controls, table, footer).
//
// The source (computeExpenseSlicesWithRows) owns the math: it hands this drawer
// the contributing rows, each carrying its already-computed `contribution`. The
// drawer NEVER recomputes contribution, never calls expenseContribution, and
// never knows cashFlowMode. It renders, narrows, searches, sorts, exports, and
// sums what it is given — sorting only reorders the rows, never changes the set
// (so the reconciling sum holds).
import { useMemo, useState } from 'react';
import type { ExpenseSliceWithRows } from '../lib/kpis/compute';
import { DrawerShell } from './DrawerShell';

interface Props {
  slice: ExpenseSliceWithRows;
  onClose: () => void;
}

type SortKey = 'date' | 'vendor' | 'category' | 'account' | 'amount';
type SortDir = 'asc' | 'desc';

// Text columns read most naturally A→Z; date & amount most-recent / largest first.
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  date: 'desc',
  amount: 'desc',
  vendor: 'asc',
  category: 'asc',
  account: 'asc',
};

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'vendor', label: 'Vendor / Memo' },
  { key: 'category', label: 'Category' },
  { key: 'account', label: 'Account' },
  { key: 'amount', label: 'Amount' },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatUsd(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Quicken dates are 'YYYY-MM-DD'. Render as MM/DD/YY (compact, tabular). Parse
// the parts directly — never `new Date('YYYY-MM-DD')`, which parses as UTC and
// can shift a day.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(m)}/${pad(d)}/${pad(y % 100)}`;
}

// Vendor primary line = payee, falling back to the memo when there's no payee.
const vendorName = (payee?: string, memo?: string): string => payee?.trim() || memo?.trim() || '';
// Memo second line — only when it's distinct from the name above it.
const vendorMemoLine = (payee?: string, memo?: string): string =>
  payee?.trim() && memo?.trim() ? memo.trim() : '';
// CSV "Vendor / Memo" cell stays the joined form for a faithful export.
const vendorMemo = (payee?: string, memo?: string): string =>
  [payee?.trim(), memo?.trim()].filter(Boolean).join(' — ');

// CSV cell: quote when the value contains a comma, quote, or newline; escape
// embedded quotes by doubling them.
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function SortIcon() {
  return (
    <svg className="txn-drawer-sort-ico" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path className="ic-up" d="M8 3.2 11.2 7H4.8z" />
      <path className="ic-dn" d="M8 12.8 4.8 9h6.4z" />
    </svg>
  );
}

export function TopExpensesTransactionsDrawer({ slice, onClose }: Props) {
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });

  // Account dropdown options = accounts actually present in this slice's rows.
  // The slice is a P&L-domain number computed from all accounts, so we narrow
  // within the slice itself rather than against a global included-account list.
  const accountOptions = useMemo(() => {
    const names = new Set<string>();
    slice.rows.forEach((row) => {
      const name = row.txn.account?.trim();
      if (name) names.add(name);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [slice.rows]);

  // Visible rows: narrow by account + search, then order by the active column.
  // Sorting is a pure display concern over the rows the source supplied — the
  // set never changes (only the order), so the reconciling sum is unaffected.
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = slice.rows.filter((row) => {
      if (accountFilter && row.txn.account?.trim() !== accountFilter) return false;
      if (!needle) return true;
      const haystack = [row.txn.payee, row.txn.memo, row.txn.category, row.txn.account]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      let c = 0;
      switch (sort.key) {
        case 'amount':
          c = a.txn.rawAmount - b.txn.rawAmount;
          break;
        case 'date':
          // YYYY-MM-DD sorts lexically === chronologically.
          c = a.txn.date.localeCompare(b.txn.date);
          break;
        case 'vendor':
          c = vendorName(a.txn.payee, a.txn.memo).toLowerCase()
            .localeCompare(vendorName(b.txn.payee, b.txn.memo).toLowerCase());
          break;
        case 'category':
          c = (a.txn.category ?? '').toLowerCase().localeCompare((b.txn.category ?? '').toLowerCase());
          break;
        case 'account':
          c = (a.txn.account ?? '').toLowerCase().localeCompare((b.txn.account ?? '').toLowerCase());
          break;
      }
      return c * dir;
    });
  }, [slice.rows, accountFilter, search, sort]);

  // Header sum is the contribution total over the VISIBLE rows — a pure sum of
  // the values the source supplied, no recomputation. On first open it equals
  // slice.value; once narrowed (not sorted) it diverges by design.
  const visibleSum = useMemo(
    () => round2(visibleRows.reduce((sum, row) => sum + row.contribution, 0)),
    [visibleRows]
  );

  const isNarrowed = accountFilter !== '' || search.trim() !== '';
  const total = slice.rows.length;
  const isEmpty = visibleRows.length === 0;

  const handleClear = () => {
    setAccountFilter('');
    setSearch('');
  };

  const handleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: DEFAULT_DIR[key] }
    );
  };

  // Export the currently visible rows and visible columns only. Amount is the
  // raw signed numeric (txn.rawAmount), not the formatted string — no total row.
  const handleExport = () => {
    const headers = ['Date', 'Vendor / Memo', 'Category', 'Account', 'Amount'];
    const lines = [headers.join(',')];
    visibleRows.forEach((row) => {
      const cells = [
        row.txn.date,
        vendorMemo(row.txn.payee, row.txn.memo),
        row.txn.category ?? '',
        row.txn.account ?? '',
        String(row.txn.rawAmount),
      ];
      lines.push(cells.map(csvCell).join(','));
    });
    const slug = slice.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'slice';
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `top-expenses-${slug}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DrawerShell
      classPrefix="txn-drawer"
      ariaLabel={`${slice.name} transactions`}
      onClose={onClose}
      panelAs="aside"
      panelDataState={isEmpty ? 'empty' : 'populated'}
    >
      {/* ── Header: slice title + close, then the subtle count·sum + Export ── */}
        <header className="txn-drawer-header">
          <div className="txn-drawer-titlerow">
            <h2 className="txn-drawer-title" title={slice.name}>{slice.name}</h2>
            <button className="txn-drawer-close" type="button" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="txn-drawer-summaryrow">
            {/* Verification total — the slice's sum. The transaction count lives
                in the footer, so the header carries just the dollar figure. */}
            <p className="txn-drawer-summary">
              <span className="txn-drawer-sum-num">{formatUsd(visibleSum)}</span>
            </p>
            <button className="txn-drawer-btn" type="button" onClick={handleExport} disabled={isEmpty}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
          </div>
        </header>

        {/* ── Controls: search + account narrow + clear ── */}
        <div className="txn-drawer-controls">
          <div className="txn-drawer-search-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="txn-drawer-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Search transactions"
            />
          </div>
          <select
            className="txn-drawer-select"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            aria-label="Filter by account"
          >
            <option value="">All accounts</option>
            {accountOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button className="txn-drawer-btn" type="button" onClick={handleClear} disabled={!isNarrowed}>
            Clear
          </button>
        </div>

        {/* ── Body: transactions table, or the empty state ── */}
        {isEmpty ? (
          <div className="txn-drawer-empty">
            <div className="txn-drawer-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </div>
            <p className="txn-drawer-empty-primary">No transactions found for this filter.</p>
            <p className="txn-drawer-empty-secondary">Try changing the account or clearing the search.</p>
          </div>
        ) : (
          <>
            <div className="txn-drawer-body">
              <table className="txn-drawer-table">
                <colgroup>
                  <col className="txn-drawer-col-date" />
                  <col className="txn-drawer-col-vendor" />
                  <col className="txn-drawer-col-category" />
                  <col className="txn-drawer-col-account" />
                  <col className="txn-drawer-col-amount" />
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => {
                      const active = sort.key === col.key;
                      return (
                        <th
                          key={col.key}
                          className={`txn-drawer-th${active ? ` is-sorted dir-${sort.dir}` : ''}`}
                          aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <button className="txn-drawer-th-sort" type="button" onClick={() => handleSort(col.key)}>
                            {col.label}
                            <SortIcon />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, i) => {
                    const name = vendorName(row.txn.payee, row.txn.memo) || '—';
                    const memoLine = vendorMemoLine(row.txn.payee, row.txn.memo);
                    return (
                      <tr key={row.txn.id || i}>
                        <td className="txn-drawer-td-date">{formatDate(row.txn.date)}</td>
                        <td className="txn-drawer-td-vendor">
                          <span className="txn-drawer-vname" title={name}>{name}</span>
                          {memoLine && <span className="txn-drawer-memo" title={memoLine}>{memoLine}</span>}
                        </td>
                        <td>{row.txn.category || '—'}</td>
                        <td>{row.txn.account || '—'}</td>
                        <td className={`txn-drawer-td-amount${row.txn.rawAmount > 0 ? ' txn-drawer-amount--credit' : ''}`}>
                          {formatUsd(row.txn.rawAmount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="txn-drawer-foot">
              {isNarrowed
                ? `Showing ${visibleRows.length} of ${total}`
                : `Showing all ${total} transaction${total === 1 ? '' : 's'}`}
            </div>
          </>
        )}
    </DrawerShell>
  );
}
