# TASK_PROMPT_TEMPLATE.md

Use this file when drafting scoped implementation prompts for Codex, Claude Code, or another coding agent.

Shared project configuration lives in:

```text
PROJECT_CONFIG.md
```

Do not duplicate project config here. Reference it.

---

## 1. Drafter Rule

Before drafting a task prompt, the drafter must read the same required-read files the executor will be asked to read.

Do not draft from memory or from a session summary alone.

Skip only when the prompt depends on no project doctrine at all.

---

## 2. Prompt Delivery Discipline

When handing off a task prompt, the prompt is the deliverable.

Allowed before the prompt:

- One line naming what the prompt does
- STOP-level flags the user must see first:
  - snapshot drift
  - locked-file proximity
  - irreversible action

Not allowed before the prompt:

- Re-explaining what the prompt already explains
- Walking through patch contents
- Narrating the drafting process

Allowed after the prompt:

- One line on what happens next
- Follow-up steps not already in the prompt

If the information is in the prompt, do not say it again outside the prompt.

---

## 3. Universal Task Prompt

Copy everything below the start marker.

### --- TASK PROMPT START ---

# Codex Task — [MODEL] — [TASK TITLE]

Target AI: [Claude Chat / ChatGPT / Claude Code / ChatGPT Codex]

See `PROJECT_CONFIG.md` → **AI Roles and Prompt Routing** for role
definitions. Prompts without a `Target AI:` header are treated as
drafts; the receiving role must stop and ask before acting.

## Project context

Read and follow:

```text
PROJECT_CONFIG.md
```

## Required reads before code

Read in the order specified by the **Required Reads Before Code** section of `PROJECT_CONFIG.md`, plus any task-specific reads listed below.

Task-specific reads:

- [task-specific file, if any — e.g. `UI_RULES.md` for UI work]

If this prompt conflicts with any required read, stop and report. Do not guess.

## Pre-flight

Run and report output before edits:

```bash
git branch --show-current
git status --short
```

If the working tree is not clean, stop and report.

Do not overwrite or clean unrelated work.

## Task

[One-sentence task description — what the change does, not how.]

[2–5 sentences of context: why this is needed, what success looks like.]

## Diagnosis first

Do not write code in the first pass.

First:

1. Read the required files.
2. Locate the relevant implementation files.
3. Identify existing patterns.
4. Identify risks:
   - locked files
   - hidden coupling
   - data-shape assumptions
   - regressions in adjacent surfaces
5. Report findings and propose a plan.

Only after the plan is acknowledged, proceed to implementation.

## STOP-and-report rule

If pre-flight or diagnosis finds something unexpected, stop and report.

Examples:

- dirty working tree
- file in unexpected path
- missing expected commit
- test/build already failing
- stale docs
- missing file
- unclear scope
- locked file needed unexpectedly

Do not route around the finding.
Do not rewrite the plan to fit the finding.
Do not improvise.

## Target files

Allowed to modify:

- [path/to/file]
- [path/to/file]

If another file must change, stop and ask.

## Locked files

Do not touch locked files listed in `PROJECT_CONFIG.md` unless explicitly authorized.

Task-specific locked files:

- [path/to/file, if any]

No new dependencies.
No new top-level files unless explicitly listed.
No `git add .`.

## Specification

[Exact task content.]

Use exact values. Avoid “roughly,” “around,” or “clean up as needed.”

For logic changes, specify:

- inputs
- outputs
- edge cases
- failure behavior
- acceptance criteria

## Optional UI module

[Insert the UI Task Module here only when the task changes visual surfaces.]

## Verification

Run the smallest meaningful verification for the task.

Minimum project verification:

```bash
npm run build
```

Then confirm:

- Build succeeds with no new warnings.
- Only files in Target files changed.
- Functional checks pass:
  - [task-specific check]
  - [task-specific check]

If any check fails, stop and report.

Do not commit.

## Pre-merge spec check

For created or substantially rewritten files, read the committed file and confirm against the prompt:

- required exports are present
- required keys/sections are present
- no extras
- no omissions
- type signatures match
- behavior matches the specification

Build passing is necessary but not sufficient.

Skip this check for small edits where `git diff` shows the full change.

## Post-task

Run:

```bash
git diff --stat
git status --short
```

Confirm only Target files changed.

Suggest one single-purpose commit message.

Do not stage.
Do not commit.
Do not push.

## Two-AI review for irreversible actions

For irreversible or high-stakes actions, report findings and stop.

Examples:

- merge to main
- deploy
- schema migration
- destructive cleanup
- force-push
- data deletion
- large branch/worktree cleanup

The user will route the report to an independent reviewer.

For reversible actions, single-agent review is fine.

## Mindset closer

Owner-operator clarity. Calm, confident, simple on top. Correctness of financial data and forecast stability come before everything else.

If something is ambiguous, stop and ask. Never guess.

### --- TASK PROMPT END ---

---

## 4. UI Task Module

Use only when the task changes visual surfaces.

Insert this module before Verification in the Universal Task Prompt.

### --- UI MODULE START ---

## Source of truth — visual

Design source URL or file path:

```text
[PASTE EXACT URL OR FILE PATH]
```

The computed specs in this prompt are the source of truth. If rendered output does not match, the implementation is wrong. Do not adjust the spec to match the implementation.

## Computed specs

Paste only the specs needed for this task.

Include exact values for:

- outer shell
- layout
- typography
- colors/tokens
- spacing
- borders/radii
- interactive states
- responsive behavior
- chart anatomy, if relevant

Do not summarize when pixel-level parity matters.

## JSX / markup structure

Paste exact markup skeleton when structure matters:

```tsx
[Element nesting, class names, aria attributes, data attributes]
```

Use `{prop.x}` placeholders for content.

## Visual verification

Verify rendered output, not source assumptions.

Check:

- relevant viewport(s)
- target surface renders
- text fits
- interactive states work if changed
- theme variants if touched
- computed styles if pixel parity matters

If freshness cannot be confirmed, report:

```text
Verification provisional — runtime freshness unconfirmed.
```

## Design-token checks

- [ ] Colors come from project token list.
- [ ] Radii come from project radius scale.
- [ ] Font sizes map to named type roles.
- [ ] Spacing values come from project spacing scale.
- [ ] No inline styles unless explicitly allowed.
- [ ] Theme/dark variants present on new elements.

### --- UI MODULE END ---
