# Retention Finish Plan

**Working implementation checklist for finishing the Retention page. Temporary — not a permanent backlog.**

> **Status — 2026-06-03 (this PR): Retention page UI is COMPLETE.** The three
> remaining shells now carry honest gate notes (Churn by Age + Segment Explorer
> = `parked`, Churn by Belt = `blocked`), Member Movement is relabeled
> ("Joins by cohort" / "Joins"), and every Page Complete Check box passes.
> **This file is intentionally NOT deleted yet.** Per the self-destruct rule
> (Instructions #5), retirement is blocked on Wesley approving migration of the
> durable rules into `AGENTS.md` / `UI_RULES.md`. Proposed wording + exact
> insertion points are in the PR description. Once migrated (or explicitly
> waived), delete this file.

## Instructions for Builder

1. **Lives with the code.** Update this file in the *same PR* as the work it describes — not separately, not after the fact.
2. **Mark state inline.** Every item carries one marker: `TODO` · `In progress` · `Done` · `Blocked` · `Parked`. Update it when reality changes (PR merges, rebases, data-gate decisions).
3. **Facts override the plan.** If the actual repo files contradict anything written here, the file is wrong. Fix the file, note what changed, and flag it in the PR description. Do not follow the plan over the code.
4. **Not a second backlog.** Implementation detail only. Bigger backlog items stay in Notion. Do not migrate Notion items into this file.
5. **Self-destruct.** When the Retention page is complete (Page Complete Check passes), delete this file in the same PR — or, if any rules in it are durable, move them into `AGENTS.md` / `UI_RULES.md` *first*, then delete. This file does not survive the page.

## Current rule (applies to every item below)

**Do not build fake history.** If the fixture does not contain dated events, do not infer trends, recovery, cancellations, or net movement over time. An honest empty result beats an invented one.

Shared classifier rule: every Retention card reuses the shared `classifyMember` logic. No card creates a competing or forked risk definition.

`$ at risk` rule: any dues-at-risk figure is **active-only**. Paused/ended rows carry `monthlyDues: 0` and self-exclude — keep it explicit so dues are never summed across statuses.

---

## Build Queue

### 1. Merge PR #410 — Attendance Health · `Done`

Status: **merged.** This was the gate everything stacked behind.

PR #410 *is* the shared classifier — it establishes `healthy` / `watch` / `silent churn`. "Finishing Attendance Health" means merging #410; there is no separate build step.

After merge: mark `Done`, continue from `main`.

### 2. Lock the shared Retention classifier · `Done`

Status: **merged.** PR #412 landed (squash `ca689b6`); #410 had landed and #411 (Churn Risk by Tenure) is the third consumer, so the lock was due.

Churn Risk by Tenure (item 4) is the third consumer of the shared classifier. The cross-card guardrail prevents drift *between* cards but does **not** prevent a wrong-but-consistent edit to the shared rule itself.

Action: add the shared classifier file (`src/lib/gym/silentChurn.ts`) to the locked / change-with-care list in `AGENTS.md`, with a note that edits affect Silent Churn, Attendance Health, Churn Risk by Tenure, and all future Retention cards. (This is PR #412.)

This is a locked-list edit → owner approval + Builder commit.

### 3. Churn Risk by Tenure branch state · `Done`

Status: **first action on this card — do not assume a branch/PR exists.**

Run the check, then branch:

- **If a branch/PR exists:** record the PR number and head branch here. Rebase onto `main` after #410 lands. Verify it imports the *merged* `classifyMember` (not a fork frozen at stack-time). Then proceed to merge.
- **If no branch exists:** build it (item 4) after #410 lands, or stack cleanly on #410.

Mark this item `Done` once the branch state is confirmed and recorded.

### 4. Churn Risk by Tenure · `Done`

Status: **built and merged in #411** (verified live on `main`, byte-identical to the gated head). Spec below kept for reference and for the anti-drift invariant.

**Card name is `Churn Risk by Tenure`** — this is what shipped in #411 (module, test, and title) and what #412 locks in `AGENTS.md`. Do not introduce "Member Risk Timeline" or "Risk by Time as Member" in any new title, file, test, or copy. Code and plan now agree; no rename is owed.

- **Subtitle:** "Which tenure cohort is drifting most."
- **Purpose:** show which membership-duration group holds the most risk.
- **Section:** Patterns.

Compute (active members only):

- Tenure = days between `membershipStart` and `FIXTURE_TODAY`.
- Buckets: `0–90 days` · `3–6 mo` (90–179) · `6–12 mo` (180–364) · `1–2 yr` (365–729) · `2 yr+` (≥730). Label in months/years, cut on days.
- Per bucket: active total, healthy, watch, silent, risk count (`watch + silent`), risk rate (`risk ÷ active`).
- Hero: highest-risk-rate bucket. Takeaway line: "Highest risk: [bucket]".

Reuse, don't fork: import `classifyMember` and the threshold resolver from `silentChurn.ts`; read the live threshold from `RetentionSettingsContext`. Do not re-implement the active-filter / `≥T` predicate.

New compute module: `src/lib/gym/churnRiskByTenure.ts` (do not bloat `silentChurn.ts`). Tenure via `parseYmdLocal` + `wholeDaysBetween`.

UI: real card on the locked `gym-card--full` surface; keep subtitle; add the "Sample data" badge. Style inner elements only — do not touch the outer `.card` surface; reuse existing tokens, no new hex.

Tests (`churnRiskByTenure.test.ts`):
- Deterministic bucket counts at T=21.
- Integrity invariant: Σ bucket active totals === total active members.
- **Anti-drift cross-check:** Σ `silent` across buckets === `computeSilentChurn(...).count` at the same threshold. This guard is required in the PR.

Guardrails: no PII, no Wodify/API work, no `contract.ts`, no locked-file edits beyond the item-2 classifier lock (which lands separately).

### 5. Decide Member Movement scope · `Done`

Status: **decided and shipped** — the card built in item 6 implements exactly this
locked scope (census + new-by-cohort, no movement time-series).

Fixture **has:** `membershipStart`, current `status`.
Fixture **lacks:** `endedAt` / `pausedAt` / `statusChangedAt` / any historical status events.

Honestly computable: current active / paused / ended census; new members by join-date cohort.
**Not** honestly computable: cancellations by period, net movement over time, churn flow over time, status-change trend — all require dated status changes the fixture does not carry. Building them = inventing cancellation dates = a fake-history violation.

**Decision (locked):** ship the smaller honest card. Census + new-by-cohort only. Do **not** show net movement, cancellation trend, flow chart, or any time-series of movement. Do not add dated status fields unless that is separately, intentionally approved.

### 6. Build Member Movement · `Done`

Status: **built and shipped in this PR.**

Show: current active / paused / ended census; new members by join-date cohort.

**Cohort-window caveat:** the fixture's newest `membershipStart` is `2025-06-02`. A narrow window ("new this month/quarter") will render 0 against `FIXTURE_TODAY` and read as broken. Use a window wide enough to produce a non-empty result on sample data (e.g. by half-year), or state the empty result explicitly.

Sample data only; "Sample data" badge; no PII; no Wodify/API work; no `contract.ts`.

**As shipped:**

- New compute module `src/lib/gym/memberMovement.ts` (`computeMemberMovement`) — kept
  separate from `silentChurn.ts`. No risk machinery: it does **not** import
  `classifyMember` / `computeSilentChurn` / the threshold resolver, takes no
  `asOf`/threshold, and has no anti-drift cross-check (there is no at-risk figure to
  drift). Reuses only `parseYmdLocal` from `silentChurn.ts` for join-date parsing.
- **Census** is a RAW `status` tally (active / paused / ended) — not derived through any
  classifier (which returns null for non-active members and so can't produce
  paused/ended). **Intake** buckets **all** members (any status) by `membershipStart`
  into contiguous **half-year** cohorts, earliest join first — active-only would
  understate past intake by dropping members who later paused/ended. Window spans the
  earliest→latest join half-year (2021-H1 … 2025-H1 on the fixture: 9 non-empty
  cohorts), satisfying the caveat.
- Tests `src/lib/gym/memberMovement.test.ts`: census integrity
  (`active + paused + ended === total === members.length`), deterministic cohort counts,
  contiguous-timeline check, all-members intake, and a defensive bad-date → `unknownJoin`
  case. No anti-drift test by design.
- UI `MemberMovementCard` in `GymPage.tsx` on the locked `gym-card--full` surface;
  `.member-movement-*` inner styling mirrors the `.attendance-health-*` tiles and
  `.churn-tenure-*` table (no new hex, outer `.card` untouched); "Sample data" badge.
- **Subtitle rewrite (in scope):** the shell's
  "Is acquisition beating churn, or is churn eating growth?" promised a net-flow-over-time
  answer this card cannot honestly give. Replaced with **"Current member mix and when they
  joined."** to match the content.
- Verified: `npx tsc -b` clean, `npm run build` clean, `vitest` 25/25 (the 19 existing
  silentChurn/churnRiskByTenure tests still pass — zero classifier drift).

---

## Blocked / Parked

Remain shells or clearly-labeled parked cards until their gate is solved. None are "low-hanging fruit."

### Churn by Age · `Parked`

Gate: PII / data-minimization decision. Use **age buckets only, never birthdates**. Do not build until the data policy is decided. **Now rendered as a `parked` gate note in `GymPage.tsx` (this PR)** — still a shell, no internals.

### Segment Explorer · `Parked`

Gate: PII / data-minimization decision — highest PII risk on the page. Needs rules before using sex, zip, payment type, class time, or other segmentation fields. Keep as a shell. Do not build until policy is decided. **Now rendered as a `parked` gate note in `GymPage.tsx` (this PR)** — still a shell, no internals.

### Churn by Belt · `Blocked`

Gate: **API access, not missing sample data.** Belt/rank data is 403-blocked at the current Wodify tier and likely needs higher-tier access or different auth, which support has already declined to help with. Do not build unless access changes. **Now rendered as a `blocked` gate note in `GymPage.tsx` (this PR)**, on the recessed surface — still a shell, no internals.

### Silent Churn Recovery · `Blocked`

Gate: dated check-in history. Needs `Client Sign-ins` (or equivalent dated attendance events). Do not infer recovery from `lastCheckIn` alone. Tracked in Notion (Silent Churn split, P3 / Later).

---

## Off Critical Path

### `Client Sign-ins` probe · `TODO`

Run separately — does not block Patterns work, but settle it early to de-risk Recovery planning.

Purpose: confirm whether dated check-in history exists.
- Dated check-in events exist → Silent Churn Recovery becomes buildable.
- Only latest check-in exists → Recovery stays parked.

---

## Page Complete Check

Retention is "done" only when all of these hold:

- [x] PR #410 (Attendance Health / shared classifier) merged.
- [x] Shared classifier locked (item 2) — #412 merged.
- [x] Churn Risk by Tenure built or intentionally parked.
- [x] Member Movement built or intentionally parked.
- [x] Every remaining shell is built, clearly labeled parked/blocked, or intentionally removed from page scope — no ambiguous shells. *(Age + Segment = `parked`, Belt = `blocked`; gate notes shipped this PR.)*
- [x] "Sample data" badges consistent across all fixture-backed cards. *(4 live cards badged; the 3 gated shells carry none — verified in-DOM.)*
- [x] No fake historical trends anywhere.
- [x] No real member PII added.
- [x] No unintended Wodify/API work added.
- [x] No financial `contract.ts` files touched.
- [x] Shared classifier reused by every relevant card (no forked risk logic).
- [x] `$ at risk` figures are active-only.

## Verification

```
npx tsc -b
```

Run deterministic tests for any Retention compute modules. Required:

- TypeScript passes.
- Tests pass.
- Shared risk totals do not drift across cards.
- Silent churn count consistent across all cards using the same threshold.

---

*The checklist is now fully satisfied (this PR). Per the rule above, the next
step is to move the durable rules into `AGENTS.md` / `UI_RULES.md` and then
delete this file — but that migration needs Wesley's sign-off (proposals in the
PR description; see the status banner at the top). Until then this file stays.*
