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

### 5. Wodify data availability probe · `BLOCKED — probed 2026-06-04 (Outcome #1)`

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

Confirm what the API can actually provide: current clients · active/paused/ended status ·
membership start date · last check-in date · monthly dues · **dated check-in history** ·
paused/cancelled/status-change dates · belt/rank.

This also settles the gate for Silent Churn Recovery (needs dated check-in history) and
for any movement/cancellation trend (needs dated status changes).
Known issue: belt/rank appears **API-blocked** at the current access level.

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
- **Churn by Belt · `Blocked`** — needs Wodify belt/rank access; currently 403-blocked
  (support declined).

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
