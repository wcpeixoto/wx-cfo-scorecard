// Right-side drawer that drills an Income & Expense bar down to the exact
// transactions behind it.
//
// Mirrors TopExpensesTransactionsDrawer's body UX (sort, search, account
// narrow, CSV export). Shell chrome comes from <DrawerShell>; the sortable
// table + footer + empty state come from <TransactionTable>. CSS prefix
// `ie-drawer-*` is preserved; the header (title, chart-anchored sum,
// Export) and the search/account controls stay in this file because they
// own the chart-displayed-value semantics.
//
// The source (computeIncomeExpenseRows) owns the math: it hands this drawer
// the contributing rows, each carrying its already-computed `contribution`.
// The drawer NEVER recomputes contribution, never calls revenueContribution
// /expenseContribution, and never knows cashFlowMode. The drawer header total
// is the chart's displayed value at the clicked bar — never re-summed from
// rows — so it reconciles to the bar the user clicked even on yearly windows
// (where the chart sums rounded monthly rollups). Once the user narrows, the
// header switches to the visible-row sum.
import { useMemo, useState } from 'react';
import type { IncomeExpenseRow } from '../lib/kpis/compute';
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
  side: 'income' | 'expense';
  rows: IncomeExpenseRow[];
  chartDisplayedValue: number;
  windowLabel: string;
  onClose: () => void;
}

export function IncomeExpenseTransactionsDrawer({
  side,
  rows,
  chartDisplayedValue,
  windowLabel,
  onClose,
}: Props) {
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' });

  const accountOptions = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((row) => {
      const name = row.txn.account?.trim();
      if (name) names.add(name);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Narrow by account + search, then order by the active column. The same
  // sorted list is what the table renders and what CSV export writes, so
  // display order and export order stay aligned.
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (accountFilter && row.txn.account?.trim() !== accountFilter) return false;
      if (!needle) return true;
      const haystack = [row.txn.payee, row.txn.memo, row.txn.category, row.txn.account]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    return filtered.slice().sort((a, b) => compareTransactionRows(a, b, sort));
  }, [rows, accountFilter, search, sort]);

  const isNarrowed = accountFilter !== '' || search.trim() !== '';
  const total = rows.length;
  const isEmpty = visibleRows.length === 0;

  // Header total: the chart's bar value when the drawer first opens (perfect
  // reconciliation with the clicked bar). Once narrowed, switch to the
  // visible-row sum so the figure reflects the active filter.
  const visibleSum = useMemo(
    () => round2(visibleRows.reduce((sum, row) => sum + row.contribution, 0)),
    [visibleRows],
  );
  const headerValue = isNarrowed ? visibleSum : chartDisplayedValue;

  const handleClear = () => {
    setAccountFilter('');
    setSearch('');
  };

  const handleSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));

  const sideLabel = side === 'income' ? 'Income' : 'Expense';
  const title = `${sideLabel} — ${windowLabel}`;
  const ariaLabel = `${sideLabel} transactions for ${windowLabel}`;

  const handleExport = () => {
    const slug = `${side}-${windowLabel}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || side;
    exportCsv({
      filename: `income-expense-${slug}.csv`,
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
      classPrefix="ie-drawer"
      ariaLabel={ariaLabel}
      onClose={onClose}
      panelAs="aside"
      panelDataState={isEmpty ? 'empty' : 'populated'}
    >
      <header className="ie-drawer-header">
          <div className="ie-drawer-titlerow">
            <h2 className="ie-drawer-title" title={title}>{title}</h2>
            <button className="ie-drawer-close" type="button" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="ie-drawer-summaryrow">
            <p className="ie-drawer-summary">
              <span className="ie-drawer-sum-num">{formatUsd(headerValue)}</span>
            </p>
            <button className="ie-drawer-btn" type="button" onClick={handleExport} disabled={isEmpty}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
          </div>
        </header>

        <div className="ie-drawer-controls">
          <div className="ie-drawer-search-field">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="ie-drawer-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Search transactions"
            />
          </div>
          <select
            className="ie-drawer-select"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            aria-label="Filter by account"
          >
            <option value="">All accounts</option>
            {accountOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button className="ie-drawer-btn" type="button" onClick={handleClear} disabled={!isNarrowed}>
            Clear
          </button>
        </div>

        <TransactionTable
          classPrefix="ie-drawer"
          rows={visibleRows}
          totalCount={total}
          isNarrowed={isNarrowed}
          sort={sort}
          onSort={handleSort}
        />
    </DrawerShell>
  );
}
