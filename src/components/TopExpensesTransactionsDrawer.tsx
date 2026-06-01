// Right-side drawer that drills a Top Expense Categories slice down to the
// exact transactions behind it (reconciled mode, Phase 1).
//
// Visual treatment follows the Claude Design "Transactions Drawer" spec: a
// 640px flex-column shell (fixed header + controls + footer; the table scrolls
// with a sticky header), a subtle count·sum verification line with Export in
// the header, sortable columns, and vendor name/memo truncation. The shell
// chrome lives in <DrawerShell>; the sortable table + footer + empty state
// live in <TransactionTable>. This file owns the slice-specific bits: header,
// account/search controls, and the contribution sum.
//
// The source (computeExpenseSlicesWithRows) owns the math: it hands this drawer
// the contributing rows, each carrying its already-computed `contribution`. The
// drawer NEVER recomputes contribution, never calls expenseContribution, and
// never knows cashFlowMode. It narrows, sorts, sums, and hands the result to
// the table (the table is purely presentational). Sorting only reorders rows,
// never changes the set — so the reconciling sum holds, and CSV export uses
// the same ordered list the table renders.
import { useMemo, useState } from 'react';
import type { ExpenseSliceWithRows } from '../lib/kpis/compute';
import { DrawerShell } from './DrawerShell';
import {
  TransactionTable,
  compareTransactionRows,
  formatUsd,
  nextSort,
  round2,
  vendorMemo,
  type SortKey,
  type SortState,
} from './TransactionTable';
import { exportCsv } from '../lib/csvExport';

interface Props {
  slice: ExpenseSliceWithRows;
  onClose: () => void;
}

export function TopExpensesTransactionsDrawer({ slice, onClose }: Props) {
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' });

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
  // The same sorted list is what the table renders and what CSV export writes,
  // so display order and export order stay aligned.
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
    return filtered.slice().sort((a, b) => compareTransactionRows(a, b, sort));
  }, [slice.rows, accountFilter, search, sort]);

  // Header sum is the contribution total over the VISIBLE rows — a pure sum of
  // the values the source supplied, no recomputation. On first open it equals
  // slice.value; once narrowed it diverges by design.
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

  const handleSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));

  // Export the currently visible rows and visible columns only. Amount is the
  // raw signed numeric (txn.rawAmount), not the formatted string — no total row.
  const handleExport = () => {
    const slug = slice.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'slice';
    exportCsv({
      filename: `top-expenses-${slug}.csv`,
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

        {/* ── Body: sortable table + footer, or the empty state ── */}
        <TransactionTable
          classPrefix="txn-drawer"
          rows={visibleRows}
          totalCount={total}
          isNarrowed={isNarrowed}
          sort={sort}
          onSort={handleSort}
        />
    </DrawerShell>
  );
}
