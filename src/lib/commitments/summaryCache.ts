// Commitment day_one summary cache — the clean abstraction the rest of
// src/lib/commitments/ calls. It hides the storage shape: callers pass a
// commitment row and get/set a grounded sentence; they never see the
// priority_prose_cache table, its column names, or the AIProse-typed hero cache.
//
// Stable-per-commitment (the approved product decision): a validated AI summary
// is cached once and served verbatim for that commitment, so the day_one
// confirmation reads like a receipt and never re-rolls on reload.
//
// Cache identity = (commitment_id, facts_hash, prompt_version):
//   - commitment_id keeps each commitment's summary distinct.
//   - facts_hash covers the facts that would make the cached sentence unsafe if
//     they changed (committed action, target amount, deadline). A future Update
//     Plan that edits any of them changes the key, so the cache MISSES and a new
//     sentence is generated — the cache can never serve a sentence that
//     contradicts the live facts.
//   - prompt_version invalidates every cached summary when the generator's
//     prompt changes. Namespaced ('commitment-...') so it can't alias the hero
//     prose cache's versions.
import type { PriorityHistoryRow } from '../priorities/types';
import {
  getSharedPersistenceWorkspaceId,
  getCachedCommitmentSummary,
  saveCachedCommitmentSummary,
} from '../data/sharedPersistence';

// Bump when the day_one SYSTEM_PROMPT in groundedSummary.ts changes, so stale
// cached sentences from the old prompt miss cleanly. Separate namespace from the
// hero cache's AI_PROSE_PROMPT_VERSION.
export const COMMITMENT_SUMMARY_PROMPT_VERSION = 'commitment-v1';

// ASCII Unit Separator — a non-printable control char that won't appear in a
// committed_action, so it can't blur field boundaries in the hashed input. Same
// rationale as the hero cache key's separator.
const SEP = '\x1f';

// FNV-1a (32-bit) — a small, dependency-free, deterministic string hash. Same
// (normalized) input always yields the same hex digest. Collision risk is
// irrelevant here: the commitment id is also a standalone key component, so a
// hash collision across two DIFFERENT commitments still can't cross-serve, and
// the hash only needs to change when one commitment's own facts change.
function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Canonicalize the deadline so equivalent instants hash identically
// ("…T12:00:00Z" === "…T12:00:00.000Z"). Unparseable/missing → '' (a commitment
// always has one; this is a defensive normalization, not a real path).
function normalizeDeadline(iso: string | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toISOString();
}

// Pure, deterministic cache key for a commitment's day_one summary. Equivalent
// facts in → byte-identical key out; any change to action/target/deadline → a
// different key. Exported for direct unit testing of the facts-hash behavior.
export function buildCommitmentSummaryCacheKey(row: PriorityHistoryRow): string {
  const id = String(row.id ?? '');
  const action = (row.committed_action ?? '').trim();
  const target = Number.isFinite(row.target_value as number) ? String(row.target_value) : '';
  const deadline = normalizeDeadline(row.deadline_date);
  const factsHash = fnv1a32([id, action, target, deadline].join(SEP));
  return `${id}${SEP}${factsHash}`;
}

// Cache read for a commitment's day_one summary, or null on miss / not-configured
// / any error. A hit is safe to render without re-validating: the facts that
// grounding checks (target, deadline) are part of the key, so a hit means the
// stored sentence was validated against these exact facts.
export async function readCachedCommitmentSummary(
  row: PriorityHistoryRow,
): Promise<string | null> {
  return getCachedCommitmentSummary(
    getSharedPersistenceWorkspaceId(),
    buildCommitmentSummaryCacheKey(row),
    COMMITMENT_SUMMARY_PROMPT_VERSION,
  );
}

// Cache write. CALLER CONTRACT (never-cache-fallback, P0): only call this with an
// AI summary that has passed grounding — never the deterministic fallback.
export async function writeCachedCommitmentSummary(
  row: PriorityHistoryRow,
  summary: string,
): Promise<void> {
  await saveCachedCommitmentSummary(
    getSharedPersistenceWorkspaceId(),
    buildCommitmentSummaryCacheKey(row),
    COMMITMENT_SUMMARY_PROMPT_VERSION,
    { signalType: row.signal_type, severity: row.severity, summary },
  );
}
