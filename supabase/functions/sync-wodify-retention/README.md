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

## Bundle/import proof (Refinement 1 — done first)

The one architectural risk was whether a Deno Edge Function can import the shared
`src/` module across the runtime boundary (the repo's only other function,
`ai-proxy`, is self-contained). Proven before any other work, with **no network
and no live Wodify call**:

```bash
# Deno type resolution across the boundary:
deno check supabase/functions/sync-wodify-retention/index.ts      # → Check … (no errors)

# esbuild bundle (mirrors the deploy bundler) — the shared module inlines:
npx esbuild supabase/functions/sync-wodify-retention/index.ts \
  --bundle --format=esm --platform=neutral --outfile=/tmp/idx.mjs # → 7.0kb, exit 0
```

Both pass: Deno's runtime resolves the repo-style extensionless `./silentChurn`
value import, esbuild strips the type-only `./memberFixture` import, and the
locked helpers are inlined into the bundle. No `tsconfig` change, no extension
gymnastics, no fork.

## Behavior

- POST only (else `405`). Reads `WODIFY_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` from the environment; any missing → generic `500`
  (never reveals which).
- Paginates `GET https://api.wodify.com/v1/clients?page=N&pageSize=100` with the
  `x-api-key` header, records under `clients`, looping while
  `pagination.has_more` (hard cap `MAX_PAGES = 50`). Request shape matches the §5
  probes (`scripts/wodify/clientsRecencyProbe.ts`).
- Calls `computeRetentionAggregate(rows, { asOf, fetchedAt, pagesFetched })`.
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

- Confirm the live `/clients` response uses snake_case field names
  (`client_status`, `last_attendance`, `last_class_sign_in`, `is_at_risk`) as the
  §5 probe observed. If casing differs, `dataQuality.unknownStatus` / `unknown`
  will surface it loudly rather than silently mis-counting.
- Confirm the `asOf` timezone basis (server-UTC date) is acceptable vs the gym's
  local day (±1 day only at the boundary; the histogram is exact-day).
