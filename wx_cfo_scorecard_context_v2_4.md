# Wx CFO Scorecard — Project State Summary
*Technical context for Claude. Start every new conversation by reading this file.*
*Last updated: April 14, 2026*

---

## What Changed Recently (April 2026)

- **Supabase introduced** as primary data layer — the app is no longer browser-local
- **Boot became network-bound** — performance is primarily dominated by payload size + latency, not compute
- **Performance investigation completed** — pagination bottleneck identified and fixed
- **Loading screen added** — branded UX layer covers boot latency with Napoleon Hill quotes
- **Trends page overhauled** — EMA smoothing, interpretation layer, signal pill, side-by-side layout
- **Known Events input layer shipped** — Add Event modal, delete with confirmation,
  separate Cash In / Cash Out fields, Status dropdown (planned/tentative/committed)
- **Chart polish completed** — gradient zero-line fix, ghost dot removal, tooltip cleanup, axis labels
- **CLAUDE.md rewritten** — reflects current architecture, required reading block added,
  locked files documented, stale browser-local references removed

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
[latest]  docs: rewrite CLAUDE.md with current architecture and required reading block
0d450e8   feat(ui): add branded loading screen for Supabase boot
8495eff   perf: PAGE_SIZE 1000 → 10000
4cd2f63   docs: max_rows config dependency
80ee1d0   chore: [BOOT] instrumentation
cce8884   docs: Supabase architecture context update
f39f059   fix(trends): axis label font override via CSS scoped rule
[prior]   Trends: refine Revenue/Expense Trend cards for clearer decision UX
[prior]   fix(what-if): thin x-axis month labels by horizon length
[prior]   feat(what-if): Known Events input layer
```

**Working tree:** clean
**Active branch:** main
**Deployment:** GitHub Pages via GitHub Actions — automatic on push to main

**Key files:**
- `src/components/LoadingScreen.tsx` — branded boot loading screen
- `src/components/CashFlowForecastModule.tsx` — forecast UI + Known Events
- `src/components/TrendLineChart.tsx` — custom SVG chart (shared)
- `src/pages/Dashboard.tsx` — data wiring, state, tab routing, boot sequence
- `src/lib/kpis/compute.ts` — forecast engine (DO NOT TOUCH)
- `src/lib/cashFlow.ts` — operating cash rules (DO NOT TOUCH)
- `src/lib/data/contract.ts` — TypeScript types (DO NOT TOUCH schema)
- `src/lib/data/sharedPersistence.ts` — Supabase fetch layer (sensitive)
- `src/lib/charts/movingAverage.ts` — EMA function
- `src/dashboard.css` — all custom styles
- `UI_RULES.md` — visual standard reference (repo root)
- `CLAUDE.md` — project rules and required reading block (repo root)
- `wx_cfo_scorecard_context_v2_4.md` — this file

---

## Data Architecture

### ⚠️ Critical shift — the app is no longer browser-local

**As of April 2026, Supabase is the primary data source.**
The old mental model ("local-first, browser storage") is no longer accurate.

| Layer | Role |
|---|---|
| **Supabase** | Primary source of truth — transactions and import batches |
| **IndexedDB** | Fallback path only (not used when Supabase is configured) |
| **localStorage** | Account settings and user preferences |

**What this means:**
- Boot time is primarily network-bound (payload size + latency), not compute-bound
- Data is shared across machines automatically via Supabase
- Each user session fetches ~4,808 rows (~4MB JSON) on boot
- The app will appear empty if Supabase is unreachable

### Supabase Project Configuration

**⚠️ HARD SYSTEM REQUIREMENT — not in repo, must be set manually:**

```
Supabase Dashboard → Settings → Data API → Max Rows → 50000
```

**Why this is critical:**
PostgREST silently truncates responses when `max_rows` is below the dataset size.
It returns HTTP 200 with partial data — no error, no warning, silent data loss.
Current dataset: 4,808 rows. Setting must remain above dataset size at all times.

**Current Supabase project:**
- Region: `us-west-2` (Oregon) — suboptimal for East Coast users, minor latency penalty
- Compute: `t4g.nano` — smallest tier, adequate for current load
- Table: `shared_imported_transactions`
- Table: `shared_import_batches`
- Table: `shared_account_settings`

### sharedPersistence.ts — How the Fetch Works

```
PAGE_SIZE = 10000
requestAllRows() loop:
  → sends Range: 0-9999 header
  → receives all 4808 rows in one response
  → loop terminates (page.length < PAGE_SIZE)
```

**Why PAGE_SIZE matters:**
- At PAGE_SIZE=1000: 5 sequential requests (~5.1s boot)
- At PAGE_SIZE=10000: 1 request (~2.9s boot)
- `max_rows` must be >= PAGE_SIZE or Supabase caps the response silently

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

**What does NOT drive boot time:**
- Pagination (fixed)
- React StrictMode (dev-only double-invoke, not a real duplicate)
- Forecast engine (1ms)

**Next performance lever if needed:**
- Replace `select=*` with explicit column list in the transaction fetch
- Every field in `SharedImportTransactionRow` is currently mapped, so column
  pruning requires auditing which fields are actually consumed downstream
- Staged loading (fetch only last 24 months on boot, lazy-load history) is
  architecturally possible but complex — deferred until boot time is unacceptable

### Loading Screen

`src/components/LoadingScreen.tsx` covers boot latency with a branded experience.
The loading screen is a UX layer to mask unavoidable network latency, not a performance optimization.
- Five soft pulsing bars (CSS-only, brand color #465FFF)
- Random Napoleon Hill quote (selected once via `useMemo`, stable through boot)
- 8-second timeout warning: "Still working… this is taking longer than usual."
- Fades out over 300ms before unmounting
- Dashboard renders only after fade completes — no stacking

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
- Page header min-height: 109px
- Primary text: #101828
- Secondary text: #667085
- Brand/action: #465FFF
- Active toggle: #FFFFFF bg, #101828 text, weight 600
- Toggle track: #F2F4F7 with 1px solid #E4E7EC border
- Success: #12B76A
- Error: #F04438
- No shadows on cards
- No gradients on backgrounds
- Area fill opacity: 0.15–0.25

**Important:** This project uses a custom CSS class system in `src/dashboard.css`.
It does NOT use Tailwind utility classes directly in JSX.

---

## Chart System — Current State

### TrendLineChart.tsx (shared SVG chart)
Custom SVG renderer used across Big Picture, What-If, and Trends pages.

Key props:
- `hideDots` — suppresses hover dots (used on Projected Cash Balance)
- `hideTrend` — suppresses moving average line
- `hideAxisLines` — suppresses X/Y axis lines
- `hideTooltip` — suppresses tooltip (used on Revenue/Expense Trend)
- `axisFontSize` — override axis label font size (default 11)
- `axisFontWeight` — override axis label font weight (default 400)
- `displayWindow` — slice last N months for display only (EMA computed on full dataset)

**Gradient rendering:**
SVG `linearGradient` uses `gradientUnits="userSpaceOnUse"` so the blue→red
fill transition lands at the actual zero line. The `zeroLineY` coordinate is
snapped to the nearest integer pixel via `Math.round()` before use as a clip
boundary.

**X-axis label behavior:**
- One label per calendar month at the last data point of that month
- Anchor month (first data point) always suppressed
- Auto-thinning by horizon: 1-6 months = every month, 7-12 = every 2,
  13-24 = every 3, 25+ = every 6. Last month always labeled.
- Format: "Apr 26" (3-letter month + 2-digit year)

### NetCashFlowChart (ApexCharts)
Used for Monthly Net Cash Flow on Big Picture.
- ApexCharts uses `gradientUnits="objectBoundingBox"` — gradient zero offset
  must be computed from actual data values (`dataMax / dataRange`), not axis bounds
- Trend series removed from tooltip to eliminate ghost second dot
- `xaxis.tooltip.enabled: false` removes empty bottom crosshair label

### Trends Page Charts
- Revenue Trend and Expense Trend use EMA (exponential moving average)
- Formula: `α = 2 / (window + 1)`, seeded with first data value
- Selector: 6-Month Trend / 12-Month Trend (default) / 24-Month Trend
- `displayWindow` prop slices display to selected window; EMA computed on full dataset
- Interpretation row: direction (Rising/Flat/Declining) + % vs prior window
  - Both values from EMA series, not raw data
  - Flat threshold: ±3% change
  - Color meaning: Revenue rising = green, Expense rising = red (business semantics)
- Hover dots and tooltip suppressed on Trend charts (direction, not point values)
- Charts displayed side by side at md breakpoint and above

---

## What-If Page — Current State

**Page structure (top to bottom):**

1. Page header block — "Cash Flow Forecast" title, scenario toggle (Base/Best/Worst)
2. Signal cards (floating) — Cash Risk Warning, Lowest Cash Point, Safety Buffer
3. Chart card — Projected Cash Balance chart, sliders, Known Events section
4. Projection Table — Month / Cash In / Out / Net / Balance

**X-axis:** Monthly labels at last data point per month, anchor month suppressed,
auto-thinning by horizon length.

**Known Events (fully shipped):**
- "Add Cash Event" button opens modal
- Modal fields: Month (dropdown), Event Title, Cash In amount, Cash Out amount,
  Status (planned / tentative / committed)
- Events apply to ALL scenarios (Option A decision — committed events are facts)
- Delete with inline confirmation: "Remove this event? [Yes] [Cancel]"
- Schema: `ForecastEvent` in `contract.ts` — DO NOT modify

**Receivables/Payables timing controls** removed from What-If, not yet added
to Settings page.

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

**Why cash-in is 30% trailing:** Trailing 6 months included weak Feb 2026
($33K) dragging baseline down. 70% historical weight produces +1.6% inflow
bias — essentially neutral.

**Why outflow is locked at 60/40:** Expenses grew ~13%/yr (2022→2025).
Projecting to 4-year average would dangerously understate expenses.

**Reconciliation:** 0.00% variance confirmed against benchmark CSV across
12 months. Engine is auditable and locked.

---

## Operating Cash Rules (LOCKED — never regress)

- Owner distributions: excluded
- Refunds: cash out
- Credit card payments (liability settlements): excluded
- True internal transfers: excluded
- All Transfer:* categories: excluded
- Loan proceeds / debt movements: excluded
- Starting cash: cash accounts only
- Supabase transactions: sole runtime source of truth
- Reconciliation: 0.00% variance confirmed

---

## Event Layer Schema

```typescript
type ForecastEvent = {
  id: string;
  month: string;           // YYYY-MM
  type: ForecastEventType;
  title: string;
  note?: string;
  status: ForecastEventStatus;  // planned | tentative | committed
  impactMode: "fixed_amount";
  cashInImpact: number;    // positive dollars
  cashOutImpact: number;   // positive dollars
  enabled: boolean;
};
```

Events apply to ALL scenarios. Formula:
```
Final forecast month = seasonal forecast + event cashInImpact - event cashOutImpact
```

---

## Business Context

- **Business:** Gracie Sports Fairfield (BJJ gym)
- **Revenue model:** Hybrid EFT recurring + PIF annual contracts
- **MRR baseline:** ~$10K/month recurring
- **Monthly expenses:** ~$38–52K (growing ~13%/yr 2022–2025)
- **Starting cash (Apr 2026):** ~$19,279
- **Cash pattern:** Lumpy, event-driven — large PIF spikes, seasonal swings
- **Key seasonal patterns:** July strongest inflow, August highest outflow,
  summer dip, December promo spike
- **Data available:** 4 complete years (2022–2025) + partial 2021 and 2026
- **Membership system:** Wodify (future integration possible, not in scope)

---

## Queued Roadmap

### Group 4 — Projection Table ← NEXT UP
Full spec designed and Codex prompt ready. Implement in next Claude Code session.

**Feature 1: Prior year actuals with year toggle pills**
- Detect available prior years dynamically from transaction data (no hardcoded years)
- New pure utility: `src/lib/kpis/priorYearActuals.ts`
  - Aggregates actuals by year and calendar month: Cash In, Cash Out, Net
  - Returns `{ years: YearActuals[], detectedYears: number[] }`
  - Excludes current forecast year from detectedYears
  - Null-safe, pure function, no side effects
- Year toggle pills in Projection Table card header, right-aligned
  - Generated dynamically from detectedYears
  - Multiple years can be active simultaneously
- Column behavior:
  - 0 years active: forecast columns only (current behavior)
  - 1 year active: actuals columns + Var % column
  - 2+ years active: actuals columns only, variance hidden
- Variance % formula: `((forecastNet - actualNet) / Math.abs(actualNet)) * 100`
  - Display "—" if actualNet === 0
  - Color-coded: positive = #12B76A, negative = #F04438
  - Format: "+6.3%" / "-4.1%", always signed

**Feature 2: CSV export**
- "Export CSV" button in card header, left-aligned
- Always exports ALL detected years + current forecast scenario
- Column order: Month, then per year [Year] Cash In / Cash Out / Net,
  then Forecast Cash In / Cash Out / Net / Balance
- No variance in CSV
- Filename: `wx-cfo-projection-[scenario]-[YYYY-MM-DD].csv`
- Plain JS Blob + anchor click, no external libraries

**Locked files for this task:**
`compute.ts`, `cashFlow.ts`, `contract.ts`, `sharedPersistence.ts`

### Phase 5.1 — Settings page
- Move Receivables/Payables Timing controls to Settings
  (removed from What-If, not yet added anywhere)

### Phase 6 — Internal QA layer
- Lightweight internal validation
- Category leakage detection
- Transfer classification checks
- Reduce reliance on external benchmark CSV

### Phase 7 — Decision UX (most important unsolved problem)
- Move from data display to decision support
- Attention states: "this month is risky"
- Risk highlights: "this dip is caused by X event"
- Action guidance: "you may need to adjust X"
- Apply Nubank philosophy to forecast surface

### Performance (deferred, not active)
- Column pruning: replace `select=*` with explicit column list
  (requires auditing all downstream consumers before touching)
- Staged loading: fetch only recent history on boot, lazy-load full history
  (architecturally complex, deferred until boot time becomes unacceptable)

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
"Reuse existing classes only. Do not modify UI_RULES.md.
Do not invent new CSS-dependent class names. No inline styles."
```

**6. Verification rule:**
```
"Before UI verification, restart the dev server from current repo state
or prove freshness with a unique new anchor visible in the UI.
If neither can be confirmed, report:
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

**Diagnosis-first pattern for visual problems:**
1. Observe and describe in plain English (no code)
2. Trace exact cause in code (no code changes)
3. Propose minimal fix with before/after (no changes)
4. Implement only after explicit approval

**Commit discipline:**
- Single-purpose commits
- Explicit file staging (never `git add .`)
- Verify before committing
- Clear conventional commit messages

---

## Known Constraints and Tradeoffs

| Constraint | Detail |
|---|---|
| Boot time | Network-bound, tied to Supabase payload size (~4MB) |
| Payload size | ~4MB JSON per boot (dominant cost driver) |
| Supabase region | us-west-2 (Oregon) — ~80-120ms latency penalty for East Coast |
| Supabase compute | t4g.nano — smallest tier, adequate now |
| max_rows dependency | Must stay >= dataset size or silent data truncation occurs |
| Dataset size | 4,808 rows as of April 2026, growing ~100 rows/month |
| No backend | Static site — no server-side code, no secrets in repo |
| GitHub Pages | Deployment via GitHub Actions — do not touch .github/workflows/ casually |
| Forecast engine | Parameters locked — do not change without re-running grid search calibration |
| Operating cash rules | Locked — do not regress transfer exclusions or classification logic |
