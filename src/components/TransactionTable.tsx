// Shared transaction table for the drawer-style surfaces that drill into
// a slice/bar's contributing transactions (Top Expenses, Income & Expense).
//
// The two drawers diverge above and below this table — each owns its own
// header (title, summary row, Export button), its own filter controls
// (search + account narrow + Clear), and its own header total semantics.
// What's identical is the table itself: sortable column headers, two-line
// vendor/memo cell, signed amount with credit colorization, and the
// "Showing X of Y" footer beneath. The empty state lives here too because
// it replaces the table + footer as a unit.
//
// CSS prefixes (`.txn-drawer-*` vs `.ie-drawer-*`) are preserved by passing
// `classPrefix` and templating every class name. The CSS rules in
// `dashboard.css` continue to match unchanged — pure JSX consolidation.
//
// Sort, format, and vendor helpers are co-located here so callers get a
// single import surface. The drawers reuse `vendorMemo` and `formatDate`
// when assembling CSV exports.
import type { Txn } from '../lib/data/contract';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SortKey = 'date' | 'vendor' | 'category' | 'account' | 'amount';
export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** The table only needs `txn` from each row. Both drawer source types
 *  (`ExpenseSliceWithRows['rows'][number]` and `IncomeExpenseRow`) match
 *  this shape structurally — extra fields like `contribution` are ignored. */
export interface TransactionTableRow {
  txn: Txn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sort helpers — exported so drawers can drive the sort state themselves and
// hand pre-filtered rows to the table.
// ─────────────────────────────────────────────────────────────────────────────

// Text columns read most naturally A→Z; date & amount most-recent / largest first.
export const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  date: 'desc',
  amount: 'desc',
  vendor: 'asc',
  category: 'asc',
  account: 'asc',
};

export const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'vendor', label: 'Vendor / Memo' },
  { key: 'category', label: 'Category' },
  { key: 'account', label: 'Account' },
  { key: 'amount', label: 'Amount' },
];

/** Toggle direction when clicking the active column; otherwise switch column
 *  and reset to its natural default direction. */
export function nextSort(prev: SortState, key: SortKey): SortState {
  return prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: DEFAULT_SORT_DIR[key] };
}

/** Comparator for sorting filtered rows by the active column. Sorting only
 *  reorders the rows — the set never changes, so a reconciling sum holds. */
export function compareTransactionRows(
  a: TransactionTableRow,
  b: TransactionTableRow,
  sort: SortState,
): number {
  const dir = sort.dir === 'asc' ? 1 : -1;
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters — shared by the table, the drawer header, and the CSV export.
// ─────────────────────────────────────────────────────────────────────────────

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatUsd(value: number): string {
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
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(m)}/${pad(d)}/${pad(y % 100)}`;
}

// Vendor primary line = payee, falling back to the memo when there's no payee.
export const vendorName = (payee?: string, memo?: string): string =>
  payee?.trim() || memo?.trim() || '';
// Memo second line — only when it's distinct from the name above it.
export const vendorMemoLine = (payee?: string, memo?: string): string =>
  payee?.trim() && memo?.trim() ? memo.trim() : '';
// CSV "Vendor / Memo" cell stays the joined form for a faithful export.
export const vendorMemo = (payee?: string, memo?: string): string =>
  [payee?.trim(), memo?.trim()].filter(Boolean).join(' — ');

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

function SortIcon({ classPrefix }: { classPrefix: string }) {
  return (
    <svg className={`${classPrefix}-sort-ico`} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path className="ic-up" d="M8 3.2 11.2 7H4.8z" />
      <path className="ic-dn" d="M8 12.8 4.8 9h6.4z" />
    </svg>
  );
}

interface Props {
  /** CSS prefix the drawer uses (e.g. `"txn-drawer"`). All table classes are
   *  templated from this so existing CSS continues to match. */
  classPrefix: string;
  /** Rows the drawer has already filtered AND sorted by the active column.
   *  The table is purely presentational — it does not re-sort, so the order
   *  the drawer hands in (also used by CSV export) is the order rendered. */
  rows: TransactionTableRow[];
  /** Pre-narrow row count, used by the footer "Showing X of Y" copy. */
  totalCount: number;
  /** Whether any narrow (account or search) is active — drives the footer copy. */
  isNarrowed: boolean;
  /** Current sort; drawer owns this state so it can hand the same instance to
   *  CSV export or other consumers if needed. */
  sort: SortState;
  /** Fired when a header is clicked; drawer should use `nextSort(prev, key)`. */
  onSort: (key: SortKey) => void;
}

export function TransactionTable({
  classPrefix,
  rows,
  totalCount,
  isNarrowed,
  sort,
  onSort,
}: Props) {
  const isEmpty = rows.length === 0;

  if (isEmpty) {
    return (
      <div className={`${classPrefix}-empty`}>
        <div className={`${classPrefix}-empty-icon`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </div>
        <p className={`${classPrefix}-empty-primary`}>No transactions found for this filter.</p>
        <p className={`${classPrefix}-empty-secondary`}>Try changing the account or clearing the search.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`${classPrefix}-body`}>
        <table className={`${classPrefix}-table`}>
          <colgroup>
            <col className={`${classPrefix}-col-date`} />
            <col className={`${classPrefix}-col-vendor`} />
            <col className={`${classPrefix}-col-category`} />
            <col className={`${classPrefix}-col-account`} />
            <col className={`${classPrefix}-col-amount`} />
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={`${classPrefix}-th${active ? ` is-sorted dir-${sort.dir}` : ''}`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button className={`${classPrefix}-th-sort`} type="button" onClick={() => onSort(col.key)}>
                      {col.label}
                      <SortIcon classPrefix={classPrefix} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const name = vendorName(row.txn.payee, row.txn.memo) || '—';
              const memoLine = vendorMemoLine(row.txn.payee, row.txn.memo);
              return (
                <tr key={row.txn.id || i}>
                  <td className={`${classPrefix}-td-date`}>{formatDate(row.txn.date)}</td>
                  <td className={`${classPrefix}-td-vendor`}>
                    <span className={`${classPrefix}-vname`} title={name}>{name}</span>
                    {memoLine && <span className={`${classPrefix}-memo`} title={memoLine}>{memoLine}</span>}
                  </td>
                  <td>{row.txn.category || '—'}</td>
                  <td>{row.txn.account || '—'}</td>
                  <td className={`${classPrefix}-td-amount${row.txn.rawAmount > 0 ? ` ${classPrefix}-amount--credit` : ''}`}>
                    {formatUsd(row.txn.rawAmount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={`${classPrefix}-foot`}>
        {isNarrowed
          ? `Showing ${rows.length} of ${totalCount}`
          : `Showing all ${totalCount} transaction${totalCount === 1 ? '' : 's'}`}
      </div>
    </>
  );
}
