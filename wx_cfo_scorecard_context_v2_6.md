# Wx CFO Scorecard — Project State Summary
*Technical context for Claude. Start every new conversation by reading this file.*
*Last updated: April 28, 2026*

---

## What Changed Recently (April 28, 2026 — this session)

### Cash Trend card — visual redesign + inline-stat variant shipped

**Commits (in order):**
```
25a0b9d  style(cash-trend): TailAdmin Pattern B visual redesign
cec2ca5  style(tooltip): global blue-tinted tooltip system + Cash Trend ⓘ migration and copy
2a8bf38  style(tooltip): change ⓘ cursor to pointer on both tooltip triggers
dd8ee23  style(cash-trend): polish TailAdmin card anatomy
57225d1  feat(cash-trend): inline-stat card variant + Big Picture 1/3 layout
1824b79  fix(cash-trend): unify margin vocabulary across variants
465a980  chore(cash-trend): remove stale margin vocabulary comment
6dc00ed  docs: add Universal CFO Signal Card System (UI_CARDS.md)
fddf900  docs: add BACKLOG.md — snapshot of Notion backlog as of 2026-04-28
```

### Cash Trend — inline-stat variant (`negativeMonthsAsSubtitle` prop)

`CashTrendHero` now accepts a `negativeMonthsAsSubtitle?: boolean` prop that activates a narrow-width variant:

| Concern | Default variant | Inline-stat variant |
|---|---|---|
| Subtitle | "Last 6 complete months" | "N of the last 6 months were negative" |
| ⓘ icon position | header-right, beside badge | inline next to title |
| Mini-stat block | visible | hidden |
| Interpretation color | `var(--cth-accent)` | `#344054` neutral |
| Interpretation top margin | `16px` | `32px` |
| CSS modifier | — | `.cth-card--inline-stat` |

**Big Picture page:** uses inline-stat variant at 1/3 width via `.cash-trend-row` grid (`minmax(0,1fr) / minmax(0,2fr)`), paired with `CashTrendPlaceholder` at 2/3. Collapses to single column at ≤767px.

**UI Lab page:** Section 13 — three-col grid (`ui-lab-three-col-grid`) shows default + inline-stat + placeholder side by side for reference.

### Margin vocabulary unified

Secondary metric line: both variants now render **"6-month cumulative profit margin"** (was: default used "6-month cash margin"). "Cash margin" and "profit margin" are different concepts to a small business owner — canonical phrase is locked as "cumulative profit margin."

No "cash margin" user-facing string remains in `src/`. One CSS comment updated to match.

### UI_CARDS.md — new card design source of truth

`UI_CARDS.md` added to repo root. Contains:
- Universal CFO Signal Card anatomy (fixed vs optional elements)
- TailAdmin card typography scale
- Spacing rhythm rules
- Full CashTrendHero implementation contract (both variants, dark mode, empty state, formatting rules)

**Required reading for all card work.** `CLAUDE.md` updated to mandate reading `UI_CARDS.md` for any card design, modification, or new card creation. `UI_RULES.md` updated with cross-link section at top.

### Tooltip system — global blue-tinted system established

All card tooltips now use `.db-tooltip-wrap` / `.db-tooltip-btn` / `.db-tooltip-panel` with `.is-wide` modifier. Global system — do not redefine tooltip styling per card.

### CSS layout additions

`.cash-trend-row` — `1fr / 2fr` grid for Cash Trend + placeholder on Big Picture.
`.ui-lab-three-col-grid` — equal 3-column grid for UI Lab comparison mocks.
`.cth-title-row` — flex row for inline title + ⓘ in narrow variant.

---

## What Changed Recently (April 27, 2026 — this session)

### Big Picture signal layer — major restructure

**Commits (in order):**
```
d69fc02  feat(efficiency): drill-down drawer — static mock locked
79448cd  feat(efficiency): drill-down wired to real data
761fda0  fix(efficiency): month label fix
c680075  fix(efficiency): donut tooltip polish
bb136de  feat(registry): add Insurance, Training & Education, Events & Community to fixed bucket
3ec2c04  feat(dig-here): compute engine + Dashboard wiring + component rewrite
658c0b2  chore(ui): rename What Needs Attention to Cost Spikes to Investigate
31330e2  feat(cash-trend): hero card — T6M margin, status hysteresis, velocity, Big Picture wiring
32627e2  fix: cash trend font regression — revert to Outfit
08ff398  docs: UI_RULES — CSS architecture clarity, font correction, chartTokens pattern
46e1ccf  docs: add wx-design-system and TailAdmin canonical source references to CLAUDE.md
ba2c678  feat(cash-trend): drop target+gap, drop 6-bar chart, add status interpretation line
8b22985  feat(big-picture): remove Trajectory card with noisy momentum signals
```

### Efficiency Opportunities — drill-down drawer shipped
The drill-down modal (full buy/month breakdown, mobile-responsive) shipped earlier in this session. The Efficiency Opportunities V1 is now complete. V2 (credible-best logic) is queued in P2.

### Cost Spikes to Investigate (formerly What Needs Attention)
Renamed to reflect the card's actual scope. This card is a **category-variance detector only** — it is NOT a macro health signal. Do not bolt macro logic into it. Macro health is Cash Trend's job.

### Cash Trend card — fully shipped and simplified
New card on Big Picture. Compute engine verified against 47-month backtest.

**Final spec (locked):**
- 4-state model: Building / Treading Water / Under Pressure / Burning Cash
- Thresholds: Building ≥10% margin AND neg months ≤2 · Burning ≤-1.5% AND neg ≥3 · Pressure between -1.5% and +5% AND neg ≥3 · Treading: everything else
- Hysteresis: stateless two-window comparison, 1.5pp buffer, no persistence layer
- No target/gap language — conflicts with 25% target in `shared_workspace_settings`
- No 6-bar chart — duplicates Monthly Net Cash Flow one card below
- Interpretation strings (locked — do not change without re-running backtest):
  - `building` → "Strong cash generation across the last 6 months."
  - `treading` → "Cash is positive, but there is little room for error."
  - `pressure` → "Cash is positive, but the margin cannot absorb a bad month."
  - `burning` → "Cash is going out faster than it comes in."
- `velocityTag` stays in result type — internal/diagnostic only, not rendered
- `monthlyBars` stays in result type — unrendered, not removed to avoid type migration
- Operating cash excludes owner draws — T6M margin appears higher than a P&L that includes draws. Intentional.
- Diagnostic harness: `computeCashTrendForDate(rollups, new Date(y, m, 1))` — always local-time constructor, never ISO string

### Trajectory card — killed
All three signals removed from Big Picture:
- **Last Month YoY**: dead. Single-month YoY is noise on a business with monthly variance.
- **Momentum (Last 3 Months)**: dead. Math is broken — T3M/prior T3M produces explosive percentages when denominator is small or negative. Backtested: max +4,433%, 49% of months extreme, 36% contradicted Cash Trend.
- **Annual Performance (T12M YoY)**: mathematically sound. Removed from Big Picture. Queued for Trends page (P2).
- Orphaned infrastructure: Trajectory compute file + `model.trajectorySignals` + debug harness references in Dashboard.tsx intentionally orphaned. Do not delete until Annual Performance card is built on Trends.

### CSS architecture clarified
- No Tailwind utilities in JSX. Custom CSS class system in `src/dashboard.css` only.
- Tailwind references in UI_RULES.md are descriptive shorthand, not literal class strings.
- Font: Outfit everywhere. Inter is not loaded. Do not use Inter.
- All ApexCharts instances must set `fontFamily: 'Outfit, sans-serif'`.
- All ApexCharts hex values must come from `src/lib/ui/chartTokens.ts` (not yet created — see P2).

### Backlog moved to Notion
The project backlog now lives in Notion:
**URL:** https://www.notion.so/084420fff00444de9413a542db3dddf0
Properties: Name, Status (Now/Next/Later/Done), Priority (P1–P5), Why.
At the end of any session where items change, update Notion directly via MCP — do not maintain a duplicate inline roadmap here.

---

## What Changed Recently (April 21, 2026)

### Efficiency Opportunities card — V1 shipped to Big Picture

Replaced the "Money Left on the Table" card on Big Picture with a new
Efficiency Opportunities card that benchmarks each cost category against
its own best-ever 3-month stretch in the last 24 months.

**Commits:**
```
84131c2  feat(ui-lab): refine bar colors, typography, column labels
2948710  feat(ui-lab): finalize bar design — two-part green/red, soft colors, 130px track
f940c88  docs: UI_RULES.md — add Efficiency Opportunities card component spec
3716420  feat(ui-lab): wire Efficiency Opportunities card to computed data
7bfbbbb  feat(big-picture): replace Money Left card with Efficiency Opportunities
e4ba5b1  feat(efficiency): add suppression list for non-actionable categories
```

**Architecture:**
New file: `src/lib/kpis/efficiencyOpportunities.ts`
- Pure computation function, no React, no side effects
- Signature: `computeEfficiencyOpportunities(model: DashboardModel, txns: Txn[]): EfficiencyOpportunitiesResult`
- Anchored to `model.monthlyRollups` last entry to resolve latestMonth
- Scans `filteredTxns` over a 24-month lookback window
- Builds category-by-month spend map + month-level revenue map
- Enumerates valid consecutive 3-month windows (revenue > 0, all months present)
- Groups by `parentCategoryName`

**Exclusion chain (applied in this order):**
1. `shouldExcludeFromProfitability(txn)` — transfers, loans, uncategorized
2. `isBusinessIncomeCategory(txn.category)` — revenue rows
3. `isCapitalDistributionCategory(txn.category)` — owner draws
4. `SUPPRESSED_CATEGORIES.has(parentCategoryName)` — non-actionable fixed categories

**Suppression list:**
```ts
const SUPPRESSED_CATEGORIES = new Set<string>([
  'Rent or Lease',
  'Depreciation',
  'Amortization',
  'Taxes and Licenses',
  'Interest Paid',
  'Loan',
]);
```
Insurance intentionally not suppressed. Refunds & Allowances intentionally not suppressed.

V1 "best" definition: Absolute lowest 3-month average ratio. No credible-best logic yet (V2 queued).

**Result shape:**
```ts
interface EfficiencyOpportunitiesResult {
  windowLabel: string;
  totalExtraPerMonth: number;
  rows: EfficiencyRow[];  // top 4 by extraPerMonth
}
```

---

## Earlier sessions (April 20, 2026)
- Settings mobile overflow fixed (Accounts + Rules) — CSS-only
- Settings page mobile overflow (tab toggle) fixed — 2d06313
- Today page V1 fully shipped — all phases through 4.17b and Phase 5 routing
- Phase 5 routing — Today is landing page (#/), Big Picture at #/big-picture

## Earlier sessions (April 18, 2026)
- TailAdmin shell migration, mobile header rebuilt, Settings subnav shipped
- Owner Distributions chart added to Big Picture
- priority_history Supabase table designed (not yet created in Supabase)

## April 17, 2026
- Settings page restructured — three sections: Data / Accounts / Rules
- System Status card shipped
- shared_workspace_settings table created
- CSV parser fixed — dynamic column map
- What-If decision cards overhauled
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
8b22985  feat(big-picture): remove Trajectory card with noisy momentum signals
ba2c678  feat(cash-trend): drop target+gap, drop 6-bar chart, add status interpretation line
46e1ccf  docs: add wx-design-system and TailAdmin canonical source references to CLAUDE.md
08ff398  docs: UI_RULES — CSS architecture clarity, font correction, chartTokens pattern
32627e2  fix: cash trend font regression — revert to Outfit
31330e2  feat(cash-trend): hero card — T6M margin, status hysteresis, velocity, Big Picture wiring
658c0b2  chore(ui): rename What Needs Attention to Cost Spikes to Investigate
```

**Working tree:** clean (stray .rtf untracked — leave alone)
**Active branch:** main
**Last updated:** April 27, 2026
**Today page V1:** SHIPPED
**Phase 5 routing:** SHIPPED — Today is landing page, Big Picture at /big-picture
**Deployment:** GitHub Pages via GitHub Actions — automatic on push to main

**Key files:**
- `src/components/LoadingScreen.tsx` — branded boot loading screen (DO NOT TOUCH)
- `src/components/CashFlowForecastModule.tsx` — forecast UI + Known Events + decision cards
- `src/components/TrendLineChart.tsx` — custom SVG chart (shared)
- `src/components/AppSidebar.tsx` — left sidebar nav (TailAdmin shell migration)
- `src/components/AppHeader.tsx` — sticky top header with search + mobile hamburger
- `src/components/OwnerDistributionsChart.tsx` — stacked bar chart, Big Picture
- `src/components/TodayPage.tsx` — landing page, owns all signal detection and data derivation
- `src/components/HeroPriorityCard.tsx` — hero decision card, async AI prose swap
- `src/components/SecondaryPriority.tsx` — compact supporting signal cards
- `src/components/CoreConstraints.tsx` — always-on reserve + forward cash strip (Today only)
- `src/components/CashTrendHero.tsx` — Cash Trend card, Big Picture (compute locked in cashTrend.ts)
- `src/components/EfficiencyOpportunitiesCard.tsx` — Efficiency Opportunities, Big Picture
- `src/lib/kpis/cashTrend.ts` — Cash Trend compute engine (LOCKED)
- `src/lib/kpis/efficiencyOpportunities.ts` — Efficiency Opportunities compute
- `src/lib/kpis/digHere.ts` — Cost Spikes to Investigate compute
- `src/lib/data/categoryRegistry.ts` — single source of truth for category classification
- `src/lib/priorities/types.ts` — Signal, RankedPriorities, PriorityHistoryRow types
- `src/lib/priorities/signals.ts` — detectSignals(model, txns)
- `src/lib/priorities/rank.ts` — rankPriorities(signals)
- `src/lib/priorities/copy.ts` — getFallbackCopy(signal, priorHistory?)
- `src/lib/priorities/ai.ts` — getAIProse stub (callAIProvider throws by design)
- `src/lib/priorities/coreConstraints.ts` — getCoreConstraints(model)
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
#/              → Today (landing page)
#/today         → Today (alias, backward compatible)
#/big-picture   → Big Picture
#/focus         → Where to Focus
#/trends        → Trends
#/forecast      → Forecast (What-If Scenarios)
#/settings      → Settings
#/ui-lab        → UI Lab (DEV only)
```

---

## Backlog

The active backlog lives in Notion — do not maintain a duplicate here.
**URL:** https://www.notion.so/084420fff00444de9413a542db3dddf0

At the end of any session where backlog items change status, new items are confirmed,
or decisions are locked, update Notion directly via the Notion MCP connector.
Do not rewrite this section.

**Sync rules:**
- Update Notion records directly via MCP (status, priority, Why field)
- Only sync items that actually changed
- When a decision locks a constraint, capture it in the Why field of the relevant item
- Do not update Big Picture layout review to Done until Cash Trend redesign and placeholder card decision are both explicitly closed

**What triggers a sync:**
- An item changes status
- A new item is confirmed and ready for tracking
- A decision is locked that changes the Why or sequencing of an existing item
- A lower-priority item is promoted due to real blocking friction

**What does not trigger a sync:**
- Conversations about the backlog without a decision
- Speculative or exploratory items not yet confirmed
- Analysis or design reviews still in progress

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

### Supabase growth warning

Current dataset: ~4,843 transactions (as of April 2026).
Current PAGE_SIZE: 10,000. Current max_rows: 10,000.

**When the dataset approaches ~9,000 rows, the pagination refactor becomes
mandatory.** The current implementation assumes rows fit within a single
page fetch and will silently truncate beyond max_rows — returning HTTP 200
with partial data and no error signal.

Action required before crossing 9,000 rows:
- Raise max_rows in Supabase dashboard settings
- Refactor pagination loop to use `Content-Range` headers or
  `Prefer: count=exact` rather than row-count-based termination
- Add a visible warning in the UI when row count exceeds 80% of PAGE_SIZE

This is a time-bomb failure mode — everything appears correct until it isn't.

---

## Time Window Rules (Critical)

These rules prevent silent math inconsistencies across cards and charts.
Violations in this area produce numbers that look correct but aren't.

- All year-based charts and tooltips use **calendar year** (Jan 1 – Dec 31)
- All badges and headline metrics tied to a chart must use the **same time
  window** as that chart — no mixing within a single card
- Trailing 12-month metrics must be explicitly labeled "Trailing 12 months"
  wherever they appear in UI copy or tooltips
- Mixing time windows in the same card is not allowed unless each metric
  is explicitly labeled with its basis

**Why this exists:** The Owner Distributions badge used trailing 12 months
while the chart used calendar years — producing a silent mismatch that
required a targeted fix. This class of bug will recur on revenue, expenses,
and runway metrics without this rule.

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

## Today Page V1 — Shipped April 19–20, 2026

Phase 1  b919f99  Rules engine (types, signals, rank, copy)
Phase 2  98ce3e3  Persistence layer (priority_history Supabase table)
Phase 3  8934e24  AI prose adapter (callAIProvider stub, fallback wiring)
Phase 4  1ee27c5  UI shell, routing, CoreConstraints
Phase 4.5        Decision card layout, context integration, copy tightening
Phase 4.6        Badge alignment, pill position, context label cleanup
Phase 4.7        Signal-specific hero pill labels
Phase 4.8        Custom dark tooltip for Owner Distributions
Phase 4.9  9719d97  Distribution target badge (revenue × profit target)
Phase 4.10 6a49871  Compare in Forecast navigation handoff
Phase 4.10b       Distribution target subtitle + projection year contract
Phase 4.10c       Subtitle format polish ($118k, parentheses)
Phase 4.10d       Header reorg + Big Picture cleanup (reserve + distributions removed)
Phase 4.10e       Layout revert (action below chart, legend left)
Phase 4.11        compareYear deep link — scroll, year pill, 12-month horizon
Phase 4.11b       Year injection fix + re-trigger fix (value-based ref)
Phase 4.11c       Validation fix (range check replaces detectedYears)
Phase 4.12 c0d56f5  Badge percentage display (↓ N% of target)
Phase 4.13 45bc154  Tooltip standardization to TailAdmin pattern
Phase 4.13b        Tooltip marker — solid fill via background-color: currentColor
Phase 4.14/4.15 d9fb73b  Multi-series tooltip + crosshair barWidth + bar bottom flatten
Phase 4.16        Reserve badge simplified (✓ On track / ↓ Getting tight / ↓ Below reserve)
Phase 4.16b       Arrow added to reserve badge labels
Phase 4.17a       Disable states.hover filter on Owner Distributions bars
Phase 4.17b b736ea1  Hide crosshair column hover background (opacity 0)
Phase 5    d4cd2fe  Today is landing page, Big Picture at /big-picture

Docs:
61c66a3  UI_RULES.md — tooltip spec, marker behavior, crosshair rules, custom tooltip exception
5013b9b  CLAUDE.md — full-file inspection rule + new component entries

### Architecture changes (Today page)
- OperatingReserveCard.tsx extracted from Dashboard.tsx inline block — now standalone
- OwnerDistributionsChart.tsx custom tooltip exception documented
- Operating Reserve and Owner Distributions removed from Big Picture — live on Today only
- priority_history Supabase table created — signal fire history, ai_headline cache, outcome tracking

### AI Determinism Rule

For identical inputs (same signal type + same underlying metric values),
AI prose output must be:

- **Cached and reused** — do not make a new API call if a recent
  `priority_history` row exists with a valid `ai_headline` for the
  same signal type and severity
- **Semantically consistent** — tone and meaning must not drift across
  identical states; the owner should not see meaningfully different
  messages for the same financial situation on different days

**Why this exists:** Without caching, the same reserve warning at 55% funded
could produce noticeably different prose on Monday vs Thursday — eroding
trust in the system. Consistency is a trust signal, not just a cost control.

Implementation note: the cache read path (check `priority_history` before
calling `callAIProvider`) was deferred in Phase 3 and is queued as a P2
item. This rule defines the behavior it must implement.

### AI prose rollback path

When `callAIProvider` is activated (proxy is live), the fallback system
must remain fully functional at all times. `getFallbackCopy()` in `copy.ts`
is the safety net — it must never be degraded or removed.

If AI prose quality degrades or API costs spike unexpectedly, the rollback
is: set `callAIProvider` to throw (as it does today). No other code changes
required. The Today page returns to deterministic fallback copy immediately.

This rollback must always be a one-function change. Do not architect the
AI layer in a way that makes fallback require broader refactoring.

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

---

## Locked Files — Do Not Modify Without Explicit Instruction

- `src/lib/kpis/compute.ts`
- `src/lib/cashFlow.ts`
- `src/lib/data/contract.ts`
- `src/lib/data/sharedPersistence.ts`
- `src/components/LoadingScreen.tsx`
- `src/components/OperatingReserveCard.tsx`
- `src/components/OwnerDistributionsChart.tsx`
- `src/lib/priorities/types.ts`
- `src/lib/priorities/signals.ts`
- `src/lib/priorities/rank.ts`
- `src/lib/priorities/copy.ts`
- `src/lib/priorities/ai.ts`
- `src/lib/priorities/coreConstraints.ts`
- `.github/workflows/`
