# SESSION_CLOSE_WORKFLOW.md

Purpose: close sessions fast, restart cleanly, preserve important state, avoid hidden dirty work, and prevent closeout from becoming a second work session.

Designed for high-frequency Wx CFO Scorecard work: 3–5 coding sessions per day.

Shared project configuration lives in:

```text
PROJECT_CONFIG.md
```

Core rule:

> The default is no close. Run a close only when observable state says one is needed. Do only what was triggered.

The close is not the work. The close protects the work.

---

## 1. Operating Targets

A healthy workflow produces:

- Same-agent continuation closes under 2 minutes.
- End-of-day closes with shipped work under 10 minutes.
- Rare Full Close under 20 minutes.
- 95%+ of all closes under 10 minutes.
- Daily aggregate close time ideally under 15–20 minutes at 4–5 sessions.
- Zero hidden dirty state.
- Zero “review next session” branch limbo.
- Next-session restart under 2 minutes.

Healthy daily mix:

| Close Type | Expected Share |
|---|---:|
| No trigger fires (silent stand-down or Continuation breadcrumb) | 30–50% |
| Single trigger | 30–40% |
| Multi-trigger or dirty-state close | 10–20% |
| Arc shipped / narrative close | <10% |

Continuation closes count as "no trigger fires" — they emit a 3-line breadcrumb but do not fire A/B/C/D/E.

If arc/narrative closes happen daily, the arc threshold is too loose or routine work is being inflated.

---

## 2. What a Close Must Answer

Every close should answer only five questions:

1. What changed?
2. Is the workspace clean or clearly labeled?
3. Was anything important captured in the right source of truth?
4. What is the next entry point?
5. Is there any risk the next session could misunderstand?

If those are answered, stop.

Do not recreate the session.
Do not write a historical essay.
Do not document what Git, Notion, or project files already know.

---

## 3. Trigger Model

Run close logic only if a trigger fires.

| Trigger | Detection | Action |
|---|---|---|
| A — Code shipped to main | New commit on main since session start | Confirm clean tree, report push state, ask before pushing |
| B — Snapshot-refresh file committed | A file listed in `PROJECT_CONFIG.md` snapshot-refresh files was committed during this session (`git log --since=<session-start> --name-only` includes it) | Flag project-file re-upload |
| C — Worktree/branch changed | New worktree exists vs. session start, OR `git branch --merged main` shows a non-main branch | Classify and dispose/track |
| D — Arc shipped | Configured arc signal fired | Write short narrative entry, after C/E complete |
| E — Workspace not clean | Dirty/untracked files, failed/skipped checks, or background process remains | Classify, resolve, preserve, or note |

No trigger = no close.

---

## 4. Mandatory Detection Sequence

When the user says “close session,” “wrap,” “handoff,” or similar, run observable checks before declaring the close type.

If the AI cannot run commands directly, ask the user to paste:

```bash
git status --short
git log main --oneline -10
git log origin/main..main --oneline
git worktree list
```

Also account for:

- failed/skipped checks from this session
- background processes started this session
- spec/project files changed this session
- configured arc signals from `PROJECT_CONFIG.md`

Then report:

```text
Close type: none — OR — triggers [A, B, C, D, E]
Steps to run: [list in trigger order]
Estimated time: [0 / 2 / 5 / 10 min]
```

If no trigger fired:

```text
Close type: none — no triggers fired. Standing down.
```

End there. No summary, no handoff, no ceremony.

---

## 5. Trigger Ordering

When multiple triggers fire, run them in this order:

1. A — push state
2. C — worktree/branch disposition
3. B — project-file re-upload flagging
4. E — workspace cleanup/classification
5. D — narrative entry

D runs last because the narrative entry must describe verified post-session state, not predicted state.

---

## 6. Trigger A — Code Shipped to Main

Run when code landed on main during the session.

Steps:

1. Verify working tree state.
2. Check push state:

```bash
git log origin/main..main --oneline
```

3. If unpushed commits exist, report them and ask before pushing.
4. If a feature branch is fully merged into main, delete it on the spot.
5. If the branch has unique unmerged content, route to Trigger C.

Never silently push. Never delete a branch with unique unmerged content under Trigger A.

Output pattern:

```text
Done in close
- Working tree clean
- Main push state checked

User action items
- [If needed] Unpushed commits on main:
  [commit list]
  Push? Defaulting to no until confirmed.
```

---

## 7. Trigger B — Snapshot-Refresh File Committed

Run when any file listed in `PROJECT_CONFIG.md` **Snapshot-refresh files** was **committed** during this session — regardless of whether the file is classified as spec or narrative under the CLAUDE.md documentation commit workflow. Working-tree edits that are not yet committed do not fire B — they fire only after the commit lands. This avoids false positives from reverted edits and noise from multi-commit sessions.

Detection:

```bash
git log --since=<session-start> --name-only -- <snapshot-refresh-paths>
```

Steps:

1. List committed files (with their commit hashes).
2. Add re-upload action.

Output:

```text
User action items
- Re-upload [filename] to the project files via project settings.
  Dragging into the current chat is not enough.
```

Only include this when snapshot/project-read files actually changed.

---

## 8. Trigger C — Worktree / Branch Changed

Run when a worktree/branch was created, destroyed, or needs disposition.

Classify each in-scope item as one of three states (matches CLAUDE.md worktree hygiene):

1. **Merged + removable** — landed on main; remove worktree, delete branch.
2. **Abandoned + removable** — replaced or will not ship; back up worth-keeping work first, then remove worktree, delete branch.
3. **Paused with Notion tracking item** — intentionally on hold; the item must record worktree path, branch, intent, and review-by date. The worktree may stay only with this item in place.

A worktree whose own session is not closing this turn is out of scope for that close — do not classify it. Sibling worktrees are not "Active"; they are simply not yours to dispose of.

Invalid classifications:

```text
Active
Review next session
```

Both are decision-deferral patterns CLAUDE.md prohibits.

If classification takes more than 5 minutes, create a cleanup/audit item:

```text
- Branch/worktree:
- Why it exists:
- What must be checked:
- Keep/delete criteria:
```

Do not do archaeology during normal close.

### Occasional grooming

Do not run heavy worktree grooming every close.

Run occasionally or during end-of-day sweep:

```bash
git worktree list --porcelain
ls [worktree parent directory]
git branch
```

This catches registered worktrees, orphan directories, and orphan branches.

---

## 9. Trigger D — Arc Shipped

Run when a configured arc signal in `PROJECT_CONFIG.md` fired.

Concrete signals first. Judgment only as fallback.

If no configured signal fired but the session feels significant, ask once:

```text
Did this close out a phase, lock a constraint, or finish a multi-commit feature? yes/no
```

Fire D only on yes.

Narrative entry:

- Goes in `wx_cfo_scorecard_context_v2_6.md`
- Commits on main after merge/disposition
- Runs after Trigger C and Trigger E
- Default length: 30 lines or less

Use five short sections:

```markdown
### [Date] — [Short title]

**What changed**
- [commit hash] [subject]

**Why it matters**
- [operating consequence]

**Current state**
- [verified post-session state]

**Next step**
- [one or two lines]

**Lessons**
- [only unusual lessons not reachable elsewhere]
```

The narrative entry points at commits, Notion items, and code. It does not restate them.

---

## 10. Trigger E — Workspace Not Clean

Run when workspace state is dirty, ambiguous, or unresolved.

Classify each unresolved item:

1. **Session trash**
   - temp files
   - screenshots
   - scratch logs
   - generated artifacts from this session  
   Action: delete if clearly disposable.

2. **Session work-in-progress**
   - uncommitted changes belonging to this session  
   Action: commit or stash with a label, if authorized.

3. **Unrelated to this session**
   - pre-existing dirty files
   - prior work
   - files touched by other tools
   - sibling worktree changes  
   Action: preserve. Do not delete. Do not revert. Note it.

4. **Failed/skipped checks**
   - record what failed/skipped
   - record likely related/unrelated/unclear  
   Action: do not chase unrelated failures during close.

Multi-worktree rule:

If a dirty file belongs to a sibling worktree’s scope, preserve it. That is another session’s WIP.

---

## 11. Cleanup Boundaries

Allowed during close:

- Delete obvious session-local temp files.
- Delete generated logs/screenshots/scratch files from this session.
- Stop dev server started only for verification.
- Remove gitignored/generated artifacts clearly disposable.
- Commit or stash session WIP only when authorized.

Not allowed without explicit approval:

- Delete unrelated untracked files.
- Revert dirty files.
- Delete branches or worktrees outside Trigger C scope (and Trigger C still requires the four-state classification — there is no path to silent deletion).
- Rewrite, amend, or squash commits.
- Clean shared caches.
- Fix unrelated failures.
- Start refactors.
- Perform speculative cleanup.
- Push commits.

When unsure, preserve and report.

---

## 12. Notion / Backlog Rule

Notion is live, not batched.

Backlog state moves when the decision happens during the session, not at close.

Close-time backlog work is verification only:

```text
Does Notion Now reflect reality?
```

If you are writing multiple backlog updates at close, mid-session discipline failed. Fix the upstream habit; do not add ceremony to the close.

---

## 13. Continuation Close

Use this when there is no durable state change, but a same-agent/same-day breadcrumb is useful.

Conditions:

- same project
- same agent/tool
- same day
- next session expected soon
- no docs/backlog update needed
- no worktree/branch decision
- no arc shipped
- no dirty-state issue
- next step is obvious

Output:

```text
Continuation close
- HEAD: [sha] — [subject]
- Working tree: clean / dirty
- Resuming: [one line]
```

No formal handoff.
No receiving-chat instructions.
No role blocks.
No narrative docs.

If the next session may be on a different platform/tool, run the cross-agent stub instead — Continuation does not transfer cross-platform.

---

## 14. Closing Message Structure

Only when at least one trigger fired.

Use these lanes. Omit empty lanes.

```text
Done in close
- [what was executed]

User action items
- [only user-owned actions]

Queued for next session
- [only work that genuinely cannot finish now]
```

Do not write “None.”

---

## 15. Close-Everything Test

Before listing anything under Queued for next session, ask:

- Can the user do this in 1–2 minutes during close?
- Is it a status check the chat or user can run now?
- Does it need a coding-agent prompt that can be drafted now?
- Is it actually cleanup/audit work rather than next-session feature work?

Only queue work that genuinely cannot finish now.

Exception:

Do not apply this rule to unrelated dirty work. Preserve and label unrelated work.

---

## 16. Cross-Agent Stub

Use only when the next session is on a different platform/tool or a fresh context without project files.

```text
# NEW SESSION — Wx CFO Scorecard

Before responding:

1. Read these project files:
   - PROJECT_CONFIG.md
   - CLAUDE.md
   - wx_cfo_scorecard_context_v2_6.md
   - UI_RULES.md / UI_CARDS.md if UI/card work
2. Read current Notion backlog:
   https://www.notion.so/084420fff00444de9413a542db3dddf0
3. If live repo/Notion conflicts with this handoff, live repo/Notion wins.
4. If this handoff conflicts with older uploaded snapshots, this handoff wins.
5. If any source cannot be accessed, say so and stop.
6. Acknowledge briefly and wait for direction. Do not start work.

## State
- main HEAD: [sha] — [subject]
- Working tree: clean / dirty
- Branches/worktrees: [list or "main only"]
- Snapshot freshness: [current / files needing re-upload]

## Next entry point
- [one line]

## Open question
- [omit if none]
```

That is the full cross-agent handoff. Do not add role-aware blocks unless the user explicitly asks.

---

## 17. Resumability Self-Check

Skipped when close type is none or Continuation. The Continuation breadcrumb is the check.

Before declaring close complete, ask:

```text
Could a fresh chat — with no transcript and no memory — resume this work in under five minutes using only project files, latest commits, Notion, and the close output?
```

Check:

- Project files reflect durable decisions.
- Commit messages are clear enough.
- Notion Now points to the correct next step.
- Close output is grounded in observable state.

If not, fix the source of truth or strengthen the close output.

This is a short mental gate, not a ceremony.

---

## 18. Time Budget

| Close Type | Target | Hard Cap |
|---|---:|---:|
| No trigger | 0 min | 1 min |
| Continuation | 30–90 sec | 2 min |
| Single trigger | ~2 min | 5 min |
| Multi-trigger / Trigger E | ~5 min | 10 min |
| Trigger D + others | ~10 min | 15 min |
| Full/irreversible review report | 10–20 min | 30 min |

If close exceeds the hard cap:

1. Stop adding work.
2. Name what remains.
3. Convert remaining work into cleanup/audit or next-session item.

Do not keep closing indefinitely.

---

## 19. What Does Not Trigger a Close

- Read-only diagnosis
- Prompt drafting
- Conversation about backlog without a decision
- Speculative exploration
- Mid-session “what’s accumulated?” check
- One-line doc edit with no spec implications

For these, answer briefly and stop.

---

## 20. End-of-Day Sweep

Do not run this every close.

Run once at end of day when appropriate, or at next start if owed:

```bash
git status --short
git log -1 --oneline
git worktree list
```

Check:

- active branches/worktrees
- obvious orphan/untracked state
- docs/Notion freshness
- project-file re-upload needs
- unresolved dirty state

This replaces five heavy closes with one targeted sweep.

---

## 21. Irreversible Actions

For high-stakes actions, stop before execution and require explicit approval and independent review.

Examples:

- merge to main
- deploy
- schema migration
- destructive cleanup
- force-push
- data deletion
- large branch/worktree deletion

Close may prepare the report. It does not execute the irreversible action.

---

## 22. Examples

### No close

```text
Close type: none — no triggers fired. Standing down.
```

### Continuation

```text
Continuation close
- HEAD: a1b2c3d — fix forecast card spacing
- Working tree: clean
- Resuming: continue mobile review on Settings.
```

### Trigger B

```text
Close type: trigger B — UI_RULES.md changed.
Steps to run: flag project-file re-upload.
Estimated time: 1 min.

User action items
- Re-upload UI_RULES.md through project settings. Dragging into this chat is not enough.
```

### Trigger E

```text
Close type: trigger E — workspace not clean.
Steps to run: classify unresolved items.
Estimated time: 5 min.

Done in close
- Deleted session trash: debug.log
- Stopped dev server on :5173

User action items
- Preserved unrelated dirty file: README.md. Decide later whether to commit, stash, or discard.

Queued for next session
- Skipped e2e check appears unrelated. Investigate separately.
```

### Trigger D

```text
Close type: triggers A + B + C + D.
Steps to run: A push state → C dispose worktree → B flag re-upload → D narrative entry.
Estimated time: 10 min.
```

---

## 23. Final Principle

Close fast when the state is simple.

Slow down only when the state is dangerous.

Stop when the next session can restart without guessing.
