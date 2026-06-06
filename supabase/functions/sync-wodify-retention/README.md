# sync-wodify-retention Edge Function

Server-side half of the first bounded live Silent Churn + Attendance Health
slice (`RETENTION_FINISH_PLAN.md` §6). Fetches Wodify `/clients`, computes a
**non-PII aggregate**, and persists one snapshot row to
`public.wodify_retention_aggregate`. The browser never calls Wodify and never
sees the key.

> **GATED — deployed but INERT.** The function is deployed and **ACTIVE**
> (`verify_jwt: true`) but holds **no `WODIFY_API_KEY`**, has never been invoked,
> makes no Wodify call, and is not wired to the SPA. The first live invoke requires
> a Reviewer audit **and** Wesley's explicit authorization to set the secret and run
> it. No secret is set and no Wodify call is made.

## Thin-shell design + reuse boundary

`index.ts` does only the request gate + fetch + persist. **All** normalization and
aggregation lives in `src/lib/gym/wodifyRetentionAggregate.ts`, and the pure
request-gate helpers (`classifySyncError`, `verifyTriggerSecret`) in
`src/lib/gym/wodifyRetentionSync.ts` — both type-checked by `npm run build` and
covered by `npm test`
(`src/lib/gym/wodifyRetentionAggregate.test.ts`, `src/lib/gym/wodifyRetentionSync.test.ts`).
The aggregate module imports the locked
date primitives `parseYmdLocal` and `wholeDaysBetween` from
`src/lib/gym/silentChurn.ts` and **never forks them**. It deliberately does not
import the threshold-coupled `classifyMember` / `computeAttendanceHealth`: the
server emits a **threshold-free** exact-day histogram and the SPA applies the
owner's threshold (PR2), so the live aggregate works at any threshold without
another Wodify fetch.

## Bundle/import proof (Refinement 1 — done first) — RESOLVED (Option A, #435)

The one architectural risk was whether a Deno Edge Function can import the shared
`src/` module across the runtime boundary (the repo's only other function,
`ai-proxy`, is self-contained). Result, with **no network and no live Wodify
call** — and **nuanced**, not a clean pass:

- **esbuild bundle — PASSES.**

  ```bash
  npx esbuild supabase/functions/sync-wodify-retention/index.ts \
    --bundle --format=esm --platform=neutral --outfile=/tmp/idx.mjs   # exit 0, ~7kb
  ```

  esbuild resolves the repo-style extensionless `./silentChurn` value import,
  strips the type-only `./memberFixture` import, and **inlines** the locked
  helpers (`parseYmdLocal` / `wholeDaysBetween` / `computeRetentionAggregate`)
  into the bundle (no fork).

- **Bare / strict `deno check` — FAILS** on the extensionless shared import. The
  exact bytes copied into a clean tree report:

  ```
  TS2307 [ERROR]: Cannot find module '…/silentChurn'.
    Maybe add a '.ts' extension or run with --sloppy-imports
      at …/wodifyRetentionAggregate.ts  (import { … } from './silentChurn')
  ```

  An earlier in-repo `deno check` that appeared to pass was a **local-environment
  artifact** — it does **not** reproduce on a clean copy of the same bytes — and is
  **not** representative of deploy resolution. Do not rely on it. *(An earlier
  draft of this README incorrectly claimed bare `deno check` passes; that claim is
  retracted here.)*

- **Function-local `deno.json` mitigation — landed (#432, `b618d02`), then DISPROVEN
  at the deploy path and REMOVED.** A minimal
  `supabase/functions/sync-wodify-retention/deno.json` = `{"unstable":["sloppy-imports"]}`
  briefly shipped alongside the function. On a clean copy of the exact bytes, strict
  `deno check` **passed with this config** (and failed without it), so sloppy-imports
  resolved the transitive extensionless `./silentChurn` import at the *`deno check`*
  level — but it did **not** resolve it at the actual Supabase **deploy/eszip** path
  (it was present in both the failed and the later passing deploy → not the
  load-bearing fix; see the deploy bullet). With Option A selected, this `deno.json`
  is dead weight and has been **removed**.

- **Deploy-bundler resolution — RAN 2026-06-05, result FAIL (live gate stays OPEN).**
  The deploy/eszip proof was actually run:
  `supabase functions deploy sync-wodify-retention --project-ref gzgxcvjvoivlwaksnmxy`
  (Reviewer-validated, Wesley-authorized; named-function-only, no `--no-verify-jwt`, no
  secret, no invoke). The edge-runtime image (`v1.73.13`) pulled and ran, then the deploy
  errored at **graph creation**:

  ```
  Error: failed to create the graph
  Caused by:
      Module not found ".../src/lib/gym/silentChurn".
          at .../src/lib/gym/wodifyRetentionAggregate.ts:24
  ```

  This is a genuine bundle-time **module-resolution FAIL**, not a Docker / CLI / network /
  auth / project-ref BLOCK. **Proven fact (narrow):** with **Supabase CLI 2.98.2** and
  **edge-runtime v1.73.13**, this deploy path did **not** resolve the extensionless
  `./silentChurn` import from the shared `src/` graph despite the function-local
  `deno.json`. **Not claimed:** whether deploy failed to *discover* the `deno.json` or
  discovered it but did not *honor* `sloppy-imports` (this run does not distinguish them),
  nor that a future CLI / edge-runtime version could never resolve it. **Platform stayed
  clean at that point:** `sync-wodify-retention` remained **not deployed**; `ai-proxy`
  unchanged (v2, `verify_jwt:false`, `ezbr_sha256 3d392f3e…`); no `WODIFY_API_KEY`; no
  serve / invoke / POST / Wodify call. **Resolution (Option A) was then selected — see
  the next bullet.** Of the candidate fixes, two were chosen (an explicit `.ts` on the
  shared import + an additive `allowImportingTsExtensions` `tsconfig` change); forking
  the locked date logic, an import map, and a generated bundle were **not** needed.

- **Option A — SELECTED and PROVEN (#435, `b6bd9d6`, 2026-06-05) — import-resolution
  sub-gate CLOSED.** Add the explicit `.ts` extension to the one shared value import
  (`'./silentChurn'` → `'./silentChurn.ts'` in `wodifyRetentionAggregate.ts`), paired
  with `allowImportingTsExtensions: true` in `tsconfig.app.json` (legal because `noEmit`
  is set, so the SPA typecheck accepts the `.ts`-extensioned import). Decisive evidence:
  the deploy had already resolved the `.ts`-extensioned `index.ts`→aggregate hop, so
  making `./silentChurn` explicit gave it the same proven-working form. The
  named-function deploy then **succeeded** (bundled from the edited tree) and `main`
  reproduces the deployed function. **`silentChurn.ts` was not touched** — its only
  transitive import is the type-only `./memberFixture`, which the bundler erases, so the
  feared lock-bound dead-end did not materialize. No fork of the locked date logic was
  introduced; the only `tsconfig` change is the additive `allowImportingTsExtensions`.

## Behavior

- Request gate, strict order: non-`POST` → `405` (before any secret/env/Wodify
  work — preserves the Step 0 reachability probe); `SYNC_TRIGGER_SECRET` unset →
  generic `500` (**fail closed**); `x-sync-trigger-secret` header missing or not
  matching (constant-time digest compare) → `403`; then `WODIFY_API_KEY`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are read from the environment, any
  missing → generic `500` (never reveals which).
- Paginates `GET https://api.wodify.com/v1/clients?page=N&pageSize=100` with the
  `x-api-key` header, records under `clients`, looping while
  `pagination.has_more` (hard cap `MAX_PAGES = 50`). If the cap is hit while
  `has_more` is still true, `dataQuality.reachedPageCap` flags the partial
  snapshot — never a silent truncation. Request shape matches the §5 probes
  (`scripts/wodify/clientsRecencyProbe.ts`).
- Calls `computeRetentionAggregate(rows, { asOf, fetchedAt, pagesFetched, reachedPageCap })`.
- Persists the aggregate via the Supabase REST API using the **service-role**
  key (bypasses RLS; never browser-exposed). Append-only snapshot insert.
- Returns a **counts-only** summary (`activeTotal`, `unknown`, `diagnostics`,
  `dataQuality`) — never raw rows.
- On any error → `502 { "error": "sync_failed", "code": <class> }`, where `code`
  is a fixed-vocabulary class — `wodify_clients_http_<status>`,
  `persist_http_<status>`, `bad_asof`, `timeout`, `parse_error`, `network_error`,
  or `unknown` (see `classifySyncError`). It is **never** a raw error message,
  URL, query string, header, row, or secret. **Nothing is logged** — the bundle
  still contains zero `console.*` calls; the `code` is returned in-body only.

## Privacy guarantees (the member-PII anon-key blocker)

- Raw `/clients` rows are transient in memory only — never logged or persisted.
- The persisted row holds **no PII**: no id, name, exact member date, or dues.
  Every column is a snapshot-level date, a count, or the counts-only histogram
  (see `supabase/wodify_retention_schema.sql`). That is why the SPA may read it
  with the anon key.
- `monthlyDuesAtRisk` is always `null` + `missingMonthlyDues: true` — `/clients`
  carries no dues, and a fabricated `$0` is never emitted.

## Trigger model + deploy (deployed; live invoke gated — NOT yet)

The function is **already deployed** (JWT-verified, `verify_jwt: true`) but holds no
key and has never run. Manual / admin-triggered first; a scheduled refresh comes
later, only after the first slice proves stable. **Two gates, not one:**
`verify_jwt: true` only keeps out *unauthenticated* callers — it admits **any**
valid project JWT, including the **public anon key** that ships in the SPA bundle,
so it is **not** sufficient on its own. The structural authorization is the
**`SYNC_TRIGGER_SECRET`** shared secret: every POST must send a matching
`x-sync-trigger-secret` header (constant-time compared) or it is rejected `403`
before any Wodify work, and if the secret is not configured server-side the
function **fails closed** (`500`) — never open. Any redeploy must stay
**name-scoped** so a bare `supabase functions deploy` never also redeploys
`ai-proxy` (which must remain `verify_jwt:false`).

```bash
# Gated on Reviewer + Wesley approval — the live-invoke step, NOT run yet:
supabase secrets set SYNC_TRIGGER_SECRET=<value>  # structural trigger gate; server-side only
supabase secrets set WODIFY_API_KEY=<value>       # server-side only; never VITE_*, never committed
# Function is already deployed JWT-verified; any redeploy stays name-scoped:
supabase functions deploy sync-wodify-retention --project-ref gzgxcvjvoivlwaksnmxy
# Then invoke with BOTH the anon JWT and the trigger header (POST):
#   curl -X POST .../functions/v1/sync-wodify-retention \
#     -H "Authorization: Bearer <anon>" -H "apikey: <anon>" \
#     -H "x-sync-trigger-secret: <value>"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform at
runtime; they are not set manually.

## Open items before the live invoke

- **Deploy/import resolution — CLOSED via Option A (#435, `b6bd9d6`, 2026-06-05).** The
  import-resolution sub-gate is closed: the explicit `./silentChurn.ts` import +
  `allowImportingTsExtensions` resolved the shared `src/` graph at the Supabase
  deploy/eszip path (the named-function deploy succeeded — see "Bundle/import proof").
  The function is deployed and **ACTIVE** (`verify_jwt: true`) but **INERT** — no key,
  never invoked, not wired to the SPA. The remaining §6 gate is the **first authorized
  live invoke** (Reviewer audit + Wesley's explicit authorization), which alone proves
  whether Wodify supplies `status` / `lastCheckIn` cleanly and globally.
- Confirm the live `/clients` response uses snake_case field names
  (`client_status`, `last_attendance`, `last_class_sign_in`, `is_at_risk`) as the
  §5 probe observed. If casing differs, `dataQuality.unknownStatus` / `unknown`
  will surface it loudly rather than silently mis-counting.
- Confirm the `asOf` timezone basis (server-UTC date) is acceptable vs the gym's
  local day (±1 day only at the boundary; the histogram is exact-day).
