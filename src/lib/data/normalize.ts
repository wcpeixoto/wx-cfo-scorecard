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
  return toISODateOnly(raw);
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

function formatLocalIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fromDateParts(year: number, month: number, day: number): string | null {
  const candidate = new Date(year, month - 1, day);
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return formatLocalIsoDate(year, month, day);
}

export function toISODateOnly(input: string | Date): string | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return formatLocalIsoDate(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }

  const value = input.trim();
  if (!value || value.includes(' - ')) return null;

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10);
    const month = Number.parseInt(isoMatch[2], 10);
    const day = Number.parseInt(isoMatch[3], 10);
    return fromDateParts(year, month, day);
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = Number.parseInt(slashMatch[1], 10);
    const day = Number.parseInt(slashMatch[2], 10);
    let year = Number.parseInt(slashMatch[3], 10);
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }
    return fromDateParts(year, month, day);
  }

  const fallback = new Date(value);
  if (Number.isNaN(fallback.getTime())) return null;
  return formatLocalIsoDate(fallback.getFullYear(), fallback.getMonth() + 1, fallback.getDate());
}

export function isFutureDate(dateISO: string, todayISO: string): boolean {
  return dateISO > todayISO;
}

export function splitActualsAndProjections(rows: Txn[]) {
  const todayISO = toISODateOnly(new Date());
  const safeTodayISO = todayISO ?? '9999-12-31';
  const actuals: Txn[] = [];
  const projections: Txn[] = [];
  let invalidDateRows = 0;

  rows.forEach((row) => {
    const normalizedDate = toISODateOnly(row.date);
    if (!normalizedDate) {
      invalidDateRows += 1;
      return;
    }

    const normalizedRow =
      row.date === normalizedDate && row.month === normalizedDate.slice(0, 7)
        ? row
        : {
            ...row,
            date: normalizedDate,
            month: normalizedDate.slice(0, 7),
          };

    if (isFutureDate(normalizedDate, safeTodayISO)) {
      projections.push(normalizedRow);
    } else {
      actuals.push(normalizedRow);
    }
  });

  if (invalidDateRows > 0) {
    console.warn(`[data] Ignored ${invalidDateRows} row(s) with invalid date values.`);
  }

  return { actuals, projections, todayISO: safeTodayISO, invalidDateRows };
}

export function buildDataSet(records: CsvRecord[], sourceUrl: string): DataSet {
  return {
    txns: normalizeRecords(records),
    fetchedAtIso: new Date().toISOString(),
    sourceUrl,
  };
}
