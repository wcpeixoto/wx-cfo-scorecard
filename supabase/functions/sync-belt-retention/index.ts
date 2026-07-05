// sync-belt-retention Edge Function — Slice 2 of the self-serve Churn-by-Belt
// importer (member_retention_by_belt).
//
// UPLOAD-ONLY (Option 1). This function accepts THREE owner-uploaded Wodify CSV
// exports (client-grain Member Retention + Progressions Current 68 + Previous 69)
// via a multipart POST, reshapes them into the NON-PII per-band counts grid, and
// upserts that grid. It makes NO Wodify call and reads NO WODIFY_API_KEY — there
// is no /progressions pull on this path. Contrast sync-wodify-retention, which
// pulls /clients; this one is fed entirely by the upload.
//
// THIN SHELL by design — the only logic here is the request gate + multipart
// parse + size cap + delegation. ALL classification, aggregation, and the
// pre-write fail-closed gates live in the typechecked, vitest-covered
// src/lib/gym/beltRetentionUpload.ts, which imports the Slice-1 aggregation core
// src/lib/gym/beltRetentionAggregate.ts (no logic fork). The shared-module import
// across the runtime boundary is RESOLVED via the same Option A the
// sync-wodify-retention function proved (explicit `.ts` import +
// allowImportingTsExtensions, #435): esbuild inlines it and the Supabase
// deploy/eszip bundler resolves it. A repeatable bundle proof
// (`npm run check:belt-fn-bundle`) + a vitest guard keep Slice 1's node-builtin-
// free purity from silently regressing.
//
// Request gate (STRICT ORDER — reject before the next step's work):
//   1. non-POST → 405 (before any secret / env / parse work)
//   2. BELT_IMPORT_TRIGGER_SECRET unset → 500 (FAIL CLOSED); header mismatch →
//      403 (constant-time compare). A NEW edge secret DISTINCT from
//      SYNC_TRIGGER_SECRET — rotatable, never bundled, never in the SPA.
//   3. per-file / total body size cap on the RAW upload → 413 (before aggregation)
//   4. classify the 3 files by HEADER LINE only; missing / duplicate /
//      misclassified → 422
//   5. aggregate via the Slice-1 module (no fork)
//   6. fail closed BEFORE any write — refuse unless per-month conservation ties
//      AND the Report-69 name bridge is collision-free (+ PII leak re-scan)
//   7. write: service-role upsert only (on_conflict = workspace_id,period_month,
//      segment,belt_band; Prefer: resolution=merge-duplicates; NEVER delete/
//      truncate). Anon-SELECT-only posture preserved — no anon-write path added.
//
// Response is COUNTS-ONLY (row count, months, conservation-ok, bridge-collision-
// free). It NEVER echoes a parsed row, a member name, or an ID. Zero `console.*`
// of member data — sanitized reject codes only; the multipart body is never
// logged and is never written to Storage or any bucket.
//
// CORS / OPTIONS preflight (Slice 3): the SPA sends custom headers, so the browser
// preflights with OPTIONS and needs CORS headers on every response to read the body.
// Handled by a NARROW allowlist (corsHeadersFor in beltRetentionUpload.ts) — never
// `*`. CORS is browser-UX only; the trigger secret + service-role posture remain the
// security gate (a non-browser client ignores CORS).
//
// GATED: not invoked live in this PR. First live invoke requires a Reviewer audit
// + Wesley's explicit authorization to set BELT_IMPORT_TRIGGER_SECRET and run it
// with the x-belt-import-trigger-secret header. Deploy/arm is a separate step.

import {
  aggregateUpload,
  classifyUploads,
  contentLengthExceeds,
  corsHeadersFor,
  exceedsSizeCap,
  verifyImportSecret,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  type BeltPayload,
  type UploadRejectCode,
} from '../../../src/lib/gym/beltRetentionUpload.ts';

const BELT_TABLE = 'member_retention_by_belt';

// Hard cap on the number of multipart file parts we will read, so a body with
// thousands of parts can't exhaust memory before the size cap is evaluated.
const MAX_FILE_PARTS = 3;

// Every response carries the CORS headers for the caller's Origin — the browser
// blocks reading even a 200 body (or an error JSON) without them.
function jsonResponse(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function reject(status: number, code: UploadRejectCode, cors: Record<string, string>): Response {
  return jsonResponse(status, { error: code }, cors);
}

// Persist the NON-PII per-band grid via the Supabase REST API using the
// service-role key (bypasses RLS; never exposed to the browser). IDEMPOTENT
// UPSERT keyed on (workspace_id, period_month, segment, belt_band): re-uploading a
// later month REPLACES that (period, band) cell instead of duplicating it, and
// NEVER deletes/truncates earlier months — PostgREST `on_conflict` + `Prefer:
// resolution=merge-duplicates`, backed by the unique constraint in
// member_retention_by_belt_schema.sql. Needs service-role INSERT + UPDATE.
async function persistBeltPayload(
  supabaseUrl: string,
  serviceKey: string,
  payload: BeltPayload,
): Promise<void> {
  // Map the pure payload rows to the table columns. fetched_at defaults to now()
  // server-side; the counts are published as-is (no <5 masking, per policy).
  const rows = payload.rows.map((r) => ({
    workspace_id: r.workspace_id,
    period_month: r.period_month,
    segment: r.segment,
    belt_band: r.belt_band,
    active_count: r.active_count,
    lost_count: r.lost_count,
  }));

  const url = `${supabaseUrl}/rest/v1/${BELT_TABLE}?on_conflict=workspace_id,period_month,segment,belt_band`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`persist_http_${res.status}`); // status only — never the body
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS headers for this caller's Origin — attached to EVERY response below so the
  // browser can read the 200 body and every error JSON. Narrow allowlist, not `*`.
  const cors = corsHeadersFor(req.headers.get('Origin'));

  // 0. OPTIONS preflight FIRST — before the method guard 405s it. A 204 with the
  //    CORS headers lets the browser proceed to the real POST. No body, no work.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // 1. Method guard — non-POST short-circuits before ANY secret / env / parse work.
  if (req.method !== 'POST') {
    return reject(405, 'method_not_allowed', cors);
  }

  // 2. Structural trigger gate — a NEW secret distinct from SYNC_TRIGGER_SECRET,
  //    never bundled, never in the SPA. verify_jwt (platform) only proves the
  //    caller holds the PUBLIC anon JWT; THIS shared secret is what authorizes an
  //    upload. FAIL CLOSED if it is not configured server-side.
  const triggerSecret = Deno.env.get('BELT_IMPORT_TRIGGER_SECRET');
  if (!triggerSecret) {
    return reject(500, 'internal_error', cors);
  }
  // Constant-time compare of the provided header against the secret. Missing or
  // mismatched → generic 403 (never reveal which). No PARSING before this passes.
  const providedSecret = req.headers.get('x-belt-import-trigger-secret') ?? '';
  if (!(await verifyImportSecret(triggerSecret, providedSecret))) {
    return reject(403, 'forbidden', cors);
  }

  try {
    // 3a. Content-Length MEMORY early-out — reject an oversized body BEFORE
    //     req.formData() buffers it all into memory. BEST-EFFORT ONLY: the header
    //     can be absent (chunked) or understated, so this never REPLACES the
    //     authoritative post-parse cap below — it just avoids buffering a body we'd
    //     reject anyway. Multipart overhead means a legit ≤15 MB upload always has
    //     Content-Length ≥ its file bytes, so this can't false-reject a valid one.
    if (contentLengthExceeds(req.headers.get('Content-Length'), MAX_TOTAL_BYTES)) {
      return reject(413, 'payload_too_large', cors);
    }

    // 3b. Authoritative size cap on the RAW upload, BEFORE aggregation. Read the
    //     multipart form, collect at most MAX_FILE_PARTS file parts, and reject if
    //     any single file or the running total exceeds the cap. The `File` parts
    //     expose `.size` without materializing bytes; text is read only after this.
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      // Not a well-formed multipart body (or wrong content-type).
      return reject(400, 'bad_multipart', cors);
    }

    const files: File[] = [];
    for (const value of form.values()) {
      if (value instanceof File) {
        files.push(value);
        if (files.length > MAX_FILE_PARTS) break; // stop early — too many parts
      }
    }
    if (files.length !== MAX_FILE_PARTS) {
      // Need exactly three file parts; fewer/more (after the early break) → reject.
      return reject(400, 'bad_multipart', cors);
    }
    if (exceedsSizeCap(files.map((f) => f.size))) {
      return reject(413, 'payload_too_large', cors);
    }

    // Only now, after the cap passes, materialize the text.
    const texts = await Promise.all(files.map((f) => f.text()));

    // 4. Classify by HEADER LINE only (same routing as the CLI). Missing /
    //    duplicate / unclassified → reject before any aggregation.
    const classified = classifyUploads(texts);
    if (!classified.ok) {
      return reject(422, classified.code, cors);
    }

    // 5 + 6. Aggregate via the Slice-1 module and enforce the pre-write gates
    //         (header parse, conservation, name-bridge collision, PII re-scan).
    const aggregated = aggregateUpload({
      retention: classified.retention,
      current68: classified.current68,
      previous69: classified.previous69,
    });
    if (!aggregated.ok) {
      return reject(422, aggregated.code, cors);
    }

    // 7. Only after every gate passes do we read the data secrets and write.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return reject(500, 'internal_error', cors); // generic — never reveal which secret
    }

    try {
      await persistBeltPayload(supabaseUrl, serviceKey, aggregated.payload);
    } catch {
      return reject(502, 'persist_failed', cors); // status-only upstream, no body echoed
    }

    // COUNTS-ONLY summary back to the caller — NO raw rows, NO PII. Every field is
    // an integer, a boolean, or a YYYY-MM month label (safe by the Slice-1
    // contract). Uploaded texts are transient in memory; never logged or stored.
    return jsonResponse(200, { ok: true, ...aggregated.summary }, cors);
  } catch {
    // Sanitized catch-all — never raw err.message, URLs, headers, rows, or
    // secrets. No logging, so the function keeps its zero-`console.*` invariant.
    return reject(500, 'internal_error', cors);
  }
});

// Reference the caps so a `noUnusedLocals` sweep can't strip the import that
// documents the enforced ceiling; also keeps them greppable from the shell.
void MAX_FILE_BYTES;
void MAX_TOTAL_BYTES;
