# SESSION_HANDOFF_TEMPLATE.md

Canonical structure for handing a Wx CFO Scorecard session off to a
new chat — same platform or cross-platform.

Use this template when:

- closing under Trigger D (arc shipped) and the next session is a
  fresh chat rather than a continuation,
- handing off across platforms (Claude Chat → ChatGPT, Claude Code →
  Codex, etc.), or
- any time the receiving session is a fresh context with no
  transcript.

For lightweight same-agent/same-day continuations, use the
Continuation breadcrumb in `SESSION_CLOSE_WORKFLOW.md` §13 instead.
This template is heavier on purpose.

The cross-agent stub in `SESSION_CLOSE_WORKFLOW.md` §16 is a minimal
fallback. This file is the load-bearing surface — whenever a real
handoff is being written, fill in this template, not the stub.

---

## Receiving chat instructions

Paste this block at the top of the handoff verbatim. The receiving
chat reads it before anything else.

```markdown
### Receiving chat instructions

Before responding to anything below:

1. Run git pre-flight from the primary clone:
   - `git worktree list --porcelain`
   - `git branch -a`
   - `git log origin/main..main --oneline`
   Confirm topology matches what this handoff describes. Path naming
   and narrative attribution are not sources of truth for worktree
   topology — live git state is. Flag any drift before proceeding.
2. Read these project files in order:
   - `CLAUDE.md`
   - `PROJECT_CONFIG.md`
   - `UI_RULES.md` (if UI work)
   - `UI_CARDS.md` (if card work)
   - `wx_cfo_scorecard_context_v2_6.md`
   - `SESSION_HANDOFF_TEMPLATE.md` (this file, for the
     receiving-block contract)
   - Any task-specific docs named below
3. Read current Notion backlog:
   https://www.notion.so/084420fff00444de9413a542db3dddf0
4. Flag any drift between project docs and Notion before proceeding.
5. If any of the above cannot be accessed, say so and stop.
6. Once read, acknowledge briefly and wait for direction — do not
   start work.
```

Step 1 (worktree pre-flight) MUST come before step 2 (file reads).
Handoff state inherited from a prior session that drifted on
worktree topology must be caught before drafting new prompts
against it.

---

## Handoff body sections

Fill in the sections below in order. Omit a section only when it is
genuinely empty — do not write "None."

```markdown
## Repo state

- main HEAD: [sha] — [subject]
- Working tree: clean / dirty
- Branches/worktrees: [list — include any self-hosting harness with
  path, branch, and "dispose at next session pre-flight" note]
- Snapshot freshness: [current / files needing Sync now]

## Shipped this session

- [PR # or commit sha] — [one-line description]

## Files changed (committed and pushed)

- [path] — [what changed in one line]

## Key decisions

- [decision] — [one-line why]

## Known issues

- [issue] — [one-line current state]

## Notion items filed this session

- [item id short] ([priority], [status]) — [title]

## Notion items closed this session

- [item id short] — [title] → Done

## Open items

- [anything pending user action: pushes not yet performed, Sync now
  not yet clicked, reviews awaited]

## Exact next step for new chat

- [one or two sentences naming the immediate next action and which
  Notion item or doc holds the spec]

## Suggested name for new chat

`wxcfo / YYMMDD HHMM / [workstream] — [topic]`
```

---

## Why this template exists

Without an explicit pre-flight step, fresh chats inherit worktree
topology from narrative description. Path naming and prior-chat
attribution have repeatedly drifted from live git state, producing
prompts written against state that no longer exists. The Step 1
pre-flight catches that drift before the receiving chat acts on it.

The body sections exist to make the handoff resumable in under five
minutes (per `SESSION_CLOSE_WORKFLOW.md` §17). If a section feels
ceremonial, the underlying state is probably already in git, Notion,
or the context doc — point to the source of truth, do not restate it.
