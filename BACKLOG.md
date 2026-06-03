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
