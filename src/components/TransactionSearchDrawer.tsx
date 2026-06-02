// Right-side drawer opened by submitting the header search input. Shows all
// transactions matching the search needle within a selected period window,
// independent of any chart click. The third drawer-style surface to reuse
// <DrawerShell> + <TransactionTable> + exportCsv.
//
// Unlike the slice-derived drawers (Top Expenses, Income & Expense), this one
// owns its own period window — there's no chart bar or donut slice anchoring
// the row set. The window is anchored on the most recent COMPLETED month that
// actually has data (not the wall-clock calendar month): this guarantees the
// default opens on real transactions even when imported data lags the calendar
// (e.g. opening on June 1 before May has been imported). When the data is
// caught up to the calendar, the anchor equals the previous calendar month, so
// there's no behavioral difference from a calendar-relative default. The
// period dropdown lets the owner widen to the trailing 3 months or YTD without
// closing the drawer. The header total is the sum of currently visible rows.
import { useMemo, useState } from 'react';
import type { Txn } from '../lib/data/contract';
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

type Period = 'latestMonth' | 'last3Months' | 'ytd';

interface PeriodOption {
  value: Period;
  label: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: 'latestMonth', label: 'Latest Month' },
  { value: 'last3Months', label: 'Last 3 Months' },
  { value: 'ytd', label: 'Year to Date' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Pad to 2 digits — used for ISO date / month-token construction.
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

// Shift a "YYYY-MM" token by a signed number of months.
function shiftMonth(token: string, delta: number): string {
  const [y, m] = token.split('-').map(Number);
  const zeroBased = y * 12 + (m - 1) + delta;
  const ny = Math.floor(zeroBased / 12);
  const nm = (zeroBased % 12 + 12) % 12 + 1;
  return `${ny}-${pad2(nm)}`;
}

// The current calendar month token from the wall clock. Used only to EXCLUDE
// the in-progress month when picking the anchor — never to build the window.
function currentCalendarMonthToken(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

// The anchor: the latest month present in the data that is strictly before the
// current calendar month (i.e. the most recent COMPLETED month with activity).
// Falls back to the latest month available (if all data sits in the current,
// incomplete month) and finally to the current calendar month (no data at all).
function resolveAnchorMonth(txns: Txn[], currentMonth: string): string {
  let latestCompleted: string | null = null;
  let latestAny: string | null = null;
  for (const txn of txns) {
    const m = (txn.date ?? '').slice(0, 7);
    if (m.length !== 7) continue;
    if (latestAny === null || m > latestAny) latestAny = m;
    if (m < currentMonth && (latestCompleted === null || m > latestCompleted)) {
      latestCompleted = m;
    }
  }
  return latestCompleted ?? latestAny ?? currentMonth;
}

interface PeriodRange {
  start: string;
  end: string;
}

// Build the inclusive [start, end] ISO window for the active period, anchored
// on the most-recent-completed-month token.
function getPeriodRange(period: Period, anchorMonth: string): PeriodRange {
  const [ay, am] = anchorMonth.split('-').map(Number);
  const anchorEnd = isoDate(ay, am, lastDayOfMonth(ay, am));

  switch (period) {
    case 'latestMonth':
      return { start: isoDate(ay, am, 1), end: anchorEnd };
    case 'last3Months': {
      const [sy, sm] = shiftMonth(anchorMonth, -2).split('-').map(Number);
      return { start: isoDate(sy, sm, 1), end: anchorEnd };
    }
    case 'ytd':
      return { start: isoDate(ay, 1, 1), end: anchorEnd };
  }
}

// Short human label for the active range — drives the title suffix and the CSV
// filename slug. The single-month case names the concrete month so the title
// and exported file are self-documenting.
function formatRangeLabel(period: Period, anchorMonth: string): string {
  switch (period) {
    case 'latestMonth':
      return monthLabel(anchorMonth);
    case 'last3Months':
      return 'Last 3 Months';
    case 'ytd':
      return 'Year to Date';
  }
}

interface Props {
  /** The full transaction set. The drawer narrows by period in-component. */
  txns: Txn[];
  /** Header search term that opened the drawer; seeds the search field. */
  initialSearch: string;
  onClose: () => void;
}

export function TransactionSearchDrawer({ txns, initialSearch, onClose }: Props) {
  const [period, setPeriod] = useState<Period>('latestMonth');
  const [search, setSearch] = useState<string>(initialSearch);
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' });

  // Anchor month is derived from the data once on mount (stable across renders).
  const anchorMonth = useMemo(
    () => resolveAnchorMonth(txns, currentCalendarMonthToken()),
    [txns],
  );
  const range = useMemo(() => getPeriodRange(period, anchorMonth), [period, anchorMonth]);
  const rangeLabel = useMemo(() => formatRangeLabel(period, anchorMonth), [period, anchorMonth]);

  // Pool to narrow over — every txn within the active period window.
  const periodTxns = useMemo(
    () => txns.filter((txn) => txn.date >= range.start && txn.date <= range.end),
    [txns, range.start, range.end],
  );

  const accountOptions = useMemo(() => {
    const names = new Set<string>();
    periodTxns.forEach((txn) => {
      const name = txn.account?.trim();
      if (name) names.add(name);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [periodTxns]);

  // Narrow by account + search, then order by the active column. Same haystack
  // as the I&E drawer so search behavior is consistent across surfaces.
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = periodTxns.filter((txn) => {
      if (accountFilter && txn.account?.trim() !== accountFilter) return false;
      if (!needle) return true;
      const haystack = [txn.payee, txn.memo, txn.category, txn.account]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
    const rows = filtered.map((txn) => ({ txn }));
    return rows.slice().sort((a, b) => compareTransactionRows(a, b, sort));
  }, [periodTxns, accountFilter, search, sort]);

  const isNarrowed = accountFilter !== '' || search.trim() !== '';
  const total = periodTxns.length;
  const isEmpty = visibleRows.length === 0;

  const visibleSum = useMemo(
    () => round2(visibleRows.reduce((sum, row) => sum + row.txn.rawAmount, 0)),
    [visibleRows],
  );

  const title = `Transactions — ${rangeLabel}`;
  const ariaLabel = `Transactions for ${rangeLabel}`;

  const handleClear = () => {
    setAccountFilter('');
    setSearch('');
  };

  const handleSort = (key: SortKey) => setSort((prev) => nextSort(prev, key));

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
          <h2 className="txn-search-drawer-title" title={title}>{title}</h2>
          <button className="txn-search-drawer-close" type="button" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="txn-search-drawer-summaryrow">
          <p className="txn-search-drawer-summary">
            <span className="txn-search-drawer-sum-num">{formatUsd(visibleSum)}</span>
          </p>
          <button className="txn-search-drawer-btn" type="button" onClick={handleExport} disabled={isEmpty}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        </div>
      </header>

      <div className="txn-search-drawer-controls">
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
        <select
          className="txn-search-drawer-select"
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          aria-label="Period"
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          className="txn-search-drawer-select"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {accountOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button className="txn-search-drawer-btn" type="button" onClick={handleClear} disabled={!isNarrowed}>
          Clear
        </button>
      </div>

      <TransactionTable
        classPrefix="txn-search-drawer"
        rows={visibleRows}
        totalCount={total}
        isNarrowed={isNarrowed}
        sort={sort}
        onSort={handleSort}
        emptyPrimary="No matching transactions for that search and window."
        emptySecondary="Try clearing the search or changing the period."
      />
    </DrawerShell>
  );
}
