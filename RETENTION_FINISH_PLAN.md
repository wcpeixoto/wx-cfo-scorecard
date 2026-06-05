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
- **Member Movement** (#414) — current census (active / paused / ended) + join-cohort
  intake only. **No movement-over-time series by design** — the fixture carries no
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

### 5. Wodify data availability probe · `Error-envelope hardening DONE (#425 · 97922cc, 2026-06-05) — classSigninProbe now detects the Wodify error envelope and treats an embedded non-2xx HTTPCode as failure, not "0 records"; probe NOT run; mapping still not proven. Prior: shape discovery (#423 · 7da4369) found the first probe's transport-2xx + 0 records was a Wodify error envelope (not a true empty dataset); bare /signins shows a per-client-ID signal (first probe #420 · 625bff8)`

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
2. **Only then** consider a **separately-approved per-client / per-ID probe** to confirm a
   `/clients/{id}/signins`-style path and the field mapping. **Still requires separate approval; not
   started** — no per-client / per-ID calls have been made.

### 6. Live wiring spike — 1–2 cards · `TODO` (do this early, before broad live work)

Wire a **minimal** live-data path for one or two Retention cards before any broader live
integration — a validation slice, not a rollout. The biggest remaining risk is whether
Wodify actually provides the fields we need cleanly, reliably, and safely; prove the real
data path before finishing more roadmap/theory.

**Recommended cards: Silent Churn + Attendance Health.** Per the §4 decision, the first
live slice is **aggregate-only** and fetches just `status` · `lastCheckIn` · `monthlyDues`
server-side — see §4 for the input scope, classifier-reuse constraint, and payload target.
`id` / `displayName` / `membershipStart` and the call-list are deferred.

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
