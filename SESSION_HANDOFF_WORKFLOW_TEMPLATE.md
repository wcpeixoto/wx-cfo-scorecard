# SESSION HANDOFF WORKFLOW TEMPLATE

A reusable scaffold for sending high-quality tasks to a coding agent
(Codex, Claude Code, or equivalent) and closing sessions cleanly.
Works for any project. UI and session-close sections are optional
modules — drop them in only when they apply.

---

## How to use

1. Fill the **Project Configuration** block once per project. Save it
   somewhere the project can reuse (e.g. `CODEX_PROJECT_CONFIG.md`).
2. Before drafting any task prompt, read the project's required-reads
   list yourself — see **Drafter's required reads** below.
3. For each new task, copy the **Universal Task Prompt** below the
   start marker, paste your project config into the bracketed slots
   at the top, then fill the task-specific slots.
4. Add the **UI Task Module** only when the task touches visual
   surfaces.
5. Add the **Session Close Module** when planning or executing a
   close, or when context deltas are accumulating.

---

## 1. Project Configuration block

Fill this once per project. Reuse across all task prompts.

```
PROJECT CONFIGURATION

Project name:
  [e.g. Wx CFO Scorecard]

Required reads (before any code):
  [List the files Codex must read first. Order matters.]
  - [PROJECT_RULES.md or equivalent]
  - [DESIGN_RULES.md if UI work]
  - [Any other project doctrine]

Source-of-truth docs:
  [Docs that define current state. Codex must check these
  before assuming anything.]
  - [CONTEXT_DOC.md]
  - [BACKLOG location, e.g. Notion DB URL]

Locked files (never modify without explicit instruction):
  - [path/to/file]
  - [path/to/file]

Allowed-by-default file scope:
  [Where Codex may freely make changes when within stated task scope.]
  - [src/...]
  - [tests/...]

Test / build commands:
  - lint:    [e.g. npm run lint]
  - test:    [e.g. npm test]
  - build:   [e.g. npm run build]
  - dev:     [e.g. npm run dev]

Commit rules:
  - [e.g. single-purpose commits, no `git add .`]
  - [e.g. suggest message only — never auto-commit]
  - [e.g. explicit file staging]

Handoff rules:
  - [e.g. update CONTEXT_DOC at session close, not mid-session]
  - [e.g. backlog source of truth is Notion — flag stale doc references]
  - [e.g. context-delta limit before forced session close: 8]
```

### Recommended pattern — spec docs vs narrative docs

Not a universal rule, but a project policy worth considering when
filling in **Commit rules** above:

- **Spec docs** (rules, design tokens, schemas, anything code depends
  on for correctness): commit alongside the code that depends on
  them, on the feature branch. Keeps spec and code in lockstep.
  Examples: design-system rules, token files, type definitions,
  config schemas.

- **Narrative docs** (session logs, context journals, decision
  records): commit only on main, after the feature branch merges.
  Keeps one visible source of truth and avoids two-version confusion
  across worktrees.

If your project has both kinds of docs, write the split into the
project's Commit rules. If it doesn't, ignore this section.

---

## 2. Drafter's required reads — applies to whoever writes the prompt

Before drafting any task prompt, the drafter (you, me, or any agent
writing the prompt) reads the same required-reads list the prompt
will ask the executor to read. Do not draft from memory, from a
handoff block, or from a session summary alone.

Why: the prompt's value depends on project doctrine that lives in
those files (token names, locked decisions, deliberate exceptions,
prompt discipline). Drafting without reading produces prompts that
look plausible but are unverified — exactly the failure mode
"diagnosis first" exists to prevent. The drafter cannot enforce
diagnosis-first on the executor while skipping it themselves.

Skip only when the prompt depends on no project doctrine at all
(e.g. a one-line config tweak in a fresh repo).

### Rewriting prompts and other text

When fixing or improving a prompt, handoff, message, instruction,
or any other text, rewrite the entire document. Do not deliver
patches, diffs, or partial edits. The user wants a complete drop-in
replacement, not a reconstruction job.

---

## 3. Universal Task Prompt

Copy everything below the start marker into your prompt. Replace
every `[BRACKETED]` slot.

### --- TASK PROMPT START ---

# Codex Task — [MODEL] — [TASK TITLE]

## Project context

[PASTE PROJECT CONFIGURATION BLOCK HERE — or reference its file path
if your project keeps it as a standalone doc that the executor
always reads]

## Required reads (before any code)

Read in this order:
1. [Required read 1]
2. [Required read 2]
3. [Required read 3]

If a value in this prompt conflicts with a required read, stop and
ask — do not guess.

## Pre-flight

Run and report output before any edits:

```
git branch --show-current
git status --short
```

If the working tree is not clean, stop and report.

## Task

[ONE-SENTENCE TASK DESCRIPTION — what the change does, not how.]

[2–5 SENTENCES OF CONTEXT — why this is needed, what problem it
solves, what success looks like.]

## Mindset — diagnosis first

Do not write code in your first pass. First:
1. Read the required files above.
2. Locate the files relevant to this task.
3. Identify any existing code, patterns, or rules that already
   address what this prompt asks for.
4. Identify risks: locked files that might be tempting to touch,
   hidden coupling, data-shape assumptions, regressions in adjacent
   surfaces.
5. Report findings and propose a plan before writing code.

Only after the plan is acknowledged, proceed to implementation.

## STOP-and-report on unexpected findings

If pre-flight or diagnosis turns up something that contradicts the
prompt — a commit that should exist but doesn't, a file in an
unexpected path, a working tree that isn't clean, a test that's
already failing on main, a tool output that doesn't match the spec —
treat it as a STOP signal, not an obstacle to route around.

Report the finding. Wait for direction. Do not improvise a
workaround. Do not "interpret" the user's intent to make the prompt
fit. Do not rewrite the plan to match what you found.

The cost of stopping unnecessarily is a 30-second clarification.
The cost of routing around an unexpected finding is silent state
corruption that surfaces later as a bug whose origin no one can
trace.

## Target files

Files this task is allowed to modify:
- [path/to/file]
- [path/to/file]

If a change is needed outside this list, stop and ask.

## Locked files — do not touch

[Paste from project config, plus any task-specific additions.]
- [path/to/file]
- [path/to/file]

No new dependencies. No new top-level files unless explicitly listed
above. No `git add .` — explicit file staging only.

## Specification

[THE ACTUAL TASK CONTENT — what to build, change, or fix. Be exact.
Use exact values, not "around" or "roughly". If logic is involved,
specify inputs, outputs, and edge cases.]

## Verification

After implementation, verify with:

```
[project test command]
[project lint command]
[project build command]
```

Then confirm:
- All required tests pass.
- No new lint warnings introduced.
- Build succeeds.
- Only files in **Target files** changed.

[ADD TASK-SPECIFIC FUNCTIONAL CHECKS — e.g. "submitting the form
with empty input shows the validation error", "exporting CSV
produces N rows with these columns".]

If any check fails, stop and report — do not commit.

## Pre-merge spec check (for created or substantially rewritten files)

Before merging, read the committed file contents and confirm against
the spec in this prompt:
- All required exports / keys / sections are present, exact-named
- No extras, no omissions
- Comments / docstrings match what the prompt specified
- Type signatures match

Test / lint / build passing is necessary but not sufficient. The
spec is the contract — verify the file matches it.

This applies whenever the prompt creates a new file or rewrites one
substantially. Skip for small edits where a `git diff` already shows
the full change.

## Post-task

```
git diff --stat
```

Confirm only files in **Target files** changed. Then suggest a
single, single-purpose commit message — do not `git add`, do not
commit.

## Two-AI review for irreversible actions

For high-stakes or irreversible actions — merge to main, deploy,
schema migration, destructive cleanup, force-push, data deletion —
the builder agent reports findings and stops. It does not execute
the irreversible action itself.

The user routes the report to an independent reviewer (a different
chat, a different model, a human reviewer). Only after both reviews
agree the change is clean does the builder execute.

This rule exists because an agent reviewing its own work is a weaker
check than two independent agents reviewing the same work. The
rubber-stamp risk is real and asymmetric: a missed flaw before merge
becomes silent main-branch corruption; a missed flaw after
independent review is at least defensible.

For reversible actions (a feature-branch commit, a draft PR, a doc
edit on a working branch), single-agent review is fine.

## Mindset closer

[ONE-LINE PROJECT-SPECIFIC PRINCIPLE — e.g. "Owner-operator clarity.
Calm, confident, simple on top." Or "Correctness over cleverness.
Silent failures are the worst kind."]

If something is ambiguous, stop and ask — never guess.

### --- TASK PROMPT END ---

---

## 4. Prompt delivery discipline

When the planning chat hands off a task prompt, the prompt is the
deliverable. Keep surrounding prose minimal.

**Allowed before the prompt:**

- One line naming what the prompt does
- Any STOP-level flags the user must see before sending (snapshot
  drift, locked-file proximity, irreversibility)

**Not allowed before the prompt:**

- Re-explaining the task the prompt already explains
- Walking through patch contents the prompt already contains
- Restating decisions already captured in the prompt body
- Narrating the drafting process

**Allowed after the prompt:**

- One line on what happens next (e.g. "After the executor runs,
  paste the diff back")
- Any follow-up steps that are not in the prompt itself

The rule: if the information is in the prompt, do not say it again
outside the prompt. The prompt is the artifact. Everything else is
friction.

---

## 5. UI Task Module (optional)

Add this section to the task prompt **only when** the task changes
visual surfaces. Insert it right before the **Verification** section.

### --- UI MODULE START ---

## Source of truth — visual

Design source URL: [PASTE EXACT URL OR FILE PATH]

The computed specs in this prompt were extracted from that source
via DevTools (or equivalent inspector). They are the source of truth
for this component. If the rendered output does not match these
values, the implementation is wrong — do not adjust the spec to
match the implementation.

## Computed specs

[PASTE FULL COMPUTED SPEC BLOCK from a single DevTools pass:
- Outer shell: width, height, padding, border, radius, background
- Header: layout, gap, alignment
- Body rows / sections: typography (px / weight / line-height),
  color, spacing, borders
- Interactive states: hover, active, focus, disabled
- Chart anatomy if relevant: legend, tooltip, axes, grid colors

Use exact px and hex values. Do not summarize. Do not round.]

## JSX / markup structure

[PASTE EXACT MARKUP SKELETON — element nesting, class names,
role/aria attributes, data attributes. Leave inner content as
`{prop.x}` placeholders.]

## Visual verification table

After implementation, fill this table by reading **computed styles
in the rendered output** — not source code, not assumed values.

| # | Surface | Expected | Observed | Result |
|---|---------|----------|----------|--------|
| 1 | [Outer container border] | [exact value] | | pass / fail |
| 2 | [Outer container radius] | [exact value] | | pass / fail |
| 3 | [Outer container padding] | [exact value] | | pass / fail |
| 4 | [Title size / weight] | [exact value] | | pass / fail |
| 5 | [Title color] | [exact value] | | pass / fail |
| 6 | [Body text size / weight] | [exact value] | | pass / fail |
| 7 | [Body text color] | [exact value] | | pass / fail |
| 8 | [Spacing between blocks] | [exact value] | | pass / fail |
| 9 | [Font family] | [exact value] | | pass / fail |
| 10 | [Dark / theme variants present] | yes | | pass / fail |
| [N] | [TASK-SPECIFIC CHECK] | [exact value] | | pass / fail |

If any row fails, stop and report — do not commit.
If freshness cannot be confirmed (cached build, stale dev server),
report: **Verification provisional — runtime freshness unconfirmed.**

## Design-token checks

- [ ] All colors come from the project token list.
- [ ] All radii come from the project radius scale.
- [ ] All font sizes map to a named role in the type scale.
- [ ] All spacing values come from the project spacing scale.
- [ ] No inline styles. No utility classes outside project
      convention.
- [ ] Theme / dark mode variants present on every new element.

### --- UI MODULE END ---

---

## 6. Session Close Module (optional)

Use this at the end of a working session, not per task. Sessions
close in one of four modes — skip, micro, lightweight, or full.
Picking the mode is the first step. Everything else waits.

### Step 0 — Pick the close mode (hard gate)

When the user says "session close" — or any equivalent — the chat's
first action is to name the mode in one short message. No other
step runs until the mode is named.

This is a hard gate, not a soft preference. The mode pick precedes:
- the session summary
- any context-doc proposal
- any backlog proposal
- any handoff drafting
- any worktree or branch review

The four modes:

- **No close** — skip the ceremony entirely. See **Skip-close
  criteria** below.
- **Micro close** — ~2 minutes, five questions. See **Micro close**.
- **Lightweight close** — 5–8 minutes, abbreviated steps. See
  **Lightweight close**.
- **Full close** — full sequential walk. See **Full close**.

If the user says "session close" and the chat thinks no close is
needed, the chat says so explicitly: *"Nothing to close — no commits,
no doc edits, no backlog changes. Standing down."* The user can
override.

This step exists because every close that skips it defaults to full
close, regardless of what the session actually warranted. Defaulting
to full close on lightweight sessions is the template's largest
workload leak. Naming the mode first is the single discipline that
fixes it.

### Skip-close criteria

A session does not need any close when ALL are true:
- No commits made
- No docs edited
- No backlog items changed
- No worktrees created or abandoned
- Pure discussion, prompt drafting, or read-only diagnosis

A skip-close session ends with at most a one-line acknowledgment.
No summary, no handoff, no closing summary structure.

### When to use which mode

**Micro close** — allowed when ALL are true:
- Nothing merged this session
- No docs changed
- No worktrees created
- No backlog items changed
- A change happened, but it's contained (e.g. one work-in-progress
  commit on an existing branch, no new state to track)

**Lightweight close** — allowed when ALL are true:
- One or fewer features / components shipped
- Three or fewer doc / context deltas
- No locked constraints changed
- At most one external system write (e.g. backlog tool)
- No worktrees created or abandoned
- Active work under 90 minutes

**Full close** — required when ANY are true:
- More than one feature / component shipped
- Doc / context deltas exceed 8
- Locked constraints changed (thresholds, contracts, copy strings,
  architectural boundaries)
- Multiple external system writes needed
- Active work exceeded 90 minutes
- Worktrees were created or abandoned this session

### File-aware handoff discipline (applies to any agent writing the handoff)

A handoff carries only what is NOT already reachable from project
files. This applies whether the close is written by a human, a
planning agent, or a coding agent.

Before writing each line, ask: "Will the new chat read this from
[context doc / project rules / backlog / locked-decisions doc / git
log / git diff]?" If yes, leave it out.

What typically belongs in a handoff:
- Current state pointer (HEAD, working tree, what just merged)
- Roadmap order agreed in this session (if not yet in backlog)
- Exact next step + any open scoping questions
- Specific IDs / items to update after the next task lands
- Environment / runtime gotchas not yet documented anywhere

What does NOT belong:
- Restating what shipped (already in commits + context doc)
- Listing locked decisions (already in context doc)
- File-change inventories (already in git)
- Repeating project rules (already in required reads)
- Re-listing required reads (already in project rules)

Target: as short as possible. If a handoff runs longer than ~15
lines, it is almost certainly restating files. Cut.

### Required handoff structure — receiving chat instructions

Every handoff begins with an explicit **Receiving chat instructions**
block. This block makes the handoff self-contained and works for any
receiving chat regardless of what files are mounted, what memory is
loaded, or which platform it runs on.

A pointer to "the project's required reads" is not enough. Spell out
the file list and the backlog URL in the handoff itself.

The block must instruct the receiving chat to:

1. Read the project's required-read files in order, by name
2. Read the current state of the project's backlog (URL or location
   spelled out)
3. Flag any drift between project docs and the backlog before
   proceeding
4. Apply the **freshness hierarchy** when sources conflict. Closer-
   to-now wins:
   1. Live repo + live backlog — ground truth when reachable
   2. The handoff's **State** block — drafted at session close,
      reflects post-close reality
   3. Project file snapshots (uploaded context docs, mounted reads)
      — only as fresh as the last upload; may lag the handoff
   4. Narrative entries inside any of the above — describe history,
      not current state
   When the handoff conflicts with a snapshot, the handoff wins.
   When State conflicts with narrative, State wins. Branches, items,
   or open threads named in narrative or older snapshots but absent
   from State should be treated as closed, not as drift.
5. If any of the above cannot be accessed, say so and stop
6. Once read, acknowledge briefly and wait for direction — do not
   start work

Without this block, three failure modes recur:
- Receiving chats with project files mounted may read them but skip
  backlog sync, missing items closed mid-session
- Receiving chats without project files mounted (different platform,
  different account) ignore the pointer entirely and start from
  memory
- Receiving chats correctly notice conflicts between the handoff and
  an uploaded snapshot, but have no rule for which to trust, so they
  stop and wait for manual resolution every time

All three are eliminated by spelling the requirement out in the
handoff.

A fourth failure mode is more subtle: a careful receiving chat reads
the narrative thoroughly, finds open threads in older entries that
were closed later in the session, and flags them as drift. This is
not the chat's fault — it's the natural reading of a narrative entry
that documents resolved work. The freshness hierarchy resolves it:
State is closer to now than narrative; the handoff is closer to now
than the uploaded snapshot.

### Shipped-only-here detection

If the handoff includes a "shipped this session" section, ask: is
this content reachable from any project file (commits, context doc,
session log)?

- If yes → drop the section. It is restating files.
- If no → that is a signal the close skipped a narrative-doc entry
  for work that warranted one. The fix is not to keep the section
  in the handoff; it is to write the missing narrative entry first
  (see **Doc-commit placement check** in the close), then drop the
  section.

A handoff is the wrong place for the only record of significant
work. Project files are the right place. The handoff just points at
them.

### Handoff is read-only on receipt

The receiving chat treats the handoff as state, not as a command.
After reading the handoff and the required-reads list, it stops and
waits for the user to say what to do next.

The handoff describes WHAT is queued, not an instruction to start
it. Drafting the next task prompt, writing code, or executing the
next task happens only after the user explicitly says go.

### Role-aware handoff format

A single handoff document serves all roles. The first section after
the **Receiving chat instructions** block names which agent is
reading and what that agent should do. Each agent reads its own
block and ignores the others.

The four roles assumed by this template:

- **Planning chat** (e.g. Claude chat) — planning, drafting, session
  state, writing prompts, running closes
- **Reviewer chat** (e.g. ChatGPT chat) — independent review of the
  planner's drafts before irreversible actions
- **Executor** (e.g. Claude Code) — runs prompts in the repo
- **Second-opinion reviewer / executor** (e.g. Codex) — reviews
  diffs or executes prompts depending on user instruction

The handoff structure puts universal context first (state, open
question), then role-specific behavior (the role blocks), then the
three lanes. Every reader needs the universal context to understand
what their role-specific instructions mean.

```markdown
## Handoff

### Receiving chat instructions

Before responding to anything below:

1. Read these project files in order:
   - [PROJECT_RULES.md or equivalent]
   - [DESIGN_RULES.md if applicable]
   - [Any other required reads]
   - [CONTEXT_DOC.md]
2. Read the current state of the backlog: [URL or location]
3. Flag any drift between project docs and backlog before proceeding
4. Apply the freshness hierarchy when sources conflict, closer-to-now
   wins: live repo/backlog > handoff State block > project file
   snapshots > narrative entries. When the handoff conflicts with a
   snapshot, the handoff wins. When State conflicts with narrative,
   State wins.
5. If any of the above cannot be accessed, say so and stop
6. Once read, acknowledge briefly and wait for direction — do not
   start work

---

**State**
- main HEAD: [SHA] — [commit subject]
- Working tree: clean / dirty
- Branches / worktrees: [list or "main only"]
- Snapshot freshness: [files needing re-upload, or "current"]

**Open question** (if any)
- [Single most important unresolved decision]

---

**If you are the planning chat:**
- Apply the **File-aware handoff discipline** and the **Closing
  summary structure** for any new close work.
- Wait for explicit user direction before drafting prompts or
  proposing next steps.

**If you are the reviewer chat:**
- You will receive prompts and diffs from the user for validation.
- Apply the **Two-AI review for irreversible actions** rule.
- Report findings; do not propose new work unless asked.

**If you are an executor:**
- Report current branch, status, and confirmation you've read the
  required files.
- Stop and wait for an explicit task prompt.
- Do not pick a next task from this handoff. Do not treat "queued
  for next session" as instructions. Task selection happens in the
  planning chat.

---

**User action items before next session**
- [Snapshot re-uploads, manual decisions, external steps]

**Queued for next session** (planning chat reads; executor ignores)
- [Item — only if it cannot finish in this session]

**Awaiting external input** (planning chat reads; executor ignores)
- [Item blocked on someone outside your control]
```

Why one document, not four: maintaining four separate handoffs is
the overhead the template exists to remove. One source of truth,
role-gated reading, no per-tool drift.

### Worked example — what a short, valid handoff looks like

The target is short, state-first, and free of anything reachable
from project files. Below is a canonical example for a session that
shipped one merge to main and has nothing queued.

```markdown
## Handoff

### Receiving chat instructions

Before responding to anything below:

1. Read these project files in order:
   - CLAUDE.md
   - UI_RULES.md
   - wx_cfo_scorecard_context_v2_6.md
2. Read the current state of the backlog: https://www.notion.so/084420fff00444de9413a542db3dddf0
3. Flag any drift between project docs and backlog before proceeding
4. Apply the freshness hierarchy when sources conflict, closer-to-now
   wins: live repo/backlog > handoff State block > project file
   snapshots > narrative entries. When the handoff conflicts with a
   snapshot, the handoff wins. When State conflicts with narrative,
   State wins.
5. If any of the above cannot be accessed, say so and stop
6. Once read, acknowledge briefly and wait for direction — do not
   start work

---

**State**
- main HEAD: 7c2f9ab — feat(today): hero pill copy QA
- Working tree: clean
- Branches / worktrees: main only
- Snapshot freshness: current

**Open question** (if any)
- None

---

(role blocks — same as template)

---

**User action items before next session**
- None

**Queued for next session**
- None — handoff is state-only.
```

That handoff is ~25 lines including the role blocks. Without the
role blocks (which are boilerplate and identical across handoffs),
the actual session-specific content is six lines: HEAD, working
tree, branches, snapshot freshness, no open question, no queued
work.

If a real handoff has more content than this, the question to ask
is whether that content is reachable from project files. If yes,
cut it. If no, it belongs in a project file first (per the
**shipped-only-here gate** in Step 8).

### Micro close — five questions

For sessions where something happened but nothing accumulated. Total
time ~2 minutes. The chat asks these five questions in one message,
the user answers, then close is done.

1. Current branch and `git status`?
2. Anything actually changed?  yes / no
3. Any docs or snapshot updates needed?  yes / no
4. Any worktree or branch to clean?  yes / no
5. Next step in one line?

If any answer is "yes" with a nontrivial follow-up, the close
escalates to lightweight. If all answers are "no" or trivial, the
close ends with a one-line confirmation.

### Lightweight close — execute in order

Same one-step-at-a-time pacing as full close (see below): open with
a short list of the steps that will follow, then walk each in its
own turn. Lightweight just has fewer steps.

1. **Summarize** — bullet list: shipped (commits with hashes),
   decided, learned. No prose recap.
2. **Doc deltas** — list the 1–3 changes proposed for context docs.
   Wait for approval. Apply **Execution mode** rule below.
3. **Backlog deltas** — list the 0–1 backlog item changes proposed.
   Wait for approval.
4. **Execute approved changes.**
5. **Note deferred items** — anything intentionally not captured,
   with the reason.

### Full close — execute in order, one step at a time

A close is walked sequentially, not dumped as a single multi-section
reply. The chat opens the close with a short table-of-contents
listing the steps it intends to walk, then handles each step in its
own turn, waiting for the user before moving to the next.

This pacing exists because each step has its own approval gate.
Bundling them forces the user to mentally context-switch and
back-track. One step at a time keeps the conversation linear.

**Decision-first prose discipline.** Each step's response opens
with the decision, proposal, or finding — not the reasoning behind
it. Reasoning follows only if the user is being asked to choose
between options, or if the user explicitly asks "why." The same
discipline that applies to Codex prompts ("the prompt is the
deliverable, surrounding prose minimal") applies to close-step
responses. Length comes from the work, not from explaining the
work.

When presenting options, list the decision and a one-line trade-off
per option. Save full reasoning for cases where the user asks. When
making a recommendation, lead with the recommendation, then give
the one or two reasons that matter, not the full decision tree.

A close that runs many real Codex round-trips will be long because
the work is long — that's fine. A close that runs few round-trips
should not be long because of meta-commentary.

**Step 0. Mode named.** Already done at the top of the close. The
full-close walk begins at Step 1.

**Step 1. Summarize the session** — concise list of what shipped
(commits with hashes), what was decided, what was learned. No prose
recap. Stop and wait for the user to acknowledge or correct.

**Step 2. Worktree and branch hygiene** — classify every worktree
and unmerged branch in this session's repo. See **Worktree hygiene**
below for the four valid classifications and the three-pass
enumeration rule. No worktree or branch survives in undecided
state. "Review next session" is not a valid classification.

This step runs before context-doc updates. The narrative entry
written in Step 3 describes end-of-session repo state; that state
is only knowable after disposition is complete. Drafting the
narrative entry first means writing fiction about state that
hasn't happened yet, which is the failure mode the **commit-
ordering rule** below was added to catch. Reordering disposition
ahead of narrative removes the failure mode at its source instead
of catching it downstream.

**Step 3. Propose context-doc updates** — for each doc that needs
changing, show the exact text to add or replace. Wait for approval
before executing. If the user has already edited the doc themselves,
skip and confirm.

**Narrative entry length default.** The default narrative entry is
short. Five sections, each a few lines:

- What changed — commit hashes and one-line subjects
- Why it matters — the operating consequence, not the play-by-play
- Current state — exact post-session repo / system state
- Next step — what comes next, in one or two lines
- Lessons or gotchas — only the unusual ones, only if they're not
  reachable from elsewhere

Longer entries are exceptions justified by what the session
produced, not the default. A session that surfaces a new workflow
rule, locks a non-obvious architectural decision, or generates
multi-step learnings worth preserving earns the long form. A
session that ships a feature, runs a smoke test, or makes a routine
update does not.

If the proposed entry exceeds ~50 lines, ask whether the length is
warranted before drafting it in full. The discipline is the same as
the file-aware handoff rule applied to narrative entries: the entry
points at commits, backlog items, and code; it does not restate
them.

**Commit-ordering rule for end-of-session state.** A narrative
entry that describes its own end-of-session state (branches, HEADs,
worktree disposition, push status) freezes that state at the moment
the entry is committed. Disposition steps that run after — branch
deletions, worktree cleanup, follow-up pushes — are invisible to the
entry. The result is a narrative that documents what was true at
draft time, not what was true at session end.

The default fix is structural: disposition runs in Step 2, before
the narrative entry is drafted in Step 3. The narrative entry then
describes verified end-of-session state, not predicted state. This
is why the walk is ordered the way it is.

The escape hatch — drafting the narrative entry before disposition
and labeling it as draft-time state with a reconciliation pointer
— exists for genuine exceptions where the entry must commit before
disposition (the entry is itself the disposition trigger, or
disposition steps depend on the entry being pushed first). It is
not a routine option. If the escape hatch is being used in
back-to-back sessions, the cause is the close-runner drafting from
memory of the wrong walk order, not a genuine constraint. Reorder
the work, don't reach for the escape hatch.

**Step 4. Execute approved doc updates** — see **Execution mode**
below. Do not move to step 5 until the doc edits are confirmed
landed.

**Step 5. Propose backlog updates** — for each backlog item that
changed, fetch its current state by ID first, then show: item name,
current Status/Why, proposed Status/Why, reason. Wait for approval
before executing. Use direct ID lookup, not search, unless explicitly
authorized.

**Supersession check.** When this session created a new backlog item
that supersedes an older one (architecture locked, scope split,
placeholder replaced), the older item must be retired in the same
close — marked Done, merged into the new one, or deleted. Two
parallel items tracking the same work is the failure mode the
single-source-of-truth rule exists to prevent. The wrong one can
get marked Done later and the project loses track of which item
reflects current reality. If the session created an item that
supersedes an older one, name both in the proposed updates and
state which retires.

**Step 6. Execute approved backlog updates** — by ID, in batch.
Confirm landed.

**Step 7. Note deferred items** — decisions made but intentionally
not captured anywhere yet, with the reason for each.

**Step 8. Next-chat handoff** — apply the **File-aware handoff
discipline**, the **Required handoff structure**, and the **Role-
aware handoff format** above. Anything reachable from project files
does not belong in the handoff body — but the **Receiving chat
instructions** block at the top is mandatory regardless.

**Pre-handoff gate — shipped-only-here check.** Before drafting
the handoff body, run this check explicitly:

> Is anything I'm about to put in the handoff not yet reachable from
> a project file (commit, context doc, backlog item, project rules)?

If yes, stop. Return to Step 3 and write the missing narrative-doc
entry (or backlog item) first. Do not draft the handoff until every
piece of session content has a project-file home. The handoff then
points at those files instead of carrying the content.

This gate is mandatory, not aspirational. The handoff is the wrong
place for the only record of significant work — that is the
"shipped-only-here" failure mode, and it is the specific reason
this gate exists. Skipping the gate produces handoffs that grow
session by session and quietly become the project's de-facto
context doc.

**Pre-handoff gate — evidence-over-memory rule.** State, Open
question, Queued items, and Required reads must come from
observation, not memory. Memory is the failure mode this gate
catches: branch HEADs move during a session, earlier-session
questions get superseded, in-session work eats into what was queued
at draft time, and session focus narrows the chat's sense of which
project files matter. A handoff drafted from memory will quietly
carry stale facts in any of these four places.

Each field has its own evidence source:

- **State** — repo observation. Run (or have the user paste) `git
  status --short` and `git log -1 --oneline <branch>` for every
  branch named in the State block. The State block must be
  derivable from that paste.
- **Open question** — re-read of the closing summary's last
  decision, not the question that was open mid-session. If the
  question shifted during the session, the handoff carries the
  closing-state question, not the entry-state one.
- **Queued items** — cross-check against the closing summary's
  pending list, not against what was pending when the close
  started. Items that landed during the close come off; items
  uncovered during the close go on.
- **Required reads** — start from the project's stated required-
  reads list (in project preferences, `CLAUDE.md`, or equivalent).
  Subtract files per-file with a one-line justification ("no UI
  surface in queued work," "spec doc not relevant to this task").
  The default is the full list. Subtractions are deliberate, named
  acts. Memory is unreliable here because session focus narrows
  attention to whichever files were active during the work, and
  files that didn't come up during the session can feel optional
  even when the project's list says otherwise.

**Show the evidence in the close.** Before writing the handoff,
paste the supporting evidence into the close itself, visible to the
user:

- Git observations (`git status --short`, `git log -1 --oneline`
  per branch) so the State block is derivable from the paste.
- The project's full required-reads list, with subtractions called
  out per-file with their justification, so the handoff's reads
  list is derivable from the paste.

This converts a self-discipline rule into a checkable artifact —
the user can see whether the handoff matches the evidence. Without
visible evidence, errors in State, branch lists, or required reads
are uncatchable until the next session reads them.

If the chat is sandboxed and cannot run git commands, it asks the
user to paste the output and waits. It does not fill any of these
fields from memory and apologize later.

The handoff is a distinct, labeled deliverable in its own message.
It is not the **Closing summary structure** (those are different
artifacts with different audiences: the closing summary is for the
user finishing this session; the handoff is for the chat starting
the next one). Do not merge them. Do not skip the handoff because
the closing summary "covered it."

If the **Queued for next session** lane is empty after applying the
**Close everything that can be closed** rule, the handoff is short —
HEAD pointer, working tree state, "no queued work," plus the
mandatory receiving-chat instructions block. That is a valid
handoff, not a reason to omit one. See **Worked example** above.

### Execution mode

When approved edits cannot be applied directly (read-only project
files, sandboxed mounts, missing tools), the chat produces a
complete coding-agent-ready prompt as the execution artifact — not
a "here's-the-block, you-decide-how-to-land-it" handoff.

The prompt must follow the Universal Task Prompt format: pre-flight,
target file, do-not-touch list, exact content to insert, verification,
suggested commit message. Apply **Prompt delivery discipline**
(section 4) — keep surrounding prose minimal. The user receiving an
approved edit should never have to ask "can I send this to the
coding agent?" — the prompt should already be there, ready to send.

This applies to context-doc updates, backlog markdown, README edits,
and any other approved change that lands as a file write the chat
cannot perform itself.

### Close everything that can be closed in this session

Before listing anything as **Queued for next session** or **Awaiting
external input**, the chat tests whether the item can actually be
closed *now*, in this session. If yes, close it now.

For each open item the chat is about to defer, ask:
- Can the user do this in 1–2 minutes during the close? → Walk them
  through it now.
- Is it a status check (PR merged? snapshot uploaded? service
  reachable?) the chat or the user can run right now? → Do it now.
- Does it just need a coding-agent prompt drafted and sent? → Draft
  and attach the prompt now (per **Execution mode**).

An item only goes to **Queued for next session** if it genuinely
cannot finish in this session — work that needs context, time, or
a fresh chat to do well. The default is close, not defer.

The goal is to start the next session as fresh as possible. Punting
small closeable items costs more across two sessions than finishing
them now.

**Worktree and branch sub-check.** Before any worktree or branch is
listed as deferred, run the close-everything test on it directly:

- Can the branch be classified now from available evidence (git log,
  diff against main, last-modified date, presence of unique
  unmerged content)? → Classify it now per **Worktree hygiene**
  below.
- Has the work been superseded, replaced, or rolled into another
  branch? → Mark abandoned, back up if needed, delete now.
- Was it shipped via squash or rebase under a different SHA? →
  Confirm with `git log main` for the subject line, delete now.
- Does it genuinely need a fresh session to evaluate (large diff,
  complex unmerged work, architectural questions)? → Only then
  defer, and only with a Notion / backlog item attached per
  **Worktree hygiene** state 4.

"Review next session" is not a valid classification. It is the
specific failure mode the worktree hygiene rule exists to prevent.
Branches accumulate that way. Months of accumulated worktree drift
costs more than spending two minutes per branch at close.

### Worktree hygiene

If this project uses git worktrees, every worktree and unassociated
branch must be classified before the close completes. No worktree
or local branch (other than main and the active branch) survives in
an undecided state.

**Enumerate three times.** `git worktree list` alone is not a
complete view. Run all three:

1. **Git's worktree view** — `git worktree list --porcelain`.
   Reports every worktree git is tracking, including ones created
   during this session that the close-runner may not remember.
2. **Filesystem view** — list the worktree parent directory directly
   (e.g. `ls .claude/worktrees/`, or wherever the project keeps
   them). Compare against git's view. Any directory present on
   disk but absent from git's view is an **orphan worktree** —
   created by a process that didn't register with git, or left
   behind when a registered worktree was removed only via `rm -rf`.
3. **Local branch view** — `git branch`. Compare against the
   worktree views. Any branch that is not main, not the active
   branch, and not associated with any registered worktree is an
   **orphan branch** — typically a leftover from a parallel or
   prior session whose worktree has already been removed but whose
   branch was never deleted.

Orphan worktrees are invisible to `git worktree list`. Orphan
branches are invisible to the worktree views entirely. Both slip
through classification when the close enumerates only one source.
Orphan worktrees take disk space and create directory collisions;
orphan branches take local namespace and pollute `git branch`
output session over session. Classify all three categories with the
same framework below.

For orphan worktrees: if the directory is empty or contains nothing
worth keeping, just delete it.

For orphan branches: if the branch has zero unique commits (0 ahead
of main, no unmerged content), it is deletable on the spot. If it
has unique unmerged commits, classify with the four-state framework
the same as worktrees.

For each worktree (registered or orphan) and each orphan branch,
classify into one of four states:

1. **Merged and removed** — branch merged to main, worktree removed,
   local branch deleted. The default outcome for completed work.

2. **Active** — PR open or work expected to resume within the
   current work cycle. Note in the close so the next session knows
   the worktree is live, not stale. "Active" requires an
   expected-to-resume window, not just intent — drift to permanent
   active is the failure mode this guards against.

3. **Abandoned** — work was paused, replaced, or failed and will
   not ship. If the worktree has uncommitted or untracked work
   worth keeping, back it up first (zip the working tree, save
   the branch as a tag, or push to a `wip/` remote ref). Then
   remove the worktree and delete the local branch.

4. **Paused with a tracking item** — work is intentionally on hold
   but will resume later. Create a backlog item naming the
   worktree path, branch, purpose, owner, review-by date, and
   explicit keep/delete decision criteria. The worktree may stay
   only with this item in place. No worktree stays paused on
   memory alone.

Stale worktrees create three kinds of compounding confusion: code
confusion (old experiments look like active work), doc confusion
(multiple copies of context docs across worktrees), and environment
confusion (multiple dev servers on different ports). The cost of
classifying every worktree at close is small; the cost of cleaning
up months of accumulated worktree drift is large.

**Out-of-scope findings during executor-run cleanup.** When the
close hands off worktree or branch disposition to an executor (via
a coding-agent prompt) and the executor's enumeration surfaces
artifacts outside the prompt's named scope, the executor stops at
the named scope, reports the additional findings, and waits for
authorization to extend. This is the same STOP-and-report-on-
unexpected-findings rule that applies to any executor task, applied
at close time.

The executor does not silently expand scope to handle the new
finding, even when the disposition seems obvious (zero-ahead
branches, identical-to-main HEADs). The planning chat decides
whether to extend authorization in the same prompt, defer to a
follow-up prompt, or leave the artifact alone. The executor's job
is to surface, not to decide.

This is how three-pass enumeration works in practice: the
enumeration runs every close; the disposition prompt names what is
authorized for cleanup; out-of-scope findings get reported back
rather than acted on. The planning chat then either authorizes the
extension or queues a separate cleanup prompt.

### Doc-commit placement check

If the project's commit rules distinguish spec docs from narrative
docs (see **Recommended pattern** in Project Configuration), the
close runs four checks:

1. **Feature branches** — any commit touching a narrative doc on a
   feature branch is flagged. Narrative-doc edits should land on
   main after merge, not on the branch. Propose dropping the commit
   before the PR opens.

2. **Main branch** — any narrative-doc edit committed to main but
   not pushed is flagged. The next session reads from main; unpushed
   doc commits are invisible to it.

3. **Missing narrative entry** — if significant work shipped this
   session (new feature, refactor, cleanup pass, infrastructure
   change, new rule landed) but no narrative-doc entry was written
   for it, flag this as a gap. Significant work without a narrative
   entry leaves the handoff as the only record, which violates the
   file-aware handoff rule (the handoff would be forced to restate
   work, because the work isn't in any project file yet).

   Propose a narrative-doc entry now so the close has somewhere to
   point. The bar for "significant" is judgment — multi-commit
   work, anything that changed locked constraints, anything that
   established a new project rule, anything that took meaningful
   time. One-line typo fixes do not need an entry.

4. **End-of-session state freshness** — if a narrative entry
   includes an end-of-session state block (branches, HEADs,
   disposition status), check whether disposition steps committed
   after the entry. If yes, the block is stale. The walk's default
   ordering (Step 2 disposition before Step 3 narrative) prevents
   this; a stale state block means the walk was run out of order.
   Per the commit-ordering rule in Step 3, either reorder so
   disposition commits before the entry, or mark the block as
   draft-time state and reference the reconciliation commit. A
   self-inconsistent narrative entry is the failure mode this
   check catches.

If the project does not distinguish spec from narrative docs, this
check is skipped.

### Snapshot drift check (line-level edits)

Project file snapshots that the chat reads from read-only mounts
may be stale. Before drafting any line-level edit (diff,
str_replace, line-numbered patch), flag the drift risk and require
the implementing agent to read the live file first.

Snapshots are fine for orientation only — never for line numbers or
exact wording.

For the executor: before applying any line-level edit, read the
live target file. If line numbers, surrounding prose, or target
text don't match the spec, STOP. Report the mismatch and stand by.
Do not edit, do not improvise, do not reach for "close enough"
replacements.

### Closing summary structure

The final closing message — the one sent after all approved changes
have landed — must split open items into three labeled lanes so the
user can act without parsing intent. A flat "carry to next session"
list is not acceptable; it forces the user to sort each item.

**User action items** — things only the user can do (manual steps,
external decisions, system-level actions the chat cannot perform).
Each item is one line, imperative voice. If the action requires a
coding-agent prompt, the prompt is attached inline under the bullet,
ready to send. The user should never have to ask "is there a prompt
for that?" — the answer is always yes if one is needed.

**Queued for next session** — work the next chat should pick up.
This is what feeds the next-chat handoff. Not action items for the
user.

**Awaiting external input** — things blocked on someone or something
outside the user's direct control (product decisions, third-party
responses, scheduled events). Listed so they are not forgotten, not
as user actions.

If a lane is empty, omit it. Do not write "None" — silence is fine.

The three-lane structure is required even when items are few. A
final message ending in a flat list — even a short one — is the
"finish line revert" failure mode: the chat held discipline through
the close and dropped it on the last bullet list. If only one item
remains, label its lane.

### Snapshot re-upload reminder

If this project uses uploaded project files or read-only snapshot
mounts that the chat reads from (e.g. files visible to the chat as
read-only context), edits made during the close do NOT automatically
refresh the snapshot. The next session will read stale state.

**Project-level upload, not chat-level.** Dragging a file into the
current chat only refreshes that chat's context. New chats read the
project-level snapshot, which is separate and is updated through the
project settings UI (e.g. on Claude.ai: Project → Files → replace).
A chat-only re-upload looks like it worked but leaves new chats
reading the pre-edit version. This is silent drift that accumulates
session over session.

When any file the chat reads from a snapshot mount has been edited
this session, add a **User action items** entry:

> Re-upload `[filename]` to the project snapshot via the project
> settings UI (Project → Files → replace) — required so new chats
> read current state. Dragging into a chat is not enough; that only
> updates the current chat.

This belongs in the closing summary every time a tracked file
changed, not just once-in-a-while. Skipping it produces silent
drift between the live repo and the chat's view of it.

**Audit trick.** If the user is unsure whether the project snapshot
is current, the next session can compare the snapshot's content
against the live file. If they don't match, the project snapshot is
stale regardless of when it was "last uploaded" — the upload may
have gone to the chat instead of the project.

### What does NOT trigger a session-close sync

- Conversations about the backlog without a decision.
- Speculative or exploratory items not yet confirmed.
- Analysis, backtests, or design reviews still in progress.
- Prompt drafting iterations.
- Read-only diagnostic results that did not change project
  direction.

### Mid-session check-in

If the user asks "what's accumulated?" or similar, list pending
context-doc and backlog deltas without executing them. Same format
as the close summary, but no proposed edits.

### Context-delta stop rule

When pending doc / context deltas hit the project's configured
limit (default 8), stop adding new work and trigger a full close.
This prevents large bundled closeouts.

---

## What goes in each slot — quick reference

| Slot | Source |
|------|--------|
| `[MODEL]` | Sonnet 4.6 (clear build) or Opus 4.6 (diagnosis / architecture) — or whichever model your tooling uses |
| `[TASK TITLE]` | Plain English: "Add CSV export to Reports", "Refactor auth middleware" |
| Project Configuration | One-time fill per project, reused everywhere |
| Required reads | Project doctrine that must be loaded before code |
| Target files | Be exact. Path-level, not directory-level when possible |
| Locked files | Project config + task-specific additions |
| Specification | The actual task — exact values, no "roughly" |
| Verification | Project test/lint/build commands + functional checks |

---

## When to skip the template

Skip the template only when:
- The change is a one-line edit with no risk surface.
- The task is pure diagnosis with no code output requested.
- The task is a doc edit only.

Everything else uses the template.
