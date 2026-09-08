// scorecard_snapshots persistence boundary.
//
// Shaped around a COMPLETED PAYLOAD, not a DashboardModel: the payload is what the table stores,
// and building it needs 20 inputs (13 Dashboard values, 4 live retention fetches, a React context
// and a clock) that this module has no business knowing about. Callers hand over the finished
// object from collectMonthlySourceExportPayload().
//
// WRITE SHAPE: a narrowly scoped PostgREST upsert on (workspace_id, period_month). It duplicates
// ~10 lines of header/URL construction from src/lib/data/sharedPersistence.ts because that file's
// `request` / `buildHeaders` are module-private and the file is LOCKED. Only the two public
// exports from it are reused. Table access is anon SELECT/INSERT/UPDATE, RLS-scoped to the
// workspace — see supabase/scorecard_snapshots_schema.sql.
//
// FAILURE POLICY: never throws, never rejects. Persistence is a side-effect of rendering the
// dashboard and must never block it or surface an error to the owner, so every path returns a
// typed result and failures are logged. Callers still `void` it behind a catch for belt-and-braces.

import { getSharedPersistenceWorkspaceId, isSharedPersistenceConfigured } from './sharedPersistence';

const TABLE = 'scorecard_snapshots';
const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type ScorecardSnapshotResult =
  | { status: 'written'; periodMonth: string; sourceHash: string }
  | { status: 'skipped'; reason: 'unconfigured' | 'invalid_payload' | 'readiness_dropped' }
  | { status: 'failed'; reason: string };

// Injectable so tests never touch env or the network. Production passes nothing.
export type ScorecardSnapshotDeps = {
  fetchImpl?: typeof fetch;
  supabaseUrl?: string;
  anonKey?: string;
  workspaceId?: string;
  now?: () => Date;
};

// ---------------------------------------------------------------------------------------------
// Canonical hashing
// ---------------------------------------------------------------------------------------------

// Canonical JSON for hashing: object keys sorted recursively (so key order can never change the
// hash), arrays left in order (their order is meaningful — monthly series, ranked movers), and the
// TOP-LEVEL `generated_at` omitted. generated_at is the only field guaranteed to differ between two
// otherwise-identical exports, so omitting it makes the hash answer "did the numbers change?"
// rather than "was this exported again?".
export function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.keys(source)
      .sort()
      .forEach((key) => {
        out[key] = canonicalizeForHash(source[key]);
      });
    return out;
  }
  return value;
}

export function canonicalPayloadJson(payload: Record<string, unknown>): string {
  const { generated_at: _omitted, ...rest } = payload;
  return JSON.stringify(canonicalizeForHash(rest));
}

// SHA-256 hex of the canonical JSON. Uses WebCrypto, which is available in the browser (the app is
// served over HTTPS on Pages, and localhost in dev — both secure contexts) and in the Node test
// runner.
export async function computeSourceHash(payload: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPayloadJson(payload));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------------------------
// Readiness gate (PURE — the whole point is that it is testable without React)
// ---------------------------------------------------------------------------------------------

// Every boot loader that contributes to the payload, plus whether the financial domain is usable.
// A loader that FAILED or was CANCELLED must report false: a settled-but-failed loader leaves the
// dashboard rendering fallback values, and persisting those would overwrite a good snapshot with a
// degraded one.
export type SnapshotReadiness = {
  // Imported transactions + newest import summary loaded WITHOUT error. Note this is deliberately
  // NOT `!isInitializing`: Dashboard clears that flag in a `finally`, so it goes false even when
  // the load threw. The caller must AND it with "no boot load error".
  importedDataLoaded: boolean;
  // Shared account settings finished loading without falling back after an exception. Account
  // settings drive current cash balance and which accounts feed the forecast, so a failed load
  // would produce a wrong runway block.
  accountSettingsLoaded: boolean;
  // Workspace/business settings resolved (remote row read, or default row written).
  workspaceSettingsSettled: boolean;
  // Renewal contracts + forecast events bootstrap finished. SETTLED, not non-empty: a workspace
  // with no forecast rows is a valid completed state whose payload correctly reports
  // `forecast:not_available` — gating on a non-empty projection would suppress the whole snapshot.
  forecastSettled: boolean;
  // A usable complete financial month exists (the builder's own financialLive condition). Without
  // it the payload is not usable for an attack plan and its scorecard_month is a fallback token —
  // writing that would overwrite a valid row. Also what makes Clear Data a no-op.
  financialUsable: boolean;
};

// Facts the Dashboard forecast bootstrap gathers, decided here so the rule is unit-tested.
// The locked readers return `[]` for a successful EMPTY result and `null` for a failure.
// saveSharedRenewalEvents catches its own exceptions and returns `false` — a caller's catch never
// sees a failed regeneration, so the boolean is the only signal. Any failure leaves forecast inputs
// stale or defaulted, and a snapshot must not be persisted off those.
export type ForecastBootstrapSignals = {
  contractsRead: unknown[] | null;
  regenResults: boolean[];
  eventsRead: unknown[] | null;
  threw: boolean;
};

export function forecastBootstrapFailed(signals: ForecastBootstrapSignals): boolean {
  return (
    signals.threw ||
    signals.contractsRead === null ||
    signals.eventsRead === null ||
    signals.regenResults.some((ok) => !ok)
  );
}

export function isSnapshotBarrierSatisfied(readiness: SnapshotReadiness): boolean {
  return (
    readiness.importedDataLoaded &&
    readiness.accountSettingsLoaded &&
    readiness.workspaceSettingsSettled &&
    readiness.forecastSettled &&
    readiness.financialUsable
  );
}

// Generation tokens. `boot` is issued once the barrier is first satisfied; each successful source
// import issues a new one. Ordinary rerenders change nothing, so they produce the same token and
// no write. Clear Data is NOT a trigger — it issues no token, and it also drops financialUsable to
// false, so it is blocked twice over.
export type SnapshotTriggerSource = 'boot' | 'quicken-import' | 'retention-import' | 'belt-import';

export type SnapshotGateState = {
  barrierSatisfied: boolean;
  token: string | null; // null until the barrier is first satisfied
  lastPersistedToken: string | null;
  inFlightToken: string | null;
};

// The single decision point. Returns true only for a token that is new AND not already being
// written — which is what keeps React Strict Mode's double-invoke from producing two logical writes.
export function shouldPersistSnapshot(state: SnapshotGateState): boolean {
  if (!state.barrierSatisfied) return false;
  if (!state.token) return false;
  if (state.token === state.lastPersistedToken) return false;
  if (state.token === state.inFlightToken) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------------------------

export async function persistScorecardSnapshot(
  payload: Record<string, unknown>,
  importId: string | null,
  deps: ScorecardSnapshotDeps = {},
): Promise<ScorecardSnapshotResult> {
  const supabaseUrl = (deps.supabaseUrl ?? import.meta.env.VITE_SUPABASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  const anonKey = (deps.anonKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const configured = deps.supabaseUrl !== undefined || deps.anonKey !== undefined
    ? Boolean(supabaseUrl && anonKey)
    : isSharedPersistenceConfigured();
  if (!configured || !supabaseUrl || !anonKey) {
    return { status: 'skipped', reason: 'unconfigured' };
  }

  // period_month comes from the payload's own scorecard_month — NEVER today's date. A payload
  // without a well-formed one is a bug upstream; refuse rather than write a bogus key.
  const periodMonth = payload.scorecard_month;
  const exportVersion = payload.schema_version;
  if (
    typeof periodMonth !== 'string' ||
    !PERIOD_MONTH_RE.test(periodMonth) ||
    typeof exportVersion !== 'string' ||
    exportVersion.length === 0
  ) {
    return { status: 'skipped', reason: 'invalid_payload' };
  }

  try {
    const sourceHash = await computeSourceHash(payload);
    const workspaceId = deps.workspaceId ?? getSharedPersistenceWorkspaceId();
    const now = (deps.now ?? (() => new Date()))();
    const doFetch = deps.fetchImpl ?? fetch;

    const response = await doFetch(
      `${supabaseUrl}/rest/v1/${TABLE}?on_conflict=workspace_id,period_month`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          period_month: periodMonth,
          computed_at: now.toISOString(), // explicit on every upsert
          export_version: exportVersion, // payload.schema_version — no second version field exists
          source_hash: sourceHash,
          import_id: importId,
          payload,
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { status: 'failed', reason: `${response.status} ${detail}`.trim() };
    }
    return { status: 'written', periodMonth, sourceHash };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------------------------
// Generation queue (PURE — no React; the hook holds one instance in a ref)
// ---------------------------------------------------------------------------------------------

// Serializes snapshot generations so an OLDER payload can never finish last and overwrite a NEWER
// one. Without this, a boot write still in flight when an import completes would let the two
// writes race; if the boot write landed second the row would describe the pre-import dataset.
//
// Rules:
//   - at most one generation is in flight at a time;
//   - a request that arrives while one is in flight WAITS, and only the NEWEST waiting token is
//     kept — intermediate generations are superseded, never lost in the sense that matters
//     (the newest always runs);
//   - the runner reads its inputs when it STARTS, so a queued generation sees the state committed
//     after the previous write finished — the freshest, not a stale capture;
//   - a token already in flight, already completed, or already waiting is ignored, which is what
//     makes React Strict Mode's double-invoke a single logical write;
//   - readiness is RE-CHECKED when a waiting generation is about to drain. If it fell while the
//     generation waited (Clear Data emptied the store behind a slow boot write), the waiting
//     generation is DROPPED — running it would collect the cleared inputs and overwrite a valid
//     row. A later successful import issues a new token and persists normally.
export type SnapshotGenerationRunner = (token: string) => Promise<void>;
export type SnapshotRequestOutcome = 'started' | 'queued' | 'ignored';

export class SnapshotGenerationQueue {
  private inFlight: string | null = null;
  private pending: string | null = null;
  private lastCompleted: string | null = null;

  constructor(
    private readonly run: SnapshotGenerationRunner,
    // Live readiness, consulted at drain time. Defaults to "always" for callers with no gate.
    private readonly isReady: () => boolean = () => true,
  ) {}

  state(): { inFlight: string | null; pending: string | null; lastCompleted: string | null } {
    return { inFlight: this.inFlight, pending: this.pending, lastCompleted: this.lastCompleted };
  }

  request(token: string, barrierSatisfied: boolean): SnapshotRequestOutcome {
    const wanted = shouldPersistSnapshot({
      barrierSatisfied,
      token,
      lastPersistedToken: this.lastCompleted,
      inFlightToken: this.inFlight,
    });
    if (!wanted || this.pending === token) return 'ignored';
    if (this.inFlight !== null) {
      this.pending = token; // newest supersedes whatever was waiting
      return 'queued';
    }
    this.start(token);
    return 'started';
  }

  private start(token: string): void {
    this.inFlight = token;
    // Never let a throwing or rejecting runner leave the queue stuck in flight.
    void Promise.resolve()
      .then(() => this.run(token))
      .catch((error: unknown) => {
        console.warn('[scorecard-snapshot] generation runner failed:', error);
      })
      .then(() => this.settle(token));
  }

  private settle(token: string): void {
    this.inFlight = null;
    this.lastCompleted = token;
    const next = this.pending;
    this.pending = null;
    if (next === null) return;
    if (this.isReady()) {
      this.start(next);
    } else {
      // Not marked completed: if readiness returns with this same token still current, the
      // effect re-requests it and it runs then. If it returns via a new import, that token wins.
      console.warn(`[scorecard-snapshot] dropped queued generation ${next}: readiness fell while it waited.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// One generation, end to end (PURE apart from the injected collect/persist)
// ---------------------------------------------------------------------------------------------

// The caller MUST build `capture` synchronously, before any await, from one consistent read of its
// latest state — so the payload and the import id describe the SAME import. Reading the id after
// the retention fetches resolve would let an import that completed mid-fetch relabel payload A as
// import B.
export type SnapshotGenerationCapture<S> = { sources: S; importId: string | null };

export type SnapshotGenerationDeps<S> = {
  collect: (sources: S) => Promise<{ payload: Record<string, unknown> }>;
  persist: (payload: Record<string, unknown>, importId: string | null) => Promise<ScorecardSnapshotResult>;
  // Live readiness, consulted again right before the write: if it fell during collection (Clear
  // Data mid-flight), the write is skipped and the stored row keeps its last valid snapshot.
  isStillReady: () => boolean;
};

export async function runSnapshotGeneration<S>(
  capture: SnapshotGenerationCapture<S>,
  deps: SnapshotGenerationDeps<S>,
): Promise<ScorecardSnapshotResult> {
  const { payload } = await deps.collect(capture.sources);
  if (!deps.isStillReady()) return { status: 'skipped', reason: 'readiness_dropped' };
  return deps.persist(payload, capture.importId);
}
