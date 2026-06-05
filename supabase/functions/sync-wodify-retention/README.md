# sync-wodify-retention Edge Function

Server-side half of the first bounded live Silent Churn + Attendance Health
slice (`RETENTION_FINISH_PLAN.md` §6). Fetches Wodify `/clients`, computes a
**non-PII aggregate**, and persists one snapshot row to
`public.wodify_retention_aggregate`. The browser never calls Wodify and never
sees the key.

> **GATED — not invoked live in this PR.** This PR ships code, schema, and tests
> only. The first live invoke requires a Reviewer audit **and** Wesley's explicit
> authorization to set the secret and run it. No secret is set and no Wodify call
> is made by this PR.

## Thin-shell design + reuse boundary

`index.ts` does only fetch + persist. **All** normalization and aggregation lives
in `src/lib/gym/wodifyRetentionAggregate.ts`, which is type-checked by
`npm run build` and covered by `npm test`
(`src/lib/gym/wodifyRetentionAggregate.test.ts`). That module imports the locked
date primitives `parseYmdLocal` and `wholeDaysBetween` from
`src/lib/gym/silentChurn.ts` and **never forks them**. It deliberately does not
import the threshold-coupled `classifyMember` / `computeAttendanceHealth`: the
server emits a **threshold-free** exact-day histogram and the SPA applies the
owner's threshold (PR2), so the live aggregate works at any threshold without
another Wodify fetch.

## Bundle/import proof (Refinement 1 — done first) — corrected

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

- **Deploy-bundler resolution — UNCONFIRMED (live-gate item).** Whether Supabase's
  actual `supabase functions deploy` / `supabase functions serve` bundler resolves
  the extensionless shared import like esbuild (resolves) or like strict Deno
  (fails) is **not proven offline**. The first live step stays blocked until a real
  deploy/serve proof confirms the shared `src/` import resolves — **without forking
  the locked date logic and without changing `tsconfig`**.

No fork of the locked date logic was introduced, and `tsconfig` is unchanged.

## Behavior

- POST only (else `405`). Reads `WODIFY_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` from the environment; any missing → generic `500`
  (never reveals which).
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
- On any error → generic `502 { "error": "sync_failed" }`. **Never logs request
  bodies, response bodies, raw rows, or the key** (the bundle contains zero
  `console.*` calls).

## Privacy guarantees (the member-PII anon-key blocker)

- Raw `/clients` rows are transient in memory only — never logged or persisted.
- The persisted row holds **no PII**: no id, name, exact member date, or dues.
  Every column is a snapshot-level date, a count, or the counts-only histogram
  (see `supabase/wodify_retention_schema.sql`). That is why the SPA may read it
  with the anon key.
- `monthlyDuesAtRisk` is always `null` + `missingMonthlyDues: true` — `/clients`
  carries no dues, and a fabricated `$0` is never emitted.

## Trigger model + deploy (when authorized — NOT yet)

Manual / admin-triggered first; a scheduled refresh comes later, only after the
first slice proves stable. Unlike `ai-proxy`, deploy **with** JWT verification
(omit `--no-verify-jwt`) so only an authenticated/service-role caller can invoke
it — there is no browser caller in this slice.

```bash
# Gated on Reviewer + Wesley approval — do NOT run as part of this PR:
supabase secrets set WODIFY_API_KEY=<value>     # server-side only; never VITE_*, never committed
supabase functions deploy sync-wodify-retention # JWT-verified (no --no-verify-jwt)
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform at
runtime; they are not set manually.

## Open items before the live invoke

- **Deploy/serve resolution of the shared `src/` import — BLOCKS the live gate.**
  Prove `supabase functions deploy` / `supabase functions serve` bundles the
  function with the shared module resolved, **without a fork or a `tsconfig`
  change**. esbuild resolves it; strict `deno check` does not; the actual deploy
  bundler is unconfirmed offline (see "Bundle/import proof").
- Confirm the live `/clients` response uses snake_case field names
  (`client_status`, `last_attendance`, `last_class_sign_in`, `is_at_risk`) as the
  §5 probe observed. If casing differs, `dataQuality.unknownStatus` / `unknown`
  will surface it loudly rather than silently mis-counting.
- Confirm the `asOf` timezone basis (server-UTC date) is acceptable vs the gym's
  local day (±1 day only at the boundary; the histogram is exact-day).
