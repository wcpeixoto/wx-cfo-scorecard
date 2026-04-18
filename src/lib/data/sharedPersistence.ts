import type { AccountRecord, ImportedTransactionRecord, TransactionImportSummary } from './contract';
import type { SignalType, PriorityHistoryRow } from '../priorities/types';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const WORKSPACE_ID = (import.meta.env.VITE_SHARED_WORKSPACE_ID ?? 'default').trim() || 'default';
const IMPORTED_TRANSACTIONS_TABLE = 'shared_imported_transactions';
const IMPORT_BATCHES_TABLE = 'shared_import_batches';
const ACCOUNT_SETTINGS_TABLE = 'shared_account_settings';
const WORKSPACE_SETTINGS_TABLE = 'shared_workspace_settings';
const PRIORITY_HISTORY_TABLE = 'priority_history';

// TRANSACTION_FETCH_COLUMNS: explicit select list to minimize Supabase egress.
// Only the `txn` jsonb payload is used by any downstream consumer on the read
// path. All 11 scalar columns (fingerprint, possible_duplicate_key, import_id,
// source_file_name, imported_at_iso, source_line_number, entered_date,
// posted_date, transfer_account, possible_duplicate, workspace_id) are mapped
// by fromSharedTransactionRow() but are discarded immediately by
// buildSnapshotFromStore(), which only reads record.txn and records.length.
// Scalar fields exist on ImportedTransactionRecord for the write path only.
// Update this constant if new fields are added to downstream read consumers.
const TRANSACTION_FETCH_COLUMNS = 'txn';

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

// Matches the shared_workspace_settings table schema.
type SharedWorkspaceSettingRow = {
  workspace_id: string;
  target_net_margin: number;
  safety_reserve_method: string;
  safety_reserve_amount: number;
  suppress_duplicate_warnings: boolean;
  acknowledged_noncash_accounts: string[];
};

export type WorkspaceSettings = {
  targetNetMargin: number;
  safetyReserveMethod: 'monthly' | 'fixed';
  safetyReserveAmount: number;
  suppressDuplicateWarnings: boolean;
  acknowledgedNoncashAccounts: string[];
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  targetNetMargin: 0.25,
  safetyReserveMethod: 'monthly',
  safetyReserveAmount: 0,
  suppressDuplicateWarnings: false,
  acknowledgedNoncashAccounts: [],
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
  const PAGE_SIZE = 10000;
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

  let transactionFetchMs = 0;
  let batchFetchMs = 0;

  const [transactionRows, batchRows] = await Promise.all([
    (async () => {
      const t0 = performance.now();
      // Fetch only the txn jsonb column — all 11 scalar columns are unused on
      // the read path (see TRANSACTION_FETCH_COLUMNS comment above).
      // Type mismatch handled here at the fetch boundary; not propagated downstream.
      const rows = await requestAllRows<{ txn: ImportedTransactionRecord['txn'] }>(
        withWorkspaceFilter(`${IMPORTED_TRANSACTIONS_TABLE}?select=${TRANSACTION_FETCH_COLUMNS}&order=imported_at_iso.asc,fingerprint.asc`)
      );
      transactionFetchMs = Math.round(performance.now() - t0);
      return rows;
    })(),
    (async () => {
      const t0 = performance.now();
      const rows = await request<SharedImportBatchRow[]>(
        withWorkspaceFilter(`${IMPORT_BATCHES_TABLE}?select=*&order=imported_at_iso.desc`)
      );
      batchFetchMs = Math.round(performance.now() - t0);
      return rows;
    })(),
  ]);

  if (import.meta.env.DEV) {
    console.log('[BOOT]   (a) Supabase txn fetch:', transactionFetchMs, 'ms', `(${transactionRows.length} rows)`);
    console.log('[BOOT]   (b) Supabase batches fetch:', batchFetchMs, 'ms');
  }

  const t0Post = performance.now();
  // Scalar fields are set to safe placeholder values — they are not read by
  // buildSnapshotFromStore() or any downstream consumer on the read path.
  // Only record.txn and records.length are used after this point.
  const result = {
    records: transactionRows.map((row): ImportedTransactionRecord => ({
      fingerprint: '',
      possibleDuplicateKey: '',
      importId: '',
      sourceFileName: '',
      importedAtIso: '',
      sourceLineNumber: 0,
      txn: row.txn,
    })),
    summaries: (batchRows ?? []).map(fromSharedBatchRow),
  };
  if (import.meta.env.DEV) {
    console.log('[BOOT]   (c) Supabase post-read mapping:', Math.round(performance.now() - t0Post), 'ms');
  }

  return result;
}

export async function replaceSharedImportedStore(
  records: ImportedTransactionRecord[],
  summary: TransactionImportSummary
): Promise<void> {
  if (!isConfigured()) return;

  await request<unknown>('rpc/replace_shared_imported_store', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      p_workspace_id: WORKSPACE_ID,
      p_records: records.map(toSharedTransactionRow),
      p_summary: toSharedBatchRow(summary),
    }),
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

  if (records.length === 0) {
    // Only delete when explicitly clearing — never as part of a save-then-insert.
    await request<unknown>(withWorkspaceFilter(`${ACCOUNT_SETTINGS_TABLE}?id=neq.__none__`), {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    return;
  }

  // Upsert: atomic per-row, avoids the DELETE+INSERT gap where remote can be left empty.
  await request<unknown>(`${ACCOUNT_SETTINGS_TABLE}?on_conflict=workspace_id,id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(records.map(toSharedAccountSettingRow)),
  });

  // Remove stale rows that are no longer in the local record set.
  const currentIds = records.map((r) => `"${r.id}"`).join(',');
  await request<unknown>(
    withWorkspaceFilter(`${ACCOUNT_SETTINGS_TABLE}?id=not.in.(${currentIds})`),
    {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }
  );
}

function fromSharedWorkspaceSettingRow(row: SharedWorkspaceSettingRow): WorkspaceSettings {
  return {
    targetNetMargin: typeof row.target_net_margin === 'number' ? row.target_net_margin : DEFAULT_WORKSPACE_SETTINGS.targetNetMargin,
    safetyReserveMethod: row.safety_reserve_method === 'fixed' ? 'fixed' : 'monthly',
    safetyReserveAmount: typeof row.safety_reserve_amount === 'number' ? row.safety_reserve_amount : DEFAULT_WORKSPACE_SETTINGS.safetyReserveAmount,
    suppressDuplicateWarnings: row.suppress_duplicate_warnings === true,
    acknowledgedNoncashAccounts: Array.isArray(row.acknowledged_noncash_accounts)
      ? row.acknowledged_noncash_accounts.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function toSharedWorkspaceSettingRow(settings: WorkspaceSettings): SharedWorkspaceSettingRow {
  return {
    workspace_id: WORKSPACE_ID,
    target_net_margin: settings.targetNetMargin,
    safety_reserve_method: settings.safetyReserveMethod,
    safety_reserve_amount: settings.safetyReserveAmount,
    suppress_duplicate_warnings: settings.suppressDuplicateWarnings,
    acknowledged_noncash_accounts: settings.acknowledgedNoncashAccounts,
  };
}

export async function getSharedWorkspaceSettings(): Promise<WorkspaceSettings | null> {
  if (!isConfigured()) return null;

  try {
    const rows = await request<SharedWorkspaceSettingRow[]>(
      withWorkspaceFilter(`${WORKSPACE_SETTINGS_TABLE}?select=*`)
    );
    if (!rows || rows.length === 0) return null;
    return fromSharedWorkspaceSettingRow(rows[0]);
  } catch (err) {
    // Table may not yet exist — return null so caller falls back to defaults.
    console.warn('[workspace-settings] Read failed (table may not exist yet):', err);
    return null;
  }
}

export async function saveSharedWorkspaceSettings(settings: WorkspaceSettings): Promise<void> {
  if (!isConfigured()) return;

  try {
    await request<unknown>(`${WORKSPACE_SETTINGS_TABLE}?on_conflict=workspace_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify(toSharedWorkspaceSettingRow(settings)),
    });
  } catch (err) {
    console.error('[workspace-settings] Write failed:', err);
  }
}

export async function getLastPriorityHistory(
  signalType: SignalType
): Promise<PriorityHistoryRow | null> {
  if (!isConfigured()) return null;

  try {
    const path = `${PRIORITY_HISTORY_TABLE}?select=*&signal_type=eq.${encodeURIComponent(signalType)}&order=fired_at.desc&limit=1`;
    const rows = await request<PriorityHistoryRow[]>(withWorkspaceFilter(path));
    if (!rows || rows.length === 0) return null;
    return rows[0];
  } catch (err) {
    console.warn('[priority-history] Read failed:', err);
    return null;
  }
}

export async function savePriorityHistory(
  row: Omit<PriorityHistoryRow, 'id' | 'fired_at' | 'workspace_id'>
): Promise<void> {
  if (!isConfigured()) return;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentPath = `${PRIORITY_HISTORY_TABLE}?select=id&signal_type=eq.${encodeURIComponent(row.signal_type)}&fired_at=gte.${encodeURIComponent(sevenDaysAgo)}&order=fired_at.desc&limit=1`;
    const recent = await request<Array<{ id: string }>>(withWorkspaceFilter(recentPath));

    if (recent && recent.length > 0 && recent[0].id) {
      // Update existing row — preserve id, fired_at, workspace_id, signal_type
      await request<unknown>(
        `${PRIORITY_HISTORY_TABLE}?id=eq.${encodeURIComponent(recent[0].id)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            severity: row.severity,
            metric_value: row.metric_value ?? null,
            target_value: row.target_value ?? null,
            category_flagged: row.category_flagged ?? null,
            gap_amount: row.gap_amount ?? null,
            recommended_action: row.recommended_action ?? null,
            ai_headline: row.ai_headline ?? null,
            committed_action: row.committed_action ?? null,
            outcome_metric: row.outcome_metric ?? null,
            resolved_at: row.resolved_at ?? null,
          }),
        }
      );
    } else {
      // Insert new row — workspace_id set explicitly; id and fired_at generated by column defaults
      await request<unknown>(PRIORITY_HISTORY_TABLE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          signal_type: row.signal_type,
          severity: row.severity,
          metric_value: row.metric_value ?? null,
          target_value: row.target_value ?? null,
          category_flagged: row.category_flagged ?? null,
          gap_amount: row.gap_amount ?? null,
          recommended_action: row.recommended_action ?? null,
          ai_headline: row.ai_headline ?? null,
          committed_action: row.committed_action ?? null,
          outcome_metric: row.outcome_metric ?? null,
          resolved_at: row.resolved_at ?? null,
        }),
      });
    }
  } catch (err) {
    console.error('[priority-history] Write failed:', err);
  }
}
