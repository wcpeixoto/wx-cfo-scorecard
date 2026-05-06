# Simple Session Close Workflow — Wx CFO Scorecard

## Goal

End every coding session with:
- clean repo state
- updated context doc
- updated Notion backlog, when needed
- clear post-merge/live-verification checklist
- paste-ready handoff for the next chat

---

## Agent roles

**Chat writes the implementation prompt. Codex executes it.**

If using Claude Code / Codex:
- Handle repo reads
- Verify Notion status if needed
- Run tests/build
- Implement code from a chat-provided prompt
- Commit/PR
- Run live verification
- Execute approved Notion writes only from an exact approved payload
- Do not draft your own implementation prompts — wait for chat to provide one

If using ChatGPT / Claude Chat:
- Do not start by verifying Notion
- Use root docs first
- Help with planning, product decisions, prompt writing, and review
- Draft Notion write plans when needed
- Touch Notion only if explicitly asked


---

## Top of queue — single source of truth

The context doc `wx_cfo_scorecard_context_v2_6.md` must contain a section
titled **"Top of queue (as of [date])"** near the top of the file.

This section lists the next 3–5 items, in order, with one line each
explaining why each item is next. It is the **single source of truth** for
"what comes next" — agents must not infer the next move from older roadmap
sections, planning notes, or implementation drafts elsewhere in the doc.

When the queue changes, update this section. When session close happens,
update this section as part of the context-doc update block (Step 1.5
below).

Format:

```md
## Top of queue (as of [YYYY-MM-DD])

1. [Item] — [why it's next]
2. [Item] — [why it's next]
3. [Item] — [why it's next]
```

Older roadmap sections, planning notes, and superseded priorities should
either be deleted or clearly marked as historical when they no longer
reflect current priorities.

---

## Session start checklist

When the user says **"start session"**, **"start a session"**, or equivalent, the active agent runs this checklist.

Behavior splits by agent type per the **Agent roles** section above.

### All agents

1. Read the required files in order:
   - `wx_cfo_scorecard_context_v2_6.md`
   - `CLAUDE.md`
   - as-needed docs based on the task:
     - `SESSION_CLOSE_WORKFLOW.md` — when opening/closing a coding session
     - `UI_RULES.md` — when touching UI
     - `UI_CARDS.md` — when touching cards
     - `UI_Verification_Rules.md` — when doing browser/UI verification

2. Confirm current state:
   - main HEAD commit and message
   - working tree status: clean / dirty
   - current branch
   - last shipped phase or branch

3. Surface the **Top of queue** section from the context doc verbatim.
   Do not infer the next move from other parts of the doc. If the section
   is missing or stale, flag it and stop — ask the user to refresh it
   before proceeding.

4. If a handoff was provided:
   - confirm the recommended next move matches Top of queue item #1
   - surface any mismatch between the handoff, Top of queue, and current repo/docs state

5. If no handoff was provided:
   - propose Top of queue item #1 as the default task
   - ask: **"What's the task?"**

### If using Claude Code / Codex

6. Run pre-flight:

```bash
   git branch --show-current
   git status --short
   git log --oneline -5
```

7. Verify Notion only if:
   - more than 24 hours have passed since the last documented Notion sync, or
   - the user explicitly asks for Notion verification.

8. Do not draft an implementation prompt.

9. Say: **"Ready for kickoff prompt"** and wait for chat to provide the prompt.

10. Do not start coding until a chat-provided kickoff prompt is received.

### If using ChatGPT / Claude Chat

6. Do not start by verifying Notion unless explicitly asked.

7. Lead with planning:
   - confirm scope
   - surface open product questions
   - surface open technical questions
   - align on approach before writing any prompt or code

8. When the task is clear and ready for execution, write the kickoff prompt for Codex.

### All agents

Do not code until the task, scope, and approach are clear.


---

## Step 1 — Chat creates the session-close bundle

Chat writes one closeout bundle with:

### 1. What shipped
- Branch name
- PR URL, if opened
- Merge commit, if merged
- Commit SHAs
- Files changed
- Build/test status
- Live verification status, if completed

### 2. Decisions locked
- Product rules
- UX decisions
- Technical decisions

### 3. Deferred items
- What was intentionally not done
- Why it was deferred
- Suggested priority

### 4. Post-merge / live-verification checklist
Exact checks still needed, written as a checklist.

### 5. Context-doc update block

Paste-ready markdown to append to or replace in:
`wx_cfo_scorecard_context_v2_6.md`

This update **must include**:
- The new phase/branch summary block (what shipped, decisions locked, lessons)
- A refreshed **Top of queue (as of [date])** section reflecting the
  current next 3–5 items in order. If items shipped this session, remove
  them from the queue. If new priorities emerged, add them. The Top of
  queue section is the single source of truth — every session close must
  refresh it.

### 6. Exact Notion write plan
For each Notion change:
- Item title
- Item ID, if updating
- Update or create
- Status
- Priority
- Exact Why text

No vague Notion instructions.

### 7. Next-chat handoff

Filled-in version of the **Handoff template** below.
Target length: 200–400 words.

---

## Step 2 — You approve the bundle

Approval means:
- context-doc update is approved (including the refreshed Top of queue)
- Notion writes are approved
- Codex can execute everything: repo mechanics + Notion writes

No approval = no shared-state writes.

---

## Step 3 — Codex executes the closeout

Codex does:

### Repo mechanics

1. Append or replace the approved context-doc block in:
   `wx_cfo_scorecard_context_v2_6.md`
   (including the refreshed Top of queue section)

2. Run:
```bash
   npm run build
   npm run test
   git status --short
```

3. Show the doc diff.

4. Compare the diff against the approved bundle:
   - If the diff matches exactly, proceed without re-approval.
   - If the diff does not match, stop and wait for approval before committing.

5. Commit only the context-doc update.
   Suggested commit format:
   `docs: update [phase/branch] context`

6. Push the docs commit.

### Notion writes

7. For each item in the approved Notion write plan:
   - For updates: call `notion-fetch` by ID to confirm the item, then `notion-update-page` with the approved Status / Priority / Why.
   - For creates: call `notion-create-pages` against the Wx CFO Scorecard — Backlog data source (`collection://bc0648c6-c8df-4496-84ba-4c1b860ae51d`) with the approved Name / Status / Priority / Why.

8. If a write fails, stop, report the error, and do not retry without approval.

### Final report

9. Report:
   - docs commit SHA
   - branch
   - build/test result
   - working tree status
   - whether main is up to date
   - whether any deploy is pending or complete
   - Notion: updated item IDs, created item IDs, skipped/no-change items

Codex does not merge PRs or touch unrelated files unless explicitly approved.

---

## Step 4 — Human re-uploads the context doc

After the context-doc commit lands on main, manually re-upload:
`wx_cfo_scorecard_context_v2_6.md`
to the project knowledge snapshot.

This is required so the next chat starts with the latest project context
and the refreshed Top of queue.

---

## Step 5 — Start the next chat

Copy the filled-in handoff from the session-close bundle into a new chat.
The handoff should be the first message.

---

## Handoff template

Use this at the end of every session-close bundle.

Target length: 200–400 words.

```md
# NEW SESSION — Wx CFO Scorecard

## Current state

- main HEAD:
- Working tree:
- Current branch / PR:
- Deploy/live status:
- Last completed phase/branch:

## What shipped last session

- [commit SHA] — [summary]
- [commit SHA] — [summary]
- [commit SHA] — [summary]

## Verification status

- Build:
- Tests:
- Browser smoke:
- Live Supabase / production verification:
- Test data cleanup:

## Top of queue (as of [YYYY-MM-DD])

1. [Item] — [why it's next]
2. [Item] — [why it's next]
3. [Item] — [why it's next]

This is the authoritative next-move list. The full ordered queue
lives in `wx_cfo_scorecard_context_v2_6.md` under the same heading.
Do not infer the next move from older roadmap sections.

## Required reads before any work

Required:
- `wx_cfo_scorecard_context_v2_6.md`
- `CLAUDE.md`

As needed:
- `SESSION_CLOSE_WORKFLOW.md` — when opening/closing a coding session
- `UI_RULES.md` — when touching UI
- `UI_CARDS.md` — when touching cards
- `UI_Verification_Rules.md` — when doing browser/UI verification

## Agent roles

If using Claude Code / Codex:
- Handle repo reads
- Verify Notion status if needed
- Run tests/build
- Implement code from a chat-provided prompt
- Commit/PR
- Run live verification
- Execute approved Notion writes only from an exact approved payload
- Do not draft your own implementation prompts — wait for chat to provide one

If using ChatGPT / Claude Chat:
- Do not start by verifying Notion
- Use root docs first
- Help with planning, product decisions, prompt writing, and review
- Draft Notion write plans when needed
- Touch Notion only if explicitly asked

## Notion status

Last Notion sync:
- [date/time or session note]

Freshness rule:
- If more than 24 hours have passed, Claude Code / Codex should re-verify Notion before pulling the next task.
- ChatGPT / Claude Chat should skip Notion unless explicitly asked.

Known possible housekeeping:
- [item, if any]

## Deferred items

- [Item] — [why deferred] — [priority]
- [Item] — [why deferred] — [priority]

## Do not touch

- [locked file/path]
- [locked feature/system]
- [known sensitive area]

## Recommended next move

Default to Top of queue item #1 unless the user redirects.
```

---

## Rule

Chat decides and drafts.
You approve.
Codex executes everything: repo mechanics and Notion writes.
You re-upload the context doc.
Next chat starts from the handoff.

**Chat writes the implementation prompt. Codex executes it.**

**Top of queue in the context doc is the single source of truth for what comes next.** Refresh it every session close.

No silent merges.
No silent Notion writes.
No silent docs commits.
No silent context changes.
