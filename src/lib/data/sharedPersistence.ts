import type { AccountRecord, ImportedTransactionRecord, TransactionImportSummary } from './contract';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const WORKSPACE_ID = (import.meta.env.VITE_SHARED_WORKSPACE_ID ?? 'default').trim() || 'default';
const IMPORTED_TRANSACTIONS_TABLE = 'shared_imported_transactions';
const IMPORT_BATCHES_TABLE = 'shared_import_batches';
const ACCOUNT_SETTINGS_TABLE = 'shared_account_settings';

type SharedImportTransactionRow = {
  workspace_id: string;
  fingerprint: string;
  possible_duplicate_key: string;
  import_id: string;
  source_file_name: string;
  imported_at_iso: string;
  source_line_number: number;
  entered_date: string | null;
  posted_date: string | null;
  transfer_account: string | null;
  possible_duplicate: boolean;
  txn: ImportedTransactionRecord['txn'];
};

type SharedImportBatchRow = {
  workspace_id: string;
  import_id: string;
  source_file_name: string;
  imported_at_iso: string;
  latest_txn_month: string | null;
  storage_scope: 'shared';
  import_mode: 'replace-all';
  new_imported: number;
  exact_duplicates_skipped: number;
  possible_duplicates_flagged: number;
  parse_failures: number;
  stored_transaction_count: number;
  possible_duplicate_examples: TransactionImportSummary['possibleDuplicateExamples'];
  parse_failure_examples: TransactionImportSummary['parseFailureExamples'];
};

type SharedAccountSettingRow = {
  workspace_id: string;
  id: string;
  discovered_account_name: string;
  account_name: string;
  account_type: AccountRecord['accountType'];
  starting_balance: number;
  include_in_cash_forecast: boolean;
  active: boolean;
  is_user_configured: boolean;
  updated_at: string;
};

function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('apikey', SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
  return headers;
}

async function requestAllRows<T>(path: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const all: T[] = [];
  let from = 0;

  for (;;) {
    const page = await request<T[]>(path, {
      headers: { Range: `${from}-${from + PAGE_SIZE - 1}` },
    });

    if (!page || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

function withWorkspaceFilter(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}workspace_id=eq.${encodeURIComponent(WORKSPACE_ID)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: buildHeaders(init?.headers),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Shared persistence request failed (${response.status}).`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.text();
  if (!body.trim()) {
    return undefined as T;
  }

  return JSON.parse(body) as T;
}

function toSharedTransactionRow(record: ImportedTransactionRecord): SharedImportTransactionRow {
  return {
    workspace_id: WORKSPACE_ID,
    fingerprint: record.fingerprint,
    possible_duplicate_key: record.possibleDuplicateKey,
    import_id: record.importId,
    source_file_name: record.sourceFileName,
    imported_at_iso: record.importedAtIso,
    source_line_number: record.sourceLineNumber,
    entered_date: record.enteredDate ?? null,
    posted_date: record.postedDate ?? null,
    transfer_account: record.transferAccount ?? null,
    possible_duplicate: Boolean(record.possibleDuplicate),
    txn: record.txn,
  };
}

function fromSharedTransactionRow(row: SharedImportTransactionRow): ImportedTransactionRecord {
  return {
    fingerprint: row.fingerprint,
    possibleDuplicateKey: row.possible_duplicate_key,
    importId: row.import_id,
    sourceFileName: row.source_file_name,
    importedAtIso: row.imported_at_iso,
    sourceLineNumber: row.source_line_number,
    enteredDate: row.entered_date ?? undefined,
    postedDate: row.posted_date ?? undefined,
    transferAccount: row.transfer_account ?? undefined,
    possibleDuplicate: row.possible_duplicate || undefined,
    txn: row.txn,
  };
}

function toSharedBatchRow(summary: TransactionImportSummary): SharedImportBatchRow {
  return {
    workspace_id: WORKSPACE_ID,
    import_id: summary.importId,
    source_file_name: summary.sourceFileName,
    imported_at_iso: summary.importedAtIso,
    latest_txn_month: summary.latestTxnMonth,
    storage_scope: 'shared',
    import_mode: 'replace-all',
    new_imported: summary.newImported,
    exact_duplicates_skipped: summary.exactDuplicatesSkipped,
    possible_duplicates_flagged: summary.possibleDuplicatesFlagged,
    parse_failures: summary.parseFailures,
    stored_transaction_count: summary.storedTransactionCount,
    possible_duplicate_examples: summary.possibleDuplicateExamples,
    parse_failure_examples: summary.parseFailureExamples,
  };
}

function fromSharedBatchRow(row: SharedImportBatchRow): TransactionImportSummary {
  return {
    importId: row.import_id,
    sourceFileName: row.source_file_name,
    importedAtIso: row.imported_at_iso,
    latestTxnMonth: row.latest_txn_month,
    storageScope: 'shared',
    importMode: row.import_mode ?? 'replace-all',
    newImported: row.new_imported,
    exactDuplicatesSkipped: row.exact_duplicates_skipped,
    possibleDuplicatesFlagged: row.possible_duplicates_flagged,
    parseFailures: row.parse_failures,
    storedTransactionCount: row.stored_transaction_count,
    possibleDuplicateExamples: row.possible_duplicate_examples ?? [],
    parseFailureExamples: row.parse_failure_examples ?? [],
  };
}

function toSharedAccountSettingRow(record: AccountRecord): SharedAccountSettingRow {
  return {
    workspace_id: WORKSPACE_ID,
    id: record.id,
    discovered_account_name: record.discoveredAccountName,
    account_name: record.accountName,
    account_type: record.accountType,
    starting_balance: record.startingBalance,
    include_in_cash_forecast: record.includeInCashForecast,
    active: record.active,
    is_user_configured: record.isUserConfigured,
    updated_at: new Date().toISOString(),
  };
}

function fromSharedAccountSettingRow(row: SharedAccountSettingRow): AccountRecord {
  return {
    id: row.id,
    discoveredAccountName: row.discovered_account_name,
    accountName: row.account_name,
    accountType: row.account_type,
    startingBalance: row.starting_balance,
    includeInCashForecast: row.include_in_cash_forecast,
    active: row.active,
    isUserConfigured: row.is_user_configured,
  };
}

export function isSharedPersistenceConfigured(): boolean {
  return isConfigured();
}

export function getSharedPersistenceWorkspaceId(): string {
  return WORKSPACE_ID;
}

export async function getSharedImportedStoreSnapshot(): Promise<{
  records: ImportedTransactionRecord[];
  summaries: TransactionImportSummary[];
} | null> {
  if (!isConfigured()) return null;

  const [transactionRows, batchRows] = await Promise.all([
    requestAllRows<SharedImportTransactionRow>(
      withWorkspaceFilter(`${IMPORTED_TRANSACTIONS_TABLE}?select=*&order=imported_at_iso.asc,fingerprint.asc`)
    ),
    request<SharedImportBatchRow[]>(
      withWorkspaceFilter(`${IMPORT_BATCHES_TABLE}?select=*&order=imported_at_iso.desc`)
    ),
  ]);

  return {
    records: transactionRows.map(fromSharedTransactionRow),
    summaries: batchRows.map(fromSharedBatchRow),
  };
}

export async function replaceSharedImportedStore(
  records: ImportedTransactionRecord[],
  summary: TransactionImportSummary
): Promise<void> {
  if (!isConfigured()) return;

  await clearSharedImportedStore();

  if (records.length > 0) {
    await request<unknown>(IMPORTED_TRANSACTIONS_TABLE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(records.map(toSharedTransactionRow)),
    });
  }

  await request<unknown>(IMPORT_BATCHES_TABLE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([toSharedBatchRow(summary)]),
  });
}

export async function clearSharedImportedStore(): Promise<void> {
  if (!isConfigured()) return;

  await request<unknown>(withWorkspaceFilter(`${IMPORTED_TRANSACTIONS_TABLE}?fingerprint=neq.__none__`), {
    method: 'DELETE',
    headers: {
      Prefer: 'return=minimal',
    },
  });
  await request<unknown>(withWorkspaceFilter(`${IMPORT_BATCHES_TABLE}?import_id=neq.__none__`), {
    method: 'DELETE',
    headers: {
      Prefer: 'return=minimal',
    },
  });
}

export async function getSharedAccountSettings(): Promise<AccountRecord[] | null> {
  if (!isConfigured()) return null;

  const rows = await request<SharedAccountSettingRow[]>(
    withWorkspaceFilter(`${ACCOUNT_SETTINGS_TABLE}?select=*&order=account_name.asc`)
  );

  return rows.map(fromSharedAccountSettingRow);
}

export async function saveSharedAccountSettings(records: AccountRecord[]): Promise<void> {
  if (!isConfigured()) return;

  await request<unknown>(withWorkspaceFilter(`${ACCOUNT_SETTINGS_TABLE}?id=neq.__none__`), {
    method: 'DELETE',
    headers: {
      Prefer: 'return=minimal',
    },
  });

  if (records.length === 0) return;

  await request<unknown>(ACCOUNT_SETTINGS_TABLE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(records.map(toSharedAccountSettingRow)),
  });
}
