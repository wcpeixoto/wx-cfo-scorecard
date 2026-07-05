// Browser-side client for the self-serve Churn-by-Belt importer (Slice 3). Assembles
// the three-file multipart POST to the gated sync-belt-retention Edge Function, maps
// the server's fixed reject vocabulary to owner-facing copy, and offers an advisory
// client-side source-kind detection for the pick UI.
//
// JSX-FREE by design so it is unit-testable without a DOM. The server is authoritative:
// this module does NOT re-implement validation — it detects a source kind for an
// advisory chip only, and the Edge Function re-classifies + re-gates every upload.
//
// SECURITY (PUBLIC repo, member PII in the uploads): the secret and file bytes are
// TRANSIENT — this module never persists them (no localStorage/sessionStorage/
// IndexedDB) and never logs file contents, parsed rows, member identifiers, or the
// secret. The secret is sent ONLY as the x-belt-import-trigger-secret header, never
// as a form field. The server response is counts-only, so surfacing it is safe.

import { classify } from './beltRetentionAggregate';
import type { Kind } from './beltRetentionAggregate';
// Type-only imports — erased at build, so the Deno-oriented upload module's runtime
// is NEVER bundled into the SPA. Keeps the reject-code union + summary shape in lockstep
// with the Edge Function's contract without adding any new export to that module.
import type { UploadRejectCode, UploadCountsSummary } from './beltRetentionUpload';

// The counts-only summary the Edge Function returns on success. Matches the server's
// contract (index.ts spreads the full summary into the 200 body).
export type BeltImportSummary = UploadCountsSummary;

export type { Kind };

/** Thrown by postBeltImport on any non-2xx response, carrying the server's reject code. */
export class BeltImportError extends Error {
  readonly code: UploadRejectCode;
  constructor(code: UploadRejectCode) {
    super(code);
    this.name = 'BeltImportError';
    this.code = code;
  }
}

// Static `import.meta.env` access (same convention as fetchRetentionAggregate.ts) —
// this is a browser-only module (no CLI imports it), so it needs neither the lazy
// dynamic read nor Node-import safety. Read per-call so tests can stub env.
function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** True when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both present. */
export function isBeltImportConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

/**
 * POST the three Wodify exports to the gated sync-belt-retention Edge Function.
 *
 * Assembles a 3-part multipart body (field names are irrelevant — the server classifies
 * by header line), sends apikey + Authorization (anon JWT) + the import secret HEADER,
 * and deliberately sets NO Content-Type so the browser writes the multipart boundary.
 * Returns the counts-only summary on 2xx; throws a BeltImportError carrying the server's
 * reject code otherwise. The secret is never placed in the form body.
 */
export async function postBeltImport(
  files: { retention: File; current68: File; previous69: File },
  secret: string,
): Promise<BeltImportSummary> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    throw new Error('Supabase isn’t configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  }

  const form = new FormData();
  form.append('retention', files.retention);
  form.append('current68', files.current68);
  form.append('previous69', files.previous69);

  const res = await fetch(`${cfg.url}/functions/v1/sync-belt-retention`, {
    method: 'POST',
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      'x-belt-import-trigger-secret': secret,
      // NO Content-Type — the browser sets multipart/form-data with the boundary.
    },
    body: form,
  });

  if (!res.ok) {
    // Reject body is { error: <UploadRejectCode> }; fall back to a generic code if the
    // body is missing/unshaped so the caller still gets a typed, safe message.
    let code: UploadRejectCode = 'internal_error';
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === 'string') code = body.error as UploadRejectCode;
    } catch {
      /* keep the generic fallback */
    }
    throw new BeltImportError(code);
  }

  const body = (await res.json()) as Partial<BeltImportSummary>;
  return {
    rowCount: body.rowCount ?? 0,
    months: body.months ?? 0,
    monthLabels: body.monthLabels ?? [],
    conservationOk: body.conservationOk ?? false,
    bridgeCollisionFree: body.bridgeCollisionFree ?? false,
    resolvedUniqueToId: body.resolvedUniqueToId ?? 0,
    ambiguousNames: body.ambiguousNames ?? 0,
    unmatchedNames: body.unmatchedNames ?? 0,
  };
}

/**
 * Owner-facing message for a server reject code. EXHAUSTIVE switch with a `never`
 * default so TypeScript fails the build if a code is added to UploadRejectCode without
 * a message here. Never exposes upstream detail (HTTP status, error text, row data).
 */
export function beltRejectMessage(code: UploadRejectCode): string {
  switch (code) {
    case 'missing_source':
      return 'One of the three reports is missing. Choose a Member Retention export, a Progressions Current (68) export, and a Progressions Previous (69) export.';
    case 'duplicate_source':
      return 'Two files look like the same report. Choose one Member Retention, one Progressions Current (68), and one Progressions Previous (69).';
    case 'unclassified_source':
      return 'One file wasn’t recognized as any of the three reports. Re-export Member Retention, Progressions Current (68), and Progressions Previous (69), then try again.';
    case 'payload_too_large':
      return 'Those files are too large (max 5 MB each, 15 MB total). Re-export the three reports and try again.';
    case 'forbidden':
      return 'That import code wasn’t accepted.';
    case 'header_validation_failed':
    case 'conservation_failed':
    case 'name_bridge_collision':
    case 'leak_guard_tripped':
      return 'The export didn’t pass safety checks — re-export all 3 reports and try again.';
    case 'persist_failed':
    case 'aggregate_error':
    case 'internal_error':
      return 'Server couldn’t save the import — try again.';
    case 'bad_multipart':
    case 'method_not_allowed':
      return 'Couldn’t prepare the upload — reselect the three reports and try again.';
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/**
 * Advisory client-side source-kind detection for the pick UI. Reads the HEADER LINE only
 * (the caller passes the first line) and reuses the Slice-1 `classify` — no forked
 * classifier, no logic change. The server re-classifies authoritatively; this is a chip,
 * not a gate.
 */
export function detectBeltSourceKind(headerLine: string): Kind {
  return classify(headerLine);
}
