# Backlog

Local mirror of the Notion Backlog (Notion is the priority authority). Each item
uses the canonical three fields — **Result / Why / Premise** (AGENTS.md).

---

## Silent Churn hero — Gym › Retention

- **Status:** Now
- **Priority:** P2
- **Notion:** https://app.notion.com/p/374ad95793398198a58aed86dc2865af

**Result.** A "Retention" section in Settings exposes a "Silent Churn Threshold"
(default 21 days). The `gym-card--hero` Silent Churn card in `GymPage.tsx` reads
that threshold and renders a code-computed at-risk call-list (count, $/mo at risk,
member rows) from a sample member fixture, with a visible "Sample data" badge.
Changing the setting changes which members count. The other six shells are
untouched.

**Why.** Validate the Retention page as an owner dashboard before committing to
Wodify; the threshold is an owner-tunable operating judgment, not a magic number.

**Premise.** No member data exists (`contract.ts` is financial-only); Wodify is
parked. Fixtures only. Code computes truth; AI only rephrases.

### Implementation notes

- Member fixture lives in `src/lib/gym/memberFixture.ts` (`GymMember` type +
  `SAMPLE_GYM_MEMBERS`), deliberately separate from the locked `contract.ts`.
  Anchored to a fixed as-of date (`FIXTURE_TODAY`) so the demo is deterministic.
- The Silent Churn rule and threshold resolver are in `src/lib/gym/silentChurn.ts`
  (`computeSilentChurn`, `resolveSilentChurnThresholdDays`). Rule: `status ===
  'active'` AND `daysSinceLastCheckIn >= threshold`; resolver clamps to a positive
  integer 1–365, falling back to 21 on missing/invalid/≤0.
- The threshold persists in a local store (`RetentionSettingsContext`,
  localStorage `wx_retention_settings`) following the `SidebarContext` precedent —
  NOT in `WorkspaceSettings` / `sharedPersistence.ts` (locked), no Supabase column.
- The Retention Settings section sits inside the edit-lock fieldset with the
  other Settings panes, so it freezes with them when Settings is locked (unlock
  to edit). It's local/non-financial, but kept under the lock for consistency so
  a stray click can't move the Gym card's headline figure during a walkthrough.

---

## Attendance Health — Gym › Retention (2nd Watch card)

- **Status:** Done (PR pending review)
- **Priority:** P2

**Result.** The full-width `gym-card--full` Attendance Health card below the
Silent Churn hero buckets active members by recency at the live threshold T —
Healthy 0–7d · Watch 8…(T−1)d · Silent ≥T. The Watch count is the hero ("members
on watch"); a Healthy/Watch/Silent breakdown sits below (+ an Unknown tile only
when an active member has a bad/missing check-in date). The Silent count always
equals the Silent Churn card's at-risk count, and all buckets react when the
Settings threshold changes.

**Why.** Silent Churn shows who has already crossed the line; Attendance Health
shows who is *drifting toward* it — the early-warning cohort an owner can still
save. It reuses the threshold the owner already tuned, so the two cards tell one
coherent story instead of two disconnected ones.

**Premise.** Same as Silent Churn: no real member data (`contract.ts` is
financial-only, Wodify parked), sample fixture only. Code computes truth; copy
only rephrases. v1 is a recency snapshot — no trend and no per-member call-list
(lastCheckIn alone can't honestly show a trend; the call-list is Silent Churn's
job).

### Implementation notes

- Both cards read ONE `classifyMember(member, resolvedT, asOf)` in
  `src/lib/gym/silentChurn.ts` — the shared active-filter + bad-date skip + `>= T`
  predicate, so they can't disagree. `computeSilentChurn` was refactored onto it
  (proven byte-identical across a threshold sweep) and `computeAttendanceHealth`
  tallies the buckets. `unknown` (active + unparseable date) is never folded into
  Healthy; `healthy + watch + silent + unknown === activeTotal` holds by
  construction.
- `WATCH_FLOOR_DAYS = 8` is the named Watch floor. When the resolved threshold is
  ≤ 8 the Watch band is empty by construction and the helper copy is guarded so it
  never renders an inverted "8–7" range.
- Card content is in `AttendanceHealthCard` (`GymPage.tsx`); `.attendance-health-*`
  styling mirrors `.silent-churn-*` and keeps the locked white `.card` outer
  (UI_CARDS). Verified live at T=21 (9/5/6), T=14 (9/2/9), and T=8 (Watch=0 empty
  state); buckets react to the Settings threshold.
