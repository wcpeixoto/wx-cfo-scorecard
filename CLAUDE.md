# wx-cfo-scorecard

A CFO-level financial dashboard for Gracie Sports Fairfield, a BJJ gym.
Turns raw accounting data into plain-English operating signals so the owner
can quickly understand what is happening, whether they are safe, and what
to do next.

**One-sentence definition:**
Wx CFO Scorecard turns accounting into plain-English operating clarity for
small business owners, using CFO-style signal design and Nubank-level usability.

---

## Source of Truth Hierarchy

When two documents conflict, follow this order:

1. `wx_cfo_scorecard_context_v2_6.md` — system behavior, data, architecture
2. `UI_RULES.md` — all visual decisions
3. `UI_CARDS.md` — card anatomy, height behavior, pairing classification
4. `CLAUDE.md` — execution rules and workflow discipline

If a rule appears in two places and they disagree, the higher document wins.
Update the lower document to match — do not leave contradictions in place.

---

## Backlog management

Notion is the sole source of truth for backlog state.

- Backlog database: Wx CFO Scorecard — Backlog
  https://www.notion.so/084420fff00444de9413a542db3dddf0
- Data source ID: bc0648c6-c8df-4496-84ba-4c1b860ae51d
- Schema: Name (title), Status (Now / Next / Later / Done),
  Priority (P1–P5), Why (text)

There is no BACKLOG.md. If a prior conversation, memory summary,
or handoff document references BACKLOG.md — reading it at session
start, fetching IDs from it, syncing card IDs into it — that
reference is stale. Flag it before acting.

When backlog state changes (status moves, new items confirmed,
decisions that lock a constraint), sync directly to Notion via
the MCP connector. Update only items that actually changed; do
not rewrite the whole backlog. When a decision locks a constraint
(threshold, copy string, architectural boundary), capture it in
the Why field of the relevant item.

What triggers a sync:
- An item changes status (Now / Next / Later / Done)
- A new item is confirmed and ready for tracking
- A decision is locked that changes the Why or sequencing
- A lower-priority item is promoted due to real blocking friction

What does not trigger a sync:
- Conversations about the backlog without a decision
- Speculative or exploratory items not yet confirmed
- Analysis, backtests, or design reviews still in progress

---

## Required reading on session start

`PROJECT_CONFIG.md` is the canonical workflow source. Its
**Required Reads Before Code** section defines the read order for
implementation work. Follow that order; do not duplicate it here.

In addition, this file (`CLAUDE.md`) is required reading for project
rules, stack, and working discipline.

Workflow files to consult when their trigger applies:

- `TASK_PROMPT_TEMPLATE.md` — required when drafting an implementation
  prompt for a coding agent.
- `SESSION_CLOSE_WORKFLOW.md` — required when closing a session.
- `README_SESSION_WORKFLOWS.md` — map of the workflow docs.

For any UI work, also check the TailAdmin source at:
`code/Code Supporting Docs/free-react-tailwind-admin-dashboard-main/`
See the **TailAdmin source reference** section below for the lookup table.

Do not skip this step. Do not rely on prior conversation context.
Always read from the files directly.

---

## Stack

- **React + TypeScript** — frontend single-page app
- **Vite** — build tool and local dev server
- **TailAdmin** — design system (custom CSS class layer in `src/dashboard.css`)
- **Supabase** — primary data persistence layer (PostgREST HTTP client)
- **ApexCharts / react-apexcharts** — chart library
- **Custom SVG components** — `TrendLineChart.tsx` for trend/forecast charts
- **GitHub Pages** — deployment via GitHub Actions

---

## Data architecture

**Supabase is the primary source of truth.** The app is no longer browser-local.

| Layer | Role |
|---|---|
| **Supabase** | Primary — transactions, import batches, account settings, workspace settings |
| **IndexedDB** | Fallback only — not used when Supabase is configured |
| **localStorage** | Legacy only — migrated to Supabase on first boot, then removed |

**Critical Supabase configuration (not in repo — must be set manually):**
```
Supabase Dashboard → Settings → Data API → Max Rows → 10000
```
PostgREST silently truncates responses when `max_rows` is below dataset size.
This returns HTTP 200 with partial data — no error, no warning, silent data loss.
Never reduce `PAGE_SIZE` in `sharedPersistence.ts` without verifying
`max_rows` >= `PAGE_SIZE`.

---

## Supabase tables

### shared_workspace_settings

**Infrastructure dependency — table must exist in Supabase before first use.**

```sql
create table shared_workspace_settings (
  workspace_id text primary key,
  target_net_margin numeric default 0.25,
  safety_reserve_method text default 'monthly',
  safety_reserve_amount numeric default 0,
  suppress_duplicate_warnings boolean default false,
  acknowledged_noncash_accounts jsonb default '[]'
);
```

| Column | Type | Controls |
|---|---|---|
| `workspace_id` | text PK | Always `'default'` — single workspace, no multi-tenancy |
| `target_net_margin` | numeric | Profit target (0–1 decimal, e.g. 0.25 = 25%) used in What-If signal cards |
| `safety_reserve_method` | text | `'monthly'` = 1× avg monthly expenses; `'fixed'` = fixed dollar amount |
| `safety_reserve_amount` | numeric | Dollar value used when `safety_reserve_method = 'fixed'` |
| `suppress_duplicate_warnings` | boolean | When true, possible-duplicate count is hidden from System Status |
| `acknowledged_noncash_accounts` | jsonb | Array of account IDs where non-cash forecast inclusion is confirmed intentional |

**Data layer position:** sits alongside `shared_account_settings` in `sharedPersistence.ts`.

**Boot behavior:**
1. On mount, `getSharedWorkspaceSettings()` reads the row for `workspace_id = 'default'`.
2. If the row exists — load it, remove any stale localStorage.
3. If no row exists — check localStorage for legacy `finance_dashboard_business_rules` values, migrate them, write to Supabase, remove localStorage.
4. If neither exists — insert the default row.
5. If the table does not yet exist — reads return `null` gracefully and defaults are used in memory; writes are logged but non-fatal.

**Write pattern:** upsert on `workspace_id` conflict. Only one row can ever exist.

**localStorage keys removed after migration:**
- `finance_dashboard_business_rules` (the entire key)

---

## Key files

| File | Role |
|---|---|
| `src/pages/Dashboard.tsx` | Data wiring, state, tab routing, boot sequence |
| `src/lib/kpis/compute.ts` | Forecast engine — **DO NOT TOUCH** |
| `src/lib/kpis/categoryCadence.ts` | Category-Cadence forecast comparator and production adapter — sensitive |
| `src/lib/kpis/forecastShared.ts` | Shared forecast series/anchor types used by production and backtests — sensitive |
| `src/lib/kpis/splitConservative.ts` | Split Conservative composition helper |
| `src/lib/cashFlow.ts` | Operating cash rules — **DO NOT TOUCH** |
| `src/lib/data/contract.ts` | TypeScript types — **DO NOT TOUCH schema** |
| `src/lib/data/sharedPersistence.ts` | Supabase fetch layer — sensitive |
| `src/lib/charts/movingAverage.ts` | EMA function |
| `scripts/backtest/conservativeFloorDiagnostic.ts` | Repeatable Conservative Floor diagnostic |
| `backtest-results/conservativeFloorReport.md` | Generated Conservative Floor diagnostic report |
| `src/components/CashFlowForecastModule.tsx` | Forecast UI + Known Events |
| `src/components/TrendLineChart.tsx` | Custom SVG chart (shared) |
| `src/components/LoadingScreen.tsx` | Branded boot loading screen |
| `src/components/OperatingReserveCard.tsx` | Extracted from Dashboard — reserve gauge card |
| `src/components/OwnerDistributionsChart.tsx` | Owner distributions chart + custom tooltip |
| `src/lib/priorities/coreConstraints.ts` | Forward cash + reserve helper for Today page |
| `src/dashboard.css` | All custom styles — class-based, no Tailwind in JSX |
| `UI_RULES.md` | Visual standard reference (repo root) |
| `wx_cfo_scorecard_context_v2_6.md` | Full project state and architecture context |

---

## Commands

```bash
npm install       # after fresh clone or dependency changes
npm run dev       # start local dev server
npm run build     # production build → dist/
npm run preview   # preview production build locally
```

---

## Deployment

Deployment is automatic on push to `main`.

- Platform: GitHub Pages
- Pipeline: GitHub Actions in `.github/workflows/`
- Do not edit `.github/workflows/` unless the deploy pipeline is fully understood

---

## Project structure

```
src/
├── components/         — UI components including charts and forecast module
├── lib/
│   ├── kpis/           — forecast engine and KPI compute (locked)
│   ├── cashFlow.ts     — operating cash classification rules (locked)
│   ├── charts/         — chart utilities (EMA, etc.)
│   └── data/           — Supabase persistence layer and TypeScript types
├── pages/              — route-level page components
└── dashboard.css       — all custom styles
public/                 — static assets
.github/workflows/      — GitHub Actions deploy workflow
UI_RULES.md             — visual standard (repo root)
CLAUDE.md               — this file
wx_cfo_scorecard_context_v2_6.md — full project context
```

---

## Styling rules

This project uses a **custom CSS class system** in `src/dashboard.css`.
It does **not** use Tailwind utility classes directly in JSX.

- All visual values must come from `UI_RULES.md`
- No raw hex values invented outside `UI_RULES.md`
- No inline styles in JSX
- No new class names that depend on values not in `UI_RULES.md`
- Reuse existing classes before creating new ones

Before writing any UI code, read `UI_RULES.md`.

---

## Design System — Universal Reference

The universal TailAdmin design system base and verification protocol are maintained
in a shared repo at:
  https://github.com/wcpeixoto/wx-design-system

Files in that repo:
- UI_RULES_TAIL_ADMIN.md — universal TailAdmin base (tokens, patterns, components,
  decision rules). Use as-is on any TailAdmin project.
- UI_VERIFICATION_RULES.md — universal verification protocol. Use as-is on any project.

This project's design system is defined by three files working together:
1. UI_RULES_TAIL_ADMIN.md — universal base (synced from wx-design-system repo)
2. UI_RULES.md — project-specific overrides and extensions for this project
3. UI_VERIFICATION_RULES.md — verification protocol (synced from wx-design-system repo)

When base rules and project rules conflict, the project rules in UI_RULES.md win.

Sync policy: UI_RULES_TAIL_ADMIN.md and UI_VERIFICATION_RULES.md are manually synced
from wx-design-system. Pull updates before starting any new design phase. Do not
auto-sync or overwrite local edits without reviewing the diff.

---

## TailAdmin source reference

The TailAdmin free React source is the authoritative reference for all
UI patterns, component structure, layout behavior, and CSS decisions.

**Location:** `code/Code Supporting Docs/free-react-tailwind-admin-dashboard-main/`

Before writing any new UI component, layout class, or interactive pattern,
check the TailAdmin source first. If a pattern exists there, replicate it —
do not invent an equivalent.

| Decision type | Where to look |
|---|---|
| Shell layout (sidebar, header, main content) | `src/layout/` |
| Nav item structure and active states | `src/layout/AppSidebar.tsx` |
| Sidebar collapse / hover / mobile behavior | `src/context/SidebarContext.tsx` |
| Tab and toggle patterns | `src/components/common/ChartTab.tsx` |
| Card, badge, button, modal primitives | `src/components/ui/` |
| Form inputs and controls | `src/components/form/` |
| CSS tokens (colors, spacing, radius, shadows) | `src/index.css` — `@theme` block |
| Mobile header pattern | `src/layout/AppHeader.tsx` |

**Rules:**
- If a pattern exists in TailAdmin source → replicate it, do not invent an equivalent
- If a pattern does not exist in TailAdmin source → check `UI_RULES.md` for token
  values before writing new CSS
- Never use Tailwind utility classes in JSX — translate TailAdmin patterns into
  CSS classes in `src/dashboard.css`
- When in doubt about any visual decision, read the TailAdmin source before
  asking or guessing

---

## TailAdmin Canonical Source

When verifying any TailAdmin pattern, fetch the source component directly from:
  https://github.com/TailAdmin/free-react-tailwind-admin-dashboard

If that repo is unavailable, fall back to the local reference clone at:
  ~/Code/_reference/tailadmin-react or ~/Code/_reference/tailadmin-react-main

Always prefer the canonical repo — it is more current. The local clone is fallback only.

---

## Locked files — do not modify without explicit instruction

- `src/lib/kpis/compute.ts` — forecast engine, parameters locked via grid search
- `src/lib/cashFlow.ts` — operating cash rules, reconciled to 0.00% variance
- `src/lib/data/contract.ts` — TypeScript schema, do not change shape
- `src/lib/data/sharedPersistence.ts` — Supabase fetch layer, sensitive
- `src/components/LoadingScreen.tsx` — boot UX, stable
- `src/components/OperatingReserveCard.tsx` — extracted from Dashboard, stable
- `src/components/OwnerDistributionsChart.tsx` — multi-series tooltip, stable
- `src/lib/priorities/coreConstraints.ts` — Phase 4 helper, stable
- `.github/workflows/` — deploy pipeline, do not touch casually

---

## Development rules

- System is live and must remain stable
- No broad redesigns without a clear reason and plan
- Fix confirmed friction before chasing theoretical improvements
- Avoid speculative refactors when current behavior is working
- Diagnosis before code: observe, trace cause, propose fix, implement only after approval
- No secrets in the frontend bundle (`VITE_*` variables are client-exposed by design)

### Architecture boundary

The core app is a static site (Vite + GitHub Pages). This constraint applies
to the main application bundle.

**Allowed external services:**
- Supabase — primary persistence layer (already in use)
- Supabase Edge Functions — permitted for secure operations (AI proxy,
  server-side key handling)
- Cloudflare Workers — permitted as an alternative for the AI proxy

**Not allowed:**
- Custom backend servers or hosted API endpoints outside the above
- Any secret keys in the frontend bundle (`VITE_*` variables are
  client-exposed by design)
- Direct browser-to-Anthropic API calls (key would be public)

**Why the clarification:** The original "no server-side code" rule was
written before the AI proxy requirement was identified. Edge Functions
and Workers are serverless and stateless — they don't violate the
static-site architecture principle, they extend it safely.
- When modifying a file that was changed in the immediately prior
  phase, read the entire file before touching anything and confirm
  all prior phase changes are still present before writing new code.
  Do not assume prior changes survived — verify from the file.

---

## Development priorities

When making decisions, prioritize in this order:

1. Correctness of financial data and calculations
2. Stability of the forecast engine and operating cash rules
3. Clarity of UI and usefulness of information
4. Simple, maintainable code
5. Polish only after the above are solid

---

## Git discipline

- `main` only for stable, deployable code
- `feature/*` branches for new work
- Single-purpose commits with clear conventional messages
- Explicit file staging — never `git add .`
- Always run `git diff --stat` and review before committing
- Suggest commit message, but never `git add` or commit without instruction

---

## Documentation commit workflow

Project documentation falls into two categories with different commit
cadences. The split exists to prevent operational truth (main branch,
Notion, shipped commits) and narrative truth (handoffs, context docs,
session logs) from drifting into separate timelines.

**Spec docs** define rules, contracts, workflows, or implementation
constraints that active work depends on. They must evolve with feature
work and stay accurate before merge.

Spec docs in this repo:
- `CLAUDE.md`
- `README.md`
- `UI_RULES.md`
- `UI_CARDS.md`
- `UI_Verification_Rules.md`
- `PROJECT_CONFIG.md`
- `TASK_PROMPT_TEMPLATE.md`
- `SESSION_CLOSE_WORKFLOW.md`
- `README_SESSION_WORKFLOWS.md`
- Token, type, and system-definition source files (e.g. `chartTokens.ts`)

The authoritative snapshot-refresh list (used by Trigger B in
`SESSION_CLOSE_WORKFLOW.md`) lives in `PROJECT_CONFIG.md`.

`CLAUDE.md` and other operational-rule docs are spec docs even when
they contain process guidance. Process rules are spec, not narrative.

**Narrative docs** record what happened and when — session history,
shipped chronology, temporary queue state, migration journals, closeout
summaries. They record work; they do not define or gate it.

Narrative docs in this repo:
- `wx_cfo_scorecard_context_v2_6.md`
- handoff documents
- session logs and closeout summaries
- migration journals

### Commit cadence

Spec docs commit on the feature branch alongside the code they
describe. They land on main at the same time as the code that depends
on them.

Narrative docs commit only on main, after the associated feature work
has merged. They do not travel on feature branches.

A session that changes both kinds of docs splits the work: the spec
changes ride with the feature branch; the narrative update lands on
main as a separate commit after merge.

### Edge cases

If feature work appears to require editing a narrative doc to proceed,
the change is not actually narrative — it is a spec change in the
wrong file. Reclassify and move it to the appropriate spec doc.

Narrative docs may reference feature branches or pre-merge work during
a live session, but they are not committed until the associated code
is merged to main.

### Why this rule exists

Without this split, four timelines drift apart: feature branch state,
narrative history, backlog state, and main branch state. The recent
Hero pill QA drift — a backlog item shown as Done in Notion but carried
forward in two handoffs as unresolved — is the failure mode this rule
prevents.

---

## Worktree and branch hygiene

Worktrees and feature branches are working state, not storage.
At session close, every worktree must end in one of three states:

1. **Merged and removed** — work shipped to main, worktree and branch deleted
2. **Abandoned and removed** — work no longer wanted, worktree and branch deleted
3. **Paused with a Notion item** — work intentionally on hold, with a tracked Notion backlog item recording: worktree name, branch name, intent, and a review-by date

No worktree may survive a session close in undecided state.
"Decide later" without a Notion item is what produces orphan worktrees.

The same applies to local branches without worktrees:
- Branches whose content has shipped (even under a different SHA via rebase or squash merge) must be deleted, not preserved as historical artifacts
- Branches with unique unmerged content must be tracked in Notion if intentionally paused, or deleted if abandoned

Verification at session close:
- `git worktree list` shows only intentional worktrees, each accounted for
- `git branch` shows only intentional branches, each accounted for
- Any backup directories under `.claude/worktree-backups/` are matched
  to a Notion item or removed

When in doubt, prefer deletion. Real work surfaces as user-facing
friction; backed-up patches age into noise.

---

## Prompt discipline (for every implementation task)

Every task must follow this sequence:

1. Read `UI_RULES.md` before any UI code. For any new UI pattern,
   also check the TailAdmin source reference section in this file
   and look up the relevant pattern before writing anything.

   For any prompt involving dashboard card design, card modification, or new card creation, also require:

   - Read `UI_CARDS.md` in the project root before writing code.

   This is in addition to the standard requirement to read `CLAUDE.md` and `UI_RULES.md`. `UI_CARDS.md` is the source of truth for dashboard card anatomy, fixed vs optional elements, TailAdmin card scale, spacing rhythm, and the CashTrendHero implementation contract.
2. Run pre-flight: `git branch`, `git status --short`, `git log --oneline -3`
3. If the target file was modified in the immediately prior phase or
   commit, read the **entire file** before touching anything and
   confirm all prior phase changes are still present. A targeted
   inspection of only the section being changed is not sufficient —
   prior fixes elsewhere in the same file must be verified intact
   before writing new code.
4. Diagnosis first — describe the problem in plain English before writing code
5. Propose fix with before/after — implement only after approval if ambiguous
6. Respect the DO NOT TOUCH file list for every task
7. Verify on running Vite dev server — prove freshness before reporting results
8. Post-task: `git diff --stat`, confirm only allowed files changed,
   suggest commit message

---

## How to start a new session

1. Read the required files listed at the top of this file
2. Confirm current branch and git status
3. Understand whether the task is bug fix, validation, or feature work
4. Ask for the task prompt or check the queued roadmap in
   `wx_cfo_scorecard_context_v2_6.md`

---

## Definition of a good next step

A good next step improves confidence or removes real friction:
- Fixing a confirmed bug or UI defect
- Implementing a queued roadmap item with a clear spec
- Validating calculation accuracy
- Tightening a workflow that causes confusion

A bad next step is broad refactoring without evidence it is needed.

---

## Key Learnings

### Operating cash and owner distributions

Operating cash excludes owner draws and capital distributions. This makes
T6M margin appear higher than a P&L that includes draws. This is intentional
— Cash Trend measures what the business produces, not what the owner takes.

### Cash Trend engine verification

Cash Trend engine verified against a 47-month backtest (Dec 2021–Mar 2026).
Hysteresis fires 3× correctly across the dataset. Status distribution matches
backtest predictions modulo operating-cash exclusions.

### Diagnostic harness date construction

`computeCashTrendForDate(rollups, new Date(y, m, 1))` — use the local-time
constructor, not an ISO string (`new Date('YYYY-MM-DD')`). ISO strings parse
as UTC midnight, which in US timezones resolves to the previous day via
`getMonth()`, shifting the analysis window one month early and producing
wrong results silently.

### Forecast model roles

Reality Forecast (= Conservative Floor) is the main/default forecast for
the product. Recovery Forecast (= Split Conservative) is an advanced
Settings-only alternate posture. Engine and Category-Cadence are
diagnostic comparators, not user-facing choices. Default Settings
posture is Reality Forecast. The Forecast page consumes the selected
posture and exposes only scenario controls (Base/Best/Worst/Custom);
no model toggle.

See "May 2, 2026 — Reality Forecast locked as main/default" in
wx_cfo_scorecard_context_v2_6.md for full context and rationale.

---

## Session close discipline

Session close behavior is governed by `SESSION_CLOSE_WORKFLOW.md`. Run
it when the user signals close (“close session,” “wrap,” “handoff,” or
similar). Do not run a close when no trigger fires.

Any session that **commits** a change to a documentation file in the
repo root must re-upload that file to the Codex/Claude project snapshot
before closing. This is Trigger B in `SESSION_CLOSE_WORKFLOW.md`.

Documentation files that must stay in sync with the Codex/Claude project:
- `CLAUDE.md`
- `UI_RULES.md`
- `UI_CARDS.md`
- `UI_Verification_Rules.md`
- `wx_cfo_scorecard_context_v2_6.md`
- `PROJECT_CONFIG.md`
- `TASK_PROMPT_TEMPLATE.md`
- `SESSION_CLOSE_WORKFLOW.md`
- `README_SESSION_WORKFLOWS.md`

Checklist before closing any session that committed a doc-file change:
□ Re-upload changed .md files to the Codex/Claude project (project → files)
□ Confirm project files match repo state
□ Do not close the session until the upload is confirmed

Why this exists: project files are snapshots, not live repo files.
Every commit that changes a doc file makes the project snapshot stale.
Stale project files cause future agents to read outdated specs and produce
wrong guidance.

---

## Snapshot drift check (line-level edits)

Before applying any line-level edit (diff, str_replace,
line-numbered patch), read the live target file. If line
numbers, surrounding prose, or target text don't match the
spec, STOP. Report the mismatch and stand by. Do not edit,
do not improvise.
