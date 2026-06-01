// Right-side drawer that drills a Top Expense Categories slice down to the
// exact transactions behind it (reconciled mode, Phase 1).
//
// Drawer pattern is COPIED from EfficiencyDrilldownDrawer / ProjectionCompareDrawer,
// not extracted into a shared primitive (Phase 1 boundary). CSS prefix `txn-drawer-*`
// keeps it independent. A third drawer now exists — a future PR can do the
// extraction pass the other two drawers' headers anticipate.
//
// The source (computeExpenseSlicesWithRows) owns the math: it hands this drawer
// the contributing rows, each carrying its already-computed `contribution`. The
// drawer NEVER recomputes contribution, never calls expenseContribution, and
// never knows cashFlowMode. It renders, narrows, searches, exports, and sums
// what it is given.
import { useEffect, useMemo, useState } from 'react';
import type { ExpenseSliceWithRows } from '../lib/kpis/compute';

interface Props {
  slice: ExpenseSliceWithRows;
  onClose: () => void;
}

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

// Quicken dates are 'YYYY-MM-DD'. Build the Date from parts — never
// `new Date('YYYY-MM-DD')`, which parses as UTC and can shift a day.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function vendorMemo(payee?: string, memo?: string): string {
  return [payee?.trim(), memo?.trim()].filter(Boolean).join(' — ');
}

// CSV cell: quote when the value contains a comma, quote, or newline; escape
// embedded quotes by doubling them.
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function TopExpensesTransactionsDrawer({ slice, onClose }: Props) {
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  // Close on ESC.
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

  // Visible rows: narrow by account + search, then sort by date descending.
  // YYYY-MM-DD sorts lexically === chronologically.
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return slice.rows
      .filter((row) => {
        if (accountFilter && row.txn.account?.trim() !== accountFilter) return false;
        if (!needle) return true;
        const haystack = [row.txn.payee, row.txn.memo, row.txn.category, row.txn.account]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => b.txn.date.localeCompare(a.txn.date));
  }, [slice.rows, accountFilter, search]);

  // Header sum is the contribution total over the VISIBLE rows — a pure sum of
  // the values the source supplied, no recomputation. On first open it equals
  // slice.value; once narrowed it diverges by design.
  const visibleSum = useMemo(
    () => round2(visibleRows.reduce((sum, row) => sum + row.contribution, 0)),
    [visibleRows]
  );

  const isNarrowed = accountFilter !== '' || search.trim() !== '';

  const handleClear = () => {
    setAccountFilter('');
    setSearch('');
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
    <div className="txn-drawer-backdrop" onClick={handleBackdropClick}>
      <div
        className="txn-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${slice.name} transactions`}
      >
        {/* ── Header: title + reconciling count/sum ─────────────────────── */}
        <div className="txn-drawer-header">
          <button className="txn-drawer-close" onClick={onClose} aria-label="Close">×</button>
          <h2 className="txn-drawer-title">{slice.name}</h2>
          <p className="txn-drawer-stat">
            <span className="txn-drawer-stat-count">
              {visibleRows.length} {visibleRows.length === 1 ? 'transaction' : 'transactions'}
            </span>
            <span className="txn-drawer-stat-sep" aria-hidden="true">·</span>
            <span className="txn-drawer-stat-sum">{formatUsd(visibleSum)}</span>
          </p>
        </div>

        {/* ── Controls: account narrow + search + clear + export ────────── */}
        <div className="txn-drawer-controls">
          <select
            className="txn-drawer-select"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            aria-label="Filter by account"
          >
            <option value="">All accounts in slice</option>
            {accountOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <input
            className="txn-drawer-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transactions"
            aria-label="Search transactions"
          />
          <button
            className="txn-drawer-btn txn-drawer-btn--ghost"
            type="button"
            onClick={handleClear}
            disabled={!isNarrowed}
          >
            Clear
          </button>
          <button
            className="txn-drawer-btn txn-drawer-btn--outline"
            type="button"
            onClick={handleExport}
            disabled={visibleRows.length === 0}
          >
            Export CSV
          </button>
        </div>

        {/* ── Transactions table ────────────────────────────────────────── */}
        <div className="txn-drawer-table-wrap">
          {visibleRows.length === 0 ? (
            <p className="txn-drawer-empty">No transactions match the current filters.</p>
          ) : (
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
                  <th className="txn-drawer-th">Date</th>
                  <th className="txn-drawer-th">Vendor / Memo</th>
                  <th className="txn-drawer-th">Category</th>
                  <th className="txn-drawer-th">Account</th>
                  <th className="txn-drawer-th txn-drawer-th--right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => (
                  <tr key={row.txn.id || i} className="txn-drawer-row">
                    <td className="txn-drawer-td txn-drawer-td--muted">{formatDate(row.txn.date)}</td>
                    <td className="txn-drawer-td">{vendorMemo(row.txn.payee, row.txn.memo) || '—'}</td>
                    <td className="txn-drawer-td txn-drawer-td--muted">{row.txn.category || '—'}</td>
                    <td className="txn-drawer-td txn-drawer-td--muted">{row.txn.account || '—'}</td>
                    <td
                      className={`txn-drawer-td txn-drawer-td--right${row.txn.rawAmount > 0 ? ' txn-drawer-amount--credit' : ''}`}
                    >
                      {formatUsd(row.txn.rawAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
