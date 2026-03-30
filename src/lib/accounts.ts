import type { AccountRecord, AccountType, Txn } from './data/contract';

const CASH_HINTS = ['checking', 'savings', 'bank', 'cash'];
const CREDIT_CARD_HINTS = ['credit', 'card', 'amex', 'visa', 'mastercard', 'discover'];
const LOAN_HINTS = ['loan', 'debt', 'mortgage', 'line of credit', 'loc'];

function normalizeAccountKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function inferAccountType(accountName: string): AccountType {
  const normalized = accountName.trim().toLowerCase();
  if (!normalized) return 'Other';
  if (CREDIT_CARD_HINTS.some((hint) => normalized.includes(hint))) return 'Credit Card';
  if (LOAN_HINTS.some((hint) => normalized.includes(hint))) return 'Loan';
  if (CASH_HINTS.some((hint) => normalized.includes(hint))) return 'Cash';
  return 'Other';
}

function defaultIncludeInCashForecast(accountType: AccountType): boolean {
  return accountType === 'Cash';
}

function buildDefaultAccountRecord(accountName: string): AccountRecord {
  const accountType = inferAccountType(accountName);
  return {
    id: normalizeAccountKey(accountName),
    discoveredAccountName: accountName,
    accountName,
    accountType,
    startingBalance: 0,
    includeInCashForecast: defaultIncludeInCashForecast(accountType),
    active: true,
    isUserConfigured: false,
  };
}

export function discoverAccountRecords(txns: Txn[]): AccountRecord[] {
  const seen = new Map<string, string>();
  txns.forEach((txn) => {
    const accountName = txn.account?.trim();
    if (!accountName) return;
    const key = normalizeAccountKey(accountName);
    if (!key || seen.has(key)) return;
    seen.set(key, accountName);
  });

  return [...seen.entries()]
    .map(([, accountName]) => buildDefaultAccountRecord(accountName))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}

function sanitizeStoredRecord(candidate: Partial<AccountRecord> | null | undefined): AccountRecord | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const discoveredAccountName = typeof candidate.discoveredAccountName === 'string' ? candidate.discoveredAccountName.trim() : '';
  const accountName = typeof candidate.accountName === 'string' ? candidate.accountName.trim() : '';
  const fallbackName = accountName || discoveredAccountName;
  if (!fallbackName) return null;

  const accountType: AccountType =
    candidate.accountType === 'Cash' ||
    candidate.accountType === 'Credit Card' ||
    candidate.accountType === 'Loan' ||
    candidate.accountType === 'Other'
      ? candidate.accountType
      : inferAccountType(fallbackName);

  const startingBalance = typeof candidate.startingBalance === 'number' && Number.isFinite(candidate.startingBalance) ? candidate.startingBalance : 0;
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? normalizeAccountKey(candidate.id) : normalizeAccountKey(fallbackName);

  return {
    id,
    discoveredAccountName: discoveredAccountName || fallbackName,
    accountName: accountName || fallbackName,
    accountType,
    startingBalance,
    includeInCashForecast:
      typeof candidate.includeInCashForecast === 'boolean'
        ? candidate.includeInCashForecast
        : defaultIncludeInCashForecast(accountType),
    active: typeof candidate.active === 'boolean' ? candidate.active : true,
    isUserConfigured: Boolean(candidate.isUserConfigured),
  };
}

export function parseStoredAccountRecords(raw: string | null): AccountRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((candidate) => sanitizeStoredRecord(candidate))
      .filter((candidate): candidate is AccountRecord => Boolean(candidate))
      .sort((a, b) => a.accountName.localeCompare(b.accountName));
  } catch {
    return [];
  }
}

export function mergeDiscoveredAccountRecords(discovered: AccountRecord[], existing: AccountRecord[]): AccountRecord[] {
  const merged = new Map<string, AccountRecord>();

  existing.forEach((record) => {
    merged.set(record.id, record);
  });

  discovered.forEach((record) => {
    const existingRecord = merged.get(record.id);
    if (!existingRecord) {
      merged.set(record.id, record);
      return;
    }

    if (existingRecord.isUserConfigured) {
      merged.set(record.id, {
        ...existingRecord,
        discoveredAccountName: record.discoveredAccountName,
      });
      return;
    }

    merged.set(record.id, {
      ...record,
      id: existingRecord.id,
      active: existingRecord.active,
      startingBalance: existingRecord.startingBalance,
      isUserConfigured: existingRecord.isUserConfigured,
    });
  });

  return [...merged.values()].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.accountName.localeCompare(b.accountName);
  });
}
