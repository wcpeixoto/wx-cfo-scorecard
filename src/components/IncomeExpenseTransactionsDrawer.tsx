// Right-side drawer that drills an Income & Expense bar down to the exact
// transactions behind it.
//
// Mirrors TopExpensesTransactionsDrawer's UX (sort, search, account narrow,
// CSV export, ESC/backdrop close) but keeps its own `ie-drawer-*` prefix and
// lives in its own file. With Efficiency, Projection-Compare, Top-Expenses,
// and this drawer, we now have a fourth surface — close enough to revisit
// extraction, but locked: copy-with-new-prefix stays, no shared <Drawer>
// primitive yet.
//
// The source (computeIncomeExpenseRows) owns the math: it hands this drawer
// the contributing rows, each carrying its already-computed `contribution`.
// The drawer NEVER recomputes contribution, never calls revenueContribution
// /expenseContribution, and never knows cashFlowMode. The drawer header total
// is the chart's displayed value at the clicked bar — never re-summed from
// rows — so it reconciles to the bar the user clicked even on yearly windows
// (where the chart sums rounded monthly rollups). Once the user narrows, the
// header switches to the visible-row sum.
import { useEffect, useMemo, useState } from 'react';
import type { IncomeExpenseRow } from '../lib/kpis/compute';

interface Props {
  side: 'income' | 'expense';
  rows: IncomeExpenseRow[];
  chartDisplayedValue: number;
  windowLabel: string;
  onClose: () => void;
}

type SortKey = 'date' | 'vendor' | 'category' | 'account' | 'amount';
type SortDir = 'asc' | 'desc';

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

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(m)}/${pad(d)}/${pad(y % 100)}`;
}

const vendorName = (payee?: string, memo?: string): string => payee?.trim() || memo?.trim() || '';
const vendorMemoLine = (payee?: string, memo?: string): string =>
  payee?.trim() && memo?.trim() ? memo.trim() : '';
const vendorMemo = (payee?: string, memo?: string): string =>
  [payee?.trim(), memo?.trim()].filter(Boolean).join(' — ');

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function SortIcon() {
  return (
    <svg className="ie-drawer-sort-ico" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path className="ic-up" d="M8 3.2 11.2 7H4.8z" />
      <path className="ic-dn" d="M8 12.8 4.8 9h6.4z" />
    </svg>
  );
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
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const accountOptions = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((row) => {
      const name = row.txn.account?.trim();
      if (name) names.add(name);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [rows]);

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
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      let c = 0;
      switch (sort.key) {
        case 'amount':
          c = a.txn.rawAmount - b.txn.rawAmount;
          break;
        case 'date':
          c = a.txn.date.localeCompare(b.txn.date);
          break;
        case 'vendor':
          c = vendorName(a.txn.payee, a.txn.memo)
            .toLowerCase()
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

  const handleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: DEFAULT_DIR[key] },
    );
  };

  const sideLabel = side === 'income' ? 'Income' : 'Expense';
  const title = `${sideLabel} — ${windowLabel}`;
  const ariaLabel = `${sideLabel} transactions for ${windowLabel}`;

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
    const slug = `${side}-${windowLabel}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || side;
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `income-expense-${slug}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ie-drawer-backdrop" onClick={handleBackdropClick}>
      <aside
        className="ie-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        data-state={isEmpty ? 'empty' : 'populated'}
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

        {isEmpty ? (
          <div className="ie-drawer-empty">
            <div className="ie-drawer-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </div>
            <p className="ie-drawer-empty-primary">No transactions found for this filter.</p>
            <p className="ie-drawer-empty-secondary">Try changing the account or clearing the search.</p>
          </div>
        ) : (
          <>
            <div className="ie-drawer-body">
              <table className="ie-drawer-table">
                <colgroup>
                  <col className="ie-drawer-col-date" />
                  <col className="ie-drawer-col-vendor" />
                  <col className="ie-drawer-col-category" />
                  <col className="ie-drawer-col-account" />
                  <col className="ie-drawer-col-amount" />
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => {
                      const active = sort.key === col.key;
                      return (
                        <th
                          key={col.key}
                          className={`ie-drawer-th${active ? ` is-sorted dir-${sort.dir}` : ''}`}
                          aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <button className="ie-drawer-th-sort" type="button" onClick={() => handleSort(col.key)}>
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
                        <td className="ie-drawer-td-date">{formatDate(row.txn.date)}</td>
                        <td className="ie-drawer-td-vendor">
                          <span className="ie-drawer-vname" title={name}>{name}</span>
                          {memoLine && <span className="ie-drawer-memo" title={memoLine}>{memoLine}</span>}
                        </td>
                        <td>{row.txn.category || '—'}</td>
                        <td>{row.txn.account || '—'}</td>
                        <td className={`ie-drawer-td-amount${row.txn.rawAmount > 0 ? ' ie-drawer-amount--credit' : ''}`}>
                          {formatUsd(row.txn.rawAmount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ie-drawer-foot">
              {isNarrowed
                ? `Showing ${visibleRows.length} of ${total}`
                : `Showing all ${total} transaction${total === 1 ? '' : 's'}`}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
