import type { DataSet, ImportedTransactionRecord, TransactionImportIssue, TransactionImportSummary, Txn, TxnType } from './contract';
import { toISODateOnly } from './normalize';

const DB_NAME = 'wx-cfo-scorecard';
const DB_VERSION = 1;
const TRANSACTIONS_STORE = 'imported-transactions';
const SUMMARIES_STORE = 'transaction-import-summaries';
const MAX_SUMMARY_EXAMPLES = 5;

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isParenNegative = trimmed.startsWith('(') && trimmed.endsWith(')');
  const numeric = trimmed.replace(/[$,()\s]/g, '');
  if (!numeric) return null;

  const parsed = Number.parseFloat(numeric);
  if (!Number.isFinite(parsed)) return null;
  return isParenNegative ? -Math.abs(parsed) : parsed;
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function classifyType(rawAmount: number): TxnType {
  return rawAmount >= 0 ? 'income' : 'expense';
}

function buildFingerprint(parts: Array<string | number | undefined>): string {
  return parts
    .map((part) => normalizeText(part === undefined ? '' : String(part)))
    .join('|');
}

function looksLikeSeparatorRow(row: string[]): boolean {
  const nonEmpty = row.map((cell) => cell.trim()).filter(Boolean);
  return nonEmpty.length > 0 && nonEmpty.every((cell) => /^-+$/.test(cell.replace(/,/g, '')));
}

function looksLikeRangeRow(row: string[]): boolean {
  const trimmed = row.map((cell) => cell.trim());
  const nonEmpty = trimmed.filter(Boolean);
  return nonEmpty.length === 1 && /^\d{1,2}\/\d{1,2}\/\d{2,4}\s+-\s+\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(nonEmpty[0]);
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function openImportDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRANSACTIONS_STORE)) {
        const txStore = db.createObjectStore(TRANSACTIONS_STORE, { keyPath: 'fingerprint' });
        txStore.createIndex('importId', 'importId', { unique: false });
        txStore.createIndex('possibleDuplicateKey', 'possibleDuplicateKey', { unique: false });
      }
      if (!db.objectStoreNames.contains(SUMMARIES_STORE)) {
        const summaryStore = db.createObjectStore(SUMMARIES_STORE, { keyPath: 'importId' });
        summaryStore.createIndex('importedAtIso', 'importedAtIso', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
  });
}

function createImportId(): string {
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function truncateIssues(issues: TransactionImportIssue[]): TransactionImportIssue[] {
  return issues.slice(0, MAX_SUMMARY_EXAMPLES);
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      const nextChar = text[i + 1];
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

type ParsedCandidate = {
  record: ImportedTransactionRecord;
  rowPreview: string[];
};

function parseQuickenReportCsv(text: string, sourceFileName: string, importId: string, importedAtIso: string): {
  candidates: ParsedCandidate[];
  parseErrors: TransactionImportIssue[];
} {
  const rows = parseCsvRows(text);
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeHeader(cell));
    return normalized.includes('account') && normalized.includes('date') && normalized.includes('payee') && normalized.includes('category') && normalized.includes('amount');
  });

  if (headerIndex < 0) {
    return {
      candidates: [],
      parseErrors: [
        {
          kind: 'parse-error',
          lineNumber: 0,
          message: 'Could not identify Quicken report columns.',
          rowPreview: [],
        },
      ],
    };
  }

  const header = rows[headerIndex].map((cell) => cell.trim());
  const headerLookup = new Map<string, number>();
  header.forEach((cell, index) => {
    headerLookup.set(normalizeHeader(cell), index);
  });

  const accountIndex = headerLookup.get('account') ?? 2;
  const dateIndex = headerLookup.get('date') ?? 3;
  const enteredIndex = headerLookup.get('entered') ?? 4;
  const postedIndex = headerLookup.get('posted') ?? 5;
  const payeeIndex = headerLookup.get('payee') ?? 6;
  const categoryIndex = headerLookup.get('category') ?? 7;
  const transferIndex = headerLookup.get('transfer') ?? 8;
  const amountIndex = headerLookup.get('amount') ?? 9;
  const memoIndex = headerLookup.get('memonotes') ?? headerLookup.get('memo') ?? 10;
  const tagsIndex = headerLookup.get('tags') ?? 11;

  const candidates: ParsedCandidate[] = [];
  const parseErrors: TransactionImportIssue[] = [];
  let currentAccountHeader = '';

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i].map((cell) => cell.trim());
    if (row.every((cell) => cell.length === 0)) continue;
    if (looksLikeSeparatorRow(row)) continue;
    if (looksLikeRangeRow(row)) continue;

    const accountCell = row[accountIndex] ?? '';
    const dateCell = row[dateIndex] ?? '';
    const amountCell = row[amountIndex] ?? '';
    const nonEmpty = row.filter(Boolean);

    if (!dateCell && !amountCell && nonEmpty.length === 1) {
      currentAccountHeader = accountCell || nonEmpty[0];
      continue;
    }

    const accountName = accountCell || currentAccountHeader;
    if (!accountName && !dateCell && !amountCell) continue;

    if (!accountName || !dateCell || !amountCell) {
      parseErrors.push({
        kind: 'parse-error',
        lineNumber: i + 1,
        message: 'Missing required account, date, or amount field.',
        rowPreview: row,
      });
      continue;
    }

    const isoDate = toISODateOnly(dateCell);
    const enteredDate = toISODateOnly(row[enteredIndex] ?? '');
    const postedDate = toISODateOnly(row[postedIndex] ?? '');
    const rawAmount = parseAmount(amountCell);
    if (!isoDate || rawAmount === null) {
      parseErrors.push({
        kind: 'parse-error',
        lineNumber: i + 1,
        message: 'Could not parse transaction date or amount.',
        rowPreview: row,
      });
      continue;
    }

    const payee = (row[payeeIndex] ?? '').trim();
    const category = (row[categoryIndex] ?? '').trim() || 'Uncategorized';
    const transferAccount = (row[transferIndex] ?? '').trim();
    const memo = (row[memoIndex] ?? '').trim();
    const tags = parseTags((row[tagsIndex] ?? '').trim());
    const amount = Math.abs(rawAmount);
    const type = classifyType(rawAmount);

    const txn: Txn = {
      id: buildFingerprint([
        isoDate,
        accountName,
        enteredDate ?? undefined,
        postedDate ?? undefined,
        payee,
        category,
        transferAccount,
        rawAmount.toFixed(2),
        memo,
        tags.join(';'),
      ]),
      date: isoDate,
      month: isoDate.slice(0, 7),
      type,
      amount,
      category,
      payee: payee || undefined,
      memo: memo || undefined,
      account: accountName,
      tags: tags.length > 0 ? tags : undefined,
      rawAmount,
    };

    const record: ImportedTransactionRecord = {
      fingerprint: txn.id,
      possibleDuplicateKey: buildFingerprint([isoDate, accountName, payee, rawAmount.toFixed(2)]),
      importId,
      sourceFileName,
      importedAtIso,
      sourceLineNumber: i + 1,
      enteredDate: enteredDate ?? undefined,
      postedDate: postedDate ?? undefined,
      transferAccount: transferAccount || undefined,
      txn,
    };

    candidates.push({ record, rowPreview: row });
  }

  return { candidates, parseErrors };
}

function sortTransactions(txns: Txn[]): Txn[] {
  return [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export async function importQuickenReportCsv(file: File): Promise<TransactionImportSummary> {
  const sourceFileName = file.name || 'Imported CSV';
  const importId = createImportId();
  const importedAtIso = new Date().toISOString();
  const text = await file.text();
  const { candidates, parseErrors } = parseQuickenReportCsv(text, sourceFileName, importId, importedAtIso);

  const db = await openImportDb();
  try {
    const readTx = db.transaction([TRANSACTIONS_STORE, SUMMARIES_STORE], 'readonly');
    const transactionStore = readTx.objectStore(TRANSACTIONS_STORE);
    const summaryStore = readTx.objectStore(SUMMARIES_STORE);
    const existingRecords = (await requestToPromise(transactionStore.getAll())) as ImportedTransactionRecord[];
    await transactionComplete(readTx);

    const existingFingerprints = new Set(existingRecords.map((record) => record.fingerprint));
    const seenPossibleKeys = new Set(existingRecords.map((record) => record.possibleDuplicateKey));
    const seenFingerprints = new Set(existingFingerprints);
    const acceptedRecords: ImportedTransactionRecord[] = [];
    const possibleDuplicateIssues: TransactionImportIssue[] = [];
    let exactDuplicatesSkipped = 0;

    candidates.forEach(({ record, rowPreview }) => {
      if (seenFingerprints.has(record.fingerprint)) {
        exactDuplicatesSkipped += 1;
        return;
      }

      if (seenPossibleKeys.has(record.possibleDuplicateKey)) {
        possibleDuplicateIssues.push({
          kind: 'possible-duplicate',
          lineNumber: record.sourceLineNumber,
          message: 'Possible duplicate detected with matching date, account, payee, and amount. Imported and flagged for review.',
          rowPreview,
        });
        acceptedRecords.push({ ...record, possibleDuplicate: true });
        seenFingerprints.add(record.fingerprint);
        return;
      }

      acceptedRecords.push(record);
      seenFingerprints.add(record.fingerprint);
      seenPossibleKeys.add(record.possibleDuplicateKey);
    });

    const storedTransactionCount = existingRecords.length + acceptedRecords.length;
    const summary: TransactionImportSummary = {
      importId,
      sourceFileName,
      importedAtIso,
      newImported: acceptedRecords.length,
      exactDuplicatesSkipped,
      possibleDuplicatesFlagged: possibleDuplicateIssues.length,
      parseFailures: parseErrors.length,
      storedTransactionCount,
      possibleDuplicateExamples: truncateIssues(possibleDuplicateIssues),
      parseFailureExamples: truncateIssues(parseErrors),
    };

    const writeTx = db.transaction([TRANSACTIONS_STORE, SUMMARIES_STORE], 'readwrite');
    const writeTransactionStore = writeTx.objectStore(TRANSACTIONS_STORE);
    const writeSummaryStore = writeTx.objectStore(SUMMARIES_STORE);
    acceptedRecords.forEach((record) => writeTransactionStore.put(record));
    writeSummaryStore.put(summary);
    await transactionComplete(writeTx);

    return summary;
  } finally {
    db.close();
  }
}

export async function getImportedTransactionsSnapshot(): Promise<{
  dataSet: DataSet | null;
  lastImportSummary: TransactionImportSummary | null;
  transactionCount: number;
}> {
  const db = await openImportDb();
  try {
    const tx = db.transaction([TRANSACTIONS_STORE, SUMMARIES_STORE], 'readonly');
    const transactionStore = tx.objectStore(TRANSACTIONS_STORE);
    const summaryStore = tx.objectStore(SUMMARIES_STORE);
    const records = (await requestToPromise(transactionStore.getAll())) as ImportedTransactionRecord[];
    const summaries = (await requestToPromise(summaryStore.getAll())) as TransactionImportSummary[];
    await transactionComplete(tx);

    const lastImportSummary = summaries
      .slice()
      .sort((a, b) => b.importedAtIso.localeCompare(a.importedAtIso))[0] ?? null;

    if (records.length === 0) {
      return { dataSet: null, lastImportSummary, transactionCount: 0 };
    }

    const txns = sortTransactions(records.map((record) => record.txn));
    const sourceLabel = lastImportSummary ? `Local import · ${lastImportSummary.sourceFileName}` : 'Local imported transactions';
    return {
      dataSet: {
        txns,
        fetchedAtIso: lastImportSummary?.importedAtIso ?? new Date().toISOString(),
        sourceUrl: sourceLabel,
        sourceKind: 'imported',
        sourceLabel,
      },
      lastImportSummary,
      transactionCount: records.length,
    };
  } finally {
    db.close();
  }
}

export async function clearImportedTransactions(): Promise<void> {
  const db = await openImportDb();
  try {
    const tx = db.transaction([TRANSACTIONS_STORE, SUMMARIES_STORE], 'readwrite');
    tx.objectStore(TRANSACTIONS_STORE).clear();
    tx.objectStore(SUMMARIES_STORE).clear();
    await transactionComplete(tx);
  } finally {
    db.close();
  }
}
