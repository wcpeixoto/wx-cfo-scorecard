# PROJECT_CONFIG.md

Project configuration for **Wx CFO Scorecard**.

This file is the shared source of truth for task prompts and session-close workflows. Do not duplicate this configuration in other workflow files. Reference this file instead.

---

## Project

```text
Project name:
  Wx CFO Scorecard
```

---

## Required Reads Before Code

Read in this order before implementation work:

1. `CLAUDE.md`
2. `wx_cfo_scorecard_context_v2_6.md`
3. Task-specific file as needed:
   - `UI_RULES.md` for UI work
   - `UI_CARDS.md` for dashboard cards
   - `UI_Verification_Rules.md` for browser/UI verification

---

## Source of Truth

```text
Context doc:
  wx_cfo_scorecard_context_v2_6.md

Backlog:
  Notion — "Wx CFO Scorecard — Backlog"
  https://www.notion.so/084420fff00444de9413a542db3dddf0

Data source ID:
  bc0648c6-c8df-4496-84ba-4c1b860ae51d
```

Backlog anti-pattern:

```text
There is no BACKLOG.md in this project.
Any prior handoff, memory, or doc that references BACKLOG.md is stale.
Flag it before acting.
```

---

## Snapshot-refresh files

Changes to these files trigger project-file re-upload to the
Codex/Claude project after commit. This list is independent of
the spec-vs-narrative commit cadence in CLAUDE.md — files of
either kind appear here because both kinds inform receiving
chats.

- `CLAUDE.md`
- `UI_RULES.md`
- `UI_CARDS.md`
- `UI_Verification_Rules.md`
- `wx_cfo_scorecard_context_v2_6.md`
- `SESSION_CLOSE_WORKFLOW.md`
- `TASK_PROMPT_TEMPLATE.md`
- `PROJECT_CONFIG.md`
- `README_SESSION_WORKFLOWS.md`

---

## Locked Files

Do not modify without explicit instruction:

- `src/lib/kpis/compute.ts`
- `src/lib/cashFlow.ts`
- `src/lib/data/contract.ts`
- `src/lib/data/sharedPersistence.ts`
- `src/components/LoadingScreen.tsx`
- `src/components/OperatingReserveCard.tsx`
- `src/components/OwnerDistributionsChart.tsx`
- `src/lib/priorities/coreConstraints.ts`
- `.github/workflows/`

---

## Allowed-by-Default File Scope

- `src/...`
- `supabase/...` when Edge Function or migration work is explicitly in scope

---

## Commands

```bash
npm run dev
npm run build
npm run preview
```

Verification floor:

```text
npm run build
```

There is no project-level lint/test runner unless one is added later.

---

## Commit Rules

- Single-purpose commits.
- Conventional commit message style.
- Explicit file staging only.
- Never use `git add .`.
- Suggest commit messages only unless explicitly told to commit.
- Spec docs commit alongside code on the feature branch.
- Narrative docs commit on main after merge.

---

## Arc Signals

Trigger D in `SESSION_CLOSE_WORKFLOW.md` fires when one of these occurs:

- Phase number bumped in `wx_cfo_scorecard_context_v2_6.md`
- Constraint added to locked files or locked decisions in `CLAUDE.md`
- Feature branch with 3+ commits merged to main
- New project rule landed in any rule-defining doc
- Multi-session feature reached a stopping point named in Notion backlog

---

## Two-AI Review Required For

- Merge to main
- Deploy
- Schema migration
- Destructive cleanup
- Force-push
- Data deletion
- Large branch/worktree cleanup

For these actions, the builder reports findings and stops. The user routes the report to an independent reviewer before execution.

---

## Context-Delta Limit

```text
8 pending doc/context deltas → full close required.
```

---

## Source-of-Truth Ownership

| Domain | Owner |
|---|---|
| File changes | Git |
| Task status | Notion |
| Durable decisions / project rules | Spec docs + context doc |
| Restart state when needed | Latest close output or narrative entry |
| Cross-platform restart state | Cross-agent stub from `SESSION_CLOSE_WORKFLOW.md` |

If a fact appears in two places, one will eventually become stale. Handoffs point to source-of-truth records; they do not replace them.

<!-- sync-test-marker 2026-05-09: pineapple-velocity-7421 -->
