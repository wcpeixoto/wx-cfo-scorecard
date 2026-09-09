# sync-wodify-retention Edge Function

Server-side Wodify retention snapshot writer. The WO-2 v3 candidate adds a
paged, aggregate-only student census while preserving the existing Silent
Churn, Attendance Health, tenure, cohort, dues, and diagnostic payload. The
browser never calls Wodify and never sees either data credential.

> **WO-2 v3 is implemented locally but is not deployed and its SQL is not
> applied.** `mode=page` and `mode=finalize` become operative only after the
> additive canonical-schema delta and the name-scoped function deployment are separately
> reviewed and explicitly authorized. The historical live-state record below
> describes the pre-WO-2 deployment, not this local candidate.

> **TENURE AGGREGATE-EXTENSION PULL DONE (2026-06-11) — DISARMED again; canonical identity
> `ezbr_sha256 3ae170006fa0ca27ed9bb23b9e4c7f8482b83cdd616ab2da245e5893cf6a2719`.**
> The function is deployed and **ACTIVE** (`verify_jwt: true`, via `list_edge_functions`). Identity
> history: `35e21c14…` (#441-era) → `a4b19062…` (idempotent-upsert redeploy, 2026-06-08) → `eb5f5a33…`
> (#445 gym-local `asOf` redeploy, 2026-06-08) → `40307a38…` (census-populate redeploy, 2026-06-10 —
> first bundle carrying the binary-census writer against the `20260610193617` nullable `inactive_total`
> column) → **`3ae17000…`** (tenure aggregate-extension redeploy, 2026-06-11 — first bundle carrying
> the per-tenure-band histogram writer against the `20260611130857` nullable `tenure_band_histogram`
> column). **Three authorized live invokes have run**, each under a Reviewer audit + Wesley's
> authorization: 2026-06-07 (first pull — 412 active / 956 scanned, conservation residual 0),
> 2026-06-10 (census-populate pull — 408 active / 549 inactive / 957 scanned, conservation residual 0,
> inserted as a second row), and 2026-06-11 (tenure pull — 408 active / 549 inactive / 957 scanned,
> conservation residual 0, band totals 75/60/93/86/94 + unknownTenure 0 = 408, upserted as a third
> row). The SPA reads the aggregate snapshot (Attendance Health #447, Silent Churn
> #448, MM census live since the 2026-06-10 pull, Churn Risk by Tenure live since the 2026-06-11
> pull). Between runs it is **DISARMED**: it holds **no
> `SYNC_TRIGGER_SECRET` and no `WODIFY_API_KEY`** (per `supabase secrets list`, corroborated by the
> fail-closed gate code) and makes no Wodify call. Any re-arm / further pull / scheduled pull requires a
> **fresh Reviewer audit + Wesley authorization**. **Identity note:** secrets operations bump EVERY
> function's platform version counter project-wide while `ezbr_sha256` + `updated_at` stay unmoved —
> identify deployments by **`ezbr_sha256` + `updated_at`, never version**.

## Slice 1 operational contract (candidate, 2026-09-09)

The canonical, self-contained SQL is `supabase/wodify_retention_schema.sql`.
Its marked `BEGIN STUDENT CENSUS DELTA` / `END STUDENT CENSUS DELTA` block is
the additive payload for an existing canonical schema. All ten final census fields
are nullable with no default, so historical rows remain unknown, not zero.
Drafts contain only counts plus run/page/time metadata. RLS is enabled, all
PUBLIC/anon/authenticated privileges are revoked, and only service-role DML is
granted. This work does not reconcile migration history.

Each request has a **55-second server-side deadline**, covering list/detail
HTTP, response bodies, sequential 500ms waits, bounded detail retries, draft
reads, cleanup and writes. Each Wodify fetch additionally times out at 15 seconds.
Detail 408/5xx, network errors and malformed JSON have at most three attempts;
429 aborts immediately. A malformed detail, an unclassified client or exhausted
detail retries rejects the page without storing a new draft. List requests are
not retried. Census pages contain at most 25 rows and page numbers must be 1..200
(a numeric bound, not guaranteed 5,000-client runtime capacity: the one-hour
freshness window and workflow timeout can bind first); overfull pages, empty nonterminal pages, an unterminated
page 200, malformed pagination/rows, invalid identifiers
and unrecognized wire statuses fail closed. Identifiers are transient in memory
only: duplicates within a page and within the final full-list request reject.

The workflow serializes scheduled/manual runs with one concurrency group and
does not cancel an active run. It invokes pages sequentially with bounded curl
connect/total timeouts, stops on any failed page and calls finalize only after a
terminal page. Finalize requires complete page coverage, conserved counts,
zero failed/unclassified clients, and every page collected within **one hour**
and on the current gym-local date. Freshness is checked again immediately before
the final write. Replacing a draft refreshes its collection timestamp; retrying
only some pages cannot make the remaining old pages fresh.

**Population identity limit:** matching scanned/active totals and complete page
numbers do not prove that independent requests observed the same clients.
Concurrent additions/removals or reordering can substitute equal-sized populations
between census pages and the final scan. There is no documented upstream snapshot
token used here, and no cross-request identifiers or fingerprints are stored.
Within-request duplicate detection and freshness reduce detectable failures but
cannot establish cross-request identity. This census is a bounded collection,
not a proven atomic upstream snapshot. The legacy attendance, tenure and cohort
histograms still describe raw clients and remain unchanged. Current dashboard
views consume only the separate versioned student payload described below.

### Page-failure diagnostics

A present group is treated as Wodify's no-group sentinel only when `group_role`
is a string that trims to empty **and** `group_id` is numeric `0`. It then follows
the existing no-group rule: at least one valid sign-in means student; zero means
guardian-only; missing/invalid sign-ins remain unclassified with
`invalid_no_group_signins`. String `"0"`, other falsy IDs, a nonzero ID with an
empty role, and any nonempty unrecognized role do not qualify. Their existing
unclassified behavior and reason codes remain unchanged.

An otherwise completed page with unclassified clients or failed details still
returns HTTP **409**, `error: "page_classification_failed"`, and writes no draft.
Its response also contains `unclassified_total`, `detail_clients_failed`,
`unclassified_reasons`, and `detail_http_status_counts`. Reasons are fixed keys:
`invalid_detail_record`, `invalid_no_group_signins`, `invalid_group_or_missing_role`,
`unrecognized_group_role`, `invalid_guardian_signins`, `invalid_client_id`, and
`detail_fetch_failed`. Each unclassified client contributes to one reason; the
reason counts sum to `unclassified_total`. These observe the existing rejection
branches without changing classification.

HTTP status counts include every non-2xx detail attempt, including retries that
later succeed. Network failures and malformed JSON do not invent an HTTP failure
status; exhausted attempts still contribute to `detail_fetch_failed`. The existing
immediate 429 abort and whole-request timeout paths remain unchanged. Diagnostics
are request-local aggregate counts only: no detail values, IDs, names, source
roles, response bodies, headers or credentials are emitted or persisted. Page
success responses, persisted rows and finalize behavior are unchanged.

For an explicitly authorized single-page check, manually dispatch **Tenure Snapshot
Clock** with `diagnostic_page` set to an integer from **1 through 200**. The job
generates a fresh run UUID internally and invokes exactly that page once. Invalid
nonzero inputs fail before any request. The diagnostic prints only a validated
aggregate failure payload or the existing
aggregate success-summary fields, and then stops. A failing page fails the job;
a passing page succeeds and may persist its normal page draft. Neither outcome
requests another page, finalize, or final-snapshot read-back. The run UUID is never
printed. The input defaults to `0` (omitted or `0` means the normal full manual run)
and is considered only for manual dispatch; Monday scheduled runs retain their
existing complete page/finalize/read-back command path.

Diagnostic failures now identify their reporting boundary with a fixed `origin`
and, when an HTTP response was received, its numeric `http_status`:

- `workflow_input`: the local diagnostic page bound check failed before curl.
- `workflow_transport`: curl failed; no HTTP origin is inferred.
- `edge_request_validation`: HTTP 400 with the function's `invalid_request` error.
- `edge_classification`: the valid HTTP 409 aggregate contract above.
- `upstream_wodify`: HTTP 502 with `sync_failed` and an allowlisted
  `wodify_clients_http_NNN` or `wodify_detail_http_NNN` code.
- `edge_function`: another recognized function error/status pair or a fixed
  allowlisted sync code. `timeout`, `network_error` and `parse_error` do not by
  themselves identify which dependency failed.
- `workflow_response_validation`: a received page summary/409 payload failed
  the workflow's aggregate contract, or the HTTP status itself was malformed.
- `gateway_or_unrecognized_response`: the status is preserved but the body does
  not match a known function contract. This includes gateway-like responses;
  it does not prove that the gateway caused the failure.

Only fixed origin/error values, bounded numeric HTTP statuses, allowlisted
function codes, and validated aggregate counts reach logs. Unrecognized messages,
HTML, response headers and raw bodies remain unprinted. Origins are inferred
from matching known response contracts, not from new server tracing metadata.

Diagnostic run `34416975969` accepted page 41 and reached curl, then printed the
old `invalid_page_diagnostic` fallback for an unmatched non-200 response. That
fallback discarded the HTTP status and cannot establish local input rejection
or systematic page-41 failure. Any earlier systematic-page conclusion is
retracted: the original 502 remains unexplained, and retries remain open to the
operator after review. This diagnostic plumbing change does not retry it.

### Reviewed deployment and read-back sequence (not executed here)

1. Independent Reviewer checks exact function/module/workflow/schema bytes and
   tests. Under the coordinator's later release, freshly read the CFO project's
   function identity (`ezbr_sha256`, `updated_at`, JWT mode), existing schema,
   grants/policies and current aggregate. Capture the same-day human-written
   `silent_dues_snapshot` for comparison. Historical values below are not a live
   baseline. Target only project `gzgxcvjvoivlwaksnmxy`.
2. Apply only the reviewed additive SQL block to that existing schema. Verify
   the ten nullable/no-default fields, draft primary key/checks, RLS and effective
   role privileges. No migration repair, db pull/push or baseline reconstruction.
   Rehearse the self-contained schema and delta in a disposable database when
   one is available. The final local candidate was tested on PostgreSQL 17 in
   network-isolated container cfo-census-validation-20260909, fresh database
   cfo_student_final_20260909: original schema + original draft SQL + exact final
   delta + canonical reapplication; history, dues, nullable fields, zero, RLS,
   browser-denied grants, service-role CRUD and page bounds passed.
3. Deploy only `sync-wodify-retention` with its reviewed shared-module graph and
   JWT verification retained. Read back deployed bytes/identity. Do not deploy
   unrelated functions or change secrets/settings as an implied part of this step.
4. Under the separately released supervised run, use a fresh UUID and the workflow
   sequence: pages 1..terminal, then finalize with that UUID. Every page must pass
   its under-60s acceptance check. Stop on any failure; never finalize a partial
   run. Confirm response conservation and zero unclassified/detail failures.
5. Independently read the persisted aggregate by workspace/day and match its
   `fetched_at` to the finalize response, student/path/guardian totals, completed
   pages, legacy histograms and diagnostics. Compare the captured same-day human
   dues value exactly; for a new day it remains null until a human writes it.
   Verify draft denial for browser roles and weekly workflow readiness. Browser-check
   the three current student cards, unknown attendance and their unavailable/zero
   states, plus historical class-plan source labels.

Recovery: failed pages/finalize validation never publish partial final counts;
use a new UUID for a replacement run. Old drafts expire for publication after
one hour and are cleaned after seven days during a later successful finalize.
Same-day final writes merge only supplied columns, preserving human dues.
A transport timeout after sending a database write has an uncertain commit
outcome: cancellation cannot undo a database commit. Independently read the
workspace/day row before retrying; never infer rollback from a client timeout.
The upsert remains idempotent. Concurrency is workflow-level only; manual direct
invocations must also be serialized by the operator.

## Slice 2 student payload and dashboard

During each classified page pass, only admitted active students contribute to
`student_retention`: version 1, collection day, student total, unknown attendance,
global recency bins, tenure bins and active age bins. It contains no inactive or
lapsed counts. The same deterministic raw normalizer and band definitions are
reused; no new attendance rule is introduced. Drafts store this counts-only JSON
alongside page counters. Finalize strictly validates each draft and merges every
bin, including unknown age/tenure/recency and overflow, into one final payload.
It never derives student numerators from the independent raw-client scan.

The frontend reads `student_retention`, census totals and date from the same
latest row. It requires version/date/total agreement, nonnegative safe-integer
counts, exact keys and band definitions, exact per-day partition conservation,
complete census pages, zero failures/unclassified clients and path conservation.
Missing, malformed, prior-version, future-dated or more-than-14-day-old data
makes all three current student cards explicitly unavailable. It never searches
older rows for a non-null student payload and never substitutes sample/raw counts.
A valid zero remains zero. Valid weekly snapshots display their as-of date.

Attendance Health always discloses the whole-gym student total and the current
selection's attendance-known rate base and missing-attendance count. Filtering
also labels the selected total separately. The display-only missing-attendance
setting controls extra notes, never these audit counts or rate denominators.
`ambiguous_no_signin_with_membership` counts only no-group clients with zero
sign-ins and `has_membership=true`; it does not include Guardian-role clients
and does not change classification.

Attendance Health (including its existing age/tenure selections), Risk by Time
as Member and by Age Group use only this payload. Existing attendance-known
denominators and the unknown-recency setting remain unchanged. Historical
Evolution and Belt rates retain their formulas and period-specific Class Plan
Member Retention report sources; they are labeled class-plan members. The
current student census does not establish historical student identity. Hidden
dues/Member Movement remain hidden and raw inactive/source tables remain intact.

Census page size 25 means fixed cadence is 12.5 seconds, leaving 42.5 seconds
for HTTP and persistence within the 55-second budget. A full-page handler test
with 25 Active clients and one-second simulated HTTP responses completes in
37.5 seconds, sequentially. This is a headroom test, not evidence of real Wodify
latency. Finalize uses separate 100-row bulk pages, at most 50, with no detail
requests; its 55-second deadline still applies. Workflow remains bounded to one
hour. The schema tolerates legacy 100-row drafts for nondestructive upgrades,
but runtime finalize requires 25-row drafts with a valid versioned payload.

## Shared implementation

`index.ts` owns only request gating, sequential HTTP, and persistence. Existing
retention normalization stays in `src/lib/gym/wodifyRetentionAggregate.ts`;
student classification, page summaries, finalize validation, and the complete
persistence-row merge live in `src/lib/gym/wodifyStudentCensus.ts`; request-gate
helpers stay in `src/lib/gym/wodifyRetentionSync.ts`. All three shared modules
are type-checked by `npm run build` and covered by `npm test`.
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
  missing → generic `500` (never reveals which). A malformed body or invalid
  `run_id`/page is rejected `400` before any data call.
- `mode=page` accepts a UUID `run_id` and positive integer `page`, fetches exactly
  `GET /clients?page=N&page_size=25`, and calls `GET /clients/{id}` sequentially
  only for rows whose wire status is exactly `Active`. It upserts one counts-only
  draft by `(run_id,page)` and returns the same counts plus `page`, `pageSize`, and
  `hasMore`; no ID or detail value crosses the response/persistence boundary.
- `mode=finalize` accepts the UUID `run_id`, re-fetches the complete fast
  `/clients` list, and calls
  `computeRetentionAggregate(rows, { asOf, fetchedAt, pagesFetched, reachedPageCap })`.
  Since the §6 aggregate extension this also bins ACTIVE members into per-tenure-band
  recency histograms from `member_since` (normalized by the same
  ISO-slice → `1900-01-01`-sentinel → `parseYmdLocal` rule; unusable or after-`asOf`
  starts route to the unknown-tenure bucket, never dropped). Band edges live in
  `src/lib/gym/tenureBands.ts` (dependency-free, shared with the SPA card — one
  definition; imported with the proven explicit-`.ts` Option-A form). It then
  requires exactly one terminal page, a complete 1..terminal sequence, exact
  row/active conservation, zero unclassified clients, and zero detail failures.
- Only after those gates pass, persists the aggregate via the Supabase REST API using the **service-role**
  key (bypasses RLS; never browser-exposed). **Idempotent upsert** keyed on
  `(workspace_id, as_of)` — PostgREST `on_conflict=workspace_id,as_of` +
  `Prefer: resolution=merge-duplicates`, backed by the unique constraint in
  `wodify_retention_schema.sql`. A same-day re-pull **replaces** the day's row
  instead of duplicating it; rows still accumulate across days. The payload is
  the complete existing aggregate plus the new census totals; same-day upserts
  continue to omit and therefore preserve `silent_dues_snapshot`.
- A finalize validation failure returns `409` with a fixed code and the two
  conflicting aggregate counters; it does not write the final table.
- On any error → `502 { "error": "sync_failed", "code": <class> }`, where `code`
  is a fixed-vocabulary class — Wodify list/detail HTTP status, census
  persist/read/cleanup status, final persist status, `bad_asof`, `timeout`,
  `parse_error`, `network_error`, or `unknown` (see `classifySyncError`). It is
  **never** a raw error message,
  URL, query string, header, row, or secret. **Nothing is logged** — the bundle
  still contains zero `console.*` calls; the `code` is returned in-body only.

## Privacy guarantees (the member-PII anon-key blocker)

- Raw `/clients` and `/clients/{id}` rows are transient in memory only — never
  logged, persisted, or returned.
- The persisted row holds **no PII**: no id, name, exact member date, or dues.
  Every column is a snapshot-level date, a count, or a counts-only histogram
  (days-absent / tenure-band — `member_since` is read for BANDING only and never
  leaves the normalize step; see `supabase/wodify_retention_schema.sql`). That is
  why the SPA may read it with the anon key.
- `monthlyDuesAtRisk` is always `null` + `missingMonthlyDues: true` — `/clients`
  carries no dues, and a fabricated `$0` is never emitted.

## Historical trigger model + deploy record (pre-WO-2; do not use as the WO-2 invocation contract)

The function is **deployed** (JWT-verified, `verify_jwt: true`). The first authorized invoke
ran once on **2026-06-07** and the function is now **disarmed** (no key set). Manual /
admin-triggered; a scheduled refresh comes later, only after the first slice proves stable and
only under fresh authorization. **Two gates, not one:**
`verify_jwt: true` only keeps out *unauthenticated* callers — it admits **any**
valid project JWT, including the **public anon key** that ships in the SPA bundle,
so it is **not** sufficient on its own. The structural authorization is the
**`SYNC_TRIGGER_SECRET`** shared secret: every POST must send a matching
`x-sync-trigger-secret` header (constant-time compared) or it is rejected `403`
before any Wodify work, and if the secret is not configured server-side the
function **fails closed** (`500`) — never open. Any redeploy must stay
**name-scoped** so a bare `supabase functions deploy` never also redeploys
`ai-proxy` (which must remain `verify_jwt:false`).

**Secrets are never placed on argv, shell history, `ps`, committed files, chat, or
logs.** Use one of the two secret-safe forms below — **never** the inline
`supabase secrets set NAME=value` form (the value would land in shell history / `ps`).

**Canonical live-invoke order (EXECUTED once 2026-06-07; remains the repeatable runbook).** This
sequence ran once under Reviewer + Wesley authorization; the function is now disarmed. Any re-run
(re-arm Step A→D, second pull, or scheduled pull) requires **fresh authorization** — no
`GET`/`POST`/invoke, **including the Step B gate proofs**, happens without it.

- **A. Set `SYNC_TRIGGER_SECRET` only** (secret-safe — see below). Generate the token
  separately: `openssl rand -hex 32`.
- **B. With `WODIFY_API_KEY` still absent, prove the gate** (only possible while the key is
  unset): `GET` (valid JWT) → `405`; `POST` no `x-sync-trigger-secret` → `403`; `POST` bad
  header → `403`; `POST` correct header → `500` fail-closed, **zero Wodify reachable**.
- **C. Set the rotated `WODIFY_API_KEY`** (secret-safe; same flow as A, but ONLY at Step C).
- **D. Single real `POST`** (valid JWT + correct `x-sync-trigger-secret`) — the live Wodify
  pull. *(Pull timing is no longer `asOf`-constrained: the gym-local `asOf` fix is **LIVE**
  (#445), so any time works — the former "midday gym-local" guidance was the now-RETIRED
  interim mitigation. This bullet previously carried the stale interim wording.)*
- **E. Verify** the persisted row + the §6.6 conservation invariant.
- **F. Unset `WODIFY_API_KEY`** (disarm).

**Setting a secret — preferred (one-time, no shell):** Supabase Dashboard → Project
Settings → Edge Functions → Secrets. No shell, no history, no argv.

**Setting a secret — CLI alternative (`--env-file`, supported on CLI ≥ 2.98):** the value is
read into a private temp file, never onto argv. Set `WODIFY_API_KEY` the same way, ONLY at
Step C.

```bash
set +x; umask 077
read -rs SYNC_TRIGGER_SECRET            # not echoed, not in shell history
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
printf 'SYNC_TRIGGER_SECRET=%s\n' "$SYNC_TRIGGER_SECRET" > "$tmp"
unset SYNC_TRIGGER_SECRET
supabase secrets set --project-ref gzgxcvjvoivlwaksnmxy --env-file "$tmp"
rm -f "$tmp"
```

**Redeploy — name-scoped only** (a bare `supabase functions deploy` would also redeploy
`ai-proxy` and flip it to `verify_jwt:true`):

```bash
supabase functions deploy sync-wodify-retention --project-ref gzgxcvjvoivlwaksnmxy
```

**Invoking (Step D) — trigger header via `curl --config`, never inline `-H`** (keeps the
secret off argv / history):

```bash
umask 077; cfg="$(mktemp)"; trap 'rm -f "$cfg"' EXIT
read -rs TRIG                            # trigger secret — read silently, never echoed
# $ANON = the public anon key (ships in the SPA bundle — NOT a secret; safe to pre-export).
# Only $TRIG is read via `read -rs`; the trigger secret is the one value that must stay private.
{ printf 'header = "Authorization: Bearer %s"\n' "$ANON"
  printf 'header = "apikey: %s"\n' "$ANON"
  printf 'header = "x-sync-trigger-secret: %s"\n' "$TRIG"; } > "$cfg"
unset TRIG
curl -X POST --config "$cfg" \
  https://<ref>.supabase.co/functions/v1/sync-wodify-retention
rm -f "$cfg"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform at
runtime; they are not set manually.

## Open items / follow-ups (first live invoke DONE 2026-06-07; idempotent-upsert redeploy DONE 2026-06-08; census-populate pull DONE 2026-06-10; tenure aggregate-extension run DONE 2026-06-11)

- **Churn-by-Tenure aggregate extension (§6) — DEPLOYED + LIVE (gated run EXECUTED CLEAN
  2026-06-11).** The source bins active members into per-tenure-band recency histograms from
  `member_since` (counts only; persisted as the NULLABLE `tenure_band_histogram` column — see
  `wodify_retention_schema.sql`) and reports per-band active totals in the 200 summary. The
  gated run applied migration `20260611130857`, shipped the bundle as the new canonical
  `3ae17000…` (name-scoped redeploy), and the single authorized pull populated the column
  (`as_of 2026-06-11` — band totals 75/60/93/86/94 + unknownTenure 0 = 408, partition merge
  exact, anti-drift @T=21 band-silent 76 == global 76); the SPA's Tenure card renders **LIVE**.
  The function was re-DISARMED at Step F (resting probes 405/500, secrets list clean).

- **Idempotency — DONE (constraint applied gate-4 + function redeployed gate-5, 2026-06-08; source carried by #444).**
  The persist path is now an idempotent upsert on `(workspace_id, as_of)`. **Live:** the named **unique
  constraint** `wodify_retention_aggregate_workspace_as_of_key` is applied
  (`ALTER TABLE … ADD CONSTRAINT … UNIQUE (workspace_id, as_of)` then `notify pgrst, 'reload schema'`;
  premise-checked — zero duplicate rows, built clean — verified via `pg_constraint`), the explicit
  `service_role` `UPDATE` grant is in the schema (a no-op live — service_role already had UPDATE), and
  the upsert bundle was deployed as `ezbr a4b19062…` (since superseded — see the identity history in
  the header banner; `on_conflict=workspace_id,as_of` + `resolution=merge-duplicates` confirmed in the
  deployed source via `get_edge_function`). A same-day
  re-pull, or a scheduler retry, now **replaces** the day's row instead of duplicating it — the
  prerequisite that unblocks any second/scheduled pull. The function stays **DISARMED**, so no pull is
  reachable until separately armed. The deployed-bundle files (`index.ts` + the three `src/lib/gym/*`
  modules) are kept reproducible from `main` (gate-5's `a4b19062…` came from #444; the current
  `40307a38…` reproduces from `main` @ `d53ccd0`).
  *(Historical: two fail-closed pre-states existed only during the gate-4→gate-5 window — a same-day
  re-insert against the old plain-insert bundle would fail `409`/`23505`, and the upsert before the
  constraint existed would fail `400`/`42P10`; both fail closed, no duplicate. Both windows are now
  closed.)*
- **Deploy/import resolution — CLOSED via Option A (#435, `b6bd9d6`, 2026-06-05).** The
  import-resolution sub-gate is closed: the explicit `./silentChurn.ts` import +
  `allowImportingTsExtensions` resolved the shared `src/` graph at the Supabase
  deploy/eszip path (the named-function deploy succeeded — see "Bundle/import proof").
  The function is deployed and **ACTIVE** (`verify_jwt: true`) and **DISARMED between authorized
  runs** (three so far: 2026-06-07, 2026-06-10, 2026-06-11; no key held at rest). The first invoke **proved
  Wodify supplies `status` / `lastCheckIn` globally enough for the first aggregate slice** (412 active /
  956 scanned, conservation residual 0), with unknown last-check-in values **surfaced explicitly** via the
  aggregate's `unknown` bucket (155 of 412 active members; 956 clients scanned overall) rather than hidden
  — the first-slice §6 live-data goal is MET. PR2 / SPA wiring has since SHIPPED (Attendance Health
  #447 + Silent Churn #448; the MM census is live since the 2026-06-10 census-populate pull).
- **Confirmed by the 2026-06-07 pull (`unknown_status=0`):** the live `/clients` response uses the
  expected snake_case field names (`client_status`, `last_attendance`, `last_class_sign_in`,
  `is_at_risk`) the §5 probe observed — no casing drift surfaced via `dataQuality.unknownStatus` /
  `unknown`.
- Confirm the `asOf` timezone basis (server-UTC date) is acceptable vs the gym's
  local day (±1 day only at the boundary; the histogram is exact-day).
