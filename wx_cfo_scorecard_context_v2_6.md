# Wx CFO Scorecard — Project State Summary
*Technical context for Claude. Start every new conversation by reading this file.*
*Last updated: April 18, 2026*

---

## What Changed Recently (April 18, 2026 — this session)

- **TailAdmin shell migration** — left sidebar nav, HashRouter routing, right rail removed globally
- **Mobile header rebuilt** — hamburger + centered "Wx CFO" brand + collapsible search icon
- **Mobile overflow fixed** — five root causes: grid track sizing (`minmax(0,1fr)`), flex toggle wrapping, table scroll, SVG intrinsic width
- **Settings subnav shipped** — segmented toggle (Data / Accounts / Rules), date header suppressed on `/settings`, content constrained to 880px
- **Owner Distributions chart added** — stacked bar (Actual + Annualized), interpretation signal pill, placed in Big Picture two-column section
- **CLAUDE.md updated** — TailAdmin source reference section added with lookup table
- **`priority_history` Supabase table designed** — schema locked for "Today" page V1 (not yet created in Supabase)
- **"Today" page architecture specced** — full V1 spec including signals, ranker, AI prose layer, memory, followup logic

### Previous session (April 17, 2026)
- Settings page restructured — three sections: Data / Accounts / Rules
- System Status card shipped — Healthy / Needs review / At risk
- Duplicate warning suppression toggle in Rules
- Non-cash inclusion acknowledgement per account
- `shared_workspace_settings` table created — all business rules migrated from localStorage
- CSV parser fixed — dynamic column map, `looksLikeTotalRow` scoped to fields 0 and 1
- What-If decision cards overhauled — safety card, margin sign, goal-met state
- max_rows confirmed at 10,000

---

## What This Project Is

A CFO-level financial dashboard for **Gracie Sports Fairfield**, a BJJ gym.
Built in React + Vite. Repo: `github.com:wcpeixoto/wx-cfo-scorecard.git`

Wesley is product owner and operator.
Claude Code handles implementation.
Claude.ai (this conversation type) handles architecture, diagnosis, and prompt engineering.

**One-sentence definition:**
Wx CFO Scorecard turns accounting into plain-English operating clarity for small
business owners, using CFO-style signal design and Nubank-level usability.

---

## Current Repo State

**Last known commits (most recent first):**
```
7040a99  feat(settings): subnav tabs, suppress date header, constrain content width
283e190  feat(big-picture): Owner Distributions chart card
c8a7526  fix: mobile header clean rebuild (TailAdmin structure, centered brand)
e941163  feat: shell migration — HashRouter routing, left sidebar, remove right rail
407d54c  Settings Phase 1: Data/Accounts/Rules structure, System Status card,
         duplicate suppression, non-cash acknowledgement, shared_workspace_settings migration
```

**Working tree:** clean
**Active branch:** main
**Deployment:** GitHub Pages via GitHub Actions — automatic on push to main

**Key files:**
- `src/components/LoadingScreen.tsx` — branded boot loading screen (DO NOT TOUCH)
- `src/components/CashFlowForecastModule.tsx` — forecast UI + Known Events + decision cards
- `src/components/TrendLineChart.tsx` — custom SVG chart (shared)
- `src/components/AppSidebar.tsx` — left sidebar nav (TailAdmin shell migration)
- `src/components/AppHeader.tsx` — sticky top header with search + mobile hamburger
- `src/components/OwnerDistributionsChart.tsx` — stacked bar chart, Big Picture
- `src/context/SidebarContext.tsx` — sidebar collapse/mobile state
- `src/pages/Dashboard.tsx` — data wiring, state, route rendering, boot sequence
- `src/App.tsx` — HashRouter + SidebarProvider wrapping Dashboard
- `src/lib/kpis/compute.ts` — forecast engine (DO NOT TOUCH)
- `src/lib/cashFlow.ts` — operating cash rules (DO NOT TOUCH)
- `src/lib/data/contract.ts` — TypeScript types (DO NOT TOUCH schema)
- `src/lib/data/sharedPersistence.ts` — Supabase fetch layer (sensitive)
- `src/lib/data/importedTransactions.ts` — CSV import parser
- `src/lib/charts/movingAverage.ts` — EMA function
- `src/dashboard.css` — all custom styles
- `UI_RULES.md` — visual standard reference (repo root)
- `CLAUDE.md` — project rules, TailAdmin source reference, working discipline (repo root)
- `wx_cfo_scorecard_context_v2_6.md` — this file

**Routing (HashRouter):**
```
#/           → Big Picture (index)
#/focus      → Where to Focus
#/trends     → Trends
#/forecast   → Forecast (What-If Scenarios)
#/settings   → Settings
#/ui-lab     → UI Lab (DEV only)
```
Note: `#/today` route not yet created — pending "Today" page V1 implementation.

---

## Data Architecture

### ⚠️ Critical shift — the app is no longer browser-local

**As of April 2026, Supabase is the primary data source.**
The old mental model ("local-first, browser storage") is no longer accurate.

| Layer | Role |
|---|---|
| **Supabase** | Primary source of truth — transactions, import batches, account settings, workspace settings |
| **IndexedDB** | Fallback path only (not used when Supabase is configured) |
| **localStorage** | Legacy only — no active business logic reads from localStorage |

### Source-of-Truth Split — Two Settings Tables

This distinction is critical. Do not conflate them.

| Table | Purpose | Key |
|---|---|---|
| `shared_account_settings` | Per-account configuration — type, starting balance, forecast inclusion, active flag | `discovered_account_name` |
| `shared_workspace_settings` | Workspace-wide business rules and acknowledgements — shared across all accounts and all machines | `workspace_id = 'default'` |

**`shared_account_settings` columns:**
`workspace_id`, `id`, `discovered_account_name`, `account_name`, `account_type`,
`starting_balance`, `include_in_cash_forecast`, `active`, `is_user_configured`, `updated_at`

**`shared_workspace_settings` columns:**

| Column | Type | Default | Controls |
|---|---|---|---|
| `workspace_id` | text PK | — | Always `'default'` — single workspace app |
| `target_net_margin` | numeric | 0.25 | Profit goal threshold on What-If profit card |
| `safety_reserve_method` | text | `'monthly'` | `'monthly'` or `'fixed'` — drives safety card |
| `safety_reserve_amount` | numeric | 0 | Used when method is `'fixed'` |
| `suppress_duplicate_warnings` | boolean | false | Hides duplicate bullet from System Status |
| `acknowledged_noncash_accounts` | jsonb | `'[]'` | Account IDs marked as intentionally in forecast |

**Persistence pattern:**
- Load: `getSharedWorkspaceSettings()` in `sharedPersistence.ts` — reads single row for `workspace_id = 'default'`
- Write: `saveSharedWorkspaceSettings()` — upsert on `workspace_id` conflict; never inserts a second row
- On first load: one-time migration from localStorage if values exist; then localStorage cleared permanently
- Defaults if no row exists: code-level defaults, not database defaults — safe even if table is empty

### Supabase Project Configuration

**⚠️ HARD SYSTEM REQUIREMENT — not in repo, must be set manually:**

```
Supabase Dashboard → Settings → Data API → Max Rows → 10000
```

**Confirmed value: 10,000 (not 50,000 — previous docs were incorrect).**

PostgREST silently truncates responses when `max_rows` is below `PAGE_SIZE`.
It returns HTTP 200 with partial data — no error, no warning, silent data loss.
`PAGE_SIZE = 10000` in `sharedPersistence.ts`. `max_rows` must stay >= `PAGE_SIZE`.

**Current Supabase tables:**
- `shared_imported_transactions`
- `shared_import_batches`
- `shared_account_settings`
- `shared_workspace_settings` ← added April 17, 2026
- `priority_history` ← designed April 18, 2026 — **NOT YET CREATED in Supabase**

**Current Supabase project:**
- Region: `us-west-2` (Oregon) — suboptimal for East Coast users, minor latency penalty
- Compute: `t4g.nano` — smallest tier, adequate for current load

### sharedPersistence.ts — How the Fetch Works

```
PAGE_SIZE = 10000
requestAllRows() loop:
  → sends Range: 0-9999 header
  → receives all rows in one response
  → loop terminates (page.length < PAGE_SIZE)
```

**Never reduce PAGE_SIZE without verifying max_rows ≥ PAGE_SIZE, or silent data loss will occur.**

---

## Boot Performance

### Verified baseline (April 13, 2026)

| Metric | Before fix | After fix |
|---|---|---|
| Supabase txn fetch | ~5,118ms (5 requests) | ~2,926ms (1 request) |
| Rows fetched | 4,808 | 4,808 |
| Improvement | — | ~43% faster |

**What drives boot time (in order of impact):**
1. **Payload size** — ~4MB JSON over the wire is the dominant cost
2. **Network latency** — Oregon region adds ~80-120ms per request
3. **Supabase compute** — t4g.nano, adequate but not fast
4. **React + KPI compute** — ~30ms, negligible

### Loading Screen

`src/components/LoadingScreen.tsx` covers boot latency with a branded experience.
- Five soft pulsing bars (CSS-only, brand color #465FFF)
- Random Napoleon Hill quote (selected once via `useMemo`, stable through boot)
- 8-second timeout warning: "Still working… this is taking longer than usual."
- Fades out over 300ms before unmounting
- Dashboard renders only after fade completes — no stacking

---

## Settings Page — Current State

Three-section structure: **Data / Accounts / Rules**

### Section 1 — Data
- CSV import controls
- Active dataset status
- Last import summary (transaction count, parse failures, duplicates)
- **System Status card** (top of section):
  - **Healthy** — no issues detected
  - **Needs review** — duplicates > 0 (unless suppressed) OR non-Cash account in forecast (unless acknowledged)
  - **At risk** — no active import, parse failures > 0, no cash anchor, or missing required rules
  - Status computed from existing page state only — no new data fetches

### Section 2 — Accounts
- Forecast cash foundation block
- Account setup table with all controls
- Account label logic (combined Type + In Forecast):
  - Cash + included → **"Cash anchor"**
  - Cash + excluded → **"Excluded"**
  - Non-Cash + included → **"Included in forecast ⚠"** + inline acknowledgement action
  - Non-Cash + excluded → **"Excluded"**
- Acknowledging a non-Cash account: ⚠ → ✓, removes warning from System Status
- Acknowledgement resets when forecast inclusion is toggled off and back on

### Section 3 — Rules
All five fields persist to `shared_workspace_settings`:

| Rule | Control | Field |
|---|---|---|
| Profit target | % input (default 25%) | `target_net_margin` |
| Safety reserve | Toggle: monthly / fixed amount | `safety_reserve_method` + `safety_reserve_amount` |
| Duplicate warnings | Toggle: show / suppress | `suppress_duplicate_warnings` |
| Cash flow timing | Placeholder — not yet implemented | — |
| Non-cash accounts | Per-account acknowledgement in Accounts section | `acknowledged_noncash_accounts` |

---

## CSV Import Parser — Current State

File: `src/lib/data/importedTransactions.ts`

### Dynamic column map (fixed April 17, 2026)

The parser now reads column positions from the header row, not fixed indexes.

```ts
buildColumnMap(headerCells) → ColumnMap | null
```

- Aborts with a clear error if `Date` or `Amount` are missing from the header
- All optional columns (`payee`, `category`, `transfer`, `memo`, `tags`) return empty string if absent
- No `?? N` fallback indexes anywhere — no silent field misreads on column reorder

**Known Quicken export variants:**
- Variant A (11 cols): Account, (blank), Date, Entered, Posted, Payee, Category, Transfer, Amount, Memo/Notes, Tags
- Variant B (11 cols, different order): Account, (blank), Date, Entered, Posted, Payee, Category, Tags, Transfer, Memo/Notes, Amount
- Variant C (9 cols): Account, (blank), Date, Payee, Category, Transfer, Amount, Memo/Notes, Tags

All three handled correctly by the dynamic column map.

### `looksLikeTotalRow` (fixed April 17, 2026)

Checks **only fields 0 and 1** — not all cells.

```ts
function looksLikeTotalRow(cells: string[]): boolean {
  const firstField = (cells[0] ?? '').trim();
  const secondField = (cells[1] ?? '').trim();
  return /^total\b/i.test(firstField) || /^total\b/i.test(secondField);
}
```

Previously checked all cells — caused memo text starting with "Total" (e.g. owner distribution memos) to be incorrectly skipped.

### Skip-before-parse rule

All structural skip checks (blank, Total, separator, range, header) fire before any field extraction. No row is parsed as a transaction until all skip checks pass and a valid column map has been built.

---

## What-If Decision Cards — Current State

Three cards in the `forecast-decision-grid`, in this order:

### Card 1 — Safety line
**At risk (gap > $100):**
```
To stay above your safety line
$19.3K
To reach your 1-month reserve
```

**Safe (gap ≤ $100):**
```
You're above your safety line
$199K
Across your full forecast
```

**Calculation:**
- `lowestProjectedBalance` = min balance across **full forecast** (not display window)
- `fixedSafetyLine` = `reserveTarget` from `model.runway.reserveTarget` (1 month of base-case expenses), OR `safety_reserve_amount` from settings if method is `'fixed'`
- `gap = fixedSafetyLine - lowestProjectedBalance`
- Safety line is **scenario-independent** — does not change when sliders move
- `SAFETY_GAP_FLOOR = 100` — gaps within ±$100 treated as zero

### Card 2 — Monthly result
```
At this pace, monthly result is
$1.9K/mo
That's about 5% net profit
```
- `currentProfit = average(net over DECISION_WINDOW_MONTHS forecast months)`
- `averageRevenue = average(cashIn over same months)`
- `netMargin = currentProfit / averageRevenue`
- Negative `avgNet` renders in red (#F04438) with `−` sign before `$`

### Card 3 — Profit goal
**Shortfall:**
```
To hit your profit goal you need
+$8K/mo
This gets you to $9.8K/mo at 25% net profit
```
**Goal met:**
```
Your current profit
$17K/mo
44% net profit — this is solid
```
- `TARGET_NET_MARGIN` read from `shared_workspace_settings.target_net_margin`, falls back to 0.25
- `profitGap <= 0` triggers goal-met state

**Formatting rules across all cards:**
- K/M unit suffix rendered at 75% size via `.forecast-unit` span
- `/mo` rendered at 75% size via `.forecast-mo` span
- Trailing `.0` decimal dropped: `$8K` not `$8.0K`

**Constants:**
- `DECISION_WINDOW_MONTHS = 12` — months used for profit/margin computations
- `DEFAULT_TARGET_NET_MARGIN = 0.25` — fallback when settings not yet stored
- `SAFETY_GAP_FLOOR = 100` — rounding guard
- `TIGHT_BUFFER_THRESHOLD = 5000` — threshold for "just above" safe state

---

## UI Standard

Every prompt that touches UI must start with:
```
"Before writing any UI code, read UI_RULES.md in the project root.
All visual decisions must match the values defined there."
```

**Key values from UI_RULES.md:**
- Font: Outfit
- Page background: #F9FAFB
- Card background: #FFFFFF
- Card border: 1px solid #E4E7EC
- Card radius: 16px
- Card padding: 24px
- Primary text: #101828
- Secondary text: #667085
- Brand/action: #465FFF
- Success: #12B76A
- Warning: #F79009
- Error / negative: #F04438
- No shadows on cards
- No Tailwind utilities in JSX — custom CSS class system in `src/dashboard.css`

---

## Chart System — Current State

### TrendLineChart.tsx (shared SVG chart)
Custom SVG renderer used across Big Picture, What-If, and Trends pages.

Key props: `hideDots`, `hideTrend`, `hideAxisLines`, `hideTooltip`, `axisFontSize`,
`axisFontWeight`, `displayWindow`, `showOnlyProjectedTicks`, `showMonthlyXLabels`

### NetCashFlowChart (ApexCharts)
Used for Monthly Net Cash Flow on Big Picture. Gradient zero offset computed from actual data values.

### Trends Page Charts
EMA (exponential moving average). Formula: `α = 2 / (window + 1)`, seeded with first value.
Selector: 6-Month / 12-Month (default) / 24-Month. `displayWindow` slices display; EMA computed on full dataset.

---

## Forecast Engine — Locked Parameters (DO NOT CHANGE)

```
Cash-In trailing weight:   0.30
Cash-In historical weight: 0.70
Outlier trim floor:        0.60
Cash-Out trailing weight:  0.60
Cash-Out historical weight:0.40
Year weights:              [0.40, 0.30, 0.20, 0.10]
Winsorization threshold:   0.30
Index cap min:             0.50
Index cap max:             2.00
```

Reconciliation: 0.00% variance confirmed. Engine is auditable and locked.

---

## Operating Cash Rules (LOCKED — never regress)

- Owner distributions: excluded
- Refunds: cash out
- Credit card payments (liability settlements): excluded
- True internal transfers: excluded
- All Transfer:* categories: excluded
- Loan proceeds / debt movements: excluded
- Starting cash: cash accounts only
- Reconciliation: 0.00% variance confirmed

---

## Business Context

- **Business:** Gracie Sports Fairfield (BJJ gym)
- **Revenue model:** Hybrid EFT recurring + PIF annual contracts
- **MRR baseline:** ~$10K/month recurring
- **Monthly expenses:** ~$38–52K (growing ~13%/yr 2022–2025)
- **Starting cash (Apr 2026):** ~$19,279
- **Cash pattern:** Lumpy, event-driven — large PIF spikes, seasonal swings
- **Key seasonal patterns:** July strongest inflow, August highest outflow, December promo spike
- **Data available:** 4 complete years (2022–2025) + partial 2021 and 2026
- **Dataset size:** ~4,808 transactions as of April 2026, growing ~100 rows/month

---

## Queued Roadmap

### "Today" Page — V1 (next major feature)
Full architecture spec locked April 18, 2026. See "Today Page Architecture" section below.

**Implementation sequence:**
1. `src/lib/priorities/` — signals, ranker, types, copy (rules engine, no AI)
2. `priority_history` Supabase table — create + wire read/write in sharedPersistence.ts
3. `copy.ts` — template fallback prose for all 6 signal types
4. `ai.ts` — AI prose layer (Claude API), structured input, JSON output, fallback to copy.ts
5. `TodayPage.tsx` + `HeroPriorityCard.tsx` + `CoreConstraints.tsx` — UI
6. Routing — `#/today` as new landing, `#/big-picture` for Big Picture, nav update

### TailAdmin Migration — In Progress
Shell migration complete. Remaining pages:
- Where to Focus — desktop width fix (content too wide after right rail removal)
- Big Picture — TailAdmin card migration
- What-If / Forecast — TailAdmin card migration
- Trends — TailAdmin card migration

### Settings — Phase 5.1
- Move Receivables/Payables Timing controls from What-If to Settings Rules section

### Phase 6 — Internal QA layer
- Lightweight internal validation
- Category leakage detection
- Transfer classification checks

### Global Language Pass (deferred — after full TailAdmin migration)
- What-If → Forecast rename
- Settings → Data & Setup rename
- Full copy review

### Performance (deferred)
- Column pruning already done (select=* replaced with txn-only fetch)
- Staged loading: fetch only recent history on boot, lazy-load full history (only if egress constraint returns)

---

## "Today" Page — V1 Architecture

**Product philosophy:** Three layers in order of value:
- Layer 1 — Financial truth (deterministic rules)
- Layer 2 — Decision clarity (one hero priority)
- Layer 3 — Behavior change (followup loop)

**Page name:** "Today" — the new landing page at `#/today`
**AI provider:** Claude (Sonnet) for V1. ChatGPT to be tested for V2 dialogue layer.
**V2 dialogue deferred:** three-button interaction, commitment capture, trade-off conservation rule

### File structure (to be created)
```
src/lib/priorities/
  types.ts     ← shared TypeScript types
  signals.ts   ← detect + evaluate each signal
  rank.ts      ← score and select hero + secondary
  copy.ts      ← template fallback prose per signal type
  ai.ts        ← Claude API prose layer, falls back to copy.ts

src/components/
  TodayPage.tsx           ← page shell + layout
  HeroPriorityCard.tsx    ← hero card, AI prose, severity
  SecondaryPriority.tsx   ← compact supporting card
  CoreConstraints.tsx     ← reserve + forward cash always-on
```

### 6 signals (V1)
| Signal | Type | Severity | Weight |
|---|---|---|---|
| Operating reserve below floor | `reserve_critical` / `reserve_warning` | critical / warning | 1.0 / 0.7 |
| Forward cash flow negative | `cash_flow_negative` / `cash_flow_tight` | critical / warning | 0.9 / 0.6 |
| Expense surge (single category >25% above 3mo avg, >$500) | `expense_surge` | critical / warning | 0.7 |
| Revenue decline (trailing 3mo vs prior 3mo, >15% / >5%) | `revenue_decline` | critical / warning | 0.7 / 0.4 |
| Owner distributions above pace (annualized >120% of prior avg) | `owner_distributions_high` | warning | 0.5 |
| No urgent signals | `steady_state` | healthy | 0 |

### Ranker — priority ladder (not score formula)
```
1. reserve_critical
2. cash_flow_negative
3. reserve_warning
4. cash_flow_tight
5. expense_surge
6. revenue_decline
7. owner_distributions_high
→ steady_state if nothing fires
```
Hero = top of ladder. Secondary = next 0–2.

### AI prose layer
**Input:** structured Signal object + optional prior history row
**Output:** JSON with keys: `headline`, `why`, `currentState`, `action`, `alternative`, `followupNote`
**Fallback:** `copy.ts` template strings if API call fails — page never breaks

**Tone calibration in system prompt:**
- healthy → calm, warm, forward-looking
- warning → focused, direct, supportive
- critical → emotionally present, stakes-aware, never accusatory
- repeat signal (metric worsened) → acknowledge difficulty, Robbins-style emotional engagement, open question

### `priority_history` Supabase table (NOT YET CREATED)
```sql
create table priority_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  fired_at timestamptz not null default now(),
  signal_type text not null,
  severity text not null,
  metric_value numeric,
  target_value numeric,
  category_flagged text,
  gap_amount numeric,
  recommended_action text,
  ai_headline text,
  committed_action text,     -- V2: populated when owner responds
  outcome_metric numeric,    -- populated on next fire of same signal
  resolved_at timestamptz    -- populated when signal stops firing
);
```
~50–100 rows/year. Free tier forever. Upsert pattern: same signal type within 7 days updates existing row rather than creating new one.

### V2 — Trade-off Conservation Rule (deferred)
When owner rejects primary action in dialogue layer:
- `gap_amount` is fixed — cannot be negotiated down
- AI must present alternatives totaling >= `gap_amount`
- Partial solutions acknowledged but conversation stays open until full gap is addressed
- "Partial solution rule": if owner offers partial fix, AI surfaces remaining gap immediately

### Routing change
```
#/today      → Today (new landing page, index)
#/           → redirects to #/today
#/big-picture → Big Picture (moved from index)
#/focus      → Where to Focus (unchanged)
#/trends     → Trends (unchanged)
#/forecast   → Forecast (unchanged)
#/settings   → Settings (unchanged)
#/ui-lab     → UI Lab (DEV only, unchanged)
```

---

## Prompt Discipline Rules

Every Claude Code prompt must include:

**1. UI rule (first line):**
```
"Before writing any UI code, read UI_RULES.md in the project root.
All visual decisions must match the values defined there."
```

**2. Pre-flight:**
```
git branch --show-current
git status --short
git log --oneline -3
```

**3. Dirty tree rule:**
```
"Stop only if TARGET files have unrelated uncommitted changes.
If other files are dirty, report them but continue."
```

**4. Explicit DO NOT touch list**

**5. Styling constraint:**
```
"Do not use Tailwind utilities in JSX. Use existing CSS class patterns from src/dashboard.css."
```

**6. Verification rule:**
```
"If runtime freshness cannot be confirmed, report:
Verification provisional — runtime freshness unconfirmed."
```

**7. Post-task discipline:**
```
git diff --stat
Confirm only allowed files changed
Suggest commit message only — never git add, never commit
```

**Model selection:**
- Sonnet 4.6: implementation tasks with clear specs
- Opus 4.6: architectural decisions, ambiguous diagnosis, multi-layer reasoning

---

## Known Constraints and Tradeoffs

| Constraint | Detail |
|---|---|
| Boot time | Network-bound, tied to Supabase payload size (~4MB) |
| max_rows | Must stay >= 10,000 (= PAGE_SIZE) or silent data truncation occurs |
| Dataset size | ~4,808 rows as of April 2026, growing ~100 rows/month |
| Supabase region | us-west-2 (Oregon) — ~80-120ms latency penalty for East Coast |
| Supabase compute | t4g.nano — smallest tier, adequate now |
| No backend | Static site — no server-side code, no secrets in repo |
| GitHub Pages | Deployment via GitHub Actions — do not touch .github/workflows/ casually |
| Forecast engine | Parameters locked — do not change without re-running grid search calibration |
| Operating cash rules | Locked — do not regress transfer exclusions or classification logic |
| businessRules localStorage | Legacy only — all reads/writes now go through shared_workspace_settings |
| Claude API key | Required for Today page AI prose layer — must be in env vars, never in repo |
| AI cost | ~$0.006–0.010 per AI call (1500 tokens in / 500 out). Design for prompt caching from day one — same data inputs = cached = 90% cheaper |
