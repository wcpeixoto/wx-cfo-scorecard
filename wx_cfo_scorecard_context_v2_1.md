# Wx CFO Scorecard — Project State Summary
*Technical context for Claude. Start every new conversation by reading this file.*
*Last updated: April 8, 2026*
## Current Status

The data plumbing is done. The engine is verified. The next phase is forecast 
intelligence — events, renewals, and decision UX — on top of a trusted foundation.

Phase 5 (manual event layer) is committed. Phase 5.1 (renewal engine) is next.

---

## What This Project Is

A CFO-level financial dashboard for **Gracie Sports Fairfield**, a BJJ gym. Built in React + TailAdmin. Repo: `wx-cfo-scorecard` at `github.com:wcpeixoto/wx-cfo-scorecard.git`.

Wesley is product owner and operator. Claude Code / Codex handles implementation. This conversation handles architecture, diagnosis, and prompt engineering.

**One-sentence definition:**
Wx CFO Scorecard turns accounting into plain-English operating clarity for small business owners, using CFO-style signal design and Nubank-level usability.

---

## Current Repo State

**Commit history (most recent first):**
```
8b45b8f  feat: add manual event layer with seed events (Phase 5)
0e687a3  chore: add operating-cash benchmark CSV for reconciliation
d761f8b  feat: add seasonal forecast engine and calibration
007fa59  fix: exclude transfer-coded rows from forecast cash rollups
90a4cbe  refactor: remove Google Sheets fallback from runtime data source
```

**Working tree:** clean  
**Active branch:** main  
**Deployment:** GitHub Pages via GitHub Actions — automatic on push to main

**Key file locations:**
- `src/lib/kpis/compute.ts` — forecast engine, seasonal index, baseline calc, event layer
- `src/lib/data/contract.ts` — all TypeScript types including ForecastEvent
- `src/lib/cashFlow.ts` — operating-cash classification rules
- `src/pages/Dashboard.tsx` — data wiring, state, event list, source precedence
- `src/components/CashFlowForecastModule.tsx` — forecast UI module
- `src/dashboard.css` — dashboard styles
- `data/category_summary_no_transfers.csv` — operating-cash benchmark (QA reference only)

---

## What Is DONE (Locked and Verified)

### Data layer
- Single source of truth: imported Quicken transactions
- Google Sheets fallback fully removed (`90a4cbe`)
- No runtime ambiguity about which dataset the engine reads
- **Shared persistence via Supabase** (April 1, 2026 — `11aeb9f`): transactions are now stored remotely, consistent across devices and sessions; replaces prior IndexedDB-only persistence model

### Boot sequence (post-Supabase)
```
1. Fetch transactions + batches from Supabase
2. Hydrate local React state
3. Compute KPIs, trends, and forecasts
```
Performance note: initial load is network-dependent. Boot profiling (`[BOOT]` logs in dev) shows the Supabase fetch accounts for ~85–95% of total startup time.

### Supabase Project Configuration (NOT in repo)

- `max_rows` is set to **50000** (Supabase default: 1000)

Reason:
- Required to allow full transaction history to be fetched in a single request
- If `max_rows` is lower than dataset size, PostgREST silently truncates responses (HTTP 200 with partial data — no error raised)
- The pagination loop in `sharedPersistence.ts → requestAllRows()` relies on this setting to avoid data loss

**WARNING:** Lowering `max_rows` below dataset size causes silent data corruption — missing rows with no error, no warning, and no visible failure in the UI. Set via Supabase Dashboard → Settings → API → Max Rows.

### Operating cash classification (locked rules — never regress)
Defined in `src/lib/cashFlow.ts`:

| Rule | Status |
|---|---|
| Owner distributions | Excluded |
| Refunds | Cash out |
| Credit card payments (liability settlements) | Excluded |
| True internal transfers | Excluded |
| All Transfer:* categories | Excluded |
| Loan proceeds / debt movements | Excluded |
| Starting cash | Cash accounts only |
| Imported transactions | Sole runtime source of truth |

### Reconciliation
- Engine vs benchmark: 0.00% variance across 12 months
- Engine is auditable and trustworthy
- Benchmark file at `data/category_summary_no_transfers.csv` is the QA reference (not the engine input)

### Forecast engine foundation
Pipeline in `src/lib/kpis/compute.ts`:
```
baseline → seasonal index → scenario adjustments → event layer
```

### Event layer (Phase 5 — just committed)
- `ForecastEvent` schema in `contract.ts`
- Three seed events hardcoded in Dashboard state
- Events applied after seasonal + scenario logic
- Compact "Known Events" UI section in forecast module
- `impactMode: "fixed_amount"` included for forward compatibility

### Repo discipline
- Clean commit history with single-purpose commits
- No stale branches
- Backup folder (`wx-cfo-scorecard-backup-20260331-1952`) identified as deletable

---

## What Is STARTED But Not Finished

### Scenario layer — partially built
- Framework exists in the engine
- UI controls for Base / Best / Worst exist
- Missing: clean operator-readable scenario impact, clear separation of scenario vs baseline in UI

### Baseline calibration — correct but not explainable
- Calibration is directionally correct (see locked parameters below)
- Missing: visibility into "why this baseline" for the operator
- The owner cannot currently see what assumptions are driving the forecast magnitude

### Forecast UX — still developer view
- Numbers are correct
- Not yet decision-first or operator-simple
- Nubank philosophy not yet applied to the forecast surface
- Does not yet answer "what should I do?" — only "what are the numbers?"

---

## What Is NOT Built Yet

### Phase 5.1 — Renewal engine
- No contract-driven event generation
- No membership lifecycle awareness (renewals, churn risk by cohort)
- Design principle: renewal events are system-generated, feed into same event layer as manual events
- Do NOT mix renewal logic with manual event logic

### Phase 6 — Internal QA layer
- Currently relies on external benchmark CSV for validation
- Missing: internal sanity checks inside the app
- Examples needed: category leakage detection, unexpected transfer classification alerts, reconciliation self-checks

### Phase 7 — Decision UX (the real CFO layer)
This is the most important missing piece for product value:
- Move from "data display" to "decision support"
- Add attention states: "this month is risky", "this dip is caused by X event"
- Add action guidance: "you may need to adjust X"
- Apply Nubank philosophy to the forecast surface

---

## Forecast Engine — Locked Parameters

Derived from grid search against 4 years of actual data. Do not change without re-running calibration.

| Parameter | Value | Notes |
|---|---|---|
| Cash-In trailing weight | 0.30 | 30% recent, 70% historical |
| Cash-In historical weight | 0.70 | Auto = 1 - trailing |
| Outlier trim floor | 0.60 | Months below 60% of trailing median → replaced with median |
| Cash-Out trailing weight | 0.60 | LOCKED — outflow bias ~-0.5% |
| Cash-Out historical weight | 0.40 | Auto |
| Year weights | [0.40, 0.30, 0.20, 0.10] | Most recent → oldest |
| Winsorization threshold | 0.30 | Ratios >30% from month median clipped before weighting |
| Index cap min | 0.50 | |
| Index cap max | 2.00 | |

**Why cash-in is 30% trailing:** Trailing 6 months included a weak February 2026 ($33K) dragging baseline down. 70% historical weight produces +1.6% inflow bias — essentially neutral.

**Why outflow is locked at 60/40:** Outflow bias of ~+4-5% vs 4-year average is intentional. Expenses grew ~13%/yr (2022: $38K → 2025: $52K/mo). Projecting to 4-year average would understate expenses dangerously.

### Seasonal index construction
- Minimum 2 complete years to activate seasonal mode
- Current dataset: 4 complete years (2022–2025) → strong confidence, 40/30/20/10 weighting
- Separate indices for cashIn and cashOut (never net cash directly)
- Partial years (2021, 2026) excluded from index, retained for baseline
- Complete year = 12 consecutive months of transaction data
- Divergence warning threshold: 25% (3+ years), 20% (2 years)

---

## Event Layer Schema (Phase 5)

```typescript
type ForecastEventType =
  | "renewal" | "promotion" | "seasonal_override" | "one_time_revenue"
  | "one_time_expense" | "churn_risk" | "staffing_change" | "rent_change"
  | "tax_payment" | "debt_payment" | "other";

type ForecastEventStatus = "planned" | "tentative" | "committed";
type ForecastEventImpactMode = "fixed_amount"; // extend to "percent_of_baseline" in 5.1

type ForecastEvent = {
  id: string;
  month: string;           // YYYY-MM
  type: ForecastEventType;
  title: string;
  note?: string;
  status: ForecastEventStatus;
  impactMode: ForecastEventImpactMode;
  cashInImpact: number;    // positive dollars
  cashOutImpact: number;   // positive dollars
  enabled: boolean;
};
```

**Core formula:**
```
Final forecast month = seasonal forecast month + event cashIn - event cashOut
```

**Current seed events:**
1. Summer churn pressure — August, cashInImpact: -6000, status: planned
2. Black Friday promo — November, cashInImpact: 12000, cashOutImpact: 1500, status: tentative
3. Annual tax payment — January, cashOutImpact: 7000, status: committed

---

## Business Context

- **Business:** Gracie Sports Fairfield (BJJ gym)
- **Revenue model:** Hybrid — EFT recurring members + Paid-in-Full (PIF) annual contracts
- **MRR baseline:** ~$10K/month recurring
- **Monthly expenses:** ~$38–52K (growing ~13%/yr 2022–2025)
- **Starting cash (Apr 2026):** ~$19,279
- **Cash pattern:** Lumpy, event-driven — large PIF spikes, seasonal swings
- **Key seasonal patterns:** July strongest inflow, August highest outflow, summer dip, December promo spike
- **Data available:** 4 complete years (2022–2025) + partial 2021 and 2026

---

## Execution Roadmap

### Now — Phase 5.1 (Renewal Engine)
- Generate ForecastEvent objects from membership contract data
- Feed into same event pipeline as manual events
- Do NOT redesign the event layer — extend it
- Key distinction: manual events are authored, renewal events are system-generated

### Next — Phase 6 (Internal QA Layer)
- Lightweight internal validation (category leakage detection, transfer classification checks)
- Reduce reliance on external benchmark CSV
- Self-healing trust system

### After — Phase 7 (Decision UX)
- This is the product's most important unsolved problem
- Move from "data display" to "decision support"
- Attention states, risk highlights, action guidance
- Apply Nubank philosophy to the forecast surface
- This is where the product becomes genuinely useful vs just technically correct

---

## Codex Prompt Discipline

**Always include:**
- Pre-flight checks (pwd, git branch, git status, HEAD)
- Explicit "Do NOT" rules before implementation spec
- Exact file paths to inspect
- Precise output format (numbered sections, pass/fail surfaces)
- Post-task discipline (working tree state, commit readiness, suggested message)
- Mindset instruction at end to prevent over-engineering

**Never use `git add .`** — always explicit file list

**Model selection:**
- Sonnet 4.6: implementation tasks with clear specs (most prompts)
- Opus 4.6: architectural decisions, ambiguous diagnostics, multi-layer reasoning
- Opus 4.6 1M: when full codebase context needed simultaneously

**Commit discipline:**
- Single-purpose commits
- Explicit file staging (never `git add .`)
- Diff review before staging
- Clear conventional commit messages

---

## Stack

- React + TypeScript (frontend)
- Styling: Custom CSS (`dashboard.css`) following TailAdmin design tokens — does NOT use Tailwind utility classes
- Charts: ApexCharts + custom SVG (`TrendLineChart`)
- Vite (build)
- GitHub Pages (deployment via GitHub Actions)
- Quicken (accounting source — CSV export, transfers excluded)
- **Backend: Supabase** (shared persistence layer — primary source of truth, added April 1, 2026)
- Data storage: Supabase (primary), IndexedDB (fallback path only, used when Supabase is not configured), localStorage (settings)
- No custom server-side code; no secrets in repo (credentials in `.env.local` + GitHub Secrets)
