// Pure, runtime-agnostic helpers for the sync-wodify-retention Edge Function
// (RETENTION_FINISH_PLAN.md §6, Prereq B — request gate + diagnostics).
//
// Kept here in src/ (not in the Deno shell) so vitest covers them and the
// function stays a thin shell. Uses ONLY Web APIs available in BOTH the Deno
// runtime and Node/vitest (Web Crypto, TextEncoder, typed arrays) — no Deno-only
// or Node-only imports — so one definition behaves identically in both.

/**
 * Sanitized, fixed-vocabulary classification of a sync failure, returned in the
 * 502 body as `code`. It is NEVER derived from a raw error message except the two
 * status-suffixed forms below, which carry only a non-sensitive HTTP integer
 * (the function itself throws them, anchored + digits-only). No URL, query
 * string, header, row, or secret can ever reach this value.
 */
export type SyncErrorCode =
  | `wodify_clients_http_${number}`
  | `persist_http_${number}`
  | 'bad_asof'
  | 'timeout'
  | 'parse_error'
  | 'network_error'
  | 'unknown';

export function classifySyncError(err: unknown): SyncErrorCode {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';
  const message = err instanceof Error ? err.message : '';

  // Status-only messages thrown by the function itself (index.ts fetch/persist).
  // Anchored + digits-only so an arbitrary message can never pass through.
  if (/^wodify_clients_http_\d+$/.test(message)) return message as SyncErrorCode;
  if (/^persist_http_\d+$/.test(message)) return message as SyncErrorCode;

  // The aggregate's asOf format guard (wodifyRetentionAggregate.ts). Defensive
  // only — asOf is server-generated (gymLocalDay), so this is effectively
  // unreachable; kept for future-proofing. NOT the UTC-vs-local asOf concern.
  if (message.startsWith('computeRetentionAggregate:')) return 'bad_asof';

  // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError' (not
  // an Error subclass, so match by name); a manual abort is 'AbortError'.
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';

  // res.json() on malformed JSON throws SyntaxError.
  if (err instanceof SyntaxError) return 'parse_error';

  // fetch() network failure throws TypeError. Coarse bucket — TypeError is not
  // exclusively connectivity, so treat 'network_error' as a hint, not proof.
  if (err instanceof TypeError) return 'network_error';

  return 'unknown';
}

/**
 * Constant-time equality of a configured secret and a caller-provided value.
 *
 * Both are hashed to fixed-length SHA-256 digests, then compared with bitwise
 * OR-accumulation over all 32 bytes — no early return in the comparison, and the
 * fixed-length digest means the compare never leaks the secret's length. Web
 * Crypto only, so it behaves identically in the Deno runtime and Node/vitest.
 *
 * Returns false for an empty `configured` (defense in depth — the caller already
 * fails closed before calling this, so a missing/unset secret can never
 * authorize even if this helper is reached directly). That guard branches on the
 * absence of a secret, not on its contents, so it leaks nothing about the value.
 */
export async function verifyTriggerSecret(configured: string, provided: string): Promise<boolean> {
  if (configured.length === 0) return false;

  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(configured)),
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);

  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

/**
 * The gym's local business day for a given `instant`, as `'YYYY-MM-DD'`.
 *
 * This is the value the sync uses for `asOf`, which is load-bearing TWICE:
 * it is the `(workspace_id, as_of)` idempotency-key bucket (#444) AND the
 * recency day-diff anchor (`computeRetentionAggregate` measures each member's
 * `daysAbsent` from `lastCheckIn` against it — RETENTION_FINISH_PLAN.md §6).
 * The Edge runtime is UTC, so deriving the day straight from a UTC instant
 * shifts the boundary ±1 vs the gym's real day near midnight: a pull that is
 * still local day X but already UTC day X+1 would bucket — and measure recency —
 * against the wrong day. Resolving the instant into the gym's IANA zone first
 * fixes both. (This is §6's deferred "permanent fix"; the interim mitigation was
 * to run the first invoke at midday gym-local.)
 *
 * The caller injects `instant` (the shell passes `new Date()`), so boundary
 * behavior is deterministic in tests. `Intl.DateTimeFormat` with a `timeZone` is
 * a Web API present — with full ICU tz data — in BOTH the Deno runtime and
 * Node/vitest (verified in both), so one definition behaves identically across
 * the runtime boundary, the same contract as the other helpers in this file.
 * `formatToParts` is assembled manually rather than trusting a locale's string
 * form, so the output is always hyphenated, zero-padded ISO regardless of locale
 * quirks (separators, bidi marks).
 *
 * Throws (RangeError) on an invalid or empty `tz` instead of silently falling
 * back to UTC — a wrong/unset zone would reintroduce the exact bug being fixed,
 * so it must fail loud.
 */
export function gymLocalDay(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day'): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
