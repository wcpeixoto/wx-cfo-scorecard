// Pure, runtime-agnostic helpers for the sync-belt-retention Edge Function
// (Slice 2 of the self-serve Churn-by-Belt importer). Mirrors the
// src/lib/gym/wodifyRetentionSync.ts pattern: the request gate + classification +
// pre-write fail-closed logic that must be vitest-covered lives HERE in src/, so
// the Deno shell (supabase/functions/sync-belt-retention/index.ts) stays a thin
// shell and holds no untypechecked business logic.
//
// UPLOAD-ONLY (Option 1): this importer takes three owner-uploaded CSVs. It makes
// NO Wodify call and reads NO WODIFY_API_KEY — the /progressions pull does not
// exist on this path. The only aggregation lives in the Slice-1 module
// src/lib/gym/beltRetentionAggregate.ts (imported, never forked).
//
// Uses ONLY Web APIs available in BOTH the Deno runtime and Node/vitest (Web
// Crypto, typed arrays) — no Deno-only or Node-only imports — so one definition
// behaves identically across the runtime boundary. The constant-time secret
// compare is re-implemented here (rather than imported from wodifyRetentionSync)
// so the belt function's gate has no cross-slice coupling; both derive from the
// same Web Crypto primitive.

import {
  analyze,
  buildBeltPayload,
  classify,
  parseCurrent,
  parsePrevious,
  parseRetention,
  scanForLeak,
  type BeltPayload,
  type Kind,
} from './beltRetentionAggregate.ts';

// ─── SANITIZED ERROR VOCABULARY ──────────────────────────────────────────────
// Fixed-vocabulary reason codes returned to the caller. NONE is derived from a
// raw error message, a parsed row, a member name, or an ID — every value below is
// a compile-time literal. Mirrors classifySyncError's "no raw message ever
// reaches the wire" contract.
export type UploadRejectCode =
  | 'method_not_allowed'
  | 'internal_error' // fail-closed: trigger secret unset server-side
  | 'forbidden' // trigger-secret mismatch (constant-time compare)
  | 'payload_too_large' // size cap tripped before aggregation
  | 'bad_multipart' // body is not the expected multipart/3-file shape
  | 'missing_source' // fewer than the three required sources classify
  | 'duplicate_source' // two uploads classify to the same source kind
  | 'unclassified_source' // an upload matches no known header signature
  | 'header_validation_failed' // a classified source fails its required-column parse
  | 'conservation_failed' // per-month active/lost sums do not tie
  | 'name_bridge_collision' // Report-69 name bridge is not collision-free
  | 'leak_guard_tripped' // serialized payload contains a PII-shaped token
  | 'persist_failed' // service-role upsert returned non-2xx
  | 'aggregate_error'; // defensive: aggregation threw

/**
 * Constant-time equality of a configured secret and a caller-provided value.
 *
 * Both are hashed to fixed-length SHA-256 digests, then compared with bitwise
 * OR-accumulation over all 32 bytes — no early return, and the fixed-length
 * digest means the compare never leaks the secret's length. Web Crypto only, so
 * it behaves identically in the Deno runtime and Node/vitest.
 *
 * Returns false for an empty `configured` (defense in depth — the shell already
 * fails closed before calling this). That guard branches on the ABSENCE of a
 * secret, not on its contents, so it leaks nothing about the value.
 */
export async function verifyImportSecret(configured: string, provided: string): Promise<boolean> {
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

// ─── CORS (browser preflight support for the Slice-3 upload UI) ──────────────
// The SPA sends custom headers (x-belt-import-trigger-secret, authorization,
// apikey), so the browser issues an OPTIONS preflight and also needs CORS headers
// on the real response to read the body. CORS is browser-UX ONLY — NOT the
// security gate: the trigger secret + service-role posture remain the boundary,
// and a non-browser client ignores CORS entirely. So this is a NARROW allowlist
// (never `*`): echo the caller's Origin only when it is one of the two known SPA
// origins, otherwise send no Access-Control-Allow-Origin.
//
// PURE + node-builtin-free so the Deno shell can call it and vitest can unit-test
// it without a Deno runtime. Same cross-runtime contract as the rest of this file.
export const CORS_ALLOWED_ORIGINS = [
  'https://wcpeixoto.github.io',
  'https://scorecard.wxestates.com',
] as const;

/**
 * Build the CORS headers for a request Origin. Methods/allowed-headers are always
 * returned; `Access-Control-Allow-Origin` is set ONLY when `origin` is in the
 * allowlist (an absent or disallowed origin gets no ACAO, so the browser blocks
 * it). `Vary: Origin` keeps a shared cache from serving one origin's ACAO to
 * another. The shell attaches these to the 204 preflight AND every real response.
 */
export function corsHeadersFor(origin: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-belt-import-trigger-secret',
    Vary: 'Origin',
  };
  if (origin && (CORS_ALLOWED_ORIGINS as readonly string[]).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

// ─── SIZE CAP ────────────────────────────────────────────────────────────────
// Per-file cap on the raw upload, enforced BEFORE any parse/aggregation work. The
// three real exports are a few hundred client-grain rows each (< ~200 KB); 5 MB
// per file is a generous ceiling that still bounds memory/CPU against an abusive
// upload. Total-body cap is 3× the per-file cap.
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per uploaded CSV
export const MAX_TOTAL_BYTES = 3 * MAX_FILE_BYTES; // 15 MB across the three files

/** True if any single file, or the running total, exceeds the caps. */
export function exceedsSizeCap(fileSizes: number[]): boolean {
  let total = 0;
  for (const size of fileSizes) {
    if (size > MAX_FILE_BYTES) return true;
    total += size;
    if (total > MAX_TOTAL_BYTES) return true;
  }
  return false;
}

/**
 * Best-effort MEMORY early-out: true when a numeric Content-Length header exceeds
 * `maxBytes`. Lets the shell reject an oversized upload BEFORE `req.formData()`
 * buffers the whole body into memory.
 *
 * BEST-EFFORT ONLY — NOT the authoritative size gate. Content-Length can be absent
 * (chunked transfer) or understated by a hostile client, so a false here proves
 * nothing; the post-parse per-file (5 MB) + total (15 MB) `exceedsSizeCap` check
 * stays the authoritative cap and must not be removed or weakened. Multipart
 * framing overhead means a legit body's Content-Length is ALWAYS ≥ the sum of its
 * file bytes, so comparing against MAX_TOTAL_BYTES can never false-reject a valid
 * ≤15 MB upload. Absent / non-numeric / negative headers → false (defer to parse).
 */
export function contentLengthExceeds(header: string | null | undefined, maxBytes: number): boolean {
  if (header == null) return false;
  const trimmed = header.trim();
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return false; // non-numeric / garbage → defer
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return false;
  return n > maxBytes;
}

// ─── CLASSIFICATION ──────────────────────────────────────────────────────────
// Map the three uploaded texts to their source kind by HEADER LINE only, using
// the SAME `classify` header-signature routing the Slice-1 module (and the CLI)
// use — no separate classifier, no drift. All three kinds must be present exactly
// once; any missing / duplicate / unclassified upload is rejected BEFORE parse.

export interface ClassifyOk {
  ok: true;
  retention: string;
  current68: string;
  previous69: string;
}
export interface ClassifyErr {
  ok: false;
  code: Extract<UploadRejectCode, 'missing_source' | 'duplicate_source' | 'unclassified_source'>;
}
export type ClassifyResult = ClassifyOk | ClassifyErr;

/**
 * Classify an array of uploaded CSV texts into the three required sources.
 *
 * - Any text that classifies to `unknown` → `unclassified_source`.
 * - Two texts classifying to the same kind → `duplicate_source`.
 * - Fewer than all three kinds present → `missing_source`.
 *
 * Returns the three texts keyed by kind on success. Header-line only: no member
 * rows are read here (the required-column parse happens downstream in
 * aggregateUpload).
 */
export function classifyUploads(texts: string[]): ClassifyResult {
  const buckets: Record<Exclude<Kind, 'unknown'>, string[]> = {
    retention: [],
    current68: [],
    previous69: [],
  };
  for (const text of texts) {
    const kind = classify(text);
    if (kind === 'unknown') return { ok: false, code: 'unclassified_source' };
    buckets[kind].push(text);
  }
  if (buckets.retention.length > 1 || buckets.current68.length > 1 || buckets.previous69.length > 1) {
    return { ok: false, code: 'duplicate_source' };
  }
  if (buckets.retention.length === 0 || buckets.current68.length === 0 || buckets.previous69.length === 0) {
    return { ok: false, code: 'missing_source' };
  }
  return {
    ok: true,
    retention: buckets.retention[0],
    current68: buckets.current68[0],
    previous69: buckets.previous69[0],
  };
}

// ─── AGGREGATE + FAIL-CLOSED GATE ────────────────────────────────────────────
// Parse the three classified sources, run the Slice-1 aggregation, and gate the
// result: refuse to hand a payload to the writer unless the required-column parse
// succeeded for all three, per-month conservation ties (active AND lost), the
// Report-69 name bridge is collision-free, and the serialized payload passes the
// PII leak scan. The shell writes ONLY on { ok: true }.

// COUNTS-ONLY summary returned to the caller. NEVER carries a row, name, or ID —
// only integers + booleans + YYYY-MM month labels (safe by the Slice-1 contract).
export interface UploadCountsSummary {
  rowCount: number;
  months: number;
  monthLabels: string[];
  conservationOk: boolean;
  bridgeCollisionFree: boolean;
  resolvedUniqueToId: number;
  ambiguousNames: number;
  unmatchedNames: number;
}

export interface AggregateOk {
  ok: true;
  payload: BeltPayload;
  summary: UploadCountsSummary;
}
export interface AggregateErr {
  ok: false;
  code: Extract<
    UploadRejectCode,
    'header_validation_failed' | 'conservation_failed' | 'name_bridge_collision' | 'leak_guard_tripped' | 'aggregate_error'
  >;
}
export type AggregateResult = AggregateOk | AggregateErr;

/**
 * Aggregate the three classified CSV texts into the belt payload and enforce the
 * pre-write gates. Pure: takes strings, returns the payload + a counts-only
 * summary, touches no Supabase / network / filesystem. The shell calls this AFTER
 * classifyUploads and only persists on { ok: true }.
 */
export function aggregateUpload(sources: {
  retention: string;
  current68: string;
  previous69: string;
}): AggregateResult {
  const ret = parseRetention(sources.retention);
  const cur = parseCurrent(sources.current68);
  const prev = parsePrevious(sources.previous69);

  // Fail closed if any classified source fails its required-column parse. classify
  // routes by a coarse header signature; this is the strict per-source contract.
  if (!ret.ok || !cur.ok || !prev.ok) {
    return { ok: false, code: 'header_validation_failed' };
  }

  let payload: BeltPayload;
  try {
    payload = buildBeltPayload(analyze(ret, cur, prev));
  } catch {
    // Defensive — the pipeline is pure and total, so this is effectively
    // unreachable; kept so a future change can never surface a raw throw.
    return { ok: false, code: 'aggregate_error' };
  }

  // Gate 1: per-month conservation must tie for BOTH active and lost. A reshape
  // that dropped or double-counted a member fails here before any write.
  if (!payload.conservation.allActiveOk || !payload.conservation.allLostOk) {
    return { ok: false, code: 'conservation_failed' };
  }

  // Gate 2: the Report-69 name bridge must be collision-free (no ambiguous /
  // unmatched names) — an unresolved bridge would misassign belt history.
  if (!payload.nameBridge69.collisionFree) {
    return { ok: false, code: 'name_bridge_collision' };
  }

  // Gate 3: re-scan the serialized payload for any PII-shaped token (day-level
  // date, ID-shaped digit run, @). By the Slice-1 contract the payload is
  // counts + labels only, so this is belt-and-suspenders; it fails closed if a
  // future change ever leaks.
  const leaks = scanForLeak(JSON.stringify(payload));
  if (leaks.length > 0) {
    return { ok: false, code: 'leak_guard_tripped' };
  }

  return {
    ok: true,
    payload,
    summary: {
      rowCount: payload.rowCount,
      months: payload.months.length,
      monthLabels: payload.months,
      conservationOk: payload.conservation.allActiveOk && payload.conservation.allLostOk,
      bridgeCollisionFree: payload.nameBridge69.collisionFree,
      resolvedUniqueToId: payload.nameBridge69.resolvedUniqueToId,
      ambiguousNames: payload.nameBridge69.ambiguousNames,
      unmatchedNames: payload.nameBridge69.unmatchedNames,
    },
  };
}
