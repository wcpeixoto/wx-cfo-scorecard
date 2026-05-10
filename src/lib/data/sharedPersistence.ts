import type {
  AccountRecord,
  ForecastEvent,
  ImportedTransactionRecord,
  RenewalContract,
  RenewalContractCadence,
  RenewalContractStatus,
  TransactionImportSummary,
} from './contract';
import type { SignalType, PriorityHistoryRow } from '../priorities/types';
import type { AIProse } from '../priorities/ai';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const WORKSPACE_ID = (import.meta.env.VITE_SHARED_WORKSPACE_ID ?? 'default').trim() || 'default';
const IMPORTED_TRANSACTIONS_TABLE = 'shared_imported_transactions';
const IMPORT_BATCHES_TABLE = 'shared_import_batches';
const ACCOUNT_SETTINGS_TABLE = 'shared_account_settings';
const WORKSPACE_SETTINGS_TABLE = 'shared_workspace_settings';
const PRIORITY_HISTORY_TABLE = 'priority_history';
const FORECAST_EVENTS_TABLE = 'forecast_events';
const RENEWAL_CONTRACTS_TABLE = 'renewal_contracts';
const PRIORITY_PROSE_CACHE_TABLE = 'priority_prose_cache';

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

type SharedForecastEventRow = {
  workspace_id: string;
  id: string;
  month: string;
  // Optional in the row type because legacy rows predate the `date` column.
  // The mapper falls back to last-day-of-stored-month for legacy rows on read.
  date?: string | null;
  type: string;
  title: string;
  note: string | null;
  status: string;
  impact_mode: string;
  cash_in_impact: number;
  cash_out_impact: number;
  enabled: boolean;
  updated_at: string;
  // Phase 5.1 — Renewal generator metadata. Shape only; no consumers in
  // this branch. Nullable to keep legacy rows valid without backfill.
  source: string | null;
  contract_id: string | null;
  generated_date: string | null;
  generated_cash_in: number | null;
  generated_cash_out: number | null;
  is_override: boolean | null;
};

// Phase 5.1 — Row shape for renewal_contracts. created_at is optional
// on writes so the writer can omit it and let the DB default
// (now()) fire on insert; on read the DB always returns a real value.
interface SharedRenewalContractRow {
  workspace_id: string;
  id: string;
  name: string;
  status: string;
  renewal_date: string;
  renewal_cadence: string;
  cash_in_amount: number;
  cash_out_amount: number;
  enabled: boolean;
  notes: string | null;
  created_at?: string;
  updated_at: string;
}

// Matches the shared_workspace_settings table schema.
type SharedWorkspaceSettingRow = {
  workspace_id: string;
  target_net_margin: number;
  safety_reserve_method: string;
  safety_reserve_amount: number;
  suppress_duplicate_warnings: boolean;
  acknowledged_noncash_accounts: string[];
  // Optional in the row type because it is absent from PostgREST
  // responses before the Supabase migration adds the column. The
  // row mapper defaults missing/null/unexpected values to 'reality'.
  forecast_posture?: string | null;
};

export type WorkspaceSettings = {
  targetNetMargin: number;
  safetyReserveMethod: 'monthly' | 'fixed';
  safetyReserveAmount: number;
  suppressDuplicateWarnings: boolean;
  acknowledgedNoncashAccounts: string[];
  forecastPosture: 'reality' | 'recovery';
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  targetNetMargin: 0.25,
  safetyReserveMethod: 'monthly',
  safetyReserveAmount: 0,
  suppressDuplicateWarnings: false,
  acknowledgedNoncashAccounts: [],
  forecastPosture: 'reality',
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
  let serverTotal: number | null = null;

  for (;;) {
    // Inline fetch so we can read Content-Range for truncation detection.
    // Using Prefer: count=exact asks PostgREST to return the full dataset
    // count in Content-Range even when max_rows caps the response.
    const headers = buildHeaders({
      Range: `${from}-${from + PAGE_SIZE - 1}`,
      Prefer: 'count=exact',
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Shared persistence request failed (${response.status}).`);
    }

    // Parse server total from first page: "Content-Range: 0-999/4843"
    if (serverTotal === null) {
      const contentRange = response.headers.get('Content-Range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) serverTotal = parseInt(match[1], 10);
      }
    }

    const body = await response.text();
    if (!body.trim()) break;
    const page = JSON.parse(body) as T[];
    if (!page || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Detect silent truncation: server told us the total but we received fewer.
  // This happens when Supabase max_rows < PAGE_SIZE. Fix: raise max_rows in
  // Supabase Dashboard → Settings → Data API → Max Rows.
  if (serverTotal !== null && all.length < serverTotal) {
    console.error(
      `[sharedPersistence] requestAllRows: fetched ${all.length} rows but server total is ${serverTotal}. ` +
      `Silent data truncation is active. Raise max_rows in Supabase Dashboard (Settings → Data API) to at least ${serverTotal}.`
    );
  }

  // Warn when approaching the limit so the issue is caught before it bites.
  if (all.length > PAGE_SIZE * 0.8) {
    console.warn(
      `[sharedPersistence] requestAllRows: ${all.length} rows fetched — within 20% of PAGE_SIZE (${PAGE_SIZE}). ` +
      `Plan to raise max_rows before the dataset crosses ${PAGE_SIZE} rows.`
    );
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

function toSharedForecastEventRow(event: ForecastEvent): SharedForecastEventRow {
  return {
    workspace_id: WORKSPACE_ID,
    id: event.id,
    month: event.month,
    date: event.date ?? null,
    type: event.type,
    title: event.title,
    note: event.note ?? null,
    status: event.status,
    impact_mode: event.impactMode,
    cash_in_impact: event.cashInImpact,
    cash_out_impact: event.cashOutImpact,
    enabled: event.enabled,
    updated_at: new Date().toISOString(),
    // Phase 5.1 — Renewal metadata write mapping. Nullable columns
    // persist as null when undefined (manual/legacy events). is_override
    // defaults to false to satisfy the NOT NULL constraint. The matching
    // read mapper hydrates these fields back onto ForecastEvent.
    source: event.source ?? null,
    contract_id: event.contractId ?? null,
    generated_date: event.generatedDate ?? null,
    generated_cash_in: event.generatedCashIn ?? null,
    generated_cash_out: event.generatedCashOut ?? null,
    is_override: event.isOverride ?? false,
  };
}

function fromSharedForecastEventRow(row: SharedForecastEventRow): ForecastEvent {
  // Read-time fallback for legacy rows persisted before the `date` column
  // was added: synthesize last-day-of-month so display works without a
  // DB backfill. Existing rows have date = null in the DB.
  const date = row.date ?? lastDayOfMonth(row.month);
  return {
    id: row.id,
    month: row.month,
    date,
    type: row.type as ForecastEvent['type'],
    title: row.title,
    note: row.note ?? undefined,
    status: row.status as ForecastEvent['status'],
    impactMode: row.impact_mode as ForecastEvent['impactMode'],
    cashInImpact: typeof row.cash_in_impact === 'number' ? row.cash_in_impact : 0,
    cashOutImpact: typeof row.cash_out_impact === 'number' ? row.cash_out_impact : 0,
    enabled: row.enabled === true,
    // Phase 5.1 — Renewal metadata hydration. Closes the read/write
    // asymmetry from Branch 1: rows now round-trip through the mapper
    // instead of dropping these fields on read. source is normalized to
    // the typed union; numeric fields coerce defensively; isOverride
    // defaults to false to mirror the NOT NULL DEFAULT false column.
    source: normalizeForecastEventSource(row.source),
    contractId: row.contract_id ?? undefined,
    generatedDate: row.generated_date ?? undefined,
    generatedCashIn: typeof row.generated_cash_in === 'number' ? row.generated_cash_in : undefined,
    generatedCashOut: typeof row.generated_cash_out === 'number' ? row.generated_cash_out : undefined,
    isOverride: row.is_override ?? false,
  };
}

function lastDayOfMonth(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return month;
  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return month;
  // Day 0 of next month = last day of current month.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
}

// Phase 5.1 — Source normalization for ForecastEvent reads. Anything
// that isn't 'manual' or 'renewal' (including null and unexpected
// strings) becomes undefined so consumers see a clean typed union.
function normalizeForecastEventSource(value: unknown): 'manual' | 'renewal' | undefined {
  if (value === 'renewal') return 'renewal';
  if (value === 'manual') return 'manual';
  return undefined;
}

// Phase 5.1 — Status normalization for RenewalContract reads. Defaults
// to 'active' when the DB value is unrecognized, so a stray string in
// the column never breaks downstream consumers.
function normalizeRenewalContractStatus(value: unknown): RenewalContractStatus {
  if (value === 'paused') return 'paused';
  if (value === 'ended') return 'ended';
  return 'active';
}

// Phase 5.1 — Cadence normalization for RenewalContract reads. Defaults
// to 'monthly' when the DB value is unrecognized. Same defensive
// posture as status: the typed union is the contract.
function normalizeRenewalContractCadence(value: unknown): RenewalContractCadence {
  if (value === 'annual') return 'annual';
  return 'monthly';
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

export async function getSharedForecastEvents(): Promise<ForecastEvent[] | null> {
  if (!isConfigured()) return null;

  try {
    const rows = await request<SharedForecastEventRow[]>(
      withWorkspaceFilter(`${FORECAST_EVENTS_TABLE}?select=*&order=month.asc,id.asc`)
    );
    return (rows ?? []).map(fromSharedForecastEventRow);
  } catch (err) {
    // Table may not yet exist — return null so caller falls back to defaults.
    console.warn('[forecast-events] Read failed (table may not exist yet):', err);
    return null;
  }
}

export async function saveSharedForecastEvents(events: ForecastEvent[]): Promise<void> {
  if (!isConfigured()) return;

  // Phase 5.1 — Manual Known Event saves are scoped to manual/legacy
  // rows only. The save path mirrors the manual UI's view of the world:
  // it sees and manages manual events. Renewal-generated rows
  // (source = 'renewal') are owned by the renewal generator and must
  // survive every manual save, including empty-list clears. PostgREST
  // OR-filter encodes "source IS NULL OR source = 'manual'".
  const manualOrLegacyFilter = `or=(source.is.null,source.eq.manual)`;

  if (events.length === 0) {
    // Empty-list save: clear manual/legacy events only. Renewal rows stay.
    await request<unknown>(
      withWorkspaceFilter(`${FORECAST_EVENTS_TABLE}?${manualOrLegacyFilter}`),
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      }
    );
    return;
  }

  // Upsert: atomic per-row, avoids the DELETE+INSERT gap where remote can be left empty.
  await request<unknown>(`${FORECAST_EVENTS_TABLE}?on_conflict=workspace_id,id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(events.map(toSharedForecastEventRow)),
  });

  // Remove stale manual/legacy rows that are no longer in the local
  // event set. Renewal rows are out of scope for this save and are
  // protected by the source filter even when their IDs are absent
  // from the manual-event list.
  const currentIds = events.map((e) => `"${e.id}"`).join(',');
  await request<unknown>(
    withWorkspaceFilter(
      `${FORECAST_EVENTS_TABLE}?id=not.in.(${currentIds})&${manualOrLegacyFilter}`
    ),
    {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }
  );
}

// Branch 4 — Private helper: resolves after ~250 ms.
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Branch 4 — Private helper: executes one DELETE request and, on failure,
// waits 250 ms then retries exactly once. If both attempts fail, logs the
// DELETE-specific path/errors and rethrows so saveSharedRenewalEvents can
// return false and emit its contract-level warning.
//
// Scope is intentionally limited to renewal stale-cleanup DELETEs. Other
// DELETE call sites (saveSharedForecastEvents, deleteSharedRenewalContract,
// account/import paths) are unchanged.
async function retryDeleteOnce(path: string): Promise<void> {
  try {
    await request<unknown>(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return;
  } catch (firstErr) {
    await sleepMs(250);
    try {
      await request<unknown>(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return;
    } catch (secondErr) {
      console.warn('[renewal-events] Stale-cleanup DELETE failed after retry', {
        path,
        firstError: firstErr instanceof Error ? firstErr.message : String(firstErr),
        secondError: secondErr instanceof Error ? secondErr.message : String(secondErr),
      });
      throw secondErr;
    }
  }
}

// Phase 5.1 — Renewal-scoped event persistence. Forces source = 'renewal'
// and contract_id on every written row, and scopes the stale-delete to
// (source = 'renewal' AND contract_id = X AND is_override = false). This
// keeps three classes of rows safe: manual events, renewal rows for
// other contracts, and operator-overridden renewal rows for THIS
// contract. Operator overrides survive even when the generator drops
// the row from its output, on the principle that an operator edit is a
// product decision the generator should not silently undo.
//
// DELETEs go through retryDeleteOnce so a transient 5xx from the
// stale-cleanup step doesn't abort an otherwise-successful regeneration.
// POST stays on the bare request() path because POST upserts are already
// retried on the next regeneration via deterministic IDs (idempotent).
export async function saveSharedRenewalEvents(
  contractId: string,
  events: ForecastEvent[]
): Promise<boolean> {
  if (!isConfigured()) return false;

  const encodedContractId = encodeURIComponent(contractId);
  // Scope every delete to this contract's non-overridden renewal rows.
  // Manual rows, other contracts' rows, and overrides are all untouched.
  const renewalScopeFilter =
    `source=eq.renewal&contract_id=eq.${encodedContractId}&is_override=eq.false`;

  try {
    if (events.length === 0) {
      // No events from the generator for this contract — clear our
      // non-overridden renewal rows only. Overrides remain in place.
      await retryDeleteOnce(
        withWorkspaceFilter(`${FORECAST_EVENTS_TABLE}?${renewalScopeFilter}`)
      );
      return true;
    }

    // Force source/contract_id at the write boundary so the generator
    // cannot accidentally produce a row that escapes the delete scope.
    // is_override is preserved if the caller supplied it (rare but
    // legal — e.g., re-saving a known override) and defaults to false.
    const rows = events.map((event) => ({
      ...toSharedForecastEventRow(event),
      source: 'renewal' as const,
      contract_id: contractId,
      is_override: event.isOverride ?? false,
    }));

    await request<unknown>(`${FORECAST_EVENTS_TABLE}?on_conflict=workspace_id,id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    });

    // Stale-delete: remove non-overridden renewal rows for this contract
    // that the generator no longer produces. Overrides survive; manual
    // events and other contracts' rows are out of scope.
    const currentIds = events.map((e) => `"${e.id}"`).join(',');
    await retryDeleteOnce(
      withWorkspaceFilter(
        `${FORECAST_EVENTS_TABLE}?${renewalScopeFilter}&id=not.in.(${currentIds})`
      )
    );
    return true;
  } catch (err) {
    console.warn('[renewal-events] Save failed', {
      contractId,
      eventCount: events.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// Phase 5.1 — RenewalContract row mappers. Mirror the ForecastEvent
// pattern. created_at is omitted from the write body when undefined so
// the DB default fires on insert and the existing value is preserved on
// conflict (PostgREST upsert SET only includes columns present in the
// payload).
function toSharedRenewalContractRow(contract: RenewalContract): SharedRenewalContractRow {
  return {
    workspace_id: WORKSPACE_ID,
    id: contract.id,
    name: contract.name,
    status: contract.status,
    renewal_date: contract.renewalDate,
    renewal_cadence: contract.renewalCadence,
    cash_in_amount: contract.cashInAmount,
    cash_out_amount: contract.cashOutAmount,
    enabled: contract.enabled,
    notes: contract.notes ?? null,
    // JSON.stringify drops undefined-valued props, so PostgREST will not
    // see created_at on first save (DB default fires) and will see the
    // preserved value on subsequent saves where the caller threads it
    // through from a prior read.
    created_at: contract.createdAt,
    updated_at: new Date().toISOString(),
  };
}

function fromSharedRenewalContractRow(row: SharedRenewalContractRow): RenewalContract {
  return {
    id: row.id,
    name: row.name,
    status: normalizeRenewalContractStatus(row.status),
    renewalDate: row.renewal_date,
    renewalCadence: normalizeRenewalContractCadence(row.renewal_cadence),
    cashInAmount: typeof row.cash_in_amount === 'number' ? row.cash_in_amount : 0,
    cashOutAmount: typeof row.cash_out_amount === 'number' ? row.cash_out_amount : 0,
    enabled: row.enabled === true,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Phase 5.1 — RenewalContract persistence. Read returns null on
// configuration absence or on table-missing errors so callers can fall
// back to defaults. Save and delete return boolean for caller-side
// success branching.
export async function getSharedRenewalContracts(): Promise<RenewalContract[] | null> {
  if (!isConfigured()) return null;

  try {
    const rows = await request<SharedRenewalContractRow[]>(
      withWorkspaceFilter(`${RENEWAL_CONTRACTS_TABLE}?select=*&order=renewal_date.asc,id.asc`)
    );
    return (rows ?? []).map(fromSharedRenewalContractRow);
  } catch (err) {
    // Table may not yet exist in dev environments — return null so
    // callers fall back to in-memory defaults.
    console.warn('[renewal-contracts] Read failed (table may not exist yet):', err);
    return null;
  }
}

export async function saveSharedRenewalContract(contract: RenewalContract): Promise<boolean> {
  if (!isConfigured()) return false;

  try {
    await request<unknown>(`${RENEWAL_CONTRACTS_TABLE}?on_conflict=workspace_id,id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify([toSharedRenewalContractRow(contract)]),
    });
    return true;
  } catch (err) {
    console.warn('[renewal-contracts] Save failed:', err);
    return false;
  }
}

export async function deleteSharedRenewalContract(contractId: string): Promise<boolean> {
  if (!isConfigured()) return false;

  try {
    await request<unknown>(
      withWorkspaceFilter(
        `${RENEWAL_CONTRACTS_TABLE}?id=eq.${encodeURIComponent(contractId)}`
      ),
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    );
    return true;
  } catch (err) {
    console.warn('[renewal-contracts] Delete failed:', err);
    return false;
  }
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
    // Defensive: handles three pre/post-migration cases — column missing
    // (undefined), column null, or column with unexpected value. All fall
    // through to the locked product default of 'reality'.
    forecastPosture:
      row.forecast_posture === 'reality' || row.forecast_posture === 'recovery'
        ? row.forecast_posture
        : 'reality',
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
    // Note: writing forecast_posture before the Supabase migration adds
    // the column will fail at the DB layer. The write path is only
    // exercised by user action in Settings UI (sub-phase 2b), so this
    // is not a real risk in practice.
    forecast_posture: settings.forecastPosture,
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

// AI prose cache — backs priority_prose_cache. Both helpers take
// workspaceId as a parameter (the Step 4 caller in ai.ts sources it from
// getSharedPersistenceWorkspaceId()), so withWorkspaceFilter()'s hardcoded
// WORKSPACE_ID is not used here. Read errors degrade to a cache miss; write
// errors degrade silently. The caller is expected to handle the absence of
// a cached value by invoking the AI provider directly.
export async function getCachedProse(
  workspaceId: string,
  cacheKey: string,
  promptVersion: string,
): Promise<AIProse | null> {
  if (!isConfigured()) return null;

  try {
    const path =
      `${PRIORITY_PROSE_CACHE_TABLE}?select=prose_json` +
      `&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
      `&cache_key=eq.${encodeURIComponent(cacheKey)}` +
      `&prompt_version=eq.${encodeURIComponent(promptVersion)}` +
      `&limit=1`;
    const rows = await request<Array<{ prose_json: AIProse }>>(path);
    if (!rows || rows.length === 0) return null;
    return rows[0].prose_json;
  } catch (err) {
    // Table-missing, network, or JSON-parse failure: degrade as a cache miss.
    console.warn('[priority-prose-cache] Read failed (table may not exist yet):', err);
    return null;
  }
}

export async function saveCachedProse(
  workspaceId: string,
  cacheKey: string,
  promptVersion: string,
  prose: AIProse,
): Promise<void> {
  if (!isConfigured()) return;

  try {
    // signal_type and severity are sourced from the prose payload itself
    // (populated by Step 2.5's validator and fallback paths), so the
    // persistence helper does not need a Signal parameter. updated_at is
    // set explicitly on every write so the conflict path refreshes it
    // without relying on a DB trigger; created_at is omitted so the DB
    // default fires on insert and the existing value is preserved on
    // conflict (PostgREST upsert SET only includes columns in the body).
    await request<unknown>(
      `${PRIORITY_PROSE_CACHE_TABLE}?on_conflict=workspace_id,cache_key,prompt_version`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          cache_key: cacheKey,
          prompt_version: promptVersion,
          signal_type: prose.signalType,
          severity: prose.severity,
          prose_json: prose,
          updated_at: new Date().toISOString(),
        }),
      }
    );
  } catch (err) {
    console.error('[priority-prose-cache] Write failed:', err);
  }
}
