# sync-wodify-retention Edge Function

Server-side Wodify retention snapshot writer. WO-2 v3 adds a
paged, aggregate-only student census while preserving the existing Silent
Churn, Attendance Health, tenure, cohort, dues, and diagnostic payload. The
browser never calls Wodify and never sees either data credential.

> **Production state recorded 2026-09-10:** migration entries **25**
> `wodify_student_census_wo_2` and **26** `wodify_census_returned_page_size` are
> applied. `sync-wodify-retention` is **ACTIVE v31**, `verify_jwt: true`.
> Workflow **Tenure Snapshot Clock** is currently **disabled_manually**.
> Successful full run **34425569190** completed **41 pages / 1,021 rows**;
> terminal page: **21 rows, has_more=false**; **397 active = 263 students +
> 134 guardian-only**, **0 unclassified**, **0 detail failures**.
> This is the census/backend result for PR #559. The dashboard changes are
> **not implemented in PR #559**; PR #560 is held until the Monday scheduled run.

### Historical deployment record — June 2026 (not current operating state)

The following disarmed/secrets/deployment statements describe June only; the
September production banner above supersedes them.

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

## Slice 1 operational contract (deployed, successful full run)

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
freshness window and workflow timeout can bind first); overfull pages, short nonterminal pages, an unterminated
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
histograms still describe raw clients and remain unchanged. PR #559 produces the
separate student payload but does not switch current dashboard consumers to it;
that frontend work is held in PR #560.

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
retracted. Subsequently, valid isolated run `34417952517` on function v28 returned
`{origin:edge_function,error:sync_failed,code:parse_error,http_status:502}`.
Same-page recurrence strongly favors a deterministic contract failure; only the
isolated run establishes `parse_error`, because the earlier body was hidden.
These were historical failed probes, not the current result. The later v30 probe
identified the returned-count terminal contract, corrected in v31; full run
34425569190 subsequently succeeded as recorded above. The workflow remains
disabled manually. **PR #559 requires whole-PR independent review before merge.**

### Page parse-origin metadata (deployed in v29)

A propagated `mode=page` SyntaxError still returns HTTP 502 with
`error: "sync_failed"` and `code: "parse_error"`. Its additional safe fields are:

- `parse_stage`: fixed call-site enum. `clients_json_decode` identifies invalid
  outer JSON; `clients_envelope`, `clients_pagination`, `clients_row`,
  `clients_identifier`, and `clients_duplicate` identify valid-JSON contract
  checks. `clients_fetch`/`clients_body_read` identify earlier operations;
  `page_build_draft`, `page_persist_draft`, and `page_success_response` identify
  unexpected internal SyntaxErrors at those calls.
- `outer_json_valid`: true when the outer upstream body decoded successfully,
  false for JSON decode failure, null when no decoded-body evidence applies.
- `response_content_type`: lowercased media type with parameters discarded,
  restricted to `application/json`, `text/html`, `text/plain`, `other`, or
  `missing`; null when no response metadata applies. Arbitrary header text is
  never reflected.
- `response_body_bytes`: exact consumed response-body byte length, including
  UTF-8 multibyte characters/BOM, not JavaScript string length or Content-Length.
  This measures bytes delivered by fetch after any HTTP decompression. Ordinary
  lengths through 64 MiB are exact; larger/unsafe lengths yield null with
  `response_body_bytes_overflow: true`, never a silently capped count. Null with
  overflow false means not applicable. The bound controls diagnostic output only;
  it does not truncate or change JSON parsing.

The shared decoder also tags `detail_json_decode`/`detail_body_read` internally.
Existing detail retries still catch those failures: three exhausted attempts
remain the existing aggregate page 409, not a new 502. Request JSON rejection
remains HTTP 400. Classification, successful payloads, persistence and finalize
outcomes are unchanged. JSON decoding retains Response.json UTF-8/BOM semantics.

The manual workflow logs new metadata only with the exact allowlisted 502
parse-error contract. Missing/malformed metadata is omitted while retaining the
legacy safe `parse_error` code. No stack, arbitrary exception text, URL, raw body,
identifier, record value, or other header is logged. Scheduled execution and
manual dispatch with diagnostic_page absent/0 select the same full-run scripts.
Those scripts changed from earlier commits and are now hash-pinned in the
workflow contract test; they are not claimed byte-identical across that history.

### Returned-count pagination correction (deployed v31)

Before the correction, live v30 was confirmed read-only. Its page-41 probe
established 21 returned rows, `page_size=21`, and boolean `has_more=false`.
Forty full census pages plus that terminal page total **40 × 25 + 21 = 1,021**
rows if the population is unchanged, not 1,025. This is dated evidence, not a
hard-coded stop or acceptance total.

`CENSUS_PAGE_SIZE=25` is request capacity; response `pagination.page_size` is
the count returned and must strictly equal `clients.length`, at most capacity.
`has_more` must be a boolean. Only false means terminal; shortness never does.
True requires a full page and must not occur at the maximum page. Terminal
short, full and empty pages are valid when their returned counts match: an empty
terminal is an explicit upstream end marker, not an inferred one. Page echo,
sequence coverage, exactly one terminal and whole-population reconciliation
remain required. Separate bulk retention fetches retain capacity **100**, with
the same response-count invariant; they are not census detail pages.

Persisted current-census drafts enforce safe nonnegative `pageSize=rowsSeen`
through 25 and a full nonterminal page. Production entry **25**
`wodify_student_census_wo_2` (`20260909140516`) and the canonical schema at that
stage used `page_size IN (25,100)`. The observed Wodify terminal returns 21, so
that database check rejected its draft. Applied entry **26**
`wodify_census_returned_page_size`, represented locally by
`20260910005116_wodify_census_returned_page_size.sql`, changes only the named
`wodify_census_runs_page_size_check`: preserve legacy 100; otherwise accept
0..25 equal to rows_seen, with has_more=true requiring a full 25 and page<200.
It does not edit entry25 or its history. Entry25 exists in production migration
history and is represented by the canonical snapshot, but has **no repository
migration file**. The repository migration directory is **not replayable history**.
This mixed convention remains separate backlog; do not synthesize entry25 or
repair migration history as part of PR #559.
Existing 25/25 drafts survive unchanged. Legacy size-100 rows remain stored under
the existing conservation checks but remain ineligible for census finalize.
Both workflow success guards follow the same contract. The full-run guard hash
changes deliberately; schedule, concurrency, authorization, dynamic page loop,
finalize and readback scripts remain otherwise unchanged. Workflow remains disabled.

Diagnostic fields/privacy are unchanged. The ordered failure enum now mirrors
the corrected predicate: `page_mismatch`, `page_size_row_count_mismatch`,
`page_size_exceeds_requested`, `has_more_type`, `row_count_exceeds_requested`,
`short_nonterminal`, `max_page_nonterminal`. The last two retain the predicate's
truthiness for malformed values, which also fail the boolean/type check.
Independent review and disposable local migration validation preceded the applied
schema/function change and successful full run. PR #559 still requires its
whole-PR review gate before merge.

### Pagination observations (introduced in v30; current safe payload)

The historical v29 page-41 probe, run `34419644471`, reported `clients_pagination`,
valid outer JSON, `application/json`, and 45,950 response-body bytes. It did not
identify which predicate failed. Forty census pages of 25 rows mean 1,000 rows
were processed; that probe alone did not establish why page 41 failed. The later
v30 observation and deployed v31 correction are described above.

Only at the `clients_pagination` throw, the function adds a `pagination`
object. For each expected field
`page`, `page_size`, and `has_more`, it reports a `_present` flag and `_type` from
`missing|null|boolean|number|string|array|object`. Missing refers to absent own
JSON properties. `page_integer`/`page_size_integer` reflect only safe integers;
their `_digit_string` counterparts reflect only 1–6 ASCII digits, preserving
leading zeros without coercing the contract. All other values are null.
`has_more_boolean` reflects only booleans; `has_more_string_boolean` reflects
only the exact strings `"true"` and `"false"`, otherwise null. `client_row_count`
is the array length, a nonnegative safe integer. No other upstream keys or values
are reflected.

`pagination_failures` uses the single current ordered enum listed in
"Returned-count pagination correction" above. Invalid pages fail 502 before
detail calls or persistence; the observer never retries or repairs them.

The manual diagnostic logs this nested object only for the validated 502
`sync_failed`/`parse_error`/`clients_pagination` contract with valid outer JSON.
It projects only fixed fields and validates all scalar bounds, types and reason
enums. Missing/invalid observations are omitted, retaining prior safe parse
metadata; arbitrary strings, keys and row contents never reach the log. Other
parse stages cannot emit pagination observations. Scheduled/manual full runs
share the current hash-pinned scripts; those scripts changed with the terminal
fix. Workflow remains disabled manually after the successful full run.

### Deployment/read-back procedure (completed for v31; future use requires authorization)

1. Independent Reviewer checks exact function/module/workflow/schema bytes and
   tests. Under the coordinator's later release, freshly read the CFO project's
   function identity (`ezbr_sha256`, `updated_at`, JWT mode), existing schema,
   grants/policies and current aggregate. Capture the same-day human-written
   `silent_dues_snapshot` for comparison. Historical values below are not a live
   baseline. Target only project `gzgxcvjvoivlwaksnmxy`.
2. Apply only the specifically reviewed migration for that release, not the
   canonical snapshot as a blanket production replay. Entries25/26 are already
   applied for v31 and must not be reapplied. Verify
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
   Verify draft denial for browser roles and weekly workflow readiness.
   Browser checks of student cards and historical class-plan source labels belong
   to PR #560 after its Monday-run hold, not to the completed PR #559 backend run.

Recovery: failed pages/finalize validation never publish partial final counts;
use a new UUID for a replacement run. Old drafts expire for publication after
one hour and are cleaned after seven days during a later successful finalize.
Same-day final writes merge only supplied columns, preserving human dues.
A transport timeout after sending a database write has an uncertain commit
outcome: cancellation cannot undo a database commit. Independently read the
workspace/day row before retrying; never infer rollback from a client timeout.
The upsert remains idempotent. Concurrency is workflow-level only; manual direct
invocations must also be serialized by the operator.

## Student payload produced by PR #559

During each classified page pass, only admitted active students contribute to
`student_retention`: version 1, collection day, student total, unknown attendance,
global recency bins, tenure bins and active age bins. It contains no inactive or
lapsed counts. The same deterministic raw normalizer and band definitions are
reused; no new attendance rule is introduced. Drafts store this counts-only JSON
alongside page counters. Finalize strictly validates each draft and merges every
bin, including unknown age/tenure/recency and overflow, into one final payload.
It never derives student numerators from the independent raw-client scan.

### Slice 2 frontend/dashboard — NOT implemented in PR #559

The following describes the separate PR #560 implementation, held until the
Monday scheduled run. It is not a claim about the current frontend.

That frontend will read `student_retention`, census totals and date from the same
latest row. Its contract requires version/date/total agreement, nonnegative safe-integer
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
but runtime finalize accepts only returned counts 0..25 with a valid versioned
payload, exactly matching rows_seen and requiring 25 for nonterminal pages.

### Manual disposable SQL regression test — never production

`tests/wodifyCensusReturnedSize.sql` is a manual PostgreSQL regression test,
not executed by npm test. The CI contract test separately compares entry26's
constraint predicate with the canonical snapshot. To run the SQL test, use the
following exact bash recipe from the repository root with Docker already running
and postgres:17 already installed. It does not pull images, expose ports, mount
the host, or create persistent volumes. It reconstructs the affected prior
canonical schema, seeds 40 synthetic current drafts plus one legacy draft,
checks row fingerprints around entry26, runs the SQL assertions, reapplies the
current canonical snapshot and repeats assertions. Any error stops the script;
only its disposable container is removed and evidence is retained. Never target
production or substitute a live connection. This recipe is documentation, not
authorization to run another production operation.

```bash
#!/bin/bash
set -euo pipefail
# Run from the repository root in bash.
EVIDENCE=$(mktemp -d /private/tmp/cfo-returned-size-evidence.XXXXXX)
CONTAINER="cfo-returned-size-${EVIDENCE##*.}"
trap 'docker rm -f "$CONTAINER" >/dev/null' EXIT
git show bfab91b203c51bd2759c86daece7f891479ddea4:supabase/wodify_retention_schema.sql > "$EVIDENCE/before-schema.sql"
shasum -a 256 supabase/migrations/20260910005116_wodify_census_returned_page_size.sql tests/wodifyCensusReturnedSize.sql > "$EVIDENCE/candidate-hashes.txt"
docker run --pull never -d --name "$CONTAINER" --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 > "$EVIDENCE/container.txt"
for attempt in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' > "$EVIDENCE/roles.log"
create role anon;
create role authenticated;
create role service_role bypassrls;
SQL
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$EVIDENCE/before-schema.sql" > "$EVIDENCE/reconstruction.log" 2>&1
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' > "$EVIDENCE/seed.log"
insert into public.wodify_census_runs
(run_id,page,created_at,page_size,has_more,rows_seen,active_clients_seen,student_total,student_member,student_dependent,student_guardian_with_signin,student_no_group_with_signin,guardian_only,unclassified,ambiguous_no_signin_with_membership,detail_calls_made,detail_clients_failed)
select '11111111-1111-4111-8111-111111111111',p,'2026-09-09T12:00:00Z',25,true,25,0,0,0,0,0,0,0,0,0,0,0 from generate_series(1,40) p;
insert into public.wodify_census_runs
(run_id,page,created_at,page_size,has_more,rows_seen,active_clients_seen,student_total,student_member,student_dependent,student_guardian_with_signin,student_no_group_with_signin,guardian_only,unclassified,ambiguous_no_signin_with_membership,detail_calls_made,detail_clients_failed)
values ('22222222-2222-4222-8222-222222222222',1,'2026-09-09T12:00:00Z',100,false,21,0,0,0,0,0,0,0,0,0,0,0);
SQL
FINGERPRINT="select md5(string_agg(row_to_json(t)::text, ',' order by run_id,page)) from public.wodify_census_runs t;"
docker exec "$CONTAINER" psql -U postgres -Atc "$FINGERPRINT" > "$EVIDENCE/before-rows.txt"
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20260910005116_wodify_census_returned_page_size.sql > "$EVIDENCE/migration.log" 2>&1
docker exec "$CONTAINER" psql -U postgres -Atc "$FINGERPRINT" > "$EVIDENCE/after-rows.txt"
cmp "$EVIDENCE/before-rows.txt" "$EVIDENCE/after-rows.txt"
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < tests/wodifyCensusReturnedSize.sql > "$EVIDENCE/assertions.log" 2>&1
docker exec "$CONTAINER" psql -U postgres -Atc "select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.wodify_census_runs'::regclass order by conname" > "$EVIDENCE/constraints.txt"
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < supabase/wodify_retention_schema.sql > "$EVIDENCE/canonical-reload.log" 2>&1
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < tests/wodifyCensusReturnedSize.sql > "$EVIDENCE/canonical-assertions.log" 2>&1
echo "PASS evidence=$EVIDENCE"

```

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
