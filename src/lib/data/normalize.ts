import type { CsvRecord, DataSet, Txn, TxnType } from './contract';

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function lookupRecord(record: CsvRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(record)) {
    map.set(normalizeKey(key), value);
  }
  return map;
}

function pickValue(lookup: Map<string, string>, keys: string[]): string {
  for (const key of keys) {
    const found = lookup.get(normalizeKey(key));
    if (found && found.trim().length > 0) {
      return found.trim();
    }
  }
  return '';
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isParenNegative = trimmed.startsWith('(') && trimmed.endsWith(')');
  const numeric = trimmed.replace(/[$,()\s]/g, '');
  if (!numeric) return null;

  const amount = Number.parseFloat(numeric);
  if (Number.isNaN(amount)) return null;

  return isParenNegative ? -Math.abs(amount) : amount;
}

function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.includes(' - ')) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return value;
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!slashMatch) return null;

  const month = Number.parseInt(slashMatch[1], 10);
  const day = Number.parseInt(slashMatch[2], 10);
  let year = Number.parseInt(slashMatch[3], 10);

  if (year < 100) {
    year += year >= 70 ? 1900 : 2000;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  const monthPart = String(month).padStart(2, '0');
  const dayPart = String(day).padStart(2, '0');
  return `${year}-${monthPart}-${dayPart}`;
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function classifyType(rawAmount: number): TxnType {
  return rawAmount >= 0 ? 'income' : 'expense';
}

function toTransaction(record: CsvRecord): Txn | null {
  const lookup = lookupRecord(record);

  const dateValue = pickValue(lookup, ['Date', 'Transaction Date']);
  const amountValue = pickValue(lookup, ['Amount']);

  const isoDate = parseDate(dateValue);
  const rawAmount = parseAmount(amountValue);

  if (!isoDate || rawAmount === null) {
    return null;
  }

  const account = pickValue(lookup, ['Account']);
  const payee = pickValue(lookup, ['Payee']);
  const category = pickValue(lookup, ['Category']) || 'Uncategorized';
  const memo = pickValue(lookup, ['Memo/Notes', 'Memo', 'Notes']);
  const transfer = pickValue(lookup, ['Transfer']);
  const tags = parseTags(pickValue(lookup, ['Tags']));

  const type = classifyType(rawAmount);
  const amount = Math.abs(rawAmount);
  const month = isoDate.slice(0, 7);

  return {
    id: `${isoDate}|${account}|${payee}|${category}|${rawAmount}|${memo}`,
    date: isoDate,
    month,
    type,
    amount,
    category,
    payee: payee || undefined,
    memo: memo || undefined,
    account: account || undefined,
    tags: tags.length > 0 ? tags : undefined,
    transfer: transfer || undefined,
    rawAmount,
  };
}

export function normalizeRecords(records: CsvRecord[]): Txn[] {
  const txns = records.map(toTransaction).filter((txn): txn is Txn => Boolean(txn));

  txns.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return txns;
}

export function buildDataSet(records: CsvRecord[], sourceUrl: string): DataSet {
  return {
    txns: normalizeRecords(records),
    fetchedAtIso: new Date().toISOString(),
    sourceUrl,
  };
}
