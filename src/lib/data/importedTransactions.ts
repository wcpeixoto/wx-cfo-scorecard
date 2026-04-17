import type { DataSet, ImportedTransactionRecord, TransactionImportIssue, TransactionImportSummary, Txn } from './contract';
import { toISODateOnly } from './normalize';
import { classifyType } from '../cashFlow';
import {
  clearSharedImportedStore,
  getSharedImportedStoreSnapshot,
  isSharedPersistenceConfigured,
  replaceSharedImportedStore,
} from './sharedPersistence';

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

/**
 * Returns true if ANY cell in the row starts with "Total" (case-insensitive).
 * Quicken CSV exports include account subtotal rows like:
 *   ,"Total Bank of America",,,,,,"212,317.81"
 * These must be skipped before any field extraction or amount parsing to prevent
 * the subtotal amount from being injected as a fake transaction.
 */
function looksLikeTotalRow(cells: string[]): boolean {
  const firstField = (cells[0] ?? '').trim();
  const secondField = (cells[1] ?? '').trim();
  return /^total\b/i.test(firstField) || /^total\b/i.test(secondField);
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

type ColumnMap = {
  account: number;
  date: number;
  payee: number;
  category: number;
  amount: number;
  memo: number;
  transfer: number;
  tags: number;
  entered: number;
  posted: number;
};

function buildColumnMap(headerCells: string[]): ColumnMap | null {
  const normalized = headerCells.map((c) => c.trim().toLowerCase());

  const account  = normalized.findIndex((c) => normalizeHeader(c) === 'account');
  const date     = normalized.findIndex((c) => normalizeHeader(c) === 'date');
  const amount   = normalized.findIndex((c) => normalizeHeader(c) === 'amount');
  const payee    = normalized.findIndex((c) => normalizeHeader(c) === 'payee');
  const category = normalized.findIndex((c) => normalizeHeader(c) === 'category');
  const memo     = normalized.findIndex((c) => normalizeHeader(c).startsWith('memo'));
  const transfer = normalized.findIndex((c) => normalizeHeader(c) === 'transfer');
  const tags     = normalized.findIndex((c) => normalizeHeader(c) === 'tags');
  const entered  = normalized.findIndex((c) => normalizeHeader(c) === 'entered');
  const posted   = normalized.findIndex((c) => normalizeHeader(c) === 'posted');

  // Date and Amount are required — abort if either is missing
  if (date === -1 || amount === -1) {
    const missing: string[] = [];
    if (date === -1) missing.push('Date');
    if (amount === -1) missing.push('Amount');
    console.error(
      `[IMPORT] Could not locate required columns (${missing.join(', ')}) in header row:`,
      headerCells,
    );
    return null;
  }

  // Warn on duplicate column titles (use first match, already handled by findIndex)
  const titles = normalized.map((c) => normalizeHeader(c));
  const seen = new Map<string, number>();
  titles.forEach((title, idx) => {
    if (!title) return;
    if (seen.has(title)) {
      console.warn(`[IMPORT] Duplicate column title "${title}" at index ${idx}; using first occurrence at ${seen.get(title)}`);
    } else {
      seen.set(title, idx);
    }
  });

  return { account, date, payee, category, amount, memo, transfer, tags, entered, posted };
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
  skippedStructuralRows: number;
} {
  const rows = parseCsvRows(text);

  // Locate the header row using a stricter detection rule:
  // must contain Date AND Amount AND at least one of Payee/Category/Transfer/Memo/Tags.
  // This prevents metadata rows that happen to share common words from being mistaken
  // for the header.
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeHeader(cell.trim()));
    const hasDate   = normalized.includes('date');
    const hasAmount = normalized.includes('amount');
    const hasOptional =
      normalized.includes('payee') ||
      normalized.includes('category') ||
      normalized.includes('transfer') ||
      normalized.some((c) => c.startsWith('memo')) ||
      normalized.includes('tags');
    return hasDate && hasAmount && hasOptional;
  });

  if (headerIndex < 0) {
    return {
      candidates: [],
      parseErrors: [
        {
          kind: 'parse-error',
          lineNumber: 0,
          message: 'Import failed: could not locate required columns (Date, Amount) in the CSV header row. Check that the file is a valid Quicken export.',
          rowPreview: [],
        },
      ],
      skippedStructuralRows: 0,
    };
  }

  const header = rows[headerIndex].map((cell) => cell.trim());
  const colMap = buildColumnMap(header);

  if (!colMap) {
    return {
      candidates: [],
      parseErrors: [
        {
          kind: 'parse-error',
          lineNumber: headerIndex + 1,
          message: 'Import failed: could not locate required columns (Date, Amount) in the CSV header row. Check that the file is a valid Quicken export.',
          rowPreview: header,
        },
      ],
      skippedStructuralRows: 0,
    };
  }

  const candidates: ParsedCandidate[] = [];
  const parseErrors: TransactionImportIssue[] = [];
  let skippedStructuralRows = 0;
  let currentAccountHeader = '';

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const rawCells = rows[i]; // untrimmed cells — used for rawRow reconstruction
    const row = rawCells.map((cell) => cell.trim());
    const lineNumber = i + 1;
    // rawRow: reconstructed from untrimmed cells as a proxy for the original CSV line
    const rawRow = rawCells.join(',');
    const cells = row; // trimmed cells alias for log clarity

    // --- Structural skip checks: evaluate BEFORE any field extraction ---
    // These are not parse failures — they are known non-transaction rows in
    // Quicken CSV exports. Skip them immediately without touching any field.
    if (row.every((cell) => cell.length === 0)) { skippedStructuralRows += 1; continue; }
    if (looksLikeTotalRow(row)) {
      skippedStructuralRows += 1;
      continue;
    }
    if (looksLikeSeparatorRow(row)) { skippedStructuralRows += 1; continue; }
    if (looksLikeRangeRow(row)) { skippedStructuralRows += 1; continue; }

    // --- Field extraction begins only after structural rows are ruled out ---
    const accountCell = colMap.account >= 0 ? (row[colMap.account] ?? '') : '';
    const dateCell    = colMap.date    >= 0 ? (row[colMap.date]    ?? '') : '';
    const amountCell  = colMap.amount  >= 0 ? (row[colMap.amount]  ?? '') : '';
    const nonEmpty = row.filter(Boolean);

    if (!dateCell && !amountCell && nonEmpty.length === 1) {
      currentAccountHeader = accountCell || nonEmpty[0];
      skippedStructuralRows += 1;
      continue;
    }

    const accountName = accountCell || currentAccountHeader;
    if (!accountName && !dateCell && !amountCell) { skippedStructuralRows += 1; continue; }

    // Only count as a parse failure if the row has a valid date (it intended to be a
    // transaction) but is missing another required field.
    const looksLikeTransactionRow = Boolean(dateCell);
    if (!accountName || !dateCell || !amountCell) {
      if (looksLikeTransactionRow) {
        parseErrors.push({
          kind: 'parse-error',
          lineNumber: i + 1,
          message: 'Missing required account, date, or amount field.',
          rowPreview: row,
        });
      } else {
        skippedStructuralRows += 1;
      }
      continue;
    }

    const isoDate = toISODateOnly(dateCell);
    const enteredDate = toISODateOnly(colMap.entered >= 0 ? (row[colMap.entered] ?? '') : '');
    const postedDate  = toISODateOnly(colMap.posted  >= 0 ? (row[colMap.posted]  ?? '') : '');
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

    const payee           = (colMap.payee    >= 0 ? (row[colMap.payee]    ?? '') : '').trim();
    const category        = ((colMap.category >= 0 ? (row[colMap.category] ?? '') : '').trim()) || 'Uncategorized';
    const transferAccount = (colMap.transfer  >= 0 ? (row[colMap.transfer] ?? '') : '').trim();
    const memo            = (colMap.memo      >= 0 ? (row[colMap.memo]     ?? '') : '').trim();
    const tags            = parseTags((colMap.tags >= 0 ? (row[colMap.tags] ?? '') : '').trim());
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
      transferAccount: transferAccount || undefined,
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

  // Disambiguate rows that share identical fingerprints.
  // Quicken legitimately produces duplicate-looking rows when separate
  // transactions share the same date, payee, category, amount, and memo.
  // Append a sequence counter so each row gets a unique fingerprint.
  const fingerprintCounts = new Map<string, number>();
  candidates.forEach(({ record }) => {
    const baseFp = record.fingerprint;
    const count = (fingerprintCounts.get(baseFp) ?? 0) + 1;
    fingerprintCounts.set(baseFp, count);
    if (count > 1) {
      const uniqueFp = `${baseFp}|#${count}`;
      record.fingerprint = uniqueFp;
      record.txn = { ...record.txn, id: uniqueFp };
    }
  });

  if (import.meta.env.DEV) {
    console.log(`[IMPORT] parseQuickenReportCsv: ${candidates.length} candidates, ${parseErrors.length} parse errors, ${skippedStructuralRows} structural rows skipped`);
  }

  return { candidates, parseErrors, skippedStructuralRows };
}

function sortTransactions(txns: Txn[]): Txn[] {
  return [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function latestTxnMonth(records: ImportedTransactionRecord[]): string | null {
  return records.reduce<string | null>((latest, record) => {
    const month = record.txn.month;
    if (!month) return latest;
    if (!latest || month > latest) return month;
    return latest;
  }, null);
}

function buildSummary(
  importId: string,
  sourceFileName: string,
  importedAtIso: string,
  acceptedRecords: ImportedTransactionRecord[],
  existingRecords: ImportedTransactionRecord[],
  possibleDuplicateIssues: TransactionImportIssue[],
  parseErrors: TransactionImportIssue[],
  storageScope: 'local' | 'shared',
  importMode: 'append' | 'replace-all'
): TransactionImportSummary {
  return {
    importId,
    sourceFileName,
    importedAtIso,
    latestTxnMonth: latestTxnMonth(acceptedRecords),
    storageScope,
    importMode,
    newImported: acceptedRecords.length,
    exactDuplicatesSkipped: 0,
    possibleDuplicatesFlagged: possibleDuplicateIssues.length,
    parseFailures: parseErrors.length,
    storedTransactionCount: existingRecords.length + acceptedRecords.length,
    possibleDuplicateExamples: truncateIssues(possibleDuplicateIssues),
    parseFailureExamples: truncateIssues(parseErrors),
  };
}

function computeImportOutcome(
  candidates: ParsedCandidate[],
  parseErrors: TransactionImportIssue[],
  existingRecords: ImportedTransactionRecord[],
  importId: string,
  sourceFileName: string,
  importedAtIso: string,
  storageScope: 'local' | 'shared',
  importMode: 'append' | 'replace-all'
): { acceptedRecords: ImportedTransactionRecord[]; summary: TransactionImportSummary } {
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

  const summary = buildSummary(
    importId,
    sourceFileName,
    importedAtIso,
    acceptedRecords,
    existingRecords,
    possibleDuplicateIssues,
    parseErrors,
    storageScope,
    importMode
  );
  summary.exactDuplicatesSkipped = exactDuplicatesSkipped;

  return { acceptedRecords, summary };
}

async function getLocalImportedStoreSnapshotRaw(): Promise<{
  records: ImportedTransactionRecord[];
  summaries: TransactionImportSummary[];
}> {
  const t0Open = performance.now();
  const db = await openImportDb();
  if (import.meta.env.DEV) {
    console.log('[BOOT]   (a) IDB open:', Math.round(performance.now() - t0Open), 'ms');
  }
  try {
    const tx = db.transaction([TRANSACTIONS_STORE, SUMMARIES_STORE], 'readonly');
    const transactionStore = tx.objectStore(TRANSACTIONS_STORE);
    const summaryStore = tx.objectStore(SUMMARIES_STORE);
    const t0Read = performance.now();
    const records = (await requestToPromise(transactionStore.getAll())) as ImportedTransactionRecord[];
    const summaries = (await requestToPromise(summaryStore.getAll())) as TransactionImportSummary[];
    await transactionComplete(tx);
    if (import.meta.env.DEV) {
      console.log('[BOOT]   (b) IDB getAll:', Math.round(performance.now() - t0Read), 'ms', `(${records.length} records)`);
    }
    const t0Post = performance.now();
    const result = {
      records,
      summaries: summaries.map((summary) => ({
        ...summary,
        latestTxnMonth: summary.latestTxnMonth ?? null,
        storageScope: summary.storageScope ?? 'local',
        importMode: summary.importMode ?? 'append',
      })),
    };
    if (import.meta.env.DEV) {
      console.log('[BOOT]   (c) IDB post-read:', Math.round(performance.now() - t0Post), 'ms');
    }
    return result;
  } finally {
    db.close();
  }
}

async function writeLocalImportedStore(records: ImportedTransactionRecord[], summary: TransactionImportSummary): Promise<void> {
  const db = await openImportDb();
  try {
    const writeTx = db.transaction([TRANSACTIONS_STORE, SUMMARIES_STORE], 'readwrite');
    const writeTransactionStore = writeTx.objectStore(TRANSACTIONS_STORE);
    const writeSummaryStore = writeTx.objectStore(SUMMARIES_STORE);
    records.forEach((record) => writeTransactionStore.put(record));
    writeSummaryStore.put(summary);
    await transactionComplete(writeTx);
  } finally {
    db.close();
  }
}

function buildSnapshotFromStore(
  records: ImportedTransactionRecord[],
  summaries: TransactionImportSummary[],
  storageScope: 'local' | 'shared'
): {
  dataSet: DataSet | null;
  lastImportSummary: TransactionImportSummary | null;
  transactionCount: number;
} {
  const lastImportSummary =
    summaries
      .slice()
      .sort((a, b) => b.importedAtIso.localeCompare(a.importedAtIso))[0] ?? null;

  if (records.length === 0) {
    return { dataSet: null, lastImportSummary, transactionCount: 0 };
  }

  const txns = sortTransactions(records.map((record) => record.txn));
  const sourceLabel =
    lastImportSummary
      ? `${storageScope === 'shared' ? 'Shared import' : 'Local import'} · ${lastImportSummary.sourceFileName}${lastImportSummary.importMode === 'replace-all' ? ' · replace-all' : ''}`
      : storageScope === 'shared'
        ? 'Shared imported transactions'
        : 'Local imported transactions';

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
}

export async function importQuickenReportCsv(file: File): Promise<TransactionImportSummary> {
  const sourceFileName = file.name || 'Imported CSV';
  const importId = createImportId();
  const importedAtIso = new Date().toISOString();
  const text = await file.text();
  const { candidates, parseErrors, skippedStructuralRows } = parseQuickenReportCsv(text, sourceFileName, importId, importedAtIso);
  if (import.meta.env.DEV) {
    console.log(`[IMPORT] ${file.name}: ${candidates.length} transaction candidates, ${parseErrors.length} parse errors, ${skippedStructuralRows} structural rows skipped (Total/header/separator)`);
  }

  if (isSharedPersistenceConfigured()) {
    const { acceptedRecords, summary } = computeImportOutcome(
      candidates,
      parseErrors,
      [],
      importId,
      sourceFileName,
      importedAtIso,
      'shared',
      'replace-all'
    );
    await replaceSharedImportedStore(acceptedRecords, summary);
    return summary;
  }

  const localSnapshot = await getLocalImportedStoreSnapshotRaw();
  const { acceptedRecords, summary } = computeImportOutcome(
    candidates,
    parseErrors,
    localSnapshot.records,
    importId,
    sourceFileName,
    importedAtIso,
    'local',
    'append'
  );
  await writeLocalImportedStore(acceptedRecords, summary);
  return summary;
}

export async function getImportedTransactionsSnapshot(): Promise<{
  dataSet: DataSet | null;
  lastImportSummary: TransactionImportSummary | null;
  transactionCount: number;
}> {
  if (isSharedPersistenceConfigured()) {
    const sharedSnapshot = await getSharedImportedStoreSnapshot();
    if (sharedSnapshot) {
      return buildSnapshotFromStore(sharedSnapshot.records, sharedSnapshot.summaries, 'shared');
    }
    return { dataSet: null, lastImportSummary: null, transactionCount: 0 };
  }

  const localSnapshot = await getLocalImportedStoreSnapshotRaw();
  return buildSnapshotFromStore(localSnapshot.records, localSnapshot.summaries, 'local');
}

export async function clearImportedTransactions(): Promise<void> {
  if (isSharedPersistenceConfigured()) {
    await clearSharedImportedStore();
    return;
  }

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
