# Wx CFO Scorecard — Project State Summary
*Technical context for Claude. Start every new conversation by reading this file.*
*Last updated: April 17, 2026*

---

## What Changed Recently (April 2026 — this session)

- **Settings page restructured** — three sections: Data / Accounts / Rules
- **System Status card shipped** — Healthy / Needs review / At risk, computed from existing state
- **Duplicate warning suppression** — toggle in Rules; suppressed duplicates no longer trigger Needs review
- **Non-cash inclusion acknowledgement** — per-account inline action; acknowledged accounts no longer trigger warning
- **`shared_workspace_settings` table created** — all business rules migrated from localStorage to Supabase
- **CSV parser fixed** — dynamic column map from header row; `looksLikeTotalRow` scoped to fields 0 and 1 only
- **What-If decision cards overhauled** — safety card calculation fixed, profit card margin sign fixed, goal-met state unblocked
- **max_rows confirmed at 10,000** — context doc previously said 50,000; actual value is 10,000 (matches PAGE_SIZE)

---

## What This Project Is

A CFO-level financial dashboard for **Gracie Sports Fairfield**, a BJJ gym.
Built in React + Vite. Repo: `github.com:wcpeixoto/wx-cfo-scorecard.git`

Wesley is product owner and operator.
Claude Code / Codex handles implementation.
Claude.ai (this conversation type) handles architecture, diagnosis, and prompt engineering.

**One-sentence definition:**
Wx CFO Scorecard turns accounting into plain-English operating clarity for small
business owners, using CFO-style signal design and Nubank-level usability.

---

## Current Repo State

**Last known commits (most recent first):**
```
407d54c  Settings Phase 1: Data/Accounts/Rules structure, System Status card,
         duplicate suppression, non-cash acknowledgement, shared_workspace_settings migration
e602617  Settings Phase 1: restructure into Data / Accounts / Rules, add configurable
         profit target and safety reserve, fix anchor label logic, replace warning block
         with inline indicator
61deaa9  Fix CSV import parser: dynamic column map, hard abort on missing required
         columns, fix looksLikeTotalRow to check fields 0 and 1 only
5c4acdf  fix(what-if): safety card copy, unit sizing, negative color, and decimal trimming
d3d9036  refactor(what-if): overhaul decision cards — safety, profit margin, and card order
```

**Working tree:** clean
**Active branch:** main
**Deployment:** GitHub Pages via GitHub Actions — automatic on push to main

**Key files:**
- `src/components/LoadingScreen.tsx` — branded boot loading screen (DO NOT TOUCH)
- `src/components/CashFlowForecastModule.tsx` — forecast UI + Known Events + decision cards
- `src/components/TrendLineChart.tsx` — custom SVG chart (shared)
- `src/pages/Dashboard.tsx` — data wiring, state, tab routing, boot sequence, Settings page
- `src/lib/kpis/compute.ts` — forecast engine (DO NOT TOUCH)
- `src/lib/cashFlow.ts` — operating cash rules (DO NOT TOUCH)
- `src/lib/data/contract.ts` — TypeScript types (DO NOT TOUCH schema)
- `src/lib/data/sharedPersistence.ts` — Supabase fetch layer (sensitive)
- `src/lib/data/importedTransactions.ts` — CSV import parser
- `src/lib/charts/movingAverage.ts` — EMA function
- `src/dashboard.css` — all custom styles
- `UI_RULES.md` — visual standard reference (repo root)
- `CLAUDE.md` — project rules and required reading block (repo root)
- `wx_cfo_scorecard_context_v2_5.md` — this file

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
- `shared_workspace_settings` ← new as of April 17, 2026

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

### Settings — Phase 5.1
- Move Receivables/Payables Timing controls to Settings
  (sliders exist on What-If page but belong in Settings Rules section)
- Migrate all remaining businessRules fields to `shared_workspace_settings`
  (profit target and safety reserve are currently still in localStorage — migrate with same pattern)

### Phase 6 — Internal QA layer
- Lightweight internal validation
- Category leakage detection
- Transfer classification checks

### Phase 7 — Decision UX
- Move from data display to decision support
- Attention states, risk highlights, action guidance
- Apply Nubank philosophy to forecast surface

### Performance (deferred)
- Column pruning: replace `select=*` with explicit column list
- Staged loading: fetch only recent history on boot, lazy-load full history

---

## Prompt Discipline Rules

Every Codex prompt must include:

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
