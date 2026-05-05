# Simple Session Close Workflow — Wx CFO Scorecard

## Goal

End every coding session with:
- clean repo state
- updated context doc
- updated Notion backlog, when needed
- clear post-merge/live-verification checklist
- paste-ready handoff for the next chat

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
Paste-ready markdown to append to:
`wx_cfo_scorecard_context_v2_6.md`

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

Paste-ready handoff for a new chat.
Keep it under 200 words and use this format:

```md
# NEW SESSION — Wx CFO Scorecard

## Current state
[Where the repo/project stands now.]

## What shipped
[Main branch/PR/commits/features shipped.]

## What remains
[Verification, docs, deploy, deferred items.]

## Next recommended move
[One clear next action.]
```

---

## Step 2 — You approve the bundle

Approval means:
- context-doc update is approved
- Notion writes are approved
- Codex can execute everything: repo mechanics + Notion writes

No approval = no shared-state writes.

---

## Step 3 — Codex executes the closeout

Codex does:

### Repo mechanics

1. Append the approved context-doc block to:
   `wx_cfo_scorecard_context_v2_6.md`

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

This is required so the next chat starts with the latest project context.

---

## Step 5 — Start the next chat

Copy the Next-chat handoff from the session-close bundle into a new chat.
The handoff should be the first message.

---

## Rule

Chat decides and drafts.
You approve.
Codex executes everything: repo mechanics and Notion writes.
You re-upload the context doc.
Next chat starts from the handoff.

No silent merges.
No silent Notion writes.
No silent docs commits.
No silent context changes.