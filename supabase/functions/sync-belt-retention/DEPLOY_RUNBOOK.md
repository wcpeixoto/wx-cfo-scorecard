# Deploy / Arm Runbook — `sync-belt-retention`

**Status: NOT deployed, NOT armed.** This document *describes* the procedure. Nothing
here is executed by the PR that adds it. Running it is a **separate, owner-authorized
step** that the Reviewer gates *after* approving this runbook.

When the runbook is later executed, run it in **default / manual permission mode** —
the native tool-approval prompts *are* the authorization gate. Stop at each numbered
boundary and confirm before proceeding.

- **Project:** `gzgxcvjvoivlwaksnmxy` (Supabase)
- **Function:** `sync-belt-retention` — upload-only importer for `public.member_retention_by_belt`
- **Contract:** 3-part multipart POST (Member Retention client-grain + Progressions
  Current 68 + Previous 69); counts-only 200; service-role write; anon-SELECT-only table.

---

## 0. Preconditions already verified (re-confirm before deploy — state can drift)

The Reviewer LIVE-verified the following against the project DB on **2026-07-05** (read-only).
They are **not** standing guarantees — **re-run the two SELECTs in step 1 immediately
before deploying**, because schema/policy state can drift between then and arm time.

- **Unique constraint is live** — `member_retention_by_belt_ws_period_segment_band_key`
  `UNIQUE (workspace_id, period_month, segment, belt_band)` exists and matches the
  function's `on_conflict` arbiter. (Also present: `PRIMARY KEY (id)`, band/period/
  non-negative `CHECK` guards.) No migration needed.
- **Anon-write boundary intact** — RLS enabled; the only policy is
  `member_retention_by_belt_anon_read` (`SELECT`, role `anon`, `using workspace_id = 'default'`).
  No anon `INSERT/UPDATE/DELETE` policy, and the broad default DML grants are revoked
  from `anon`/`authenticated`. Only the service-role key (RLS-bypass) writes.
  **Do not add any anon-write path.**

---

## 1. Pre-deploy re-confirm (READ-ONLY — run these first, every time)

Run via Supabase MCP `execute_sql` or the SQL editor. Both must match the expected result.

**1a. Unique constraint is live and correctly-keyed:**

```sql
select conname,
       pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.member_retention_by_belt'::regclass
  and contype = 'u';
```
Expect a row: `member_retention_by_belt_ws_period_segment_band_key` →
`UNIQUE (workspace_id, period_month, segment, belt_band)`.
If it is absent, **stop** — re-apply `supabase/member_retention_by_belt_schema.sql`
(the `DO` block adds it idempotently) and `notify pgrst, 'reload schema'` before deploying;
the `on_conflict` upsert 500s without it.

**1b. RLS is anon-SELECT-only (no anon write policy):**

```sql
select polname,
       cmd,
       roles::regrole[] as roles,
       pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.member_retention_by_belt'::regclass;
```
Expect exactly one policy: `member_retention_by_belt_anon_read`, `cmd = SELECT`,
`roles = {anon}`, `using_expr = (workspace_id = 'default')`.
If any `INSERT/UPDATE/DELETE/ALL` policy for `anon` appears, **stop** — the anon-write
boundary is broken; do not deploy until it is removed.

---

## 2. Deploy posture — `verify_jwt = false`

Deploy with **`verify_jwt = false`** — deliberately UNLIKE the sibling
`sync-wodify-retention` (which uses `verify_jwt = true`).

**Rationale (one line):** the browser's CORS **OPTIONS preflight carries no JWT**, so
`verify_jwt = true` would make the platform **401 the preflight** before the function's
own CORS handler runs — blocking every real POST. The security gate here is the in-function
`x-belt-import-trigger-secret` (constant-time compare) **plus** the service-role/RLS
posture, **not** the platform JWT check. CORS is browser-UX only.

**Deploy command (documented — do NOT run in this PR):**

```bash
# Supabase CLI (project already linked to gzgxcvjvoivlwaksnmxy):
supabase functions deploy sync-belt-retention --no-verify-jwt
```

Or the Supabase MCP equivalent: `deploy_edge_function` for `sync-belt-retention` with
the verify-JWT option **off** (`verify_jwt: false`). Confirm after deploy that the
function's config shows `verify_jwt = false`.

---

## 3. Arm — set the trigger secret

The function fails closed (500 `internal_error`) until `BELT_IMPORT_TRIGGER_SECRET` is set.

1. **Generate a strong secret, DISTINCT from `SYNC_TRIGGER_SECRET`:**
   ```bash
   openssl rand -base64 32
   ```
2. **Set it as a function secret** (never bundled, never in the SPA):
   ```bash
   supabase secrets set BELT_IMPORT_TRIGGER_SECRET='<generated value>'
   ```
   (Or the MCP secret-set equivalent.) The function also needs `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` — these are platform-provided to edge functions by default;
   confirm they resolve.
3. **Owner types the SAME value** into the dashboard's Settings → Data → **Churn by Belt**
   → "Import code" field at run time. It is transient in memory only — never stored,
   never logged, cleared after a successful POST and on unmount.

**Rotation (kill-switch, see §5):** re-run `supabase secrets set` with a new value. Every
in-flight or subsequent upload using the old code instantly fails closed with `403 forbidden`.
Unsetting it entirely makes the function fail closed with `500 internal_error`.

---

## 4. First-invoke smoke test

Use the **smallest real 3-CSV set** (one Member Retention client-grain export + Progressions
68 + Progressions 69). Prefer the UI path; the `curl` form is for a controlled test.

**4a. Via the UI (preferred):** Settings → Data → Churn by Belt → pick the 3 files → enter
the import code → **Run belt import**. Expect a **counts-only 200** rendering:
`rowCount`, `months`, `monthLabels`, `conservationOk = true`, `bridgeCollisionFree = true`,
`ambiguousNames`, `unmatchedNames`. Any non-2xx renders a safe `beltRejectMessage` — no PII.

**4b. Via `curl` (controlled test — substitute real values):**

```bash
curl -i -X POST \
  "https://gzgxcvjvoivlwaksnmxy.supabase.co/functions/v1/sync-belt-retention" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${VITE_SUPABASE_ANON_KEY}" \
  -H "x-belt-import-trigger-secret: ${BELT_IMPORT_TRIGGER_SECRET}" \
  -F "retention=@member_retention.csv;type=text/csv" \
  -F "current68=@progressions_current_68.csv;type=text/csv" \
  -F "previous69=@progressions_previous_69.csv;type=text/csv"
# Do NOT set Content-Type manually — curl -F sets the multipart boundary.
```
Expect `HTTP/2 200` with `{ "ok": true, ... }` counts-only body.

**4c. Verify the write (READ-ONLY):**

```sql
select period_month, count(*) as rows, sum(active_count) as active, sum(lost_count) as lost
from public.member_retention_by_belt
where workspace_id = 'default'
group by period_month
order by period_month;
```
Confirm the imported `period_month`(s) are present with the expected row counts.

**4d. Verify the logs are clean:** check `get_logs` (or the Functions log view) for the
invoke — it must show **only** sanitized reject codes (or nothing on success). **No member
names, no IDs, no request body, no secret.** If any PII appears, disarm immediately (§5).

---

## 5. Disarm / rollback

**Kill switch — the trigger secret is the only arming control:**
- **Rotate** (`supabase secrets set BELT_IMPORT_TRIGGER_SECRET='<new>'`) → old code → `403`.
- **Unset** the secret → function fails closed with `500` on every upload.

**There is NO destructive path.** Writes are **idempotent upserts** on
`(workspace_id, period_month, segment, belt_band)` with `Prefer: resolution=merge-duplicates`
and **no delete/truncate**. So a bad import is corrected, not "rolled back":
- **Re-upload corrected CSVs** — the upsert overwrites the affected `(period_month, band)`
  cells in place; earlier months are untouched.
- **Identify a bad import** by `period_month` and the write-time `fetched_at` stamp:
  ```sql
  select period_month, belt_band, segment, active_count, lost_count, fetched_at
  from public.member_retention_by_belt
  where workspace_id = 'default'
  order by fetched_at desc
  limit 50;
  ```
- **Targeted service-role fix** (only if re-upload can't express the correction) — a scoped
  `UPDATE`/`DELETE` on specific `(period_month, segment, belt_band)` rows via the SQL editor /
  MCP under human authorization. Never a bulk `TRUNCATE`.

---

## 6. CORS origin reminder

The function's `corsHeadersFor` allowlist (in `src/lib/gym/beltRetentionUpload.ts`) is:
`https://wcpeixoto.github.io` and `https://scorecard.wxestates.com`.

- **`https://wcpeixoto.github.io`** is the LIVE GitHub-Pages serving origin today — confirm
  the import is exercised from there.
- **`https://scorecard.wxestates.com`** is allowlisted but the custom domain is **NOT live
  yet** — verify it actually serves the SPA before relying on it, otherwise the preflight
  from that origin succeeds in code but the page isn't there.

If a new serving origin is ever added, it must be added to `corsHeadersFor` (and this list)
first, or the browser blocks the POST.
