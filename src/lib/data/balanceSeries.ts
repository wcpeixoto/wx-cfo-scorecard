import type { AccountRecord, Txn } from './contract';

export type BalancePoint = { dateISO: string; balance: number };

// Mirrors normalizeAccountKey from lib/accounts.ts so the join key matches
// what's stored in AccountRecord.id (which is the source of truth for the
// inclusion filter and the starting-balance lookup).
function normalizeAccountKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const DAY_MS = 86_400_000;

// Reconstructs the true daily cash balance for the cash-included accounts
// using the same recipe as `currentCashBalance` in Dashboard.tsx
// (startingBalance + Σ rawAmount), but evaluated at every calendar date in
// the txn window. Days with no activity carry forward the prior day's value.
//
// Pure function. No transfer netting, no profitability filtering — preserves
// the same all-in semantics as `currentCashBalance` so the series's last
// point equals `currentCashBalance` when the inclusion filter matches.
export function buildCashBalanceSeries(
  baseTxns: Txn[],
  accountRecords: AccountRecord[],
): BalancePoint[] {
  const includedIds = new Set(
    accountRecords
      .filter((r) => r.includeInCashForecast && r.active)
      .map((r) => r.id),
  );
  if (includedIds.size === 0) return [];

  const startingTotal = accountRecords
    .filter((r) => includedIds.has(r.id))
    .reduce((sum, r) => sum + r.startingBalance, 0);

  const dailyDelta = new Map<string, number>();
  for (const txn of baseTxns) {
    const key = normalizeAccountKey(txn.account ?? '');
    if (!key || !includedIds.has(key)) continue;
    if (!txn.date) continue;
    dailyDelta.set(txn.date, (dailyDelta.get(txn.date) ?? 0) + txn.rawAmount);
  }

  if (dailyDelta.size === 0) return [];

  const sortedDates = [...dailyDelta.keys()].sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

  const series: BalancePoint[] = [];
  let running = startingTotal;
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const dateISO = new Date(ms).toISOString().slice(0, 10);
    const change = dailyDelta.get(dateISO);
    if (change !== undefined) running += change;
    series.push({ dateISO, balance: running });
  }
  return series;
}
