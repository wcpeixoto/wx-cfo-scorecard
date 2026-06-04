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

### 1. Add PR test CI · `TODO`

Add a `pull_request` workflow that runs the Retention guards on every PR:

- `npm run test` (= `vitest run`)
- `npm run build` (already runs `tsc -b`; a separate `tsc -b` step is optional, as an
  earlier-failing typecheck signal)

Reason: the tests protect the shared classifier locally but are **not enforced on PRs**
today. Land this first so later PRs are gated by it.

Note: `.github/workflows/` is a **locked path** — owner approval required before implementation.

### 2. Independent `silentChurn.ts` correctness audit · `TODO`

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

### 4. Live-data safety / architecture decision · `DECISION NEEDED` (gates all Phase 2 build)

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

### 5. Wodify data availability probe · `TODO`

Confirm what the API can actually provide: current clients · active/paused/ended status ·
membership start date · last check-in date · monthly dues · **dated check-in history** ·
paused/cancelled/status-change dates · belt/rank.

This also settles the gate for Silent Churn Recovery (needs dated check-in history) and
for any movement/cancellation trend (needs dated status changes).
Known issue: belt/rank appears **API-blocked** at the current access level.

### 6. Build server-side Wodify Retention adapter · `TODO` (after §4)

Only after the safety decision. Map live data into the internal member model: `id` ·
`displayName` · `status` · `monthlyDues` · `membershipStart` · `lastCheckIn`. Do not add
PII fields unless approved.

### 7. Add real-data guards · `TODO`

Before live data powers the cards, handle: missing `membershipStart` · invalid dates ·
missing `lastCheckIn` · unknown status · missing monthly dues.

Important guard: an at-risk member with a bad `membershipStart` must not appear in Silent
Churn but silently **disappear** from Churn Risk by Tenure — surface an explicit unknown
bucket rather than dropping them.

### 8. Add sample/live source handling · `TODO`

Cards keep the **same compute logic**; only the source changes (sample fixture ↔ live
Wodify). When live: remove/replace the `Sample data` badge and show a clear
source/freshness status.

### 9. Validate live Retention cards · `TODO`

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
