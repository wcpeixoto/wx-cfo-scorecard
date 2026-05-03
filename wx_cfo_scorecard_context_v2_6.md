# Wx CFO Scorecard — Project State Summary
*Technical context for Claude. Start every new conversation by reading this file.*
*Last updated: May 3, 2026*

---

### May 3, 2026 — Sub-phase 2c.2 shipped (Today posture-awareness)

Today consumers (`detectSignals`, `getCoreConstraints`) previously read
`model.cashFlowForecastSeries` (Engine 36-month baseline), causing
Today to diverge from the Forecast page after sub-phase 2c.1.

**Architectural decision: consumer-prop threading, not compute-layer posture.**

Path A (thread `forecastPosture` into `computeDashboardModel`) was
rejected after read-only diagnosis. It would have required modifying
two locked files (`compute.ts` and `contract.ts` — `DashboardModel.cashFlowForecastSeries`
is typed `CashFlowForecastPoint[]`, posture composers return `ScenarioPoint[]`).
It would also have coupled a UI/Settings preference to the pure-math
computation layer.

Path B was implemented: pass `scenarioProjection` (already computed in
`Dashboard.tsx` before `<TodayPage>` renders) down as a required prop.

**Required-prop enforcement, no Engine fallback.** `detectSignals` and
`getCoreConstraints` now require `forecastProjection: ScenarioPoint[]`.
There is no fallback to `model.cashFlowForecastSeries`. Compile-time
guarantee that Today cannot silently regress to Engine baseline.

**Commit:**

| Hash | Subject |
|---|---|
| `ef088be` | feat(today): route Today forward-cash signals through forecastPosture |

**Files changed (4, no locked files):**
- `src/lib/priorities/signals.ts` — required `forecastProjection` param
- `src/lib/priorities/coreConstraints.ts` — required `forecastProjection` param (defensive; function is currently dead code, exported but never imported)
- `src/components/TodayPage.tsx` — required `forecastProjection` prop, threaded to `detectSignals`
- `src/pages/Dashboard.tsx` — pass `scenarioProjection` to `<TodayPage>`

**`CoreConstraints.tsx` component was not touched** — it is dead code (defined, never rendered). Updating only the upstream function preserves a posture-correct path for future wiring.

**Verified live (production, commit `ef088be`):**
- Reality posture: Today "Cash floor" card = $15K; Forecast 1Y trough Apr 2027 = $14,693 traced from $20,115 cash-on-hand → match
- Recovery posture: Today "Cash floor" card = $17K; Forecast trough Jun 2026 = $17,191 traced from $20,115 → match
- Reality → Recovery → Reality reversible cycle: $15K → $17K → $15K
- No console errors related to forecast posture path
- Bundle hash `index-DaP_wuE1.js` confirmed live

**Key learnings:**

- `model.cashFlowForecastSeries` produces 36 months (Engine baseline);
  posture composers cap at 12 months. The two series have different
  types (`CashFlowForecastPoint` vs `ScenarioPoint`) but both expose
  `.netCashFlow`. `ScenarioPoint` has no `status` field — all points
  are projected by definition, so the `.filter(e => e.status === 'projected')`
  step is dropped at consumer sites.
- `getCoreConstraints` and `CoreConstraints.tsx` are dead code today.
  They were defined as part of Today V1 scaffolding but never wired in.
  Defensive update during 2c.2 ensures future wiring is posture-correct
  by default.
- Required-prop enforcement is the right discipline for posture: optional
  fallback would have kept the Engine-baseline divergence alive as a
  "just in case" path. Compile-time enforcement is the guarantee that
  the bug we just fixed cannot silently return.
- Posture toggle is a UI/Settings concern. Keeping posture out of
  `compute.ts` preserves the abstraction boundary: pure math vs user
  preference.

**What's next:**

- Future audit: check any new forecast-dependent surfaces for posture
  consistency when they are added.
- Known Events + AR/AP carry policy for composed forecasts (Reality and
  Recovery) — unresolved; deferred policy phase.
- Long-horizon UX boundary on Forecast page — communicate the 12-month
  confidence boundary when users select 2y/3y horizons.

---

## What Changed Recently (May 1, 2026)

### Forecast Backtest Harness (Phases 1–2 complete)

Permanent diagnostic harness in `scripts/backtest/`. Walks the locked
forecast engine through 15 historical as-of dates (Jan 2025 – Mar 2026)
and measures forecast quality against a truth series built from the
same operating-cash rules in `src/lib/cashFlow.ts`.

Three comparators run alongside the engine on every harness run:
- naive YoY (same-month-last-year)
- T12M-average (flat trailing-12-month delta)
- category-cadence (per-category cadence-aware projection)

The locked `backtest-results/baseline.json` captures canonical
aggregate metrics: directionalAccuracy 42.8%, mape90 18.4%,
safetyLineHitRate 100%, worstSingleMonthMiss $30,817. Four hard-fail
regression thresholds protect those numbers from silent drift on
future engine changes.

CLI flags: `--update-baseline` writes a fresh baseline; `--allow-regression`
suppresses non-zero exit on threshold breaches. Exit codes: 0 pass /
1 regression / 2 missing baseline.

Harness fixture: 4,851-transaction snapshot stored as JSONL at
`backtest-results/fixtures/transactions-snapshot.jsonl`. Historical
operating-cash anchors for 2022-01-01 / 2023-01-01 / 2024-01-01 /
2025-01-01 in `backtest-results/fixtures/historical-anchors.json`
let the harness reconstruct absolute starting balances at every
as-of date so level-dependent metrics are reliable.

Run with: `npx tsx scripts/backtest/runBacktest.ts`.

### Engine override seam (commit `7b7d0e5`)

`src/lib/kpis/compute.ts` gained an optional `EngineParameterOverrides`
argument on `projectScenario`. When undefined (the default for every
production caller), behavior is byte-for-byte identical to before.
Used only by `scripts/backtest/parameterSweep.ts` for diagnostic
parameter sensitivity analysis. Production behavior is unchanged.

### Diagnostic finding: locked engine loses to baselines

Per-as-of wins/losses on worstSingleMonthMiss across the 15 as-of dates:
- Engine vs naive YoY: 3/12 (engine loses 12 of 15)
- Engine vs T12M-average: 1/14
- Engine vs category-cadence: 7/8 after the Sales-rule swap in `4a97cbd`
  (was 6/9 under the previous trailing-12 Sales rule)

The parameter sweep (23 variants across all nine locked engine
parameters) showed no single tweak closes the gap. The architecture is
the issue, not the parameter values.

### Category-cadence forecast comparator (production-promoted)

`src/lib/kpis/categoryCadence.ts` exports two functions:
- `categoryCadenceForecast(asOfDate, txns, anchors)` — pure function,
  used by the harness.
- `projectCategoryCadenceScenario(model, input, txns, startingCashBalance, events)`
  — production-facing adapter that mirrors `projectScenario`'s output
  shape (`ForecastProjectionResult`) so call sites can swap function
  names with one extra argument (txns, the 3rd required arg).

Each operating-cash category projects on its own cadence:
- **STABLE** (Payroll, Rent, Utilities, Cleaning, Software Subscriptions,
  Marketing, Office Expenses, Repairs and Maintenance, Bank Service
  Charges, Merchant Fees) → trailing 3-month average.
- **PERIODIC** (Taxes and Licenses, Insurance, Legal/Accounting/Prof
  Services, Training & Education, Events & Community, Misc. Expense)
  → same-month-last-year.
- **EVENT** (COGS, Customer Refunds, Depreciation, Interest Paid)
  → same-month-last-year.

Special case: `Business Income:Sales` now uses a 50/50 component-wise
blend of trailing-12 run-rate and 2-year YoY average (`4a97cbd`). The
previous trailing-12-only rule had a flatness problem: it projected
May=Jun=Jul and erased all monthly shape, including the consistent July
strength visible in 2022–2025 Sales history. The 50/50 rule keeps
non-flat summer shape and July strength visible without overcommitting
to pure same-month-last-year or pure 2-yr-YoY volatility.

Sales-rule decision notes:
- Refresh source: Quicken CSV exports through 2026-05-08. `Business
  Income:Sales` matched exactly across No Transfers, Transfers inside
  the report, and Transfers outside the report; transfer handling does
  not affect Sales totals.
- Refreshed April 2026 Sales closed at $39,329, replacing the stale
  frozen-fixture MTD value of $22,991 through 2026-04-21.
- Production verification for as-of 2026-05-01 matched the diagnostic
  exactly: May $37,300 / Jun $35,445 / Jul $44,195.
- `worstSingleMonthMiss` is not decisive for this Sales-specific rule;
  treat it as one signal alongside operator-facing shape, historical
  seasonality, and trust/volatility.
- Sales projection lookups are cutoff-safe: both trailing-12 and
  2-yr-YoY components query months strictly before `startMonth`.
  This is a Sales-scoped statement only. `classifyCategories(txns)`
  still runs over the full transaction array; future-dated rows could
  influence statistical fallback classification for non-hard-coded
  categories, which remains a separate audit item.

Hybrid classification: hard-coded core list with full-string overrides
for split-cadence parents (e.g. `Business Income:Sales` = EVENT,
`Business Income:Other Income` = STABLE), plus a statistical fallback
(months-active ratio + CV) for unanticipated categories.

### Stage 3: production toggle on What-If page

`src/pages/Dashboard.tsx` gained a segmented toggle in the What-If
header (Engine / Category-Cadence). Engine remains the default;
category-cadence is opt-in.

State is component-local React `useState` only — no localStorage, no
Supabase, no URL param, no context. Session-only by design: the toggle
resets to Engine on every full page reload.

Single call-site swap. The forecast-page `projectScenario` call is the
only conditional invocation; the engine path is untouched. Downstream
consumers (chart, decision cards, reserve gauge) consume only
`ForecastProjectionResult.points` and `.seasonality` and need no
changes — both functions return the same type.

### Forecast architecture status

- Engine: still locked, still default in production.
- Category-cadence: production-visible, opt-in, NOT default.
- Known Events overlay: not started; remains in backlog.
- The forecast model toggle is the safety valve — Engine is always
  one click away.

### Commits (May 1, 2026, in order)

```
fb31ef4  feat(backtest): Phase 1 forecast backtest harness with optional anchors
de36b70  docs(backtest): correct fixture refresh procedure
3271b97  refactor(backtest): JSONL fixture format, drop CSV translation layer
d295b27  chore(backtest): commit transactions snapshot fixture (4,851 rows)
8367cc8  chore(backtest): commit historical anchors for level-dependent metrics
2d6314b  feat(backtest): Phase 2 — baseline tracking, regression check, naive comparison
61526dd  chore(backtest): lock canonical baseline metrics (Phase 2 follow-up)
7b7d0e5  chore(forecast): add diagnostic-safe parameter override seam to engine
f18480e  refactor(backtest): extract harness loop into pure callable runner
a48ea76  diag(backtest): add parameter sensitivity sweep over engine overrides
28e3f46  feat(backtest): add category-cadence comparator (data layer)
0727411  feat(backtest): apply trailing-12 rule to Sales in category-cadence comparator
2198620  feat(backtest): display category-cadence comparator in harness output
0a79843  refactor(forecast): promote category-cadence comparator to src/lib/kpis/
2baaac9  feat(forecast): add Stage 2 production adapter for category-cadence
0cb00f2  feat(forecast): wire category-cadence into What-If as opt-in toggle
4a97cbd  fix(forecast): blend Sales seasonality with trailing run-rate
```

(`de36b70` was a docs-only correction inserted between Phase 1 and the
JSONL refactor. The other 15 are the substantive commits.)

---

### May 2, 2026 — Forecast model selection + two correctness fixes

**Production commits:**
- `30ad734` fix(forecast): apply scenario sliders to Category-Cadence projection
  (Revenue Growth and Expense Change sliders were silently inert on Cadence view)

**Model selection settled via backtesting:**

Split Conservative (Engine cash-in + Cadence cash-out) is the leading
primary forecast candidate.

| Horizon | Split Conservative abs net error | Read |
|---|---:|---|
| 30d | $7,885 | Best model; beats Cadence and Engine |
| 90d | $6,872 | Effectively tied with Cadence ($6,782) and h50/50 ($6,758); best signed bias (+$84) |
| 1y | $9,840 | Best model; beats Cadence by 37%, Engine by 62% |

Mechanism: Engine under-projects expenses (aggregate baseline
under-weights recent expense growth); Cadence over-projects revenue
at 30d (Sales 50/50 lifts cash-in vs Engine's seasonal baseline).
Split Conservative uses the stronger side of each: Engine for
cash-in (more conservative), Cadence for cash-out (more accurate).

Two guardrails (not base model tuning problems):
1. Federal Tax: exclude old S-corp/C-corp history from training.
   Treat future tax as known/planned events (Stage 5 overlay).
2. Promo/event calendar: Black Friday etc = known events, not
   base-model signals.

Caveat: n=5 windows, 1y partially realized. Out-of-sample
re-validation as more realized months close is needed before
production commitment.

Next step: read-only inspection of Split Conservative implementation
scope — can cash-in and cash-out be composed from two models cleanly?

### May 2, 2026 — Native Split Conservative validation after Cadence component exposure

Commit `721b254` exposed native Cadence `operatingCashIn` /
`operatingCashOut` on `ScenarioPoint`. Native validation re-ran the
Split Conservative comparison using production wrapper outputs
instead of the prior per-category diagnostic proxy.

**Ranking unchanged:**

| Horizon | Native winner | Split Conservative |
|---|---|---|
| 30d | Split Conservative | abs net error $7,823 — leads |
| 90d | h50_50 (by $123 abs error) | +$101 signed bias — best of any model |
| 1y | Split Conservative | abs net error $9,728 — leads |

**Old proxy artifact:** `Refunds & Allowances` at as-of 2025-05-01.
Production wrapper uses `classifyCategories(allTxns)` → PERIODIC.
Diagnostic used per-category `classifyCategories(catTxns)` → STABLE
(activeRatio inflated to 100% by execution pattern). Production
classification is the more defensible one. Total impact: $559 over
12 months at a single as-of date (<0.15% of projected cashOut).
Removing 2025-05-01 from aggregates does not change any winner;
1y Split Conservative abs error actually improves to $4,149.

**Conclusion preserved:** Split Conservative leads 30d and 1y; 90d
within noise of h50_50 with best signed bias. Native production
wrapper outputs are now the correct basis for Phase 2.

**Phase 2 cleared** — implement as third selectable model alongside
Engine and Cadence, not as default flip. Persistence not required
for initial ship (session-only, matching current toggle pattern).

**Diagnostic disposition:** `splitConservativeDiagnostic.ts` retained
untracked under `Temp/`. Known limitation: per-category
`classifyCategories(catTxns)` execution pattern artificially inflates
`activeRatio` to 100%. Do not use as ground truth for component-level
Cadence values going forward — use production wrapper outputs.

### May 2, 2026 — Phase 2 Split Conservative selectable model shipped

Commit `24e0717` added Split Conservative as a third selectable model
on the What-If forecast page. The model toggle now offers:
Engine / Split Conservative / Category-Cadence.

Engine remains the default and the toggle remains session-only. No
localStorage, Supabase, URL parameter, routing, or Today-page wiring was
added. Engine and Category-Cadence remain selectable comparators.

Implementation shape:
- `src/lib/kpis/splitConservative.ts` exports
  `composeSplitConservative(engine, cadence, startingCashBalance)`.
- Composition is month-aligned and pure: Engine `operatingCashIn` +
  Cadence `operatingCashOut`, then recompute net and rolling balance.
- Split Conservative intentionally excludes Known Events in Phase 2 by
  passing `[]` to both component projections.
- No AR/AP carry is applied in the merge; `cashIn` equals
  `operatingCashIn` and `cashOut` equals `operatingCashOut`.
- Engine seasonality metadata is inherited for now. Carry, events, and
  seasonality policy remain Phase 3 decisions.

Verification reported clean before ship:
- `npx tsc --noEmit` clean
- `npm run build` green
- Backtest regression passed with locked metrics unchanged:
  directionalAccuracy 42.8%, mape90 18.4%, safetyLineHitRate 100%,
  worstSingleMonthMiss $30,817
- Composition correctness validated for as-of 2026-02-01 across 12
  months

### May 2, 2026 — Conservative Floor diagnostic reframes product direction

After Phase 2, a current/as-of forecast check showed Split Conservative
is not always the lowest-net forecast. Split Conservative combines
Engine cash-in with Cadence cash-out; when Engine cash-out is higher
than Cadence cash-out, Split can be less conservative than Engine.

This resolved the apparent contradiction between the retrospective
backtest and the current forecast:
- Retrospective tests ask which model would have been closest to later
  realized outcomes across historical as-of dates.
- Current/as-of forecasts ask which model gives the lowest projected net
  from today.
- Split Conservative remains a strong best-estimate candidate, but it is
  not a guaranteed conservative planning floor.

Diagnostic model introduced for analysis only:
`Conservative Floor = min(Engine cash-in, Cadence cash-in) −
max(Engine cash-out, Cadence cash-out)`.

Retrospective diagnostic, Federal Tax excluded from projection/truth:

| Horizon | Engine abs err | Cadence abs err | Split abs err | h50_50 abs err | Floor abs err | Best abs accuracy | Most conservative |
|---|---:|---:|---:|---:|---:|---|---|
| 30d | $12,493 | $8,625 | $7,823 | $8,892 | $8,238 | Split | Floor |
| 90d | $11,740 | $6,800 | $6,890 | $6,767 | $6,512 | Floor | Floor |
| 1y | $26,199 | $15,527 | $9,728 | $18,750 | $6,686 | Floor | Floor |

Floor signed bias:
- 30d: +$4,409, under-projected 2/5 windows
- 90d: -$3,386, under-projected 3/5 windows
- 1y: -$4,291, under-projected 4/5 windows

Current forecast diagnostic, full fixture / production-like basis
(fixture through 2026-04-21, first forecast month 2026-05):

| Horizon | Model | Cash In | Cash Out | Net Change |
|---|---|---:|---:|---:|
| 30d | Engine | $35,924 | $31,685 | $4,239 |
| 30d | Cadence | $36,620 | $34,730 | $1,890 |
| 30d | Split | $35,924 | $34,730 | $1,194 |
| 30d | h50_50 | $36,272 | $33,207 | $3,064 |
| 30d | Floor | $35,924 | $34,730 | $1,194 |
| 90d | Engine | $117,923 | $105,252 | $12,671 |
| 90d | Cadence | $114,898 | $102,044 | $12,855 |
| 90d | Split | $117,923 | $102,044 | $15,880 |
| 90d | h50_50 | $116,411 | $103,648 | $12,763 |
| 90d | Floor | $111,067 | $109,809 | $1,257 |
| 1y | Engine | $465,056 | $435,941 | $29,115 |
| 1y | Cadence | $467,236 | $422,023 | $45,213 |
| 1y | Split | $465,056 | $422,023 | $43,033 |
| 1y | h50_50 | $466,146 | $428,982 | $37,164 |
| 1y | Floor | $449,411 | $454,833 | -$5,422 |

Product framing locked from this diagnostic:

| Role | Model | Read |
|---|---|---|
| Expected / best-estimate operating forecast | Split Conservative | Best 30d accuracy, strong 90d signed bias, reasonable 1y calibration |
| Downside / stress planning floor | Conservative Floor | Best 90d/1y retrospective absolute error, but pessimistic by construction and under-projects 1y net in 4/5 windows |
| Conservative comparator | Engine | Current 90d/1y net is lower than Split; legacy safety benchmark |
| Full-model comparator | Category-Cadence | Best expense model and important comparator |

Implications:
- Do not promote Split Conservative as "the conservative forecast."
- Do not choose a single primary model yet.
- Product direction becomes a two-model forecast concept:
  Expected Case = Split Conservative; Downside Case = Conservative Floor.
- Engine and Category-Cadence remain comparators.
- Phase 3 policy decisions (carry, Known Events, seasonality metadata)
  now apply to both composed models: Split Conservative and Conservative
  Floor.
- Conservative Floor is not implemented in production yet. It remains a
  diagnostic/proposed downside view until explicitly built.

### May 2, 2026 — Current horizon diagnostic: Expected vs Downside across 30d–3y

Read-only diagnostic at `Temp/currentHorizonDiagnostic.ts`. Computes
Expected Case (Split Conservative) and Downside Case (Conservative Floor)
directly from production wrapper outputs (`projectScenario` +
`projectCategoryCadenceScenario`). No production code introduced.

Basis: full fixture (4,851 rows). Latest closed month: `2026-04`.
First forecast month: `2026-05`.

**Cadence horizon caveat for 2y/3y:** Category-Cadence is capped at 12
months in production (`HORIZON_MONTHS = 12` in `categoryCadence.ts`).
For 2y (24 months) and 3y (36 months), the diagnostic extrapolates
Cadence by repeating the period-12 pattern from months 1–12. STABLE
categories repeat exactly (trailing-3 average is constant). PERIODIC/EVENT
and Sales components in months 13+ look up prior-year months that fall
outside the current training data, so the Sales cash-in contribution
drops to 0 in those months. This makes the Conservative Floor at 2y/3y
extra-pessimistic on cash-in. Treat 2y/3y as directional only, not
calibrated.

**Cumulative net change by horizon:**

| Horizon | Months | Expected (Split) | Downside (Floor) | Difference | Product read |
|---|---:|---:|---:|---:|---|
| 30d | 1 | +$1,194 | +$1,194 | $0 | Identical — Engine is both lower-in and higher-out for May |
| 60d | 2 | −$2,924 | −$2,924 | $0 | Identical — same pattern holds for June |
| 90d | 3 | +$15,880 | +$1,257 | $14,623 | First material divergence — July flips Engine to higher-in/higher-out |
| 6m | 6 | +$20,969 | −$4,051 | $25,021 | Floor crosses below zero |
| 1y | 12 | +$43,033 | −$5,422 | $48,455 | **Main planning signal** — Expected strongly positive, Downside negative |
| 2y* | 24 | +$86,066 | −$10,844 | $96,910 | Directional only — Cadence extrapolated; Floor extra-pessimistic on cash-in |
| 3y* | 36 | +$129,099 | −$16,266 | $145,365 | Directional only — same caveat as 2y |

`*` = Cadence months 13–36 are period-12 extrapolations, not native model
output. Sales cash-in falls to 0 in those months by construction.

**Compact text chart (cumulative net, $K):**

```
                  Expected (Split Conservative)            Downside (Conservative Floor)
                  ──────────────────────────────────────  ──────────────────────────────────────
30d   (1mo)    $1K  ▏                                $1K  ▏
60d   (2mo)   -$3K  ▏                               -$3K  ▏
90d   (3mo)   $16K  ████▏                            $1K  ▏
6m    (6mo)   $21K  █████▏                          -$4K  ▏
1y   (12mo)   $43K  ███████████▏                    -$5K  ▏
2y*  (24mo)   $86K  ██████████████████████▏        -$11K  ▎
3y*  (36mo)  $129K  █████████████████████████████▏ -$16K  ▍
                  ──────────────────────────────────────  ──────────────────────────────────────
                  (1 block ≈ $4K, positive only)         (small negative — magnitude shown above)
```

The visual gap is what matters: Expected fans out positive while Downside
hugs the zero line and turns negative from 6m onward. The 1y row is the
operational planning signal.

**Notes captured:**
- 30d and 60d: Expected and Downside are mathematically identical when
  Engine is simultaneously the lower cash-in model and the higher cash-out
  model. This holds for May and June 2026.
- 90d: first material divergence ($14.6K). Driven primarily by July, where
  Engine flips to higher-cash-in *and* higher-cash-out, so Floor takes
  Cadence cash-in (lower) and Engine cash-out (higher) — doubly conservative.
- 1y: Expected +$43K vs Downside −$5K. This is the main planning signal
  and the horizon at which the two-view framing earns its keep.
- 2y/3y: lower-confidence, directional only. Cadence is extrapolated beyond
  its validated 12-month horizon; the Floor is over-pessimistic on cash-in
  in years 2 and 3 because Sales lookback misses.
- Forecast posture (Expected vs Downside) belongs in **Settings**, not as a
  permanent toggle on the Forecast page. The two views answer different
  questions for the operator and switching between them mid-analysis adds
  cognitive load without analytical value.
- Default posture should be **Downside / Cautious**. Expected is an
  optional, user-selected posture surfaced in Settings.
- Temporary Forecast-page testing exposure (e.g., a dev-only toggle or
  query param) is acceptable during build-out but must not become
  permanent product UX.

### May 2, 2026 — Drafted implementation plan (NOT EXECUTED)

The following plan is captured for reference. **No production code has
been written. No defaults have changed. No Settings UI exists yet.**
Each phase requires explicit go-ahead before implementation begins.

**Phase A — Conservative Floor production helper (pure function only)**

Add `src/lib/kpis/conservativeFloor.ts`, mirroring the shape of
`splitConservative.ts`:

```ts
export function composeConservativeFloor(
  engine: ForecastProjectionResult,
  cadence: ForecastProjectionResult,
  startingCashBalance: number,
): ForecastProjectionResult
```

Composition rule (per month, after month-alignment check):
- `operatingCashIn  = min(engine.operatingCashIn,  cadence.operatingCashIn)`
- `operatingCashOut = max(engine.operatingCashOut, cadence.operatingCashOut)`
- `cashIn`/`cashOut` mirror operating values (no AR/AP carry — same policy
  as Split Conservative)
- `netCashFlow` and `endingCashBalance` recomputed from composed values
- Inherit Engine seasonality metadata (same policy as Split)

Constraints:
- Pure function. No transactions argument. No date argument.
- Throws on month-count mismatch or month-string mismatch (same guards as
  Split).
- No Known Events overlay in this phase (Phase 3 policy decision applies).
- Cadence's 12-month cap is a known limitation. The helper does not
  extrapolate; if Cadence has fewer points than Engine, the result has
  `min(engine.points.length, cadence.points.length)` points. Caller
  responsibility to handle horizons beyond Cadence's reach.

Verification before merge:
- `npx tsc --noEmit` clean
- `npm run build` green
- Backtest regression unchanged: `directionalAccuracy 42.8%`, `mape90 18.4%`,
  `safetyLineHitRate 100%`, `worstSingleMonthMiss $30,817`
- Composition correctness validated against `Temp/currentHorizonDiagnostic.ts`
  output for the 12-month horizon (must match within rounding).

**Phase B — Settings forecast posture control**

Add a posture field to `shared_workspace_settings`:

```sql
alter table shared_workspace_settings
  add column forecast_posture text not null default 'downside';
-- allowed values: 'downside' | 'expected'
```

Default `'downside'` aligns with Cautious-as-default product decision.

Surface in Settings → Rules section as a single segmented toggle:
- Label: "Forecast posture"
- Options: "Cautious (Downside)" | "Best estimate (Expected)"
- Help text: brief explanation that Cautious uses the lower of two model
  views month by month, Best estimate uses the calibrated hybrid.

Persistence path mirrors `target_net_margin` etc. — load via
`getSharedWorkspaceSettings()`, save via `saveSharedWorkspaceSettings()`,
upsert pattern, defaults if row absent.

No migration of existing data needed (single workspace, single row).

**Phase C — Forecast page consumes selected posture**

Replace the current session-only Engine/Split/Cadence toggle behavior
with posture-driven model selection:
- `posture === 'downside'` → `composeConservativeFloor(engine, cadence, ...)`
- `posture === 'expected'` → `composeSplitConservative(engine, cadence, ...)`

Both Engine and Cadence still need to be computed first (they are the
inputs to both composed models). The selected output feeds the existing
chart, decision cards, and reserve gauge — no downstream consumer changes,
all consume `ForecastProjectionResult.points` and `.seasonality`.

The visible Engine/Split/Cadence toggle on the Forecast page is removed
in this phase. The page renders only the composed view selected in
Settings.

**Phase D — Optional temporary testing exposure (only if needed)**

If side-by-side comparison is required during build-out, expose a
dev-only toggle or query parameter (`?compare=1`) that renders both
composed views simultaneously for visual comparison. Must not be reachable
from normal navigation. Removed before any production milestone is
declared "shipped."

**Open questions deferred to Phase 3:**
- Carry policy (AR/AP days) for both composed models — currently dropped.
- Known Events overlay — currently excluded; needs symmetric application
  policy across both Engine and Cadence inputs.
- Cadence 2y/3y handling — production helper does not extrapolate; UI
  must communicate the 12-month confidence boundary if longer horizons
  are exposed.

### May 2, 2026 — Reality Forecast locked as main/default

Current locked product decision following the Conservative Floor
diagnostic and a revenue-seasonality sanity check.

**Reality Forecast = Conservative Floor** is now the main/default forecast
for the product. It replaces any prior framing of Split Conservative as
"Expected" or Conservative Floor as "Downside."

Composition (unchanged from diagnostic):
- cash-in  = min(Engine operatingCashIn, Cadence operatingCashIn)
- cash-out = max(Engine operatingCashOut, Cadence operatingCashOut)
- net      = cash-in − cash-out

Why Reality Forecast is the default:
1. Matches current business reality. 2026 YTD P&L is negative; Split
   was projecting too optimistically over 1y for an operator who needs
   a planning view, not a neutral best-estimate.
2. Best retrospective performance at longer horizons:
   90d avg abs net error $6,512; 1y avg abs net error $6,686.
3. Intentionally cautious by construction. Floor under-projected
   actuals in 4/5 retrospective 1y windows. It is framed as a
   planning forecast, not a perfectly neutral prediction.
4. Revenue-seasonality sanity check passed. Reality does not crush
   recurring November / promo-season strength:
   - Historical November avg cash-in: ~$41.9K
   - Engine November: ~$41.8K
   - Cadence November: ~$40.9K
   - Reality November: ~$40.9K
   Recurring seasonal revenue is learned well enough from history.

Reality Forecast is a cash-flow planning forecast, not a P&L net-income
forecast; the P&L screenshot is used as a business-reality smell test,
not as a direct accounting match.

Locked product framing:

| Role | Model | User-facing? |
|---|---|---|
| Main/default forecast | Reality Forecast (= Conservative Floor) | Yes — default |
| Advanced alternate posture | Recovery Forecast (= Split Conservative) | Settings/Advanced only |
| Diagnostic comparator | Engine | No — internal/diagnostic |
| Diagnostic comparator | Category-Cadence | No — internal/diagnostic |

Retired language (do not use going forward):
- "Expected" for Split Conservative
- "Downside" as the main user-facing label for Conservative Floor / Reality
- "Expected vs Downside" as a Forecast-page choice

Product behavior direction:
- Forecast page eventually has no model toggle.
- Forecast page shows Reality Forecast by default.
- Forecast-page controls remain scenario controls only:
  Base Case / Best Case / Worst Case / Custom Case.
- Forecast posture belongs in Settings (or Advanced Settings).
- Default Settings posture = Reality Forecast.
- Recovery Forecast ships as an advanced Settings option, not as a
  visible Forecast-page control.
- Engine and Category-Cadence are not exposed as normal user-facing
  choices.

Known Events policy:
Known Events policy is unresolved for Reality/Recovery composed
forecasts. The Add Cash Event feature exists and Engine has event
handling, but Cadence does not consistently apply events and Phase 2
intentionally excluded events from Split Conservative. Resolving event
handling consistently for both composed models (Reality and Recovery)
is deferred to a later policy phase.

Distinction to preserve when that policy work happens:
- Recurring seasonal patterns (e.g. November promo lift) should be
  learned from history, not entered as Cash Events.
- Manual Cash Events are reserved for unusual, changed, or one-off
  future events that history will not capture.

Implementation sequence (locked):
1. Pure Conservative Floor module (`src/lib/kpis/conservativeFloor.ts`),
   no UI surface.
2. Settings-based forecast posture, in sub-phases:
   - 2a — schema + persistence (touches locked files
     `src/lib/data/contract.ts` and `src/lib/data/sharedPersistence.ts`;
     approved in principle, each prompt must still justify)
   - 2b — Settings UI control + copy
   - 2c — Forecast page consumes posture and removes the model toggle
   - 2d — audit Today and any other forecast-dependent surfaces for
     posture consistency

Temporary 4th Forecast-page toggle (Path A) is rejected. The Forecast
page should reach its final shape (no model toggle) as quickly as the
Settings work allows.

### May 2, 2026 — Reality Forecast implementation shipped

Five-commit implementation pass executing the locked product decision
("Reality Forecast as main/default"), plus the supporting Supabase
migration. Forecast page now consumes the user's posture from Settings;
Forecast-page model toggle is removed; Today posture-awareness is
explicitly deferred to sub-phase 2c.2.

**Commits (in order):**

| Hash | Subject | Sub-phase |
|---|---|---|
| `90a1832` | feat(charts): hybrid axis for Projected Cash Balance y-axis | (chart polish, prereq) |
| `c2e508d` | feat(forecast): add Reality Forecast pure composer | Step 2 — `composeConservativeFloor()` |
| `0a3cf36` | feat(persistence): add forecast_posture to WorkspaceSettings | Step 4-2a |
| `2b9ccae` | feat(settings): add Forecast style control to Rules section | Step 4-2b |
| `b93cad2` | feat(forecast): route Forecast page through forecastPosture | Step 4-2c.1 |

**Supabase migration (run manually via MCP against the Supabase test
project before sub-phase 2b shipped):**

```sql
ALTER TABLE shared_workspace_settings
  ADD COLUMN IF NOT EXISTS forecast_posture text
    NOT NULL DEFAULT 'reality'
    CHECK (forecast_posture IN ('reality', 'recovery'));
```

Migration-safe by design: the `getSharedWorkspaceSettings` row mapper
defaults `forecastPosture` to `'reality'` if the column is absent, null,
or unexpected. App was deployable before the column existed; pre-migration
writes failed with PGRST204 silently (existing save-error swallow path)
and the read-side default kept the UI consistent.

**Verified live (12 horizon × posture combinations):**
- Reality 1Y/2Y/3Y net change: −$5.4K / −$10.8K / −$16.3K (linear scaling)
- Recovery 1Y/2Y/3Y net change: +$43K / +$86.1K / +$129.1K (linear scaling)
- November cash-in preserved across years: $40,910.70 in 2026, 2027, 2028
- Backtest regression unchanged (locked metrics held across all commits)

**Today divergence — deferred to sub-phase 2c.2:**

Today consumers (`coreConstraints.ts` reserve gauge, `signals.ts`
priority cards) read `model.cashFlowForecastSeries`, an Engine-baseline
forecast built inside `computeDashboardModel` via
`buildCashFlowForecastSeries`. This is independent of the Forecast page
projection and was always Engine-only. Pre-2c.1 the divergence was
hidden because Engine was the default; post-2c.1 with Reality as
default, Today and Forecast can show different forward-cash numbers.

Documented in code comments at both call sites:
"Forecast posture intentionally not applied here yet. Today
posture-awareness is deferred to sub-phase 2c.2."

The architectural choice for 2c.2 is between:
- Threading posture into `computeDashboardModel` so
  `cashFlowForecastSeries` becomes posture-aware globally
  (locked `compute.ts` change, cleaner long-term, larger blast
  radius)
- Applying posture at the consumer layer (`coreConstraints.ts`,
  `signals.ts` — both on the locked list, less invasive but couples
  posture knowledge to each consumer)

Decision deferred until fresh diagnosis.

**Key learnings during implementation:**

- `WorkspaceSettings` type lives in `sharedPersistence.ts`, not in
  `contract.ts` as previously implied. The new field was added in
  place; relocation deferred as housekeeping.
- The Forecast model toggle lived in `Dashboard.tsx`, not in
  `CashFlowForecastModule.tsx`. CashFlowForecastModule was not
  touched in 2c.1.
- Cadence has a hard 12-month cap (`HORIZON_MONTHS = 12`). Composers
  throw on length mismatch by design. Long-horizon support is the
  caller's responsibility — composers do not extrapolate.
- The first `niceTicks` tier-table approach had bracket boundary
  issues. Final algorithm: target-count-driven 1-2-5 snap with
  hybrid local/zero-based axis. No tier table.
- Hybrid axis matters because cash balance is a level metric, not a
  volume metric. Zero-based axis on short horizons ($21K–$25K range)
  visually flattens the signal; local axis preserves it.

---

## What Changed Recently (April 30, 2026 — afternoon session)

### Segmented toggle standardization — fully shipped

Audited every toggle control in the app. Identified 8 instances using 6
deprecated, one-off CSS class sets. Replaced all 8 with a single shared
`.segmented-toggle` / `.segmented-toggle-btn` / `is-active` system.
Locked the spec in `UI_RULES.md` Part 6.

**Commits (in order):**
- `14f1d78` — Initial segmented toggle spec added to UI_RULES.md (Part 6)
- `64d79d6` — Spec corrected: rounded-full → rounded-lg/rounded-md (geometry from TailAdmin ChartTab)
- `65f39aa` — Spec corrected again: dimensions from TailAdmin Analytics card (40px/36px/px-3 py-2/weight 500 both states)
- `3566cc6` — Implementation: all 8 toggles migrated; dead CSS deleted (~2.4 kB)

**Toggles replaced (8 total):**
1. Big Picture — timeframe (6M/12M/YTD/More ▾)
2. Big Picture — MA window (12W/24W/52W)
3. Net Cash Flow chart — Operating/Total toggle
4. Cash Trend chart — Total/Operating toggle
5. Forecast horizon — 30d/60d/90d/More ▾
6. Forecast scenario — Base/Best/Worst/Custom (4-button, wrap modifier)
7. Settings Data tab — method toggle (×2 instances)

**Architecture decisions:**
- Settings JSX left untouched — `.settings-subnav*` paired in the same CSS
  rule block as `.segmented-toggle*`. Visual no-op; structural unification.
- More ▾ triggers (Big Picture + Forecast) get `.segmented-toggle-btn` for
  visual styling plus their existing dropdown class for positioning behavior.
- `.segmented-toggle--wrap` modifier added for 4-button scenario toggle:
  `width:100%; flex-wrap:wrap; height:auto` — mobile-safe without breaking
  2- and 3-button tracks.

**Dead CSS deleted:**
`.cashflow-toggle*`, `.kpi-timeframe-toggle*`, `.forecast-scenario-toggle*`,
`.forecast-timeline-toggle*`, `.forecast-view-toggle*`, `.dig-here-period-toggle*`

**Spec locked in `UI_RULES.md` Part 6 — Segmented toggle (standard pattern):**
| Property | Value |
|---|---|
| Track background | `#F2F4F7` |
| Track radius | `8px` (rounded-lg) |
| Track height | `40px` |
| Track padding | `2px` |
| Segment radius | `6px` (rounded-md) |
| Segment height | `36px` |
| Segment padding | `8px 12px` (py-2 px-3) |
| Font size | `14px` |
| Font weight | `500` (both states) |
| Active bg | `#FFFFFF` |
| Active color | `#101828` |
| Active shadow | `0px 1px 2px 0px rgba(16,24,40,0.05)` |
| Inactive color | `#667085` |
| Transition | `all 150ms ease` |

**Lesson learned — measure, don't describe:** Initial spec was written from
verbal description (rounded-full, weight 600 active). Two correction rounds
were needed before dimensions matched actual production CSS. For future specs:
inspect computed CSS values directly; never describe from visual impression.

**Working tree:** clean.
**Active branch:** main.

---

## What Changed Recently (April 30, 2026 — morning session)

### Card system + spacing normalization — fully shipped

Multi-commit pass to align the entire dashboard with the documented
TailAdmin spacing standard. Card padding/radius normalized. Grid gaps
made responsive. Page wrapper rhythm corrected across all routes.
align-items declared explicitly on every card grid.

**Commits landed:**
- `94e0740` — UI Lab one-two grid utility
- `cecb4f4` — .card base normalization (radius 24→16, padding 16→24)
- `59acb02` — UI_CARDS card height + pairing rules; CLAUDE hierarchy update
- `4278d9d` — UI_Verification_Rules tracked in repo
- `05424db` — session close discipline added to CLAUDE.md
- `ada3df7` — Spacing section expanded in UI_RULES.md
- `17175c5` — grid gap normalization + align-items declarations
- `acba8a7` — responsive md:gap-6 added to six card grids
- `5f47cc1` — Grid gap subsection tightened in UI_RULES.md
- `a522c43` — main-zone top gap, forecast cockpit, Settings heading rhythm
- (two additional commits) — Today page wrapper gap + Settings section rhythm;
  empty .today-context-section rule removed

**Documentation files updated:**
- `UI_CARDS.md` — Card Height & Pairing Behavior section added; Known
  Classified Pairings table expanded to 9 entries
- `UI_RULES.md` — Spacing section expanded from 7 lines to full spec:
  allowed values table, page/layout rules, card padding, card internal
  spacing, grid gap (mandatory responsive pattern), align-items rules,
  what not to do
- `UI_Verification_Rules.md` — added to repo, now tracked
- `CLAUDE.md` — source of truth hierarchy expanded to 4 entries;
  session close discipline section added; UI_Verification_Rules added
  to sync list

**Deferred to backlog (Notion — Later / P3):**
- Settings page full layout normalization. The .ta-page / .ta-section /
  .ta-card legacy structure should be rebuilt with standard .card and
  .stack-grid patterns before any further spacing fixes are attempted.
- Efficiency/DigHere component follow-up audit (component files not read
  in original card audit).
- Documentation refactor — separate reusable TailAdmin base from Wx CFO
  overlay for portability across projects.

**Working tree:** clean (stray .rtf only).
**Active branch:** main.

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
- `src/lib/kpis/compute.ts` — forecast engine (DO NOT TOUCH; diagnostic override seam exists, production callers do not use it)
- `src/lib/kpis/categoryCadence.ts` — category-cadence forecast (pure function + production adapter; opt-in on What-If)
- `src/lib/kpis/forecastShared.ts` — shared forecast types (`Anchor`, `ForecastSeries`, `SeriesPoint`) and starting-cash anchor helper (`reconstructStartingCash`); used by both production and harness
- `scripts/backtest/` — diagnostic harness directory (runner, fixtures, comparators, regression check)
- `backtest-results/` — frozen fixture (transactions JSONL + historical anchors) and locked `baseline.json`
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

**Override seam (May 1, 2026):** the engine is still locked for
production behavior, but `compute.ts` now exposes
`EngineParameterOverrides` for diagnostic use only. Production callers
do not pass overrides; their absence is byte-for-byte identical to the
pre-seam engine. The seam exists only for the harness's parameter
sensitivity sweep.

**Sweep finding (May 1, 2026):** these parameter values were tested via
the parameter sweep harness across 22 variants. No single tweak closed
the gap against naive baselines. The engine remains as-is pending a
decision on patch vs replace; in the meantime, the category-cadence
comparator is available as an opt-in alternative on the What-If page.

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
| Forecast model toggle | Session-only by design. The What-If toggle resets to Engine on every page reload — no localStorage, no Supabase, no URL param, no context. Persistence is intentionally not implemented at this stage. |
| Category-cadence — Known Events | Comparator does not yet handle Known Events. Adapter accepts the `events` argument for shape parity with `projectScenario` but ignores it. Known Events overlay has not started. |

---

## Locked Files — Do Not Modify Without Explicit Instruction

- `src/lib/kpis/compute.ts` (engine remains locked; the `EngineParameterOverrides` seam added May 1, 2026 is the only sanctioned modification path, used only for diagnostic parameter sweeps)
- `src/lib/kpis/categoryCadence.ts` (category-cadence forecast — Stage 4+ work to extend it should follow the staged-promotion pattern; ad-hoc rewrites disturb the harness regression check)
- `src/lib/kpis/forecastShared.ts` (shared types and starting-cash anchor; both production and harness depend on this — touching it requires re-running the harness)
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
