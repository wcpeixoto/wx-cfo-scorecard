# Retention Finish Plan

## Purpose

This file is the **source of truth** for finishing the Retention page — until the
page is fully live and working on the intended data source (Wodify), not just
sample data. Prefer it over chat history, Claude memory, or scattered Notion
items for the Retention roadmap.

It tracks:

- what is already built
- what remains
- what is blocked
- what decisions are still needed
- what must **not** be built yet

This file stays in the repo until Retention is fully live. See **Operating rules**
for when (and how) it is finally retired.

---

## Current status — UI-complete on sample data

Every card on the page renders from the **sample member fixture**
(`src/lib/gym/memberFixture.ts`). The page is **not fully live**: it is not wired
to Wodify data yet.

**Built and merged:**

- **Silent Churn** (#408) — first live (sample-data) card; owner-tunable threshold
  via `RetentionSettingsContext` (localStorage, not `sharedPersistence`).
- **Attendance Health** (#410) — establishes the shared `classifyMember`; buckets
  active members Healthy / Watch / Silent at the live threshold **T**.
- **Churn Risk by Tenure** (#411) — active-only risk rate by tenure band. Anti-drift
  invariant enforced by tests: Σ `silent` across bands === `computeSilentChurn(...).count`
  at the same T.
- **Member Movement** (#414) — current census + join-cohort intake only. The census
  is **BINARY (active / inactive)** since the 2026-06-10 §6 rescope — the original
  active/paused/ended design was RETIRED as source-unsupported (see §6, "Census
  rescope"). **No movement-over-time series by design** — the fixture carries no
  dated status changes, so a flow/cancellation trend would be invented history.
- **Parked / blocked gate labels** (#415) — the three remaining shells show honest gate
  notes via `GymCardShell`'s `gate` prop (still shells, no internals): Churn by Age +
  Segment Explorer = `Parked` (PII), Churn by Belt = `Blocked` (API).

All sample-data scope-gate boxes passed in #415 (recorded in git at `f9ded0a`). That
gate certifies **scope/structure only — not numerical correctness** (see Phase 1 §2).

Code lives in `src/lib/gym/` (`silentChurn.ts` — **LOCKED** shared classifier + date
helpers; `churnRiskByTenure.ts`; `memberMovement.ts`; `memberFixture.ts`),
`src/context/RetentionSettingsContext.tsx`, UI in `src/components/GymPage.tsx`, styles
in `src/dashboard.css`.

---

## Durable rules (govern every item below)

These apply to current **and** future (live) work — a live card must obey them just
as a sample card does. The first three are candidates to migrate into permanent docs
(Phase 1 §3); the fourth already lives in `AGENTS.md`.

- **No fake history.** Without dated events in the data, do not infer trends, recovery,
  cancellations, or net movement over time. An honest empty result beats an invented one.
- **`$ at risk` is active-only.** Paused/ended members carry `monthlyDues: 0` and
  self-exclude — never sum dues across statuses.
- **Fixture-backed cards show the `Sample data` badge.** A card with no data behind it
  (parked/blocked shell) must not — use the gate note instead.
- **Shared classifier reuse.** Every risk card reuses `classifyMember` from the locked
  `silentChurn.ts`; no forked risk logic. *(Already in `AGENTS.md` — not a migration candidate.)*

---

## Remaining Phase 1 — harden the sample-data page

### 1. Add PR test CI · `Done (#417)`

Added `.github/workflows/ci.yml` — a `pull_request` workflow that runs the Retention
guards on every PR:

- `npx tsc -b` — typecheck (fast-fail signal before tests/bundle)
- `npm run test` (= `vitest run`) — the real classifier guard
- `npm run build` (= `tsc -b && vite build`)

Reason: the tests protect the shared classifier locally but were **not enforced on PRs**
before this. Landed first so later PRs are gated by it.

Decided — **no `VITE_SUPABASE_*` env block on the build step.** The app compiles cleanly
without the secrets (`sharedPersistence` reads them with `?? ''` defaults and disables
itself via `isConfigured()` when empty), so PR CI builds with shared persistence off. This
keeps the gate honest (it tests the Retention compute, not the live data layer) and avoids
a flake on fork/automation PRs, which don't receive secrets. Secrets stay in deploy CI only.

(`.github/workflows/` is a **locked path** — this edit was made with owner approval.)

### 2. Independent `silentChurn.ts` correctness audit · `Done — audited 2026-06-04; no defect; T consistent end-to-end`

Separate task. Confirm:

- the shared Retention classifier is mathematically correct
- Silent Churn, Attendance Health, and Churn Risk by Tenure stay consistent

**Do not treat the sample-data scope gate as proof of numerical correctness** — it is a
structure/scope gate only. This audit is the correctness track and is still **open**.

### 3. Governance / durable-rule migration · `TODO` (deferred — Wesley's call)

Move the durable rules into permanent docs: **no fake history** + **`$ at risk` active-only**
→ `AGENTS.md`; **`Sample data` badge** → `UI_RULES.md`. **Skip** shared-classifier-reuse
(already in `AGENTS.md`).

The rules stay in this file (governing) until migrated. **Do not migrate yet and do not
delete this file** without Wesley's explicit approval — and not before the page is fully
live (see Operating rules → Retirement).

---

## Remaining Phase 2 — live Wodify readiness

### 4. Live-data safety / architecture decision · `DECIDED (2026-06-04)` (gates all Phase 2 build)

Must happen **before** any Wodify adapter work. Decide:

- where Wodify API calls run
- how the Wodify API key is protected
- whether raw member rows ever reach the browser, or only server-side rollups
- how member PII is protected

Hard rules:

- The Wodify API key **must not** live in frontend/browser code (`VITE_*` is
  client-exposed by design).
- This is a public SPA with a client-exposed Supabase **anon key** — anything readable
  with it is effectively public. Raw member data must not be exposed through the SPA
  unless explicitly approved.
- Display name, status, dues, check-in dates, and risk status are sensitive enough to
  require a data-safety decision.

**Decision (recorded 2026-06-04).** Transport and PII posture for going live:

- **Wodify credentials are server-side only.** No `VITE_*` Wodify secrets; the key never
  enters the browser bundle.
- **No raw Wodify member rows in the browser, and none in any browser-readable Supabase
  table.** The client-exposed anon key makes anything it can read effectively public.
- **Raw member rows are transient, server-side only.** Even inside the server-side fetch,
  raw Wodify rows are never logged and never persisted server-side; only the derived
  aggregate row may be stored.
- **`ai-proxy` is precedent only** for server-side secret storage and third-party calls —
  **not** for the threat model. Its CORS-only boundary (deployed `--no-verify-jwt`) is
  browser-advisory and trivially spoofed; it is **not** sufficient protection for
  member PII.
- **No real private auth boundary exists** (public SPA, public anon key, cosmetic
  edit-lock). So the preferred transport is: **server-side Wodify fetch → aggregate-only
  Supabase table → SPA reads the aggregates.** The browser never calls Wodify and never
  holds the key; the persisted table holds only non-PII aggregates.
- **First live Retention slice is aggregate-only.** Silent Churn call-list and member
  names stay **sample-only** unless real auth is added or PII exposure is explicitly
  accepted.

**First live aggregate — input scope.** Server-side Wodify inputs needed to derive the
first aggregate:

- `status`
- `lastCheckIn`
- `monthlyDues` — for *monthly dues at risk*, not for classification

Deferred (not fetched for this slice): `membershipStart` (defer until Churn Risk by
Tenure); `id` and `displayName` (not needed for an aggregate-only slice).

**Implementation constraint — reuse the locked classifier.** Do not fork or re-implement
the silent / watch / healthy threshold logic. Prefer importing the pure helpers
(`classifyMember`, `resolveSilentChurnThresholdDays`, and the date helpers) from the locked
`silentChurn.ts`. Do **not** force `computeSilentChurn` end-to-end if it would require
PII-shaped placeholder rows or emit a call-list — derive the aggregate at the
`classifyMember` level (with `computeAttendanceHealth`, which already returns counts only).

**First live payload target** (aggregate-only):

```ts
{
  source: "wodify",
  asOf: "YYYY-MM-DD",
  fetchedAt: "ISO timestamp",
  thresholdDays: number,
  silentChurn: { count: number, monthlyDuesAtRisk: number },
  attendanceHealth: { activeTotal: number, healthy: number, watch: number, silent: number, unknown: number },
  dataQuality: { missingLastCheckIn: number, unknownStatus: number, missingMonthlyDues: number }
}
```

`missingMembershipStart` is intentionally **excluded** from the first slice.

**Build remains gated on §5.** The architecture is decided; implementation does not start
until the §5 probe confirms Wodify exposes the required fields (`status`, `lastCheckIn`,
`monthlyDues`) cleanly at our access tier.

### 5. Wodify data availability probe · `Per-client probe re-run (2026-06-05, after the #428 clients-key patch) — /clients prerequisite now SOLVED (100 records/page, 3 IDs sampled), but the per-client sign-ins endpoint is NOT found: all 4 candidate path templates (/clients/{id}/signins, /clients/{id}/sign-ins, /signins/{id}, /sign-ins/{id}) returned 4xx (missing-ID signal) → no working path. Dated check-in history UNPROVEN; mapping UNPROVEN (not disproven — the real path is not among the 4 guesses). NOTE: /clients itself exposes recency (last_attendance / last_class_sign_in / days_since_last_attendance) — may supply lastCheckIn for the first slice WITHOUT a sign-ins endpoint. Next = per-client sign-ins PATH discovery (separately approved). Prior: /clients shape discovery #428; error-envelope hardening #425; signins shape discovery #423; first per-client run blocked at /clients (this PR #427)`

**Probe result (2026-06-04).** Phase 2 §5 probed 2026-06-04 — Outcome #1: no repo Wodify
integration/docs/credentials or approved safe server-side path; BLOCKED pending external
Wodify API docs or field-list/schema with fake/redacted sample only, plus future safe
server-side credential setup. No implementation started.

Probe scope was the **first-slice subset only** (`status`, `lastCheckIn`, `monthlyDues`) —
not movement/status-change dates, belt/rank, age, segment, or recovery data. Repo evidence:
the only "Wodify" in code is the finance-layer account name (`dataSanity.ts` Stripe gross-up
reconciliation) and a belt/rank gate-note string; the sole Edge Function is `ai-proxy`
(Anthropic), and no `WODIFY_*` secret or env entry exists. **Sharing rule for any sample:**
field names with fake/redacted values only — no API keys, and no real member rows, names,
IDs, exact check-in dates, or dues values in chat or committed to the repo.

**Correction (2026-06-04) — reported prior off-repo work.** The repo-only Outcome #1 above
was procedurally clean but **incomplete**: a May 6, 2026 chat reportedly did real Wodify API
work outside this repo. These facts are **chat-reported, not repo-verified** — the repo still
holds no committed Wodify client, endpoint docs, or credentials. Treat the below as **leads to
re-confirm on the next live probe**, not established repo facts.

- **Local scripts (not committed here):** an endpoint probe, a full audit (reportedly ~912
  clients + paginated memberships/leads), and a retention analysis over the audit JSON. Run
  locally because the sandbox blocks `api.wodify.com`.
- **Reported access:** base URL `https://api.wodify.com/v1`; auth via `x-api-key` header.
- **Reported API quirks — re-confirm or preserve to avoid rediscovery:**
  - `status=Active` on `/clients` does **not** filter — use per-record `client_status`.
  - membership `is_active` must be filtered in the **server-side fetcher**, never the SPA.
  - max page size is **100 records/page** regardless of requested `pageSize` — always paginate.
  - null dates may surface as `1900-01-01` — all date logic must treat that as **missing**.
  - mandatory-ID endpoints can return a misleading `403 - Missing Authentication Token` when
    the ID param is absent (not a real auth failure).
- **Reported Wodify support answers:** progressions/belt-rank API is **unavailable for public
  use** (not merely tier-blocked); financials are blocked at the current API tier but reachable
  via the Wodify **Admin reports UI**.
- **Reported sourcing posture (hybrid):** automated API pulls for reachable operational KPIs +
  **monthly manual Wodify Admin CSV exports** for financial / churn-dollar data the API doesn't
  expose. This is a sourcing approach **under** §4 — it does **not** replace it. Manual CSV data
  stays subject to §4: no raw member rows in the browser or in anon-readable Supabase tables; no
  secrets/PII committed; aggregate-only to the SPA.

**Security — Wodify API key rotated 2026-06-04.** A prior chat reportedly exposed a live Wodify
API key in message text. Wesley rotated it on 2026-06-04: the exposed key is now
**invalidated/inert** (it lingers in old chat history but should no longer authenticate). The
**new key must never be pasted into chat and never committed** — set it only via a safe
local/server-side mechanism (e.g. `supabase secrets set`). If Wodify exposes API request logs,
check for unauthorized use since **May 6, 2026**.

Confirm what the API can actually provide: current clients · active/paused/ended status ·
membership start date · last check-in date · monthly dues · **dated check-in history** ·
paused/cancelled/status-change dates · belt/rank.

This also settles the gate for Silent Churn Recovery (needs dated check-in history) and
for any movement/cancellation trend (needs dated status changes).

**Next true probe (after the 2026-06-04 key rotation):** the **Class Sign-ins / Client
Sign-ins** dated check-in history endpoint — it gates Silent Churn Recovery and supplies the
`lastCheckIn` the first slice needs. A **draft probe for this is now on `main`** (see "Draft probe
merged" below) and has now been **run once locally** (2026-06-04 — see "First probe run" below); the
remaining step is to **confirm the field mapping** (the run returned a 2xx with 0 records inspected —
mapping not yet proven). Probing stays local / server-side and only the safe aggregate contract is
ever shared — never raw data.

Belt/rank: **reportedly unavailable for public use** per Wodify support (chat-reported, not
repo-verified) — an API-availability limit, not merely a current-tier block.

**Readiness check (2026-06-04) — probe contract recorded; still BLOCKED on a safe key path.**
A read-only readiness check confirmed: no committed Wodify client/adapter/probe script, no
`WODIFY_*` secret in any local gitignored env file, and no server-side consumer (no Wodify Edge
Function, no aggregate table) for a `supabase secrets` value. The §4 transport is decided but
unbuilt, so **no safe key path is confirmed yet**. Verdict: **do not run the live probe** until
the rotated key is placed via a safe server-side / local-only mechanism *and* a separate probe
task is explicitly approved. The contract below is preserved so that task inherits it.

**Safe output contract for the Class / Client Sign-ins probe.** The probe is aggregate /
diagnostic only — it emits counts, booleans, and status enums, **never member data**.

Allowed output:

- endpoint reached / not reached, plus an HTTP status class (`2xx` / `4xx` / `5xx` /
  `network_error`) — never a raw response body
- pages fetched (proves pagination worked) and total records inspected
- field-presence counts per expected field (client reference, check-in date) — the identifier is
  *counted, never emitted*
- missing-date count and invalid-date count (fails a strict `YYYY-MM-DD` parse)
- `1900-01-01` sentinel count — reported **separately** (see the sentinel guard below)
- whether dated check-in history is available (multiple dated events per client, not just a
  single latest value)
- distinct clients with any check-in (a count only, never IDs)
- *(optional, year-granularity only if needed: earliest / latest year — default omit)*

Never output (in results, logs, or error text):

- names · client / membership IDs (even hashed) · exact check-in dates or timestamps · dues values
- raw member rows · raw sign-in rows · raw or echoed API responses · upstream error bodies
  (report the status class only)
- API keys, auth headers, or request / response dumps

Operational guards (preserve the reported quirks to avoid rediscovery — re-confirm on the live probe):

- paginate: 100 records/page cap regardless of requested size; report pages fetched
- `status=Active` does **not** filter server-side — use per-record `client_status`; filter
  membership `is_active` in the server-side fetcher, never in the SPA
- distinguish a real `403` from a missing-required-ID `403` (a "Missing Authentication Token"
  response can mean an absent path param, not an auth failure)
- never log raw rows or the key (follow the `ai-proxy` precedent: no body / header / secret logging)
- key handling: server-side (`supabase secrets`) or a gitignored local env consumed by a
  local-only script — **never `VITE_*`, never pasted to chat, never committed**; the pre-rotation
  key is inert, so use only the rotated key

**Real-data guard — `1900-01-01` is a null sentinel, not a date.** Wodify surfaces null dates as
`1900-01-01`. It must be treated as missing **before any date math or classifier reuse**: counted
separately in the probe output (above) and **never** passed into `classifyMember` as a real
`lastCheckIn`. The current `parseYmdLocal` (`src/lib/gym/silentChurn.ts`) would otherwise *accept*
`1900-01-01` as a valid date and mis-classify the member as `silent` with a huge `daysAbsent`, so
this guard must live in the server-side fetch / normalization layer, ahead of the classifier. It
also governs the §8 real-data guards (invalid dates).

**Draft probe merged (2026-06-04, PR #420 · squash `625bff8`).** A local / server-side probe for
the Class / Client Sign-ins dated-check-in-history endpoint is now on `main`:
`scripts/wodify/classSigninProbe.ts` (+ `scripts/wodify/README.md`). The same PR made `.env.local`
protection **repo-owned** via `.env*.local` in `.gitignore` (no longer reliant on a machine-global
gitignore; `.env.example` stays tracked). The probe's endpoint path / response shape / pagination /
field names were placeholders to confirm on the first run. Output stays limited to the **safe output
contract above**: counts / booleans / status enums (+ optional calendar years) only — **no raw member
rows, names, IDs, exact check-in dates, dues values, API responses, or keys.**

**First probe run (2026-06-04).** The probe was **run once** locally — the exact command
`npx tsx --env-file=.env.local scripts/wodify/classSigninProbe.ts` from the primary clone. The local
run used the **repo-ignored `.env.local`** (`.env*.local` is in `.gitignore`) for the rotated key;
the **key value was never printed**, never committed, and never `VITE_*` / browser-exposed. The
**key authenticated for this request** (no 401/403, no missing-ID 403). The result was the only
output and stayed fully within the safe contract — no raw rows, names, IDs, exact dates, timestamps,
dues values, raw API bodies, auth headers, or secrets:

- `endpointReached: true` · `httpStatusClass: "2xx"` · `pagesFetched: 1`
- `totalRecordsInspected: 0`; `fieldPresenceCounts` `clientRef: 0` / `checkInDate: 0`
- `missingDateCount: 0` · `invalidDateCount: 0` · `sentinelDateCount: 0`
- `datedCheckInHistoryAvailable: false` · `distinctClientsWithAnyCheckIn: 0`; `earliestYear` /
  `latestYear` omitted
- no safe diagnostic warnings fired

**Interpretation — mapping not proven.** A 2xx with **0 records inspected** means the field
**mapping is not yet proven**. This is **not** evidence that Wodify lacks dated check-in history, and
**not** a finding that the `CONFIG` is wrong. The `CONFIG`, endpoint path, default filters, response
shape, pagination, or per-client (per-ID) requirements **may need adjustment** before the probe can
confirm what the endpoint exposes — that mapping confirmation is the next (separate) discovery task.
The `1900-01-01` null-sentinel rule above still binds: count it separately, never treat it as a real
`lastCheckIn`.

**Second probe — shape discovery (2026-06-04/05, PR #423 · `7da4369`).** A separate local-only
discovery probe — `scripts/wodify/signinsShapeDiscovery.ts` (run via the worktree-safe absolute
`--env-file` path; the rotated key was never copied, printed, or committed) — tested a small allowlist
of **list-style** Class / Client Sign-ins endpoint candidates to explain the first probe's transport-2xx
+ 0 records. Output stayed fully within the §5 safe contract (endpoint paths, key names, counts,
booleans, and HTTP status classes only — no values, rows, names, IDs, dates, dues, raw bodies, or
secrets). Findings:

- `/clients/signins` (the original probe path), `/clients/sign-ins`, and `/classes/signins` returned
  **transport-2xx bodies that are Wodify error envelopes** — top-level keys `DeveloperMessage` /
  `ErrorCode` / `HTTPCode` / `UserMessage` only, with **no records array** (`data` / `results` /
  `items` / `records` all absent). The in-body `HTTPCode` means the real status rides in the payload,
  so a transport-2xx here is **not** a success signal.
- `/signins` and `/sign-ins` (bare) returned **4xx** carrying the missing-ID `403 "Missing
  Authentication Token"` marker — the §5 signal that the sign-ins resource **likely requires a
  per-client (per-ID) path**.
- No pagination keys were observed, and the ID-like-key guard fired zero redactions.

**Interpretation (second probe).** The first probe's **2xx + 0 records must not be treated as a true
empty dataset** — it was an error envelope at the transport-2xx layer, which
`classSigninProbe.extractRecords` (which only looks for a records array) reported as 0 records. No
candidate returned a records array, so the **field mapping remains unproven**. The exact embedded
error code is intentionally **not** captured (it is a field value, outside the safe contract), so we
know the body is an error envelope but not precisely which error. *(The step-1 hardening below (#425)
derives only the coarse status **class** — 2xx/4xx/5xx — from `HTTPCode`, never the exact code, so the
safe-output contract still holds.)*

**Third probe — per-client / per-ID (2026-06-05, step 2).** A new self-contained local-only script,
`scripts/wodify/clientSigninsProbe.ts` (+ README) — `classSigninProbe.ts` and `signinsShapeDiscovery.ts`
left untouched — was built to confirm a `/clients/{id}/signins`-style per-client path and the dated
check-in field mapping. Because a per-client path needs a real client ID, it fetches one page of
`/clients`, extracts a **small deterministic sample** of IDs **into memory only** (default 3; hard cap
`MAX_PER_CLIENT_CALLS = 8`; no broad iteration), and uses them solely to build the per-client URL — the
**request URL is never emitted; only the `{id}` path template is.** Builder built it; a read-only
Reviewer audited the safe-output (**APPROVE — no leak paths**, posture byte-identical to the merged
siblings); a network-free `--selftest` PASSED (synthetic PII never appears in output); then it was run
once with the worktree-safe absolute `--env-file` (key never copied / printed / committed). Output
stayed fully within the §5 safe contract — counts, booleans, HTTP status classes, path templates, and
SAFE field names only; no values, rows, names, IDs, dates, dues, URLs, raw bodies, or secrets.

- **Outcome — BLOCKED at the `/clients` prerequisite; per-client path UNTESTED.** `/clients` returned
  transport-`2xx` with `errorEnvelopeDetected: false`, but `recordsOnFirstPage: 0` and
  `clientIdsExtractedForSample: 0` — so no client ID could be sampled, the per-client templates were
  never tried (`candidatePathTemplatesTried: []`, `perClientCallsMade: 0`), and the result was
  `conclusion: "unproven"` / `conclusionReasonCode: "could_not_obtain_client_id"`.
- **Interpretation — mapping UNPROVEN (not disproven).** The 2xx body was **not** a Wodify error
  envelope, so the failure is upstream: the current `RECORD_ARRAY_KEYS` / `CLIENT_ID_FIELDS` (lowercase)
  did **not** match the `/clients` response shape (Wodify is PascalCase-heavy). Two possibilities remain
  — a genuinely empty client list, or (far more likely, given the chat-reported ~912-client audit) a
  **response-SHAPE mismatch**. The safe output alone cannot distinguish them. The per-client sign-ins
  endpoint was **never reached**, so its mapping is neither proven nor disproven. The §5 interpretation
  guard holds: a 2xx is not proof of anything about data availability.
- **No per-client / per-ID sign-in calls were made** (the prerequisite failed first), no live wiring /
  §6 work was started, and the probe artifact (per-client machinery + safe-output contract, reviewed)
  is ready to re-run once the `/clients` shape is known.

**`/clients` shape discovery (2026-06-05) — `/clients` is shape-mismatched, NOT empty.** The §5 step-2
per-client probe (`clientSigninsProbe.ts`, #427) was blocked at its `/clients` prerequisite (2xx, not an
error envelope, but 0 records / 0 sampled IDs). A new local-only structure-only probe,
`scripts/wodify/clientsShapeDiscovery.ts` (+ README) — built on `signinsShapeDiscovery.ts`'s reviewed
helpers, network-free `--selftest` PASS, run once with the worktree-safe absolute `--env-file` (key never
printed/committed) — reproduced that exact `/clients` request and reported its structure. Output stayed
fully within the §5 safe contract: endpoint path, key names, array lengths, per-field TYPE CATEGORIES,
booleans, and status classes only — no values, names, IDs, dates, dues, pagination values, raw rows, or
raw bodies. One `/clients` call only.

- **Finding — `/clients` returns `{ clients: [ …100… ], pagination: {…} }`** — a full page of 100 record
  objects under the key **`clients`**, with a nested `pagination` object (`pagination.page` /
  `pagination.page_size` / `pagination.has_more`). It is **NOT empty** (`conclusion: "shape_mismatch"`).
- **Root cause of #427's 0 records:** `clientSigninsProbe.ts`'s `RECORD_ARRAY_KEYS`
  (`data`/`results`/`result`/`items`/`records`/`value`/`signins`/`SignIns`/`rows`, exact-case) does
  **not** include `clients`, so its `extractRecords` found no array and returned `[]`
  (`recordArrayKeyMatchesClientProbeConfig: false`).
- **Confirmed mapping (names + type categories only):** client-ID = **`id`** (number; already in #427's
  `CLIENT_ID_FIELDS`, so `clientIdFieldMatchesClientProbeConfig: true`), status = **`client_status`**
  (matches the §5 reported quirk). Recency is **on `/clients` directly**: `last_attendance`,
  `last_class_sign_in`, `last_booking_sign_in`, `days_since_last_attendance` (number), plus Wodify's own
  `is_at_risk` (boolean) and `total_class_sign_ins`. **No dues field** on `/clients` (consistent with §5's
  financials being API-tier-blocked) — `monthlyDues` must come from another source. `/clients` is
  PII-dense (name / email / phone / DOB / address / etc.) — reinforces the §4 aggregate-only posture; the
  probe emitted field NAMES + type categories only, never values.
- **Note on `lastCheckIn`:** `/clients` exposes a LATEST attendance/sign-in (recency), which likely
  supplies the first slice's `lastCheckIn` **without** the per-client sign-ins endpoint. Dated check-in
  HISTORY (multiple events, for Silent Churn Recovery) still needs that endpoint. Values were not
  inspected; the `1900-01-01` null-sentinel rule still binds when these fields are read live.

**Re-run (2026-06-05, after the #428 `clients`-key patch).** Per #428's `/clients` shape discovery
(records under the key `clients`, client-ID field `id`), `clientSigninsProbe.ts`'s `RECORD_ARRAY_KEYS`
was patched with a single entry (`clients`, appended at lowest precedence) and the **bounded** probe was
re-run (network-free `--selftest` PASS first; worktree-safe absolute `--env-file`; key never printed).

- **`/clients` prerequisite SOLVED.** `recordsOnFirstPage: 100`, `clientIdsExtractedForSample: 3` — the
  patch worked; client IDs now sample internally (never emitted).
- **Per-client sign-ins endpoint NOT found.** All four candidate templates — `/clients/{id}/signins`,
  `/clients/{id}/sign-ins`, `/signins/{id}`, `/sign-ins/{id}` — returned `4xx` (missing-ID signal), no
  error envelope; `workingPathTemplate: null`, `perClientCallsMade: 4` (client #1 only — bounded, no
  iteration); `conclusion: "unproven"` / `conclusionReasonCode: "no_working_path_found"`.
- **Dated check-in history UNPROVEN; mapping UNPROVEN (not disproven).** The four guessed per-client
  paths are all wrong; the real per-client sign-ins path (if one is exposed at this API tier) is not
  among them. Finding it needs a separate per-client sign-ins **path** discovery (Wodify API docs or a
  structure-only path probe) — out of scope for "re-run the bounded probe."
- **Recency is already on `/clients` (per #428):** `last_attendance` / `last_class_sign_in` /
  `days_since_last_attendance`. This likely supplies the first slice's `lastCheckIn` **without** any
  sign-ins endpoint; that endpoint remains needed only for dated **history** (Silent Churn Recovery).
  Output stayed within the §5 safe contract — schema field NAMES, counts, status classes, path
  templates only; no values, IDs, dates, dues, URLs, or secrets.

**`/clients` direct-recency evaluation (2026-06-05) — SUFFICIENT on the sampled page; a date-slice is
needed.** A new local-only probe, `scripts/wodify/clientsRecencyProbe.ts` (+ README) — built on the
sibling probes' reviewed posture; read-only Reviewer **APPROVE (no leak paths)**; network-free
`--selftest` PASS (synthetic PII + a raw status value never reach output); run once with the
worktree-safe absolute `--env-file` (key never printed/committed) — evaluated whether `/clients`'s
direct recency fields can source the first-slice `lastCheckIn` **without** the per-client sign-ins
endpoint. ONE `/clients` page (100 records; `morePagesAvailable: true`, so **page-1-only, not global**).
Output stayed fully within the §5 safe contract: counts, booleans, status classes, an allowlisted
status-category breakdown, the records-array key name, and verdict enums only — no values, names, IDs,
dates, dues, pagination values, URLs, raw rows/bodies, or secrets.

- **Verdict — `suitability: "sufficient"` (`firstSliceLastCheckInDerivable: "yes"`).** Of the **26
  active** records on the page (the cohort `classifyMember` keeps; the other 74 bucketed `inactive`),
  **23 (≈88%) carry a usable, non-sentinel recency date** on both `last_attendance` and
  `last_class_sign_in`. The ~3 active members with only the `1900-01-01` sentinel correctly fall into the
  classifier's **`unknown`** bucket — never silently Healthy. So the first slice's `lastCheckIn` **can be
  sourced from `/clients` directly** for this sample.
- **A date-slice IS required (`lastCheckInNormalizationNeeded: "date_slice"`).** Every usable value was
  an ISO timestamp (`datedWithTimeCount` 44/44 per field; `strictYmdCount: 0`), not bare `YYYY-MM-DD`.
  `parseYmdLocal` rejects a timestamp, so the §4 server-side normalizer must **slice the leading
  `YYYY-MM-DD`** before reusing the locked parser. The `1900-01-01` sentinel (56/100 overall;
  concentrated in inactive members) must be stripped to `null` **before** the classifier (§5/§8 guard).
- **`days_since_last_attendance` is NOT a clean substitute** — `numeric` for 100/100 *including* the 56
  sentinel records (a meaningless ~46k-day count off `1900-01-01`, no null signal). Source `lastCheckIn`
  from `last_attendance` (sentinel detectable) and let `classifyMember` compute `daysAbsent` from **our**
  today-anchor (preserves the §4 anchor); do not trust Wodify's precomputed count. `is_at_risk` fires for
  only **1/100** — a useful *secondary* cross-check, not a replacement for the deterministic rule.
- **Still blocked without the per-client sign-ins endpoint:** dated check-in **history** (multiple events
  per member) for Silent Churn **Recovery**. `/clients` gives only the *latest* recency value — exactly
  what the first-slice `lastCheckIn` needs, but not the multi-event history (#427/#428: endpoint still
  unfound; separate path-discovery task). No live wiring / §6 work was started.

**Next steps.**

1. **Harden the probes against embedded error envelopes · `Done (#425 · 97922cc, 2026-06-05)`.**
   `scripts/wodify/classSigninProbe.ts` now detects the Wodify error envelope (top-level
   `DeveloperMessage` / `ErrorCode` / `HTTPCode` / `UserMessage`) and treats an embedded non-2xx
   `HTTPCode` as a failure rather than reading it as "0 records":
   - New `detectErrorEnvelope()` + `SafeProbeResult` fields `errorEnvelopeDetected` and
     `embeddedHttpStatusClass`. The embedded `HTTPCode` is reduced to a status **class** only — its
     raw value, and the `DeveloperMessage` / `ErrorCode` / `UserMessage` text, are never read into
     output, logs, or errors. The **safe-output contract is preserved** (counts / booleans / status
     classes only) and the `1900-01-01` sentinel guard is unchanged.
   - The embedded `HTTPCode` is **authoritative**: a 4xx/5xx envelope is flagged even with an empty
     records array present; a 2xx with an empty array is treated as a real empty dataset; and a
     non-empty records array is always read — **real rows are never discarded**.
   - The **Wodify probe was NOT run** for this change (verified with a network-free synthetic check).
     **No per-client / per-ID calls were made.** **Mapping remains unproven** — this hardens the
     *interpretation* of the response; it does not confirm the endpoint path or field mapping.
2. **Per-client / per-ID probe · `Re-run 2026-06-05 (after the #428 patch) — UNPROVEN`** (see "Re-run"
   above). With `clients` added to `RECORD_ARRAY_KEYS`, `/clients` now yields IDs (100 records, 3
   sampled), but all four candidate per-client sign-ins templates returned `4xx` →
   `workingPathTemplate: null`. **Dated history + mapping remain UNPROVEN (not disproven)**; bounded
   (4 calls, client #1 only); no live wiring / §6.
3. **Discover the `/clients` response shape (structure-only) · `Done (#428)`.**
   `scripts/wodify/clientsShapeDiscovery.ts` proved `/clients` is shape-mismatched (records under
   `clients`, client-ID `id`), not empty — which is what the one-line `RECORD_ARRAY_KEYS` patch above
   resolves. *(#428 holds the full `/clients` shape record; not duplicated here — see the merge-order
   note below.)*
4. **Discover the per-client sign-ins endpoint PATH · `TODO` (separately approved).** The four guessed
   templates all returned `4xx`; find the real path (Wodify API docs and/or a structure-only per-client
   sign-ins path probe), then re-run `clientSigninsProbe.ts` to confirm whether it exposes dated
   check-in history. Until then, dated-history availability is **UNPROVEN — not disproven**.
5. **Evaluate sourcing `lastCheckIn` from `/clients` directly · `Done — SUFFICIENT on the sampled page`**
   (see the "`/clients` direct-recency evaluation" record above). `clientsRecencyProbe.ts` confirms the
   first slice's `lastCheckIn` **can** come from `/clients` recency without the per-client sign-ins
   endpoint (≈88% of active members on the page have a usable date; sentinel-only ones → `unknown`
   bucket). Two §6 implementation constraints fall out: (a) the server-side normalizer must **slice the
   `YYYY-MM-DD`** off the ISO timestamp before `parseYmdLocal`, and (b) the `1900-01-01` sentinel must be
   nulled **before** the classifier. Coverage is **page-1-only** (a global confirmation needs a
   separately-approved broader run); dated **history** (recovery) still needs the unfound per-client
   sign-ins endpoint (item 4).

**Merge order with #428.** This PR (#427) and #428 both edit §5 + `scripts/wodify/README.md`. #428 is
the standalone `/clients` shape-discovery; this PR's one-line patch + re-run builds on it. Merge **#428
first**, then rebase + merge #427, resolving §5 / README to keep both records (the `/clients` shape
discovery from #428, and the patch + re-run outcome here).

### 6. Live wiring spike — 1–2 cards · `Server-side slice (PR1, #431) IMPLEMENTED; deploy/eszip import-resolution sub-gate CLOSED via Option A (explicit .ts import + allowImportingTsExtensions, #435 @ b6bd9d6, 2026-06-05) — deno.json cleanup DONE (#437 @ 04cd034, 2026-06-06 — vestigial deno.json dropped + README reconciled; name-scoped redeploy from merged main PROVEN deno.json-free); grants hardened #440 @ 7a3bc77 (anon/authenticated → SELECT-only); SYNC_TRIGGER_SECRET trigger-gate + fail-closed-500 LIVE #441 @ 67aafd0; redeployed v3 (verify_jwt=true, #441-era ezbr 35e21c14…); FIRST AUTHORIZED LIVE INVOKE EXECUTED 2026-06-07 19:48:53 UTC (one aggregate row verified: 412 active / 956 scanned, §6.6 conservation residual 0, no page cap, dues null + missing flag, PII-free) → first-slice §6 live-data validation goal MET; Step F disarm COMPLETE (both secrets unset, plaintext trigger file deleted) → function now DISARMED/inert; idempotency upsert (unique CONSTRAINT (workspace_id, as_of) + PostgREST on_conflict) DONE 2026-06-08 — constraint applied (gate-4) + function redeployed gate-5 as ezbr a4b19062… (source carried by #444), function still DISARMED; gym-local asOf permanent fix #445 REDEPLOYED LIVE 2026-06-08 (name-scoped CLI from main @ fb21a41, ezbr a4b19062…→eb5f5a33…, verify_jwt=true, still DISARMED, ai-proxy untouched, table unmoved); SPA wiring now LIVE — Attendance Health (PR2, #447 @ 28af0b9) + Silent Churn count-only (PR3, #448 @ 8d1b0b7), both off the shared aggregate snapshot; Member Movement census SPA wiring shipped (#450 @ 243a566) but the card stays Sample until a re-armed re-pull populates the live census columns; normalizeStatus taxonomy HARDENED (#451 @ 058b470) — present-but-unrecognized client_status now fails closed to unknown instead of silently 'ended', edge-function logic only and INERT in prod until the DISARMED function is redeployed + re-pulled` (do this early, before broad live work)

Wire a **minimal** live-data path for one or two Retention cards before any broader live
integration — a validation slice, not a rollout. The biggest remaining risk is whether
Wodify actually provides the fields we need cleanly, reliably, and safely; prove the real
data path before finishing more roadmap/theory.

**Recommended cards: Silent Churn + Attendance Health.** Per the §4 decision, the first
live slice is **aggregate-only** and fetches just `status` · `lastCheckIn` · `monthlyDues`
server-side — see §4 for the input scope, classifier-reuse constraint, and payload target.
`id` / `displayName` / `membershipStart` and the call-list are deferred.

**First bounded live slice — server-side half IMPLEMENTED (PR1, #431) and import-resolution sub-gate CLOSED (Option A, #435 @ `b6bd9d6`, 2026-06-05).**
Source = `/clients` direct recency (§5 #429 — SUFFICIENT for `lastCheckIn`). Cards = Silent Churn +
Attendance Health, aggregate-only. The four open items are decided (see §6.7). PR1 shipped the server-side
half — the pure aggregate module `src/lib/gym/wodifyRetentionAggregate.ts` (reuses the locked date
primitives, threshold-free histogram, parity-tested vs `computeAttendanceHealth`), the thin Edge Function
`supabase/functions/sync-wodify-retention/`, and the non-PII aggregate table
`supabase/wodify_retention_schema.sql`.

**Deploy/eszip import-resolution — CLOSED on the bundling-proof dimension (Option A).** The Edge Function
reaches the locked date helpers through a transitive **extensionless** import of `./silentChurn` (via
`wodifyRetentionAggregate.ts`). That resolved under esbuild but **failed Supabase's deploy/eszip bundler**:
the proof deploy (2026-06-05, CLI 2.98.2 / edge-runtime v1.73.13) errored `Module not found
".../src/lib/gym/silentChurn"`. The earlier #432 function-local `deno.json` `sloppy-imports` mitigation was
**disproven at that deploy path** (present in both the failed and the later passing deploy → not the cause).
**Option A fixed it:** add the explicit `.ts` extension to the one import (`'./silentChurn'` →
`'./silentChurn.ts'`), paired with `allowImportingTsExtensions: true` in `tsconfig.app.json` (legal because
`noEmit` is set). Decisive evidence: the deploy had already resolved the `.ts`-extensioned `index.ts`→aggregate
hop, so making `./silentChurn` explicit gave it the proven-working form. **Verified end-to-end:** local gates
green (23/23 targeted, 661/661 full, `tsc -b`+`vite build`); the named-function deploy **succeeded** (bundled
from the edited tree); landed on `main` via **PR #435 @ `b6bd9d6`** (squash, exactly 2 files; auto Pages SPA
deploy green → the tsconfig change is SPA-safe). `main` now **reproduces the deployed function**. The locked
`silentChurn.ts` was **not** touched — its only transitive import is the **type-only** `./memberFixture`,
which the deploy bundler erases, so the feared lock-bound dead-end did **not** materialize.

**First authorized live invoke EXECUTED — first-slice live-data goal MET; now DISARMED.** `sync-wodify-retention`
is deployed and **ACTIVE** with **`verify_jwt: true`**. On **2026-06-07** the **first authorized live invoke ran once**
under Reviewer + Wesley authorization, against the then-current #441-era bundle (`ezbr_sha256 35e21c14…`) — an
invoke, not a deploy (gate 5 later redeployed the idempotent-upsert bundle as `a4b19062…`; see the idempotency note). **Step D** fetched `/clients` globally and persisted **one non-PII aggregate row**
at **`2026-06-07 19:48:53 UTC`**. **Step E verification passed:** `active_total=412`, `clients_scanned=956`, §6.6
conservation residual **0**, `reached_page_cap=false` (`pages_fetched=10`), `monthly_dues_at_risk=null` with
`missing_monthly_dues=true`, `future_last_check_in=0`, `unknown_status=0`, and the row contains only
counts/dates/histogram fields. **Step F disarm is complete:** `WODIFY_API_KEY` absent, `SYNC_TRIGGER_SECRET` absent,
and the plaintext trigger file was deleted. The **first-slice §6 live-data validation goal is therefore MET** — Wodify
supplies `status` / `lastCheckIn` globally enough for the first aggregate slice, with unknown `lastCheckIn` values
**surfaced explicitly** via the aggregate's `unknown` bucket (155 of 412 active members; 956 clients scanned overall),
not hidden — *not* a failure, because the aggregate contract counts unknowns (conservation:
`activeTotal === histogram + overflow + unknown`) rather than implying perfect coverage. The broader
**PR2 / SPA wiring has since SHIPPED** — Attendance Health (PR2, #447 @ 28af0b9) renders these buckets live at the owner threshold (T=21: **Healthy 146 / Watch 37 / Silent 74 / unknown 155**, summing to the 412 active) and Silent Churn count-only (PR3, #448 @ 8d1b0b7) reuses the same shared snapshot — and any future
re-arm, second pull, or scheduled pull requires a **fresh Reviewer audit + Wesley authorization** (its own two-AI
gate).

**Request-gate stack (current inert behavior; `verify_jwt:true` is the OUTER layer) — `index.ts` + #441:**

- any request **without a valid project JWT → `401`** (platform; never reaches the function)
- `GET` (valid JWT) **→ `405`**, before any secret/env/Wodify work (preserves the Step-0 reachability probe)
- `POST` (valid JWT), `SYNC_TRIGGER_SECRET` **unset → `500` fail-closed** (never open) — **this is the post-disarm resting state**
- `POST` (valid JWT), secret set but `x-sync-trigger-secret` missing/wrong **→ `403`** (constant-time digest compare)
- only `POST` (valid JWT **+** correct `x-sync-trigger-secret` **+** `WODIFY_API_KEY` set) reaches Wodify

The **`SYNC_TRIGGER_SECRET`** shared-secret gate (#441 @ `67aafd0`) is **required and fail-closed**:
`verify_jwt:true` alone admits the public anon key shipped in the SPA bundle, so the trigger secret — not the
JWT — is the structural authorization. The aggregate table's grants were hardened in **#440 @ `7a3bc77`**
(anon + authenticated reduced to **SELECT-only**; the service-role writer left unchanged) — see
`supabase/wodify_retention_schema.sql`. This **idempotency change** then makes the writer an idempotent
upsert and adds a matching named unique **constraint** `wodify_retention_aggregate_workspace_as_of_key`
on `(workspace_id, as_of)` (via `ALTER TABLE … ADD CONSTRAINT`, which fires this project's PostgREST
schema-cache auto-reload — `CREATE INDEX` would not) + an explicit `service_role` **UPDATE** grant
(documentary — premise-checked that live service_role already retains UPDATE; the file's intended
write contract is now SELECT + INSERT + UPDATE, and does not bless the broader platform defaults
service_role still carries). The live constraint apply (`ALTER TABLE … ADD CONSTRAINT …` then
`notify pgrst, 'reload schema'`, 2026-06-08, verified via `pg_constraint`) and the name-scoped redeploy
are **DONE**; the gate-5 idempotency bundle's identity was `ezbr a4b19062…` (itself superseding the #441-era `35e21c14…`;
verified via `list_edge_functions` + a `get_edge_function` source read), later superseded LIVE by the #445
gym-local `asOf` redeploy `eb5f5a33…` (see the asOf note), with the function still DISARMED.

**Deploy rule — name-scoped only.** Any redeploy MUST be name-scoped
(`supabase functions deploy sync-wodify-retention --project-ref gzgxcvjvoivlwaksnmxy`). A **bare**
`supabase functions deploy` would also redeploy `ai-proxy` and **flip it to `verify_jwt:true`**, breaking the
live SPA proxy.

**First authorized live invoke — canonical order (EXECUTED once 2026-06-07; remains the repeatable runbook; any re-run needs fresh Reviewer + Wesley authorization):**

- **A.** Set `SYNC_TRIGGER_SECRET` only (secret-safe flow — see the function README).
- **B.** With `WODIFY_API_KEY` **still absent**, prove the gate: `GET → 405`; `POST` no header `→ 403`;
  `POST` bad header `→ 403`; `POST` correct header `→ 500` fail-closed with **zero Wodify reachable**
  (this proof is only possible while the key is unset).
- **C.** Set the rotated `WODIFY_API_KEY` (secret-safe flow).
- **D.** Single real `POST` (valid JWT + correct `x-sync-trigger-secret`) — the **irreversible external
  action** (first live Wodify pull). *(Pull timing is no longer `asOf`-constrained: the gym-local `asOf`
  fix is live (#445), so any time works; the former **midday gym-local** timing was the now-RETIRED
  interim mitigation.)*
- **E.** Verify the persisted row + the §6.6 conservation invariant.
- **F.** Unset `WODIFY_API_KEY` (disarm).

**Execution record — 2026-06-07.** **A:** `SYNC_TRIGGER_SECRET` set. **B:** gate proofs passed — `GET → 405`;
`POST` no/bad header → `403`; `POST` correct header + key absent → `500` fail-closed, zero Wodify reachable. **C:**
rotated `WODIFY_API_KEY` set. **D:** one real `POST` at `19:48:53 UTC` — first live Wodify pull. **E:** row verified —
412 active / 956 scanned, §6.6 conservation residual 0, no page cap, dues null + missing flag, PII-free. **F:**
`WODIFY_API_KEY` and `SYNC_TRIGGER_SECRET` unset, plaintext trigger file deleted.

**First cycle complete (2026-06-07); the function is DISARMED.** Re-arming Step A→D requires **fresh authorization**.
**Idempotency — DONE 2026-06-08** (was the recommended next; prerequisite for any second/scheduled pull):
a named unique **constraint** `wodify_retention_aggregate_workspace_as_of_key` on `(workspace_id, as_of)`
(via `ALTER TABLE … ADD CONSTRAINT` — which fires this project's PostgREST cache auto-reload, `CREATE INDEX`
would not — applied gate-4 with `notify pgrst, 'reload schema'`; premise-checked: zero duplicate rows, built
clean; live service_role already had UPDATE) + an intentional PostgREST upsert (`on_conflict=workspace_id,as_of`,
`Prefer: resolution=merge-duplicates`) deployed gate-5 (`ezbr a4b19062…`), so a same-day re-pull **replaces**
the day's row instead of duplicating it. Constraint applied live + function redeployed (function still
DISARMED); the matching source is carried by **#444**. **PR2 / SPA wiring — DONE:** Attendance Health (PR2, #447 @ 28af0b9) and Silent Churn
count-only (PR3, #448 @ 8d1b0b7) both apply the owner threshold + `WATCH_FLOOR_DAYS` to the
shared aggregate histogram client-side (via `deriveBuckets`). **Recommended next §6 work** is the
slice the non-PII aggregate cannot yet back, each gated on re-arming the **DISARMED** function
(re-arm / 2nd / scheduled pull = a fresh Reviewer + Wesley two-AI gate). **Pre-pull taxonomy gate
(#451 @ `058b470`):** before any re-armed pull, confirm the real `client_status` vocabulary Wodify
returns and map each value explicitly. `normalizeStatus` now **fails closed to unknown** for any
present-but-unrecognized status (the prior silent `else → 'ended'` catch-all is gone), so an
un-enumerated status inflates `unknownStatus` rather than the ended census — **do not proceed with
the pull if the real statuses would make the census semantics misleading; stop
and report and extend the taxonomy first.** *(This gate was EXERCISED 2026-06-10: the vocab probe
proved the 3-way semantics WERE misleading, and the census was rescoped to binary — see "Census
rescope" below.)* (#451 is **edge-function logic only** and is **INERT in
production** until the DISARMED `sync-wodify-retention` function is redeployed **and** a fresh
authorized pull runs — the SPA bundle is unchanged.) The blocked slices: (i) **Member Movement** —
the census SPA wiring **shipped (#450 @ `243a566`, rescoped to binary 2026-06-10)**, but the card
**stays Sample** until a re-armed re-pull populates the live census column (`inactive_total`); its
**join-cohort intake** plus **Churn Risk by Tenure** (#411) bands additionally need the **unproven
`membershipStart` / join-date** field; (ii) Silent Churn **$-at-risk** needs a dues source (CSV
import — the Wodify financials API is tier-blocked); (iii) Silent Churn **call-list / member
names** stay blocked by the §4 PII / auth gate. **Live status:** Attendance Health + Silent Churn
(count-only) are **LIVE** from the aggregate; Member Movement + Churn Risk by Tenure remain **not
fully live** (Sample).

**asOf timezone — permanent fix LIVE (2026-06-08, #445).** `asOf` was the **server-UTC** fetch
date, which can shift the day boundary ±1 vs the gym's local day. The permanent fix is now **implemented in
code**: `asOf` is derived gym-local (`America/New_York`) via the pure, dual-runtime `gymLocalDay(instant, tz)`
helper in `wodifyRetentionSync.ts`, wired into the `index.ts` shell (`fetchedAt` stays a true UTC instant;
`computeRetentionAggregate` unchanged). **It is now LIVE (2026-06-08, #445):** a name-scoped CLI redeploy of `sync-wodify-retention` from merged
`main` @ `fb21a41` replaced the prior UTC-`asOf` bundle. Two-AI gated (builder readiness packet + 4-blob-SHA
byte-pin → read-only Reviewer pre/post close) and owner-run. The canonical live identity is now
**`ezbr eb5f5a33…`** (was `a4b19062…`), `verify_jwt:true`, function **still DISARMED** — the redeploy is
secret-neutral, and post-deploy the aggregate table was unmoved (1 row, `as_of 2026-06-07`, `fetched_at`
unchanged), so no invoke fired. The **interim midday-gym-local mitigation is RETIRED**: the live bundle now
buckets `asOf` to the gym's day regardless of pull time.

**Census rescope — BINARY (active/inactive), 2026-06-10. The paused/ended census is RETIRED as
source-unsupported (not deferred).** Evidence, in order: (1) the **vocab gate** (2026-06-09, live
`clientStatusVocab.ts` run, 957 records, coverage-complete) proved `client_status` is **binary** —
exactly `Active` (409–410) / `Inactive` (547–548), no third value; (2) the **field-discovery probe**
(`scripts/wodify/clientsMembershipStateDiscovery.ts`, 3-round Reviewer hardening gate, live run
2026-06-10, output Reviewer-gated CLEAN) proved **NO other `/clients` field separates paused from
ended**: 79 fields total, **no hold/freeze/cancel/membership-state field exists**, and every field is
present on all 957 records, so presence-based separation is structurally impossible
(`separationConfidence: none`). A 3-way census is therefore **unsourceable from `/clients`** — under
the pre-rescope code a re-pull would have rendered paused 0 / ended 0 with all 548 Inactive members
in unknown, a dishonest card. **The rescope (one code-only PR):** `normalizeStatus` maps the proven
vocabulary only (`/^active$/i`, `/^inactive$/i`, anything else fail-closed → `unknownStatus`); the
aggregate census partition is now `activeTotal + inactiveTotal + unknownStatus === clientsScanned`
(conservation tested); the unapplied draft schema's `paused_total`/`ended_total` became
`inactive_total` (NULLABLE, no default — null → Sample, a real 0 renders live; verified 2026-06-10
the live table has never had census columns); the card shows **Active / Inactive** with honest
catch-all copy (on-hold placement within Wodify's binary is **unverified** — the copy hedges rather
than asserts) and surfaces a nonzero unknown-status count (parity with Attendance Health's Unknown).
The AH/SC path is regression-clean by construction — the `/^active$/i` matcher, activeTotal, and the
recency histogram are untouched (pinned by a parity-regression test). The card **keeps its Sample
gate** until a future Wesley-gated re-armed re-pull populates `inactive_total`. A 3-way census would
need a different source (another Wodify endpoint at a higher tier, or an Admin export) — a separate,
unscoped discovery.

**Prior-state facts (preserved).** The import-resolution sub-gate closed via Option A (#435 @ `b6bd9d6`); the
**`deno.json` cleanup — DONE** (#437 @ `04cd034`, 2026-06-06) dropped the vestigial function-local `deno.json`
and reconciled the README; a name-scoped redeploy from merged `main` (CLI 2.98.2) was **deno.json-free**
(`index.ts` → `wodifyRetentionAggregate.ts` → `silentChurn.ts` via `.ts` imports alone; the type-only
`./memberFixture` erased), proving `deno.json` is not load-bearing for the deployed bundle.
`sync-wodify-retention` is **ACTIVE, `verify_jwt:true`**, current identity **`ezbr_sha256 eb5f5a33…`** (the #445 gym-local `asOf` redeploy 2026-06-08, superseding the gate-5
idempotent-upsert redeploy; the 2026-06-07 live pull was an invoke against the prior #441-era `35e21c14…` bundle,
not a deploy), and is **DISARMED** (version pins are documentation only — identity is `ezbr` / `verify_jwt` /
`updated_at`); `ai-proxy` is provably **untouched** (`verify_jwt:false`, `ezbr_sha256 3d392f3e…`, `updated_at`
unmoved). Loose ends: (a) **CLOSED by gate 5** — the redeploy reset the platform metadata, so `import_map_path`
is now `null` and `entrypoint_path` points at the fresh deployed path (no more deleted-worktree references); the
current `ezbr_sha256 eb5f5a33…` bundle is authoritative. (b) **CLOSED** — the #445 redeploy was that next substantive `index.ts` redeploy, so the deployed
header comment is now reconciled live; `main` @ `fb21a41` reproduces the live `eb5f5a33…`. **(ii) PR2 / SPA wiring** (apply the owner threshold +
`WATCH_FLOOR_DAYS` rule client-side to the histogram) is now **DONE** — Attendance Health
(PR2, #447 @ 28af0b9) + Silent Churn count-only (PR3, #448 @ 8d1b0b7), both off the shared
aggregate snapshot via `deriveBuckets`. **Post-cycle state:** exactly one
authorized invoke/POST/Wodify call occurred on 2026-06-07, then the function was disarmed (both secrets unset,
plaintext trigger file deleted); SPA/PR2 wiring has since shipped frontend-only (PR2, #447 @ 28af0b9 + PR3, #448 @ 8d1b0b7 — no further invoke / deploy / Wodify call); `ai-proxy` unchanged (`verify_jwt:false`, `ezbr_sha256
3d392f3e…`).

1. **Server-side reuse boundary (refined in PR1).** The server imports ONLY the locked, threshold-FREE
   date primitives — `parseYmdLocal` and `wholeDaysBetween` — from `silentChurn.ts`, and never forks them
   (`src/lib/gym/wodifyRetentionAggregate.ts`). It does NOT call `classifyMember` /
   `computeAttendanceHealth` server-side: those are threshold-coupled, and the aggregate is a
   **threshold-free** exact-day histogram (§6.6) so the owner-tunable threshold is applied entirely in the
   SPA (PR2), reusing the same `WATCH_FLOOR_DAYS` + threshold rule. *(This refines the original §6.1, which
   said the server derives "at the `classifyMember` / `computeAttendanceHealth` level" — that path can't
   yield a threshold-free histogram.)* The server reads only the raw `/clients` fields that matter:
   `client_status` (→ `'active'` is load-bearing) and the recency dates `last_attendance` /
   `last_class_sign_in` (→ `parseYmdLocal`; null/invalid → `unknown`). `monthlyDues` is unavailable (§6.4);
   `id` / `displayName` are never read. So the minimal normalized per-member input is
   `{ status, lastCheckIn: 'YYYY-MM-DD' | '' }`. Parity with the locked classifier is PROVEN BY TEST
   (`wodifyRetentionAggregate.test.ts`): reconstructing Healthy / Watch / Silent from the histogram equals
   `computeAttendanceHealth` at every threshold (so `silent === computeAttendanceHealth().silent ===
   computeSilentChurn().count` by construction).

2. **Wodify `/clients` → internal normalization (server-side, transient).**
   - **`status`** ← per-record `client_status` (the `status=Active` query does **not** filter — §5).
     **BINARY since the 2026-06-10 rescope (proven vocabulary only):** map `/^active$/i → 'active'`,
     `/^inactive$/i → 'inactive'`; **everything else fails closed to unknown** — present-but-unrecognized
     values (e.g. `Trial`, `Prospect`, `Active - Comp`, and the formerly-mapped `Paused`/`Frozen`/`On Hold`/
     `Ended`/`Cancelled` words, none of which Wodify returns) **and** missing / non-string / empty — are
     excluded from both census buckets **and** counted in `dataQuality.unknownStatus`. *(History: #451
     (@ `058b470`) removed the original `else → 'ended'` catch-all; the 2026-06-10 rescope then replaced the
     speculative paused/ended word-maps with the proven binary vocabulary — see "Census rescope" above.)*
     Only active-ness is load-bearing for this slice.
   - **`lastCheckIn`** ← the most-recent **usable** of `last_attendance` and `last_class_sign_in` (both
     primary). Per field, **in this order**: (a) **slice the leading `YYYY-MM-DD`** off the ISO timestamp
     (#429: every value carried a time component, `strictYmd 0`); (b) if it equals the **`1900-01-01`
     sentinel → null**; (c) if it fails a strict `YYYY-MM-DD` calendar check → null. `lastCheckIn` =
     `max(usable dates)`, or `''` when neither is usable (→ `parseYmdLocal` null → `unknown` bucket, never
     silently Healthy). **Slice + sentinel-null happen BEFORE the classifier** — `1900-01-01` is never
     passed to `parseYmdLocal` (it would parse as a real ancient date and mis-flag the member `silent`).
   - **`monthlyDues`** ← **NOT on `/clients`** (#428: no dues field). Set `null`, never `0` (`0` fakes a
     real value and understates dues-at-risk). Consequence in §6.4.
   - **`is_at_risk`** → **secondary context only** — not consumed by the classifier; may be stored as a
     diagnostic `wodifyAtRiskCount` to compare Wodify's flag (fired 1/100, #429) against our threshold rule.
   - **`days_since_last_attendance`** → **diagnostic only** — we compute `daysAbsent` ourselves from
     `lastCheckIn` against **our** `asOf` (today) anchor (§4). Never primary (it is numeric even for
     sentinel members — #429 — so it has no clean null and would silently mis-flag them).

3. **Anchor + threshold.** `asOf` = the server-side fetch date (today, `YYYY-MM-DD`), recorded with
   `fetchedAt` (ISO). **DECIDED (a): the server emits a non-PII `daysAbsent` histogram** — counts by
   `daysAbsent` over active members, plus the `unknown` count — **not** a single-threshold precomputed
   aggregate. The SPA re-derives count / Healthy / Watch / Silent at **any** threshold client-side (the same
   `WATCH_FLOOR_DAYS` + threshold rule from `silentChurn.ts`), so the owner-tunable threshold (shipped #408,
   browser-side `RetentionSettingsContext`) keeps working with **zero PII and no extra Wodify fetch**. The
   histogram is bounded (final `>= 365`-day bin) so it carries no exact dates and cannot re-identify a member.

4. **The dues gap — count-complete, dollar-incomplete (honesty guard; §6 "do not fake").** `/clients` has
   no dues field, so `monthlyDuesAtRisk` **cannot** be sourced from this slice. **DECIDED (b): ship
   count-only first — do NOT block live Silent Churn on dues.** Emit `monthlyDuesAtRisk: null` +
   `missingMonthlyDues: true` (**never `0`, never a fabricated dollar**); the card shows the dollar as "not
   available from this source yet," never `$0`. A real dollar waits on a dues source — the §5 hybrid
   **monthly Wodify Admin CSV** (financials are API-tier-blocked), joined server-side by an internal key —
   deferred to its own slice.

5. **Transport + PII safety (binds §4 + the member-PII anon-key blocker).**
   - **DECIDED (d):** the Supabase **Edge Function `sync-wodify-retention`** holds `WODIFY_API_KEY` via
     `supabase secrets` — **server-side only**; never `VITE_*`, never the browser bundle, never committed.
     The browser never calls Wodify.
   - The function **paginates all `/clients` pages** (100/page cap + `has_more` loop; ~10 pages for the
     ~912-client prior) → the live aggregate is **global**. This is where #429's "sampled-page-only" caveat
     is closed — at wiring time, by the real fetcher, so no separate multi-page probe is needed first.
   - Raw `/clients` rows are **transient in memory only** — never logged, never persisted (§4).
   - The aggregate Supabase table **persists only the aggregate / normalized fields the dashboard needs —
     never raw Wodify payloads** — and holds **no PII**: `activeTotal` / `daysAbsentHistogram` / `unknown` /
     `asOf` / `fetchedAt` / `dataQuality`. The SPA reads it with the public anon key, which is safe
     **because** the row is non-PII (the anon-key blocker is satisfied by construction, not by trust).
   - Normalization reuses the probe scripts' slice / sentinel / status-bucket logic + the locked classifier
     helpers — one definition, no fork.
   - **Refresh cadence (DECIDED d): manual / admin-triggered first** — the function runs on demand for the
     first live slice. A **scheduled refresh comes later, only after the first slice proves stable** — not
     part of this slice.

6. **Payload (IMPLEMENTED shape — exact-day `daysAbsent` histogram OBJECT; PR1 server-side slice).**
   ```ts
   { source: "wodify", asOf, fetchedAt,
     activeTotal: number,
     daysAbsentHistogram: {            // threshold-free, exact-day, over ACTIVE members
       maxExactDays: 364,              // bins "0".."364" are exact whole-day counts
       countsByDaysAbsent: Record<string, number>,  // sparse: { "<days>": <count> }
       overflow365Plus: number,        // active members >= 365 days absent
     },
     unknown: number,                  // active, missing/sentinel/invalid lastCheckIn (NOT Healthy)
     silentChurn: { monthlyDuesAtRisk: null, missingMonthlyDues: true },  // count derived client-side at T
     diagnostics: { wodifyAtRiskCount },
     dataQuality: { unknownStatus, futureLastCheckIn, pagesFetched, reachedPageCap, clientsScanned } }
   ```
   The SPA computes `silentChurn.count` and the Healthy / Watch / Silent split from `daysAbsentHistogram`
   at the owner's current threshold: `silent` = bins `>= T` plus `overflow365Plus`; `watch` = bins
   `[WATCH_FLOOR_DAYS, T)`; `healthy` = bins `< WATCH_FLOOR_DAYS`; `unknown` carried separately. No member
   rows, names, IDs, exact dates, or dues ever enter the payload.

   **Shape change vs the original §6.6 (PR1, per "Facts override this file").** The histogram is an OBJECT,
   not `number[]`. A bare array has no defined slot for a future-dated `lastCheckIn` (negative `daysAbsent`)
   and conflates the `>= 365` overflow with a positional index. The object bins exact days `0..364` in
   `countsByDaysAbsent`, rolls `>= 365` into `overflow365Plus`, bins a future date at day 0
   (Healthy-compatible — §6.7) and counts it in the new `dataQuality.futureLastCheckIn` diagnostic.
   Conservation holds by construction: `activeTotal === sum(countsByDaysAbsent) + overflow365Plus + unknown`.

7. **Decisions (locked 2026-06-05 by owner).** (a) **payload = `daysAbsent` histogram**, not single-T, so
   the owner-tunable threshold works without another Wodify fetch (§6.3); (b) **dues = ship count-only
   first**, `monthlyDuesAtRisk: null` + `missingMonthlyDues: true`, never `$0`, never block live Silent Churn
   on dues (§6.4); (c) **`lastCheckIn` = most-recent usable of `last_attendance` / `last_class_sign_in`**
   after ISO slicing + `1900-01-01` nulling (§6.2); (d) **Edge Function `sync-wodify-retention`**, persist
   only aggregate/normalized dashboard fields (not raw payloads), **manual/admin-triggered refresh first**,
   scheduled refresh later only after the first live slice proves stable (§6.5). Wiring stays gated: **do not
   build until this design is greenlit to implement.**

Rules:

- Spike / validation slice only — **not** a full rollout.
- Wodify API key **must not** be exposed in the browser; prefer server-side access or safe
  rollups (respect §4).
- Do not add PII fields beyond those needed for this validation.
- Do not wire Churn by Age, Segment Explorer, Churn by Belt, or Silent Churn Recovery.
- **Do not fake missing data.** If Wodify doesn't provide the required fields cleanly,
  **stop and report**.
- If the safe architecture is unclear, **stop and report** before building deeper.

Success criteria:

- Confirm whether Wodify can support Silent Churn and Attendance Health with real data.
- Identify missing / bad fields, and any privacy/security blockers.
- Confirm whether our sample-data assumptions hold.
- Decide: continue to full live wiring, or revise the Retention model first.

Everything below (broad adapter, broad source switching, real-data guards, full-card
validation, and any future card) waits on what this spike finds.

### 7. Build server-side Wodify Retention adapter (broad) · `TODO` (after §4 + §6 spike)

Only after the safety decision and the spike. Generalize the minimal §6 path into the full
internal member model: `id` · `displayName` · `status` · `monthlyDues` · `membershipStart`
· `lastCheckIn`. Do not add PII fields unless approved.

### 8. Add real-data guards · `TODO`

Before live data powers the cards, handle: missing `membershipStart` · invalid dates ·
missing `lastCheckIn` · unknown status · missing monthly dues.

Important guard: an at-risk member with a bad `membershipStart` must not appear in Silent
Churn but silently **disappear** from Churn Risk by Tenure — surface an explicit unknown
bucket rather than dropping them.

### 9. Add sample/live source handling (broad) · `TODO`

Cards keep the **same compute logic**; only the source changes (sample fixture ↔ live
Wodify). When live: remove/replace the `Sample data` badge and show a clear
source/freshness status.

### 10. Validate live Retention cards · `TODO`

Validate Silent Churn, Attendance Health, Churn Risk by Tenure, Member Movement on live
data. No fake recovery, churn trend, cancellation trend, or movement trend unless Wodify
provides dated history.

---

## Future gated cards (not required for the first live page)

- **Silent Churn Recovery · `Blocked`** — needs dated check-in history; do not build from
  `lastCheckIn` alone. Off-page; tracked in Notion (P3 / Later).
- **Churn by Age · `Parked`** — PII / data-minimization decision; use **age buckets only,
  never birthdates**.
- **Segment Explorer · `Parked`** — PII / data-minimization decision; do not use sex, zip,
  payment type, class time, or similar without policy. Highest-PII surface on the page.
- **Churn by Belt · `Blocked`** — Wodify progressions/belt-rank API **reportedly unavailable
  for public use** per Wodify support (chat-reported, not repo-verified) — an API-availability
  limit, not merely a current-tier 403.

---

## Open decisions

- **Live-data safety architecture** (Phase 2 §4) — the gating decision for going live.
- **PII / data-minimization policy** — unblocks Churn by Age + Segment Explorer.
- **Durable-rule migration timing + file retirement** — when to migrate (#1/#2/#4) and
  when to delete this file (only once fully live).
- **Parked/blocked gate-note pattern** — decide later whether the convention introduced in
  #415 needs a durable home in `UI_RULES.md` (deferred from the #415 review; single use so far).

---

## Operating rules

- **Source of truth, with a lifespan.** This file is the Retention roadmap until the page
  is fully live on the intended data source — then it is retired (below). It is not a
  replacement for permanent docs.
- **Facts override this file.** If implementation reveals it's wrong, fix it in the same PR
  and note what changed.
- **Lives with the code.** Update this file in the same PR as the work it describes; mark
  items `Done` (with PR #) as they land.
- **Not a second backlog.** Implementation detail and roadmap only — bigger backlog items
  stay in Notion.
- **Durable rules may move out.** The rules above may migrate to `AGENTS.md` / `UI_RULES.md`
  (Phase 1 §3) while this file still lives.
- **Retirement.** Delete this file only when Retention is **fully live** *and* its durable
  rules have been migrated — with Wesley's explicit approval. *(This supersedes the earlier
  "delete when the Page Complete Check passes" rule: that check now passes, but the file
  lives on through the live-data work.)*

**Verification (for edits to this file):** docs-only change — confirm the diff touches only
`RETENTION_FINISH_PLAN.md`; no build required unless the repo process demands it.
