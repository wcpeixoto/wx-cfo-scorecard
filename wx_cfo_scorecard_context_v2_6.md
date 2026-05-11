# Wx CFO Scorecard — Project State Summary
*Technical context for Claude. Start every new conversation by reading this file.*
*Last updated: May 9, 2026 (Suggested-change format rule — intent-based)*

---

### Phase 5.1 — Renewal contracts and generated events

**Status:** Branches 1–5 shipped. Renewal pipeline operator-facing end-to-end.

**Pipeline architecture:**
- `renewal_contracts` table (Supabase): operator-managed source of truth
  for recurring revenue agreements
- `generateRenewalEvents(contract, horizonMonths, today)`: pure function
  in `src/lib/forecast/generateRenewalEvents.ts` produces `ForecastEvent[]`
  per contract; UTC-stable, deterministic, returns `[]` for malformed input
- `saveSharedRenewalEvents(contractId, events)`: persists with delete-safety
  (only deletes `source='renewal' AND contract_id=? AND is_override=false`
  rows). Includes `retryDeleteOnce` helper for boot-window 503 transients
- Dashboard load effect: fetches contracts → regenerates events → saves →
  refetches `forecast_events`. Single completed-ref guards against
  StrictMode double-invoke via convergence on idempotent backend writes
- Existing `applyEventsOverlay` consumes renewal events transparently —
  no overlay logic changes

**Schema additions:**
- `renewal_contracts` table: id, name, status (active/paused/ended),
  renewal_date, renewal_cadence (monthly/annual), cash_in_amount,
  cash_out_amount, enabled, notes, timestamps
- `forecast_events` columns: source, contract_id, generated_date,
  generated_cash_in, generated_cash_out, is_override
- Anon RLS policies on `renewal_contracts` workspace-scoped to 'default'
  (matches `first_test_*` pattern)

**Branches merged on main:**
- bac7e30 — Branch 1: schema + types
- 37520cf — hotfix: is_override default
- 9180f2b — Branch 2: persistence round-trip + delete safety
- 78e1d54 — Vitest tooling (Vitest 2.1.9, node env, no globals)
- 3aaff9e — Branch 3: pure generator (38 tests)
- cfe4c29 — hotfix: anon RLS policies for renewal_contracts
- 689aa37 — Branch 4: integration + StrictMode fix + retry helper
- 122cf62 / 351ac5a / 6c8cc57 / d0693c2 / a2f41f6 — Branch 5: renewal
  contracts UI + override semantics (merged via `2ac68c3`)

**Product rule (locked May 5, 2026 — Branch 5):**

> Contracts own renewal events. Editing a contract rewrites its generated
> events. Deleting a contract removes its generated events. One-off
> exceptions belong as manual events.

`is_override=true` remains backend future-proofing — schema columns are
preserved but no UI surface in V1.

**Cross-cutting deferred items (post-Phase-5.1):**
- Persistence observability cleanup: saveSharedForecastEvents has no
  try/catch (uncaught throws on save failure); savePriorityHistory
  has a silent catch
- forecast_events policy mismatch: live DB has qual=true, schema file
  documents workspace-scoped. Decide direction
- vite.config.js tracked-output convention worth removing

**Lessons captured:**
- RLS policies for new Supabase tables must land in the same branch
  as the schema migration, not later. Anon-key access is empty without
  policies and the failure is silent.
- StrictMode + ref-as-guard race: synchronous ref-set before async
  work locks permanently. Use single completed-ref + idempotent
  backend writes for one-time async effects.
- Stale-bundle / wrong-port can produce false-positive bug reports.
  Hard-reload + port verification before capturing wire evidence.

---

### May 9, 2026 — Suggested-change format rule added to CLAUDE.md

**What changed**
- `03cc755` docs: add suggested-change format rule (initial draft
  with line-count threshold)
- `1481436` docs: tighten rule to intent-based criteria
  (final shipped form)

**Why it matters**
- Codifies how chats deliver text suggestions to the user. Final
  rule: small identifiable sentence/line edits use exact
  quote-current / quote-replacement. Anything that affects
  structure, logic, multi-line wording, or could be ambiguous gets
  a full block rewrite. Pairs with the existing snapshot-drift
  check — both rules protect against hand-merge errors when live
  files have moved.

**Current state**
- main HEAD: `1481436`. Working tree clean.
- Rule lives at the bottom of CLAUDE.md, after "Snapshot drift
  check (line-level edits)".

**Next step**
- Click "Sync now" on the Claude project (CLAUDE.md is on the
  snapshot-refresh list → Trigger B fires).

**Lessons**
- First draft used a 2-line threshold; user pushed back that the
  threshold was too loose and judgment-prone. Replacing the
  numeric trigger with intent-based criteria ("affects structure,
  logic, multi-line wording, or could be ambiguous") removed the
  line-counting argument.
- The user's own delivery of both the original and the revision
  demonstrated the rule: each rewrite was >2 lines and shipped as
  a full block, not a diff.

---

### May 9, 2026 — Trigger B mechanic: GitHub Sync now replaces re-upload

**What changed**
- `94e0789` docs: switch Trigger B from re-upload to GitHub Sync now
  (CLAUDE.md, SESSION_CLOSE_WORKFLOW.md, PROJECT_CONFIG.md)

**Why it matters**
- The live Claude project is now connected to `wcpeixoto/wx-cfo-scorecard`
  on branch `main` via the GitHub connector, with the 9 snapshot-refresh
  files explicitly selected. Trigger B closes now flag a single "Sync now"
  click instead of a multi-file drag into project settings. Faster per
  close, same discipline.

**Current state**
- main HEAD: `94e0789`. Working tree clean.
- Live project GitHub-connected; manual uploads of snapshot-refresh files
  removed; auxiliary references (Nubank, TailAdmin CSS, retention .docx)
  preserved as separate manual uploads.
- Throwaway test project used to verify the mechanic; safe to delete.

**Next step**
- Click "Sync now" after this commit (narrative entry touches a
  snapshot-refresh file → second Trigger B fire of the session).
- Delete the throwaway test project.

**Lessons**
- Supersedes the earlier "Project-snapshot upload, not chat-upload"
  lesson. The October 2025 "connected-but-stale" bug did not reproduce.
- GitHub-connected files are reachable by name and search but are NOT
  returned by the "list project files" tool — only manually-uploaded
  files appear there. Read snapshot-refresh files by name; do not rely
  on enumeration.
- Sync is manual, not auto-on-push. Pushing alone does not refresh.

---

### May 5, 2026 — Phase 5.1 Branch 5 shipped (Renewal Contracts UI + override semantics)

**Feature branch:** `claude/gallant-pasteur-52b3c9` (PR merged via merge
commit `2ac68c3`).

Five single-purpose commits, in build order:

| Hash | Subject |
|---|---|
| `122cf62` | feat(phase-5.1): contracts & renewals settings pane |
| `351ac5a` | fix(phase-5.1): group renewal events by contract |
| `6c8cc57` | feat(phase-5.1): style renewal rows in known events |
| `d0693c2` | feat(phase-5.1): block unsupported renewal row controls |
| `a2f41f6` | refactor(phase-5.1): tighten known events row layout |

**Files changed (4, no locked files):**
- `src/components/ContractsSettingsPane.tsx` — new component (604
  lines): contract list, add/edit modal, delete-confirm, segmented
  toggles for direction / status / cadence
- `src/components/CashFlowForecastModule.tsx` — `groupedEventRows`
  rewritten to discriminate manual vs renewal buckets via
  `event.source === 'renewal'`; `.is-renewal` row class; `activeSteerId`
  state; toggle/delete hidden on renewal rows; edit click on renewal
  rows opens an inline steer panel; right-side controls wrapped in
  `<span class="forecast-event-controls">`
- `src/dashboard.css` — contracts pane styles, `.forecast-event-row.is-renewal`
  rule (gray-25 surface + default-strong border accent),
  `.forecast-event-steer*` panel rules, `.forecast-event-controls`
  cluster wrapper (4px inner gap, `margin-left: auto`)
- `src/pages/Dashboard.tsx` — `'contracts'` added to `activeSection`
  union, fourth Settings sub-tab button, fourth section pane rendering
  `<ContractsSettingsPane>`, `contracts={forecastContracts}` prop on
  `<CashFlowForecastModule>`

**V1 decisions (locked):**
- `is_override=true` remains backend future-proofing only — column kept
  but no UI surface in V1. Override semantics deferred until a real
  product reason emerges.
- "Direction" (Revenue / Expense / Both) is UI-only form state. The
  persisted shape is the existing `cashInAmount` / `cashOutAmount` pair
  on `RenewalContract`; no `direction` field on the schema. The form
  controls visibility of the cash-in / cash-out inputs and zeroes the
  unused side on save.
- Renewal date input means *next upcoming renewal* — the first
  generated occurrence anchor. The generator emits forward from that
  date at the contract's cadence stride.
- Renewal row controls in Known Events: toggle hidden, delete hidden,
  edit visible (click opens inline steer panel referencing the contract
  name). Manual rows retain full toggle / edit (modal) / delete
  (confirm) behavior.
- "Go to Contracts" deep link from the steer panel: deferred. Would
  require lifting `activeSection` out of Dashboard's local state or
  introducing a URL-fragment scheme. The steer copy alone is sufficient
  for V1.
- Per-instance enabled/disabled persistence across regeneration:
  deferred. Today the row toggle is hidden on renewal rows. Future
  approach: match `(contract_id, generated_date)` before delete/reinsert
  in `saveSharedRenewalEvents`.

**Verified live (production Supabase, May 5 2026, post-merge):**

Six-check verification passed end-to-end against live Supabase from the
main repo path (worktree had no `.env.local`):

1. Create contract → `renewal_contracts` row written + `forecast_events`
   generated. (Verified: 1 event for the 90d horizon, then 10 events
   after switching to 1y horizon.)
2. Edit contract amount → renewal events regenerated with new amount
   ($2,500 → $3,500 across all 10 events).
3. Delete contract → renewal events removed (contract row gone, all 10
   forecast_events gone).
4. Renewal grouped row in Known Events: one row per contract, badge
   reads "Monthly" (not "Once"), title from `contract.name`.
5. Renewal row controls: toggle hidden, delete hidden, edit click opens
   inline steer panel with contract name in copy.
6. Manual rows still render with full toggle/edit/delete and "Once"
   badge; both row kinds use the new `.forecast-event-controls`
   right-side cluster.

Test data was cleaned up — no QA artifacts remain in production.

**Lessons captured:**

- Worktree environments often lack `.env.local`. Live Supabase
  verification must run from the main repo path. Don't copy env files
  into worktrees — they create drift across worktrees and require
  cleanup. Run live checks post-merge from main.
- Build the data-source UI first when later steps depend on its data.
  Step 1 (contracts pane) shipped before Steps 2–5 so subsequent steps
  had real renewal events to verify against. No synthetic data needed.
- Group-level discriminators beat per-event prefix rechecks.
  `groupedEventRows` returns a `kind: 'manual' | 'renewal'` field; all
  downstream control branches read `group.kind`. Adding new grouping
  rules in the future does not require revisiting every consumer.
- One-off exceptions stay manual. Once contracts own generated events,
  resist the temptation to override individual instances in the UI —
  that path drags the schema toward a half-implemented override system.
  If the operator wants a one-off, they add a manual event.
- The post-composition Known Events overlay (Phase 5.1 May 3) consumes
  renewal events transparently. No overlay-engine changes were needed
  in Branch 5 — the source-of-truth column on `forecast_events` was
  already enough.

---

### May 4, 2026 (evening) — Known Events feature complete + Forecast chart honesty pass

**Known Events row enabled/disabled toggle: shipped (commit `42b0dab`, merged via `61b7fa3`).**

Per-row toggle button (●/○) on each Known Events row. Disabled events
remain visible in the list, are excluded from `applyEventsOverlay`, and
their markers do not render on the chart. Toggle state persists via
Supabase. No schema migration required — `enabled` column already in
place. Operators can keep events saved without applying them, removing
"delete to test" friction.

**Files:** `src/components/CashFlowForecastModule.tsx`,
`src/pages/Dashboard.tsx`, `src/dashboard.css`.

---

**Known Events exact-date support: shipped (commit `8821299`, merged via `33c2567`).**

Date is now the source of truth for Known Events. The Month picker is
removed from the user-facing form; date is required and selected via a
native date input. Picker constraints: min = today, max = last day of
36-month forecast horizon (sourced from canonical
`FORECAST_RANGE_OPTIONS`, never hardcoded). Empty default — no
prepopulation. Validation: "Choose the expected event date." (empty)
and "Choose a date within the forecast window." (out of range).

Month column retained in DB and derived from date on save (`YYYY-MM`)
to preserve existing grouping and overlay logic. Overlay math
granularity unchanged (monthly); date precision is currently display +
persistence only.

**Schema migration applied:** `forecast_events` gains nullable
`date date null` column. Read-time fallback synthesizes
last-day-of-stored-month for legacy NULL rows. Legacy rows that pass
through a save round-trip will have their synthesized date persisted
back — no semantic change.

**Files:** `src/lib/data/contract.ts` (additive optional `date?: string`),
`src/lib/data/sharedPersistence.ts` (additive `date` pass-through +
read-time fallback), `src/components/CashFlowForecastModule.tsx`,
`src/pages/Dashboard.tsx` (`forecastRangeOptions` mapper passes `months`
so the form can derive the canonical horizon),
`supabase/shared_persistence_schema.sql`.

---

**Cash Event marker label shows exact date: shipped (commit `0ec6f57`, merged via `33c2567`).**

Marker dot stays bucket-aligned (chart uses categorical x-axis;
sub-bucket placement requires datetime x-axis rework deferred as Issue
B Tier 2). Marker label now displays `event.date` in `Mmm DD, YYYY`
format alongside title and impact, so the operator sees the date they
entered even when the dot is bucket-aligned.

**Label structure (top → bottom):** title (no dot), impact amount
(visible orange dot — anchored to bucket math), exact event date (no
dot). Dot stays adjacent to impact because the impact is the
load-bearing fact; date is supporting context.

**Files:** `src/components/ProjectedCashBalanceChart.tsx`.

---

**Forecast weekly tooltip range fix: shipped (commit `989545b`, merged via `286f742`).**

Tooltip header now displays the full week range
(e.g. "Jun 8 – Jun 14, 2026") for weekly granularity instead of only
the week-end date. Tells the truth about what the data point
represents — a weekly bucket, not a single day. X-axis ticks unchanged
(still week-start). Monthly granularity tooltip unchanged.

**Pre-existing bug** introduced in `5c8614d` (Apr 29). Surfaced
visibly when exact-date events made the date inconsistency
operator-noticeable. The function name `formatBucketEndDate` is now
slightly misleading (returns range for weekly) — kept for scope
discipline.

**Files:** `src/components/ProjectedCashBalanceChart.tsx`.

---

**Forecast chart curve research (UI Lab): shipped (commit `af40655`, merged via `92e32e5`).**

Visual side-by-side comparison of three ApexCharts curve modes (smooth,
straight, stepline) against two data shapes (TailAdmin-style continuous
variance vs Wx-style flat-baseline-plus-spike). Pure research; no
production chart changes.

**Decision: production stays on `curve: 'smooth'`.** Lab confirmed
smoothing handles Wx-style spike data acceptably — the bell-curve
around an isolated spike is a fine representation. Straight and
stepline alternatives sacrifice aesthetic consistency across the whole
chart to address one visual surface. With realistic operating data
(natural revenue/expense variance), smoothing reads as flow, not
distortion. The lab persists in the codebase as documentation for this
decision.

**Files:** `src/components/CurveLabCharts.tsx` (new),
`src/pages/Dashboard.tsx`.

---

**Today V1 QA pass — re-verification on integrated branch:**

Cross-feature integration verified on the rebased toggle branch:
toggle composes cleanly with exact-date display and marker labels. 8/8
verification checks passed including persistence round-trip across
Supabase. Cash floor with test event enabled = $22,194; disabled =
$15,578 (delta confirms event correctly excluded from overlay when
disabled).

**Branch hygiene incident:** the toggle branch was originally cut from
the trough-month branch instead of main, creating tangled ancestry.
Caught and corrected via `merge → rebase` sequence. New rule
established: every prompt's pre-flight explicitly verifies branch is
cut from main, never from another feature branch.

---

**Diagnostic findings logged to Notion:**

- **Issue B Tier 2 — Forecast chart datetime x-axis** for true
  sub-bucket marker placement (architectural rework). P3/Later. Touch
  candidate: `ProjectedCashBalanceChart.tsx`. Would also resolve any
  remaining tooltip/marker precision concerns by making the chart's
  date semantics continuous instead of categorical.

**No new follow-ups from the curve lab** — the research concluded
production stays as-is.

---

**Session learnings:**

- **Phase-gate discipline catches real issues.** Twice this session
  (toggle work, exact-date work) Phase 1 diagnosis surfaced
  scope-expansion triggers (signal payload type change, schema
  migration) that warranted explicit approval before Phase 2.
  Skipping the gate once on the toggle commit was acknowledged but
  passed; the exact-date schema migration showed why the gate
  matters.

- **Branch ancestry is load-bearing.** Cutting feature branches from
  main (not from other feature branches) prevents tangled history
  and unexpected commits leaking across features. Pre-flight
  verification of branch base is now standard.

- **Pre-existing bugs surface when foundations get more precise.**
  The weekly tooltip mismatch existed for ~5 days before exact-date
  support made it visible. Adding precision to one part of a system
  exposes imprecision elsewhere.

- **Visual research before product decisions.** The curve lab took
  one focused commit to definitively answer "should we change the
  Forecast chart curve?" Direct comparison was faster and more
  trustworthy than debate.

- **"Operator-honest" beats "scope-correct."** The exact-date commit
  technically delivered its scope (display + persistence only,
  overlay stays monthly), but shipping it as-is would have left the
  chart marker landing at month-start while the row showed
  user-entered day. Adding the marker label fix made the feature
  operator-honest. Scope correctness without product honesty isn't
  done.

---

### May 4, 2026 — Today V1 QA pass + AR/AP carry deprecation

**Today V1 posture-aware QA pass: PASS with coverage gaps.**

10 signal states identified canonically from `src/lib/priorities/signals.ts`,
`rank.ts`, `copy.ts`, and `TodayPage.tsx`. 4 states verified live in
production data; 6 states + 3 layout variants not reachable without
synthetic data. Decision: declare verified-as-far-as-current-data-allows
and move on. No synthetic-data QA pass scheduled — verify remaining
states in flight when they fire naturally.

**Verified live (production data, May 4 2026):**
- `reserve_warning` as hero (59% funded, < 100% of $34,368 target)
- `cash_flow_tight` as secondary
- `expense_surge` warning tier as secondary (Rent or Lease ~50% above baseline)
- 2-card secondary layout (`.today-secondary-row.is-pair`)
- Deterministic fallback copy from `copy.ts` (AI provider stub always falls back)
- Severity styling: `is-critical` / `is-warning` / `is-healthy` CSS verified
- 12-month Today window invariant holds (Forecast range change does not affect Today)
- Forecast posture math working — 90d Reality +$101.3K vs Recovery +$115.9K (delta $14.6K matches prior diagnostic)
- Today + Forecast wiring stable

**Coverage gaps (not reachable in current data):**
- `reserve_critical`, `cash_flow_negative`
- `expense_surge` critical tier (relDelta at boundary)
- `revenue_decline` warning + critical tiers
- `owner_distributions_high`
- `steady_state`
- 1-card and 0-card secondary layouts
- Today cash-floor posture split — masked by standing +$100K June 2026 test event;
  posture confirmed working via Forecast layer instead

**Findings:**
- F-1 — Today cards have no `.dark .today-*` / `.dark .hero-*` CSS coverage
  despite UI_CARDS.md §19 requirement. Cosmetic; no dark-mode toggle exposed
  in production yet. Logged in Notion as P3/Later.

**Posture-sensitivity reality check:** Of 10 signals, only `cash_flow_negative`,
`cash_flow_tight`, and (indirectly) `steady_state` shift on posture toggle.
The other 7 are posture-invariant (read `model.runway`, `txns`, or
`model.monthlyRollups` directly).

---

**AR/AP carry deprecation pass: shipped (commit `c3aec05`, merged via `cf65f92`).**

Removed misleading product language. No math changed. Composed Forecast
Policy is cash-basis only; the "Cash flow timing — Coming soon" Settings
row implied a roadmap feature that was explicitly removed from scope.

**Changes:**
- `src/pages/Dashboard.tsx` — removed Rule 4 placeholder JSX block (7 lines)
- `src/dashboard.css` — removed orphan `.rules-row--coming-soon` rule (3 lines)

**Engine carry layer in `compute.ts` left untouched.** Locked file; cash-basis
policy is already documented in `splitConservative.ts` and `conservativeFloor.ts`
at the composition layer. The locked-file barrier itself signals not-in-production.

**Verification:** Forecast 90d Reality net change unchanged at +$101.3K
before and after commit on identical data state.

**Deferred (logged in Notion as P4/Later):** Remove unused
`receivableDays` / `payableDays` plumbing from `Dashboard.tsx` and
`CashFlowForecastModule.tsx`. Vestigial; not rendered. Cleanup requires
locked-file approval (`contract.ts`, `compute.ts`).

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

### May 3, 2026 — Composed Forecast Policy + Known Events overlay shipped

**Composed Forecast Policy (locked May 3, 2026)**

Wx CFO Scorecard is a cash-basis product. Operating reality is what the bank account does, month by month. Accrual concepts (receivables, payables, aging, invoice-level timing) are not part of the data model and are not modeled in any forecast.

**Known Events:** persisted manual cash adjustments that DO affect the displayed forecast via a post-composition overlay. Engine, Cadence, Reality (Conservative Floor), and Recovery (Split Conservative) composers all continue to receive `events: []`. Events apply once to the final `ScenarioPoint[]` horizon visible to the user, in `Dashboard.tsx`'s `forecastProjection` useMemo, after the 2Y/3Y caller-layer extension. Apply to `cashIn` / `cashOut`, recompute `netCashFlow`, and roll forward `endingCashBalance` from the event month onward. Preserve `operatingCashIn` / `operatingCashOut`. `enabled` is the math switch; `status` is decorative.

**AR/AP carry:** out of scope. The hidden "AR/AP days" Settings slider is to be removed. AR/AP terminology is stripped from UI. The Engine carry layer in `compute.ts:2293–2374` is dead code from a user perspective and stays in place for backtest compatibility, with a code comment marking it not-surfaced. Real AR/AP becomes possible only when the data model has receivable/payable entities — invoice-level data, aging, payment terms.

**Composed forecast invariants:**

| Property | Reality | Recovery | Engine |
|---|---|---|---|
| Includes Known Events in displayed forecast via overlay | Yes | Yes | Diagnostic/raw Engine path unchanged |
| Includes AR/AP carry | No | No | No (effectively) |
| Cash-basis | Yes | Yes | Yes |
| Default user-facing posture | Yes | Optional | Diagnostic only |

**Commits this session:**

| Hash | Subject |
|---|---|
| `dd9b038` | fix(today): decouple forward-cash signal window from Forecast range |
| `6e8628d` | feat(forecast): persist Known Events to Supabase |
| `cbe5b38` | fix(forecast): two-line Cash Event marker label with elevated layout |
| `1a9f7f2` | feat(forecast): post-composition Known Events overlay (Reality + Recovery) |
| `dc12288` → reverted by `ee7c67c` | "Included in forecast" badge and helper text on event rows. Reverted because the badge and helper sentence became redundant once Commit 2 made events visibly affect the chart line and the row already shows month + amount + ONCE/MONTHLY pill. The truthfulness gap closed itself when math became real. |

**Files changed across the sequence:**
- `src/lib/priorities/signals.ts` — Today window slice (Commit 0)
- `src/lib/priorities/coreConstraints.ts` — Today window slice (Commit 0, defensive — function still dead code)
- `supabase/shared_persistence_schema.sql` — `forecast_events` DDL (Commit 1)
- `supabase/first_test_policies.sql` — `forecast_events` RLS (Commit 1)
- `src/lib/data/sharedPersistence.ts` — row type, mappers, get/save helpers (Commit 1, additive persistence helpers only)
- `src/pages/Dashboard.tsx` — boot load + handler wrappers (Commit 1) + overlay seam (Commit 2)
- `src/components/ProjectedCashBalanceChart.tsx` — marker rendering across ranges + two-line label (Commit 1b/1c)
- `src/lib/kpis/applyEventsOverlay.ts` — new pure helper (Commit 2)

**No locked forecast-math files modified across the sequence.** `sharedPersistence.ts` received additive persistence helpers only.

**Verified live (production):**
- Reality posture: Today $20K floor with the persistent +$100K Jun 2026 test event applied. Trough lifted from pre-event $15K because the +$100K shifts every subsequent point above the starting cash.
- Recovery posture: composed correctly with overlay applied downstream.
- Marker visible on 60d / 90d / 6M / 1Y / 2Y / 3Y; absent on 30d (Jun outside data window — correct).
- Two-line label: title above, signed value below, dot at data point.
- Math byte-identical when events list is empty (verified via early-exit paths in `applyEventsOverlay`).
- Today + Forecast agree under both postures.

**Key learnings:**

- Post-composition overlay is the right architectural seam for Known Events. Avoids the Engine/Cadence asymmetry problem (Cadence has no event overlay path) and keeps composer math pure.
- ApexCharts annotation positioning consults the rendered category-label text, not the underlying categories array. When `labels.formatter` returns `''` at the matching index, the annotation point is silently dropped — the marker simply does not render. Diagnosed during 1b: the chart's manual labelStep thinning at `ProjectedCashBalanceChart.tsx:202` was emptying the category text at non-step indexes (every other position on 1Y, every third on 2Y/3Y), which made markers appear only on 60d and 6M by coincidence (where labelStep happened to equal 1). Fix: stop returning `''` from the formatter; let Apex's built-in `hideOverlappingLabels: true` handle visual density without breaking annotation lookup.
- ApexCharts `label.text` renders through a single SVG `<text>` element with no `<tspan>` children, so `\n` is collapsed to whitespace. Multi-line labels require two stacked annotation points at the same `x` with different `offsetY` — the two-line marker (Commit 1c) uses an invisible-marker title-line above and a value-line + visible dot below.
- Required-prop enforcement at the persistence layer is not the same as required-prop enforcement at the math layer. Persistence (Commit 1) used save-on-change inside the existing handler updaters, mirroring `updateBusinessRules`. The math overlay (Commit 2) used a single insertion seam in the `forecastProjection` useMemo with the helper added to the dep array — no other call sites needed to change because every downstream consumer reads `scenarioProjection`.
- The "Today is invariant to Forecast UI state" guarantee from sub-phase 2c.2 was a quiet regression introduced by 2c.2 itself (the new posture-aware series's length followed the user's Forecast range selector). Commit 0 (`dd9b038`) restored the invariant by slicing to a fixed 12-month window inside `detectSignals` and `getCoreConstraints`. Without that restoration, Commit 2's overlay would have made long-horizon events surface on Today as a function of where the user last clicked on the Forecast page — a non-obvious dependency that is now closed.
- Commit 3 added an explicit "Included in forecast" pill plus a helper sentence per event row, then was reverted. The truthfulness gap no longer needed extra copy once the forecast line, table, marker, and Today signal all moved with the event. The badge was correct as a placeholder when math was silent (pre-Commit-2); after Commit 2 the product behavior became self-evident and the copy turned redundant. This is not a general "say nothing" principle — it's specific to surfaces where downstream behavior already communicates the fact the copy was meant to assert.

**What's next (carried forward):**

- Long-horizon UX boundary on Forecast page — communicate the 12-month confidence boundary when users select 2y/3y horizons. Especially relevant now that recurring events can extrapolate visually beyond the composer cap via the caller-layer month-of-year repeat.
- Remove the AR/AP days Settings slider and any remaining AR/AP terminology from UI surfaces. The Engine carry layer in `compute.ts` stays for backtest compatibility but should carry an explicit "not user-surfaced" comment.
- Visibility/exposure of the `enabled` flag on Cash Events. Today the schema honors `enabled = false` (overlay skips disabled events) but the row UI has no toggle to set it. Either add a toggle or document that disabling currently requires DB-direct edits.

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
5e31ad8  fix(ai-prose): round dollars to $K and lock reserve ratio to percent
fe3d661  docs: update narrative entry to reflect final intent-based rule
1481436  docs: tighten suggested-change format rule to intent-based criteria
5051039  docs: narrative entry for suggested-change format rule
03cc755  docs: add suggested-change format rule to CLAUDE.md
2e31aa0  docs: narrative entry for Trigger B switch to GitHub Sync now
94e0789  docs: switch Trigger B from re-upload to GitHub Sync now
```

**Working tree:** clean
**Active branch:** main
**Last updated:** May 9, 2026
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
- `priority_history` ← created in Phase 3 (see Phase 3 closeout entry below for confirmation). The earlier "NOT YET CREATED" note is superseded.

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

---
## May 6, 2026 — UI Lab canonical components, three shipped
UI Lab repurposed as the canonical component reference. Three locked
references built from DevTools-extracted TailAdmin specs, each as a
standalone primitive with its own BEM namespace.
### Source-of-truth rule (locked May 6, 2026)
For UI components built in UI Lab as canonical references:
> TailAdmin native specs (DevTools-extracted computed values) win on
> visual appearance. Project tokens win where deliberately overridden
> (`--bg-muted` = `#F2F4F7`, etc.). When unclear, ask before guessing.
The canonical TailAdmin demo is `https://demo.tailadmin.com` and its
sub-routes. The free React repo is incomplete (only 1 of 7 dashboards);
Pro dashboards (AI, Sales, etc.) require DevTools extraction from the
live demo.
### Three canonical components shipped
**`.metric-card`** — Source: TailAdmin demo `/ai` "Users" tile
- Bordered shell, 20px padding, 16px radius, `#FFFFFF` bg
- Header (label left + icon right) → hero h2 (`30px/36px/600`, `#1D2939`)
  → footer (subtitle left + delta right)
- Up-delta color `#039855` (success-text), icon color `#637AEA` (brand-400)
- Icon stroke uses `currentColor` driven by CSS — project deviation from
  TailAdmin's hardcoded SVG attr. Centralizes color in CSS.
**`.revenue-card`** — Source: TailAdmin demo `/sales` "Total Revenue" tile
- Borderless shell, 20px padding, 12px radius, `#FFFFFF` bg
- Two-row anatomy: header (title-block with nested delta, icon right) +
  hero row (h2 50% width + sparkline 50% width, `align-items: flex-end`)
- Title h3 `16px/24px/600`, `#344054` (new "Card title (medium)" role)
- Sparkline: ApexCharts area, 99×70, stroke `#12B76A` 1px, gradient
  `rgba(18,183,106,0.55)` → `rgba(137,219,181,0)`, smooth curve,
  `chart.sparkline.enabled = true`. Series + options live as
  module-scope fixtures in `Dashboard.tsx` (`UI_LAB_SPARKLINE_SERIES`,
  `UI_LAB_SPARKLINE_OPTIONS`); lift to shared lib when second sparkline
  card needs them.
- Icon accent `#12B76A` (success-accent) is distinct from `#039855`
  (success-text). Two greens, two roles.
**`.statistics-card`** (shell only — chart pending) — Source: TailAdmin
demo `/sales` "Users & Revenue Statistics"
- Bordered shell, 24px padding, 16px radius
- Title h3 `18px/28px/500`, `#1D2939` (new "Card title (large)" role)
- Header `margin-bottom: 32px` — chart-card rhythm distinct from
  metric/revenue cards
- Tabs locally scoped: `.statistics-card__tabs` (44px wrapper),
  `.statistics-card__tab` (40px buttons, padding 10px 12px),
  `.statistics-card__tab--active`. Do NOT consolidate with global
  `.segmented-toggle` — that pattern is calibrated to a smaller
  40/36/8 scale and has 7+ consumers. Two scales coexist deliberately.
- Chart container `.statistics-card__chart`: 250px height, 100% width,
  empty. ApexCharts implementation is Prompt B (next session).
### UI Lab page additions
- `.ui-lab-preview-width` (default 365px) — MetricCard, RevenueCard
- `.ui-lab-preview-width--wide` (800px) — StatisticsCard, future
  chart-cards. 800px chosen for spec validation fidelity (wide enough
  to keep ApexCharts axis label spacing and gradient behavior matching
  TailAdmin's 1011px render without compression artifacts).
- Each card sits under a `.ui-lab-section` label with TailAdmin source
  URL and "Locked spec, 2026-05-06" subtitle.
### Doc reconciliation deltas (shipped May 7, 2026)
UI_RULES.md (+222 lines) and UI_CARDS.md (+104 lines) updated in the May 7 session.
All 14 deltas applied. See branch `claude/stoic-chaum-f90bfd`. Delta list below for reference.
1. **Brand-400** `#637AEA` — new entry in Brand color table (icon
   color on metric cards)
2. **Success text** `#039855` — distinct from semantic success
   `#12B76A`. Add as a separate role: "Success text on white" vs
   "Success accent (filled badge / icon)"
3. **Borderless 12px card shell** — new pattern. UI_RULES.md and
   UI_CARDS.md assume bordered 16px radius as default. Borderless
   12px needs its own anatomy entry
4. **Card title (medium)** `16px/24px/600 #344054` — new text role
   distinct from existing hero/label scales
5. **Card title (large)** `18px/28px/500 #1D2939` — new text role
6. **Card padding scales** — 20px (metric/revenue cards) vs 24px
   (chart-cards). Document both
7. **Header margin-bottom 32px** — chart-card rhythm
8. **`#344054` "Card title" text color** — distinct from `#1D2939`
   (Primary) and `#667085` (Secondary). Add to Text colors table
9. **Icon implementation pattern** — project standard is
   `stroke="currentColor"` with color driven by CSS class.
   TailAdmin sometimes hardcodes `stroke="#xxxxxx"` on SVG attrs;
   we deliberately deviate
10. **Sparkline canonical config** — area, smooth, stroke 1px,
    gradient at 0.55 opacity → 0 transparent, all axes/grid/legend/
    markers suppressed, sparkline mode enabled. Document as the
    standard sparkline pattern
11. **Tab scale duality** — 40/36/8 (global `.segmented-toggle`,
    Analytics-card scale) and 44/40/10 (chart-card scale, locally
    scoped per card). Document both, document the rule for which
    to use when
12. **Pattern E "ChartTab" stale** — UI_RULES.md describes a
    `.chart-tab` class that does not exist in code. Only
    `.segmented-toggle` is implemented. Dedup
13. **Chart axis label color** `#373d3f` — new token (TailAdmin
    Sales chart spec)
14. **Chart grid color** `#e0e0e0` — TailAdmin Sales spec uses this;
    UI_RULES.md currently has `#EAECF0` as chart grid. Project drift
    from TailAdmin native. Reconcile (likely TailAdmin wins per
    source-of-truth rule)
### Locked files unchanged this session
All standard locked files per CLAUDE.md remain untouched.
`compute.ts`, `cashFlow.ts`, `contract.ts`, `sharedPersistence.ts`,
all priorities files, all locked components — unchanged.
### Next session
Prompt B: `.statistics-card` ApexCharts implementation. Series,
legend, tooltip, axes, grid, crosshair. Tooltip reconciliation
against existing global ApexCharts tooltip rules — diagnosis-first,
scope local if global drifts. Recommended: complete the doc
reconciliation pass (items 1–14 above) BEFORE Prompt B so the
component build references current docs.

---

## May 7, 2026 — StatisticsCard chart shipped + doc reconciliation

### Doc reconciliation pass shipped
14 deltas captured across UI_RULES.md (+222 lines net) and
UI_CARDS.md (+104 lines net). Brand-400 #637AEA, success-text/accent
split (#039855 vs #12B76A), borderless 12px shell, card-title medium
(16/600/#344054) and large (18/500/#1D2939), fixed-scale padding
(20px metric/revenue, 24px chart-card), 32px chart-card header rhythm,
Pattern E stale-doc cleanup, tab scale duality (40/36/8 global vs
44/40/10 chart-card), currentColor icon pattern, canonical sparkline
config, axis label #373d3f, chart grid reconciled to #e0e0e0
(TailAdmin source-of-truth). Merged via PR #10.

### StatisticsCard ApexCharts shipped (Prompt B)
The empty `.statistics-card__chart` container from May 6 is now
populated. Two area series (Online Sales #465fff, Offline Sales #9cb9ff)
with 0.45 → 0 gradient. Custom JSX legend top-left per Pattern C
(deviated to two named siblings — `.statistics-card__legend` +
`.statistics-card__chart` — instead of anonymous wrapper, since the
two children don't need a shared parent for layout). Solid grid
`#e0e0e0` (first compliant chart with reconciled docs; production
charts still on `#EAECF0`, sweep tracked at Later/P3). Axis labels
`#373d3f`. Crosshair `#b6b6b6` 1px dash-3, styled by global CSS only
(redundant per-chart config skipped). Tooltip behavior matches global
spec on every value except marker size — local override of 6px (vs
global 8px) scoped to `.statistics-card`, documented inline. Local
fixtures (`STATISTICS_CARD_CATEGORIES`, `STATISTICS_CARD_SERIES`,
`STATISTICS_CARD_OPTIONS`) live in `Dashboard.tsx` alongside the
existing UI Lab section — no carve-out to `src/components/UiLab/*`
yet. Merged via PR #11.

### Locked decisions
- StatisticsCard tooltip marker override is per-card, not global
- Legend two-sibling structure is a documented minor deviation from
  Pattern C (acceptable when shared parent isn't needed for layout)
- Crosshair styling lives in global CSS only — per-chart ApexOptions
  duplication explicitly avoided

### Locked files unchanged this session
All standard locked files per CLAUDE.md remain untouched. Doc files
(UI_RULES.md, UI_CARDS.md, wx_cfo_scorecard_context_v2_6.md) edited
in the doc reconciliation pass only — not touched by Prompt B.

---

## May 7, 2026 — chartTokens infrastructure + snapshot drift rule

### Shipped to main

- `95820db` (PR #13) — fix(charts): grid color #EAECF0 → #e0e0e0 in
  OwnerDistributionsChart and ProjectedCashBalanceChart
- `b41869f` (PR #13) — fix(persistence): detect silent truncation in
  requestAllRows. Inline fetch with `Prefer: count=exact` to read
  `Content-Range` header. Console.error on mismatch, console.warn at
  80% of PAGE_SIZE. Verified live against Supabase: 4,851 rows / 4,851
  total, no truncation, no warn.
- PR #14 — docs: add "Snapshot drift check (line-level edits)" rule
  to CLAUDE.md
- PR #15 — docs: reconcile chart grid color token in UI_RULES.md
  (added production-commit reference, preserved historical narrative
  per option (a))
- `b5c90e1` (PR #16) — feat(ui): create chartTokens.ts as single
  source of truth. 12 canonical tokens, no consumers yet.

### Decisions locked

**Snapshot drift rule.** Project file snapshots in `/mnt/project/`
may drift from main and cannot be trusted for line-level edits.
Before any diff, str_replace, or line-numbered patch, the
implementing agent must read the live target file. Mismatch halts
the task. Codified in three places: User Preferences, Notion CLAUDE.md
template, and live CLAUDE.md.

**chartTokens.ts spec — 12 tokens:**
- Brand: brand `#465FFF`, brandSecondary `#9CB9FF`, brand400 `#637AEA`
- Semantic: success `#12B76A`, successText `#039855`, error `#F04438`,
  warning `#F79009`, pressure `#DC6803`
- Structural: gridBorder `#e0e0e0`, axisText `#667085`,
  axisTextSales `#373d3f`
- Text-on-chart: chartTextStrong `#344054`

**Inline-white exception.** `#FFFFFF` is the only hex literal
permitted inline in ApexCharts options objects (stroke separators,
marker fills). Documented in chartTokens.ts JSDoc.

**Orphan hex policy.** `#FB5454`, `#b6b6b6`, `#89DBB5`, `#9ca3af`
decided commit-by-commit during per-chart migration, not pre-added
to chartTokens.ts.

**NetCashFlowChart drift policy.** Existing Tailwind-palette values
(`#ef4444`, `#6b7280`, `#9ca3af`, `#E4E7EC`) NOT preserved via
additional tokens. Accept visual change toward TailAdmin canonical
palette during migration. Rationale: card system-wide is converging
on TailAdmin native; preserving one-off drift institutionalizes it.
Migration PR must include side-by-side screenshot for review.

### Migration plan (Notion: 359ad957-9339-81e8-8ba6-ec81c713295a)

Five planned migration commits, in order; DigHereHighlights is deferred:
1. OwnerDistributionsChart (smallest safe first)
2. TopCategoriesCard (confirms #FFFFFF inline exception)
3. Dashboard.tsx UI-Lab consts (lowest blast radius, casing drift cleanup)
4. ProjectedCashBalanceChart (forces #344054 token use; #b6b6b6 decision)
5. NetCashFlowChart (highest risk; visual change accepted)
6. DigHereHighlights deferred pending product confirmation on #FB5454

### Learned

- Diagnosis-first surfaced 4 chartTokens spec gaps that would have
  become silent drift if we'd shipped from the canonical 11.
- Per-chart migration is correctly scoped as five commits, not one big
  bang. Each is independently revertable.
- `Prefer: count=exact` is now the standing pattern for paginated
  Supabase fetches.

### May 7, 2026 (afternoon) — chartTokens migration complete

Branch: `claude/goofy-faraday-1158f7` merged to main via PR #18
(rebase merge). All 6 commits live on main; branch and worktree
removed.

Migration sequence (rebased SHAs on main):
- 4ee2e72 — OwnerDistributionsChart
- 5b82798 — successGradientEnd token added (#89DBB5)
- d282daa — Dashboard.tsx UI-Lab consts
- 91865bd — crosshairStroke token added (#b6b6b6)
- 26e86d8 — ProjectedCashBalanceChart
- 945f3ac — NetCashFlowChart (drift heal)

TopCategoriesCard skipped — already compliant.
DigHereHighlights deferred — pending product call on #FB5454.

chartTokens.ts now has 14 tokens. Two added during migration:
- successGradientEnd '#89DBB5' (gradient fade-to for sparklines)
- crosshairStroke '#b6b6b6' (subtle reference lines: crosshairs,
  zero-line annotations)

NetCashFlowChart drift heals (Tailwind palette → TailAdmin canonical,
intentional and accepted):
- ef4444 → F04438 (red, 4 gradient stops)
- 6b7280 → 667085 (axis labels, 2 occurrences)
- E4E7EC → e0e0e0 (grid border, 1 occurrence)
- 9ca3af → b6b6b6 (zero-line, folded into crosshairStroke)

Locked decisions:
- One-off color use does not earn a dedicated token. #9ca3af folded
  into crosshairStroke rather than spawning a new zeroLine token.
- "Drift is healed, not preserved" — when a Tailwind-flavored hex
  encounters a TailAdmin canonical, the canonical wins. Do not invent
  tokens to keep old hexes alive.
- Codex prompt template no longer includes "WAIT for me to review"
  clause — review gate lives between Wes and Claude (chat), not
  between Wes and Claude Code.
- Doc workflow split: spec docs (UI_RULES.md, chartTokens.ts) commit
  alongside the code that depends on them on the feature branch;
  narrative docs (this file, session logs) commit only on main after
  merge. Keeps one visible source of truth across worktrees.

---

## May 8, 2026 — afternoon session — AI proxy local smoke test passed (Path B)

### Shipped to main

- `e485a2e` — docs: reconcile May 10 end-of-session block + dispose
  redundant worktree. Updates the May 10 entry's End-of-session
  block to reflect actual post-close state (main HEAD `8fa8907`,
  three `claude/*` deferred-hygiene branches classified
  merged-and-removed and deleted). Removes redundant worktree
  `claude/crazy-satoshi-9c5cd3` (identical to main, no unique
  content). Single narrative-doc commit, pushed.

### Smoke test passed — `feat/ai-proxy-scaffold @ 88990c2`

Path B local smoke test against `supabase/functions/ai-proxy/index.ts`
ran via `deno run --allow-net --allow-env`. All four README scenarios
passed:

- OPTIONS allowed origin (`http://localhost:5173`) → 204 + correct
  CORS headers
- OPTIONS disallowed origin (`https://evil.example.com`) → 403,
  no CORS headers, no body leak
- POST without secret → 200, `secret_loaded: false`
- POST with secret loaded via `set -a; . supabase/.env; set +a` →
  200, `secret_loaded: true`

CORS allowlist works in both directions. Fail-closed verified.
Secret loading via `Deno.env.get('ANTHROPIC_API_KEY')` correct in
both states. No secret echoed in any response, header, or log.
The May 9 locked architecture's CORS + secret-isolation surface
is verified end-to-end at V0. Scaffold unchanged; no new commit
on the branch.

### Decisions locked

**Path B accepted (`deno run` over `supabase functions serve`).**
Initial attempt with `supabase functions serve ai-proxy --env-file
supabase/.env` failed at boot: CLI 2.98.2 gates `functions serve`
on `supabase start` having been run first, which would download
multi-GB images (Postgres, Auth, Realtime, Storage, Studio) and
create `config.toml`/Postgres state in the scaffold worktree.
Read-only diagnostic confirmed `index.ts` has zero imports and
uses only `Deno.serve` + `Deno.env.get`, so it runs standalone
under Deno with no functional difference for this scaffold's
surface (CORS, env reading, response shape). Path B accepted on
that basis. Path A remains the right call later for any function
that adds Supabase-runtime-specific imports (`@supabase/functions-js`
etc.) — the scaffold currently has none.

Boot command translation: `deno serve` (Deno 2.x) requires
`export default { fetch }`; imperative `Deno.serve(handler)`
modules use `deno run --allow-net --allow-env` instead.

**Production deploy deferred to a fresh session.** May 9 plan
explicitly named "Anthropic wiring is the second prompt" implying
a session boundary between scaffold verification and integration.
Recommendation for V1: manual `supabase functions deploy` over
GitHub Actions pipeline. One deploy doesn't justify the workflow
file plus `SUPABASE_ACCESS_TOKEN` secret management. Manual deploy
is one command, takes seconds, produces a clear log. Pipeline is
reasonable later if/when deploy frequency justifies it.

### Workflow clarifications captured

**Freshness hierarchy when sources conflict.** Closer-to-now wins:
live repo + live backlog > handoff State block > project file
snapshots > narrative entries. When the handoff conflicts with a
snapshot, the handoff wins. When State conflicts with narrative,
State wins. Branches, items, or open threads named in narrative
or older snapshots but absent from State should be treated as
closed, not as drift. Surfaced when the receiving chat correctly
read the May 10 narrative entry and flagged the three `claude/*`
branches as drift — they were deleted earlier in the May 10
session, but the narrative entry's End-of-session block had frozen
pre-close state. The freshness hierarchy resolves this for future
receiving chats without manual override each time.

**Project-snapshot upload, not chat-upload.** Project file snapshots
used by the chat (read-only mounts) refresh only via the project
settings UI (Project → Files → replace), not by dragging a file
into the chat. Chat-only re-upload looks like it worked but leaves
new chats reading the pre-edit version. Surfaced this session when
the reconciled `wx_cfo_scorecard_context_v2_6.md` was uploaded to
the chat first; the next chat would have read the stale
pre-reconciliation version. The project-level upload is now in the
close checklist.

### Open follow-ups

- `claude/sweet-wing-96cf4b` — orphan local branch surfaced during
  this session's Step 6 enumeration. At `8fa8907` (= pre-`e485a2e`
  main HEAD), 0 ahead / 0 behind, no unique commits. Disposition
  deferred to Step 6 of this close.
- Production deploy of `feat/ai-proxy-scaffold @ 88990c2` (manual
  `supabase functions deploy` recommended), followed by production
  smoke test against deployed URL, followed by merge to main and
  branch deletion.
- After deploy: Anthropic integration prompt (the second prompt
  per May 9 plan) — wires `callAIProvider` to the deployed proxy,
  removes the stub, kicks off the cache work that depends on it
  (Notion item `35aad957-9339-818c-a8fa-ccc27e07879c`).

### End-of-session repo state

Per the commit-ordering rule, this block describes draft-time state.
The session-end disposition for `claude/sweet-wing-96cf4b` will land
in a follow-up step or follow-up session.

- main HEAD: `e485a2e` (reconciliation commit from this morning,
  pushed)
- `feat/ai-proxy-scaffold` HEAD: `88990c2` — one commit ahead of
  main, unmerged, not pushed; smoke-test verified locally
- Remaining branches: `main`, `feat/ai-proxy-scaffold`,
  `claude/inspiring-shannon-4f480e` (harness),
  `claude/sweet-wing-96cf4b` (orphan, disposition pending)
- Worktrees: main + `inspiring-shannon-4f480e` (scaffold)

**Working tree:** clean.
**Active branch:** main.

---

## May 8, 2026 — evening session — AI proxy V0 deployed, smoke-tested, merged to main

### Shipped to main

- `04eef21` — Merge branch 'feat/ai-proxy-scaffold' — AI proxy V0
  deployed and smoke-tested. Non-FF merge preserving scaffold SHAs
  `88990c2` (scaffold) and `d31ae59` (README fix). Brings two new
  files into main: `supabase/functions/ai-proxy/index.ts` and
  `supabase/functions/ai-proxy/README.md`. `.gitignore` produced no
  diff — main's `6903c05` had already landed identical content.

### Deployed function

- URL: `https://gzgxcvjvoivlwaksnmxy.supabase.co/functions/v1/ai-proxy`
- Project ref: `gzgxcvjvoivlwaksnmxy` (wx-cfo-scorecard-test)
- Source: `index.ts @ 88990c2` (preserved exactly through merge)
- Deploy command: `supabase functions deploy ai-proxy --no-verify-jwt --use-api`

### Production smoke — all scenarios passed

Four base scenarios against the deployed URL:

- OPTIONS allowed origin (`http://localhost:5173`) → 204 + correct
  CORS headers
- OPTIONS disallowed origin (`https://evil.example.com`) → 403, no
  CORS headers, no body leak
- POST allowed origin (`http://localhost:5173`) → 200,
  `secret_loaded: true`
- POST disallowed origin (`https://evil.example.com`) → 403, no CORS
  headers, body `origin_not_allowed`

Three gap-closing scenarios after reviewer flagged coverage gaps:

- OPTIONS allowed origin (`https://wcpeixoto.github.io`) → 204 +
  correct CORS headers
- POST allowed origin (`https://wcpeixoto.github.io`) → 200,
  `secret_loaded: true`
- POST with no Origin header at all → 403, no CORS headers, body
  `origin_not_allowed`

Both allowlist origins now verified end-to-end. CORS fail-closed
verified on OPTIONS, POST, and missing-Origin paths.
`ANTHROPIC_API_KEY` confirmed present in deployed secrets and loads
correctly.

### Decisions locked

**`--no-verify-jwt` is required for V1 deploys.** V1 threat model is
CORS allowlist only; the function performs no JWT check. Without the
flag, Supabase's default JWT verification 401s every request before it
reaches `index.ts`. Verified end-to-end this session. README updated
to reflect this requirement (commit `d31ae59`). This is an operational
deploy-runbook constraint that future redeploys must honor until/unless
V2 introduces JWT verification.

**`--use-api` bundles server-side; no Docker required for deploys.**
Resolves the May 8 morning gate where Docker absence blocked local
`supabase functions serve`. Deploys do not require Docker.

**Non-FF merge chosen for SHA stability.** Main had advanced five
commits past the scaffold branch point at `502b32b`, making FF
impossible. Rebase would have rewritten `88990c2` — the SHA literally
named in the May 8 afternoon entry as "the smoke-tested artifact."
Merge commit preserves both scaffold SHAs as discoverable history. The
audit trail integrity (deployed = merged = same SHA) was deemed more
valuable than linear history for this track.

**Project ref `gzgxcvjvoivlwaksnmxy` (wx-cfo-scorecard-test) is the V1
deploy target.** Confirmed pre-deploy. The `-test` suffix is
intentional for V1.

### Workflow patterns reinforced

**Pre-deploy gate before irreversible action.** The deploy track ran
as three single-purpose Codex prompts with two-AI review between them:
(1) read-only pre-deploy gate, (2) deploy + production smoke, (3)
merge + cleanup. Each prompt had hard STOPs on unexpected state. Two
real STOPs fired: FF-NOT-POSSIBLE on the first merge attempt
(corrected by switching to non-FF), and a divergence between the
handoff State block and live main HEAD (correctly diagnosed as benign
— `f85ac73` was a docs commit landed earlier in the session that
post-dated the handoff). Both STOPs caught real conditions without
escalating into incidents. The discipline prevented two silent failure
modes: rebased audit-trail SHA and out-of-date pre-flight assumption.

**Reviewer-flagged coverage gaps closed before merge.** The production
smoke initially exercised only one of the two allowlist origins
(`localhost:5173`). The reviewer flagged that the production browser
origin `wcpeixoto.github.io` was untested — logically covered by
`Array.includes()` symmetry but not verified at runtime. Three
additional curls closed the gap before authorizing merge. Pattern:
production smoke verifies, never infers.

**Non-FF merge with `--no-commit` inspection.** Pattern for any future
non-FF merge where conflict surfaces are unclear: run
`git merge --no-commit --no-ff <branch>`, inspect with
`git diff --cached`, commit only if clean, abort otherwise. This turned
a potential silent `.gitignore` conflict into an explicit verification
step. The merge produced zero diff in `.gitignore` — auto-merge
converged because main and scaffold had landed identical content from
independent paths — but the inspect step proved that, rather than
assuming it.

### End-of-session repo state

Per the commit-ordering rule, this block describes draft-time state.
The narrative-doc commit will advance main's HEAD beyond `04eef21`.

- main HEAD: `04eef21` (merge commit pushed this session)
- Active branch: `main`
- Working tree: clean
- Branches: `main`, `claude/cranky-gauss-2f0df1` (active harness for
  the chat that drove this session — expected, not orphan)
- Worktrees: main + `cranky-gauss-2f0df1` (active harness)
- AI proxy V0 deployed and live; integration prompt deferred to next
  session

---

## May 10, 2026 — AI proxy scaffold + repo hygiene pass

### AI proxy hello-world scaffolded (`88990c2` on `feat/ai-proxy-scaffold`)

Implemented the May 9 locked architecture as a deployable skeleton.
Single feature-branch commit, not merged, not pushed.
`supabase/functions/ai-proxy/index.ts` (90 lines) + README.md (117
lines) + `.gitignore` additions for `supabase/.env*` and
`supabase/.temp/`.

**Behavior:**
- CORS allowlist locked to two origins:
  `https://wcpeixoto.github.io` and `http://localhost:5173`
- Fail-closed on every origin check — no wildcard, no permissive
  fallback, disallowed origins return 403 with no CORS headers
- `Deno.env.get('ANTHROPIC_API_KEY')` presence-only check; response
  body returns `secret_loaded: <boolean>`, never the value
- 405 on non-POST/OPTIONS; generic 500 on errors with no detail
  leak
- Zero third-party imports — supply-chain surface is zero, property
  worth preserving when the Anthropic integration lands

**Verification status:**
- Manual review passed 7-row spec checklist (CORS fail-closed, no
  wildcard, no secret leak, gitignore coverage, edge cases)
- `deno check` skipped — Deno toolchain not installed locally
- Local serve smoke test **deferred** — `supabase functions serve`
  requires Docker daemon, not installed locally

The scaffold is reviewed but not executed. Commit message marks
the deferred smoke test explicitly so it cannot be mistaken for
production-ready. No `supabase functions deploy` ran. No browser-
side wiring. No `callAIProvider` modification.

### Repo hygiene pass — 14 worktrees + 44 branches removed

Audited all stale worktrees and orphan branches. Every removal
backed by evidence — patches read, intent summarized, cross-
referenced against context doc and Notion before disposal. The
methodology is the shippable artifact, not the deletion count.

**Pattern surfaced:** agent worktrees and feature branches kept
alive past the point where their work either shipped under a
different SHA (rebase/squash merge) or was superseded by parallel
mainline progress. Specific cases:
- `agent-a95e163d` (598-line "Efficiency drilldown drawer" patch) —
  byte-for-byte identical to live `EfficiencyDrilldownDrawer.tsx`
- `agent-aa2ccc28` (TopCategoriesCard tooltip refactor) — would
  have reverted the documented exception in UI_RULES.md §1004–1015,
  causing pie/donut multi-series stacking
- `nifty-banach-b0b1bc` (`computeTickAmount` x-axis fix) — already
  shipped as `d995623` (PR #5, May 5)
- `optimistic-maxwell-da29bc` (ProjectionTableV2) — already shipped
  as `1e07af0`, tagged `projection-v2-checkpoint`
- `codex/percent-delta-rounding` (chart scale fix) —
  architecturally obsolete; the file it modified (TrendLineChart
  for Net Cash Flow) was replaced by `NetCashFlowChart.tsx` in
  `b1baf05` the next day

**Output:** 14 stale worktrees removed (4 agent-* + 6 named clean-
merged + 4 named with stale uncommitted work), 44 orphan local
branches deleted (40 mechanical + 4 evaluated for unique content).

Cleanup also produced commit `843afdd` ("docs: add worktree and
branch hygiene rule"), which the May 8 entry's "Shipped to main"
list omitted. Recording it here for the narrative record.

### Operational lessons locked this session

**Recursive STOP discipline.** When a prompt's STOP catches a
missing prerequisite (Supabase CLI), and resolving that
prerequisite reveals a second prerequisite (Docker), the executor
re-STOPs. The discipline is recursive, not one-shot. Codex
executed this correctly across two retries — diagnosis-first
caught both gates before any code was written.

**Bounded override pattern.** When a verification step physically
cannot run, two-AI override is allowed only when (1) the override
is explicitly authorized at chat level, (2) verification is
deferred not skipped — the deferred verification is named in the
commit message and the handoff, and (3) production-affecting
actions (deploy, push, merge) remain locked even under override.
This is how the ai-proxy scaffold landed: scaffold + manual review
authorized, smoke test deferred to a follow-up session that
installs Docker first.

**Working state is not storage — applies to scaffolds too.** The
May 8 hygiene rule says working-tree state across sessions is
worse than a clearly-scoped commit. Today's scaffold tested that
rule against an unverified-but-reviewed artifact. Resolution:
commit on the feature branch with the deferred verification named
in the commit message, so downstream readers cannot mistake the
scaffold for production-ready.

### End-of-session repo state (reconciled)

This block was reconciled in a follow-up narrative-doc commit on
main after the original May 10 entry froze pre-close state at
draft time. Actual state at session close:

- main HEAD: `8fa8907` (this entry's commit)
- `feat/ai-proxy-scaffold` HEAD: `88990c2` — one commit ahead of
  main, unmerged, not pushed
- Three previously-listed `claude/*` deferred-hygiene branches
  (`epic-lamarr-923f2e`, `festive-goldwasser-f21174`,
  `jolly-hofstadter-fcf57b`) classified merged-and-removed and
  deleted at session close
- Remaining branches: `main`, `feat/ai-proxy-scaffold`,
  `claude/inspiring-shannon-4f480e` (harness)
- Worktrees: main worktree + harness worktree
  (`inspiring-shannon-4f480e`)

Lesson captured: a narrative entry that describes its own
end-of-session state inside the same commit that adds the entry
freezes that state at draft time. Disposition steps that run
after the doc is staged are not reflected. Future close entries
should either (a) commit disposition steps first and the
narrative entry last, or (b) explicitly mark the End-of-session
block as "draft-time state, see follow-up commit for
reconciliation."

### Open follow-ups created or materially affected today

- Three `claude/*` deferred-hygiene branches — apply the hygiene
  rule, classify each, remove or track in Notion
- Install Docker Desktop, run four-scenario curl smoke test
  against `supabase functions serve` (commands documented in
  `supabase/functions/ai-proxy/README.md`)
- After smoke test passes: deploy decision + Anthropic integration
  prompt (separate commit)

**Working tree:** clean.
**Active branch:** main.

---

## May 9, 2026 — AI proxy V1 architecture locked (discovery, not implementation)

### Discovery, not code

This session was scoping only. No code changed, no commits to source files. Output: an Opus 4.6 / Extra-High discovery report covering current `callAIProvider` state, browser-secret audit, provider comparison (Supabase Edge Function vs. Cloudflare Worker), request/response contract, cache integration seam, and determinism/retry/timeout behavior. Implementation prompts deferred to a future session.

The proxy and cache are now tracked as separate Notion items. The proxy is its own architectural layer, not a footnote on the cache work — it has independent platform choice, deploy story, secret rotation policy, and observability surface. Cache item `35aad957-9339-818c-a8fa-ccc27e07879c` carries a dependency line pointing to the new proxy item; it does not start until the proxy ships.

### The architectural principle worth preserving

**Every failure mode in the AI layer collapses back into deterministic copy with no UI branching.**

This was true before the proxy decision (the rollback path in `callAIProvider` is a one-function throw) and it stays true after. Non-2xx response, timeout, malformed JSON, validation failure, missing field, network error — all funnel through `getAIProse`'s catch into `getFallbackCopy(signal, priorHistory)`. The user never sees an error pill, banner, modal, or "AI unavailable" copy. They see deterministic prose. The Today page is a confidence surface; cycling between AI and "AI down" copy would erode trust faster than always-deterministic copy.

This principle predates the proxy and is independent of it. The proxy decision is downstream of it.

### The proxy is intentionally thin

The proxy's job is, completely: **`request in → Anthropic call → validated JSON out`**. Nothing else.

"Smartness" belongs in three other places:

1. **Prompt construction** — client-side. The system prompt lives at [src/lib/priorities/ai.ts](src/lib/priorities/ai.ts) and is sent in the request body. Prose changes ride frontend deploys. Single grep target for prompt versioning. Avoids browser/proxy version skew.
2. **Cache quantization** — client-side. `buildPriorityProseCacheKey(signal)` is a pure helper in the priorities module. The proxy has no cache awareness.
3. **Deterministic fallback logic** — client-side. `getFallbackCopy` is pure, synchronous, no I/O. The proxy has no fallback awareness.

This split exists to resist scope creep. Future feature requests against the proxy ("add user-specific personalization," "branch on signal type," "include trailing context window") fail the test: the proxy does not know about the user, the signal type, or the conversation. It is a secret-isolation and cost-protection layer, not a logic layer. If a feature requires the proxy to know more, that growth needs justification, not just convenience.

### Locked decisions

Six decisions captured in the new Notion proxy item Why field. Summary:

1. **Platform: Supabase Edge Function.** Extends existing footprint; secrets, logs, dashboards live where the rest of app state lives. The rollback path makes regional outage user-invisible, neutralizing Cloudflare's multi-region advantage.
2. **Cache placement: browser-side, read and write.** Keeps proxy minimal; preserves `AI_PROSE_PROMPT_VERSION` as single grep target for cache invalidation.
3. **System prompt location: client-side, in request body.** See above.
4. **Determinism settings: temperature `0`, max_tokens `512`, model pinned to a constant inside the proxy.** Byte-stable outputs for identical inputs. Any future drift in these values funnels through `AI_PROSE_PROMPT_VERSION` bumps to flush stale cache entries.
5. **Auth model: CORS allowlist only for V1.** Anon-key JWT verification on a publishable key is theatre, not security. The proxy is a cost-protection and secret-isolation layer, not an auth boundary. Escalation ladder if abuse materializes: signed requests → Supabase Auth → server-issued nonce. None pre-built.
6. **Failure behavior: silent fallback to deterministic copy on every non-2xx, timeout, or malformed response.** Preserves the one-function rollback path. DEV-mode console warning acceptable; PROD silent.

### Open questions before implementation

1. **Specific Anthropic model ID.** Cost note in the context doc ("$0.006–0.010 per call" at 1500-in/500-out) aligns with the Haiku tier of the current Anthropic family. Defer to live Anthropic documentation at implementation time.
2. **CI/CD path.** No GitHub Actions step exists today for `supabase functions deploy`. Manual CLI deploy vs. pipeline step with `SUPABASE_ACCESS_TOKEN` secret — decide before implementation.
3. **Rotation cadence playbook.** No rotation policy defined for Supabase secrets. Worth writing alongside the proxy launch but not blocking.
4. **CORS allowlist scope.** Production GitHub Pages origin + localhost dev. Exact list belongs in the implementation prompt.

### Next-session entry point

First implementation prompt: scaffold the Edge Function and ship a deployable hello-world that verifies CORS + secret loading. **Before any Anthropic integration.** Confirms the platform, deploy story, and secret-handling work end-to-end without entangling the Anthropic call. Anthropic wiring is the second prompt.

### Lessons captured

- **Cache work was almost started before the proxy was scoped.** Cache is downstream infrastructure; building it first means committing to architecture (cache-key shape, prompt versioning, table layout) before the thing it caches is real. Order is: proxy → first real call → then cache. Caught and corrected at session start.
- **Auth recommendations need a threat model, not just a credential mention.** "Verify the anon-key JWT" reads like security but verifies nothing on a publishable key. CORS-only is the honest answer for V1 because it doesn't pretend to be more than it is.

---

## May 8, 2026 — Documentation commit workflow + AI prose cache V1 architecture

### Shipped to main

- 1639967 — docs(chartTokens): remove stale #9ca3af orphan-list reference.
  Single-line cleanup of stale commentary; #9ca3af was folded into
  crosshairStroke during the May 7 migration but the orphan-list comment
  hadn't been updated.

- cd33668 — docs(claude): codify spec-doc / narrative-doc commit workflow.
  Adds a new top-level section to CLAUDE.md formalizing the rule that
  emerged informally during the May 7 chartTokens migration: spec docs
  commit on the feature branch alongside dependent code; narrative docs
  commit only on main after merge. Section sits between "Git discipline"
  and "Worktree and branch hygiene." Landed via docs/doc-commit-workflow-rule
  branch — first session to use a docs/ prefix for a spec-doc-only change.

### Decisions locked

**Documentation commit workflow rule.** The split is between operational
truth (main branch, Notion, shipped commits) and narrative truth
(handoffs, context docs, session logs). Spec docs include CLAUDE.md,
AGENTS.md, README.md, UI_RULES.md, UI_CARDS.md, UI_Verification_Rules.md,
SESSION_CLOSE_WORKFLOW.md, and token/type/system-definition source files.
Narrative docs include this file, handoff documents, session logs, and
migration journals. Rule rationale: prevents four timelines (feature
branch, narrative, backlog, main) from drifting into separate states.
The Hero pill QA drift caught at start of this session is the canonical
example of the failure mode the rule prevents.

**AI prose cache read path V1 — full architecture.** All eight scoping
questions (G1–G8) decided and locked. Captured as Notion backlog item
35aad957-9339-818c-a8fa-ccc27e07879c (Later, P2). Implementation
intentionally split into staged prompts (migration → helper →
persistence → integration → verification); the staging is part of the
architecture, not project management. Key decisions:
- Schema: separate priority_prose_cache table, not a column on
  priority_history. Reasons: avoids coupling cache lifecycle to
  fire-history PATCH-vs-POST logic; allows future prompt versioning;
  preserves auditability.
- Cache validity: (workspace_id, cache_key, prompt_version) match.
  No time-based expiry. Time fights determinism — same condition,
  same prose, regardless of age.
- Quantization: floor-based bucketing across all dollar metrics ($1K
  bands), 5% bands for percent funded, exact for categorical fields
  (categoryFlagged, troughMonth). Floor avoids cache-key oscillation
  at boundaries.
- Invalidation: bump AI_PROSE_PROMPT_VERSION constant, or change cache
  key composition. No flag, no env gate.
- Scope: hero-only V1. SecondaryPriority does not call getAIProse today.

**Drift detection caught and corrected.**
- Hero pill QA was Done in Notion (commit aff4491) but carried forward
  in two handoffs as unresolved. First instance of the new doc-commit
  workflow rule preventing real drift.
- DigHereHighlights deferral previously lived only as a footnote in
  the closed parent chartTokens migration's Why field. Promoted to
  standalone Notion item 35aad957-9339-813a-acdb-f94a2305c1e1.

### Discovery artifact

Codex (Opus 4.6) produced a read-only scoping report covering current
callAIProvider flow, priority_history persistence surface, candidate
cache-lookup boundaries, cache key composition analysis, freshness
signals, and fallback decision tree. Report sections A–H. Findings
informed every G1–G8 decision. Report not committed (one-shot scoping
artifact); decisions captured in Notion item Why field and this entry.

### Learned

- A discovery prompt with structured section headings produces structured
  reports. Open-ended "investigate this" produces wandering ones.
- The first enforcement action of a new workflow rule should model the
  rule it codifies. Task #2 (CLAUDE.md doc-commit rule) landed via a
  feature branch + fast-forward merge precisely because committing it
  directly to main would have weakened the rule's debut.
- Snapshot drift between project files and live repo is real and load-
  bearing. The Codex discovery prompt enforced read-live-first; the
  context-doc patch from this session does the same.

### Working tree at session end

Clean. Main only. No worktrees. No branches except main.

Open from this session:
- Notion item 359ad957-9339-8118-9000-d764b6478bf7 — "Audit
  Dashboard.tsx JSX color swatches against chartTokens" (P3 Later).
- DigHereHighlights migration tracked as standalone Notion item
  35aad957-9339-813a-acdb-f94a2305c1e1 (Later, P3) — blocked on
  #FB5454 product decision. Parent chartTokens migration is Done.

Resolved in subsequent sessions:
- chartTokens.ts orphan-list comment nit cleared on May 8, 2026
  (commit 1639967).
- Hero pill QA shipped May 7, 2026 in commit aff4491 (verified all
  10 signal × severity states). Carried forward in error in two
  handoffs after that — corrected here.

---

### 2026-05-09 — Session workflow split

The monolithic `SESSION_HANDOFF_WORKFLOW_TEMPLATE.md` was replaced by a
split workflow system at the repo root:

- `PROJECT_CONFIG.md` — shared project/workflow config (required reads,
  locked files, spec-doc list, arc signals, irreversible-action rules).
- `TASK_PROMPT_TEMPLATE.md` — implementation-prompt drafting template
  for Codex / Claude Code / other coding agents.
- `SESSION_CLOSE_WORKFLOW.md` — trigger-based session close behavior.
- `README_SESSION_WORKFLOWS.md` — map of the workflow docs.

`CLAUDE.md` now points to `PROJECT_CONFIG.md` for required-read order
rather than restating it. `README.md` gained a Workflow docs section
and dropped the obsolete `AGENTS.md` row (file does not exist in repo).

No app code changed.

## May 9, 2026 — AI proxy V1 + client wiring shipped to production

### What changed

- `38cac6e` — feat(ai-proxy): wire V1 Anthropic forwarder. Replaces V0
  echo scaffold with thin forwarder to api.anthropic.com/v1/messages.
  Server-pinned model `claude-haiku-4-5` (dated snapshot at deploy
  time: `claude-haiku-4-5-20251001`), `anthropic-version: 2023-06-01`,
  8s timeout. Forwards Anthropic's status and body verbatim;
  network/timeout failures return 502. Incoming `model` field silently
  discarded.
- `f4cfcbf` — feat(ai): wire callAIProvider to deployed proxy. Replaces
  throw stub with fetch to deployed proxy URL. Sends system + messages
  + temperature 0 + max_tokens 512; no model field. 5s
  AbortSignal.timeout. Six-category DEV-only `console.warn` on
  fallback. SYSTEM_PROMPT tightened with explicit "no markdown code
  fences" instruction. `stripJsonFences` helper used in both
  `callAIProvider` (before return) and at the `JSON.parse` site in
  `getAIProse` — defense in depth.
- `b7308d4` — Merge AI proxy V1 + client wiring (non-FF, preserves
  both feature SHAs).

### Why it matters

Today page hero prose now renders from real Anthropic Haiku 4.5 calls
on every render at `https://wcpeixoto.github.io/wx-cfo-scorecard/`.
The May 9 architectural invariant ("every failure mode collapses to
deterministic copy with no UI branching") verified end-to-end against
the production origin: every non-2xx, timeout, parse error,
validation error, network error, or unknown error throws and is
caught by `getAIProse`'s existing try/catch, routing to
`getFallbackCopy(signal, priorHistory)`. The user never sees an error
pill, banner, or "AI unavailable" copy.

The cache layer (Notion `35aad957-9339-818c-a8fa-ccc27e07879c`) is
now unblocked — its only dependency was this client wiring landing.

### Current state

- main HEAD: `b7308d4`, pushed
- AI proxy V1 deployed at
  `https://gzgxcvjvoivlwaksnmxy.supabase.co/functions/v1/ai-proxy`
- Production-origin browser smoke verified: OPTIONS 204, POST 200,
  hero card prose is real Anthropic output (sample headline: "Your
  cash cushion is solid but still building"), no console errors,
  no error UI
- Per-call cost surface live: ~346 input + ~184 output tokens at
  Haiku 4.5 list price. CORS allowlist is the only auth boundary;
  any actor with `Origin: https://wcpeixoto.github.io` can incur
  Anthropic spend via curl. Documented accepted risk per May 9
  architecture.
- Working tree: clean. Branch `claude/loving-borg-6fc924` and its
  worktree removed.

### Next step

Two follow-ups in Notion:

- `35bad957-9339-81d5-8c1e-df2110b274c2` (P2, Next) — AI prose copy
  refinements. Production smoke surfaced two formatting drifts:
  exact dollar amounts ($14,091) instead of operator-rounded ($14K),
  and multiplier units (0.59x) in body prose despite percentage in
  headline (59%). Fix is SYSTEM_PROMPT edit. Coordinate with cache
  prompt's invalidation strategy.
- `35bad957-9339-819a-bfbe-eef014637cb5` (P3, Next) — Worktree/branch
  sweep. Five carry-over `claude/*` worktrees and four orphan
  branches remain from prior sessions. Out of scope for this close;
  audit when convenient.

Cache prompt (`35aad957-9339-818c-a8fa-ccc27e07879c`) is unblocked.
Latency is the implicit promotion trigger — if real-use feedback
shows hero feels sluggish, escalate from Later to Next.

### Lessons

- Markdown fence stripping at the parser site is load-bearing, not
  hypothetical. Live smoke against the V1 proxy showed Haiku 4.5
  wraps JSON output in ` ```json ... ``` ` fences even under a
  SYSTEM_PROMPT that explicitly forbids it. Without the
  `stripJsonFences` defense in depth, every prose render would
  silently 100%-fall-back to deterministic copy with no user-visible
  error and no obvious diagnostic — exactly the silent-failure mode
  CLAUDE.md flags as the worst kind. Belt and suspenders earned its
  keep.
- Production-origin browser preflight is not interchangeable with
  curl from an allowlisted origin. Curl proves wire shape; only a
  real browser proves the deployed bundle's preflight + render path.
  Reviewer note 1 from the merge-prep review correctly insisted on
  the browser smoke before declaring V1 shipped.
- Sandboxed agent reports of "site is 404" need grounding before
  conclusions. The deployed Pages URL was `/wx-cfo-scorecard/`, not
  the user-site root — Codex hit 404 at the wrong URL and inferred
  the site was down. The deploy was fine; the smoke instructions
  were the broken thing.

## May 9, 2026 — AI prose cache Steps 1–4 implemented

### What changed

Five-step implementation of the AI prose cache locked in the May 8 architecture. Steps 1–4 landed on feature branch `claude/infallible-nightingale-a67687` over the course of the session; Step 5 (end-to-end verification) was deferred to May 10 after a verification incident surfaced a methodology gap.

- Step 1 — `priority_prose_cache` table created in `wx-cfo-scorecard-test`. RLS mirrors `priority_history`. Manual Supabase migration, not in repo.
- `36a488a` — feat(priorities/cache): cache key + prompt version. `buildPriorityProseCacheKey` and `AI_PROSE_PROMPT_VERSION` in `src/lib/priorities/cacheKey.ts`. 25 vitest tests covering every `SignalType` and every G4 quantization rule.
- `e041016` — feat(priorities/ai): extend `AIProse` shape. Step 3 diagnosis surfaced that the `priority_prose_cache` row shape required `signalType` and `severity` on `AIProse`, which the Step 2 cache-key work had not anticipated. Inserted Step 2.5 mid-implementation: extended the interface, updated the validator, updated `getFallbackCopy` to populate both fields from the source `Signal`. Locked-file scoped edit. No prose-field logic changed.
- `acd793f` — feat(persistence): `getCachedProse` and `saveCachedProse`. Locked-file scoped edit to `src/lib/data/sharedPersistence.ts`. Both helpers take `workspaceId` as a parameter — first helper pair in this file to do so. Upsert uses explicit `updated_at = new Date().toISOString()` on conflict, no DB trigger. `getCachedProse` does not throw — read errors degrade as cache miss.
- `d51b8a8` — feat(priorities): wire AI prose cache into `getAIProse`. Read seam inside the outer try/catch (defensive against future regression in `getCachedProse`). Write seam fires `saveCachedProse` after `savePriorityHistory` on AI success only, fire-and-forget. Fallback control flow unchanged except for the added identity fields from Step 2.5.

### Why it matters

The cache architecture is end-to-end implemented but not yet shipped. Every AI failure mode still collapses to deterministic copy. When the cache hits, the user-facing return value is identical to the AI-generated prose with no provider call. The May 8 architectural invariants (G1–G8) are all satisfied in code.

### Decisions locked

- Cache read placement inside the outer try/catch, not above it. Two safety nets: the Step 3 contract that `getCachedProse` doesn't throw, and the outer try/catch in `getAIProse`. Per G8, missing-table or read errors degrade as cache miss and never break the hero card.
- Cache writes are fire-and-forget. Awaiting them would couple the user-facing return value to a write that has no effect on what the user sees. `saveCachedProse` swallows its own errors internally.
- Step 2.5 inserted mid-implementation rather than retrofitted. Once Step 3 diagnosis surfaced the type-shape gap, fixing it upstream was cleaner than threading a `Signal` parameter through the persistence helper.

### Verification incident

Step 4 verification ran a smoke that called `getAIProse` with a mock `cash_flow_negative` signal against the default `workspace_id`. `savePriorityHistory` PATCHes existing rows within a 7-day dedupe window when `signal_type` matches, so the smoke mutated a real production fire row from earlier the same day. The cleanup step then deleted that mutated row by `ai_headline` pattern.

Lost permanently from the original production row: `ai_headline`, `severity`, `metric_value`, `target_value`, `gap_amount`, `recommended_action`, `category_flagged`. Preserved: `signal_type`, `fired_at` (`2026-05-09 22:44:02.036875+00`), `workspace_id`. Functional impact bounded — the next `cash_flow_negative` fire restores the row functionally; no UI surface or financial calculation broken.

Methodology fix recorded as Notion `35bad957-9339-811b-adb6-e1c215591cda`. Future AI-layer smokes must isolate from production data via dedicated test `workspace_id`. Step 5 prompt to be drafted next session with the requirement explicit.

### Current state

- Feature branch `claude/infallible-nightingale-a67687`, HEAD `d51b8a8`, four commits ahead of `origin/main`, unpushed pending Step 5.
- Working tree clean.
- Production data loss bounded and documented.
- Notion `35aad957-9339-818c-a8fa-ccc27e07879c` (cache item) status: Now. Implementation status synced in the Why field with all four commit SHAs.

### Next step

Step 5 — end-to-end verification on dev with isolated `workspace_id = 'verify'`. Then push, open PR, two-AI review for merge to main per `PROJECT_CONFIG.md`.

### Lessons

- Diagnosis-first caught real spec drift twice in the same implementation. Step 3 diagnosis surfaced the missing `signalType`/`severity` fields on `AIProse` before Codex wrote any persistence code — would have produced an invalid-row write otherwise. Step 4 diagnosis caught that the Step 4 spec's pseudocode had glossed over the inner try/catch around `savePriorityHistory`, which had to be preserved exactly. Both surfaces caught before code was written. The phase-gate discipline pays for itself the first time it surfaces a finding that would have produced wrong code.
- JSONB byte-equal vs value-equal. PostgreSQL JSONB stores parsed key-value pairs and reserializes on read, so byte-stable output through a JSONB round-trip is not achievable. The Step 3 spec said "byte-for-byte"; Codex correctly flagged the impedance mismatch and used deep-equal. Future cache specs say value-equal.
- Locked-file scoped authorization works as a discipline. Three separate locked-file edits this implementation (`ai.ts` for Step 2.5, `sharedPersistence.ts` for Step 3, `ai.ts` for Step 4). Each scoped to a specific change with diagnosis surfacing every proposed line range before edits. Zero scope creep across all three.
- Working state is not storage. The verification incident lost recoverable detail because the smoke ran against the live workspace. Methodology fix is a dedicated test `workspace_id` enforced via env-launched runner. The discipline must be implemented as a process boundary, not a code convention — `WORKSPACE_ID` is a module-level constant resolved at import, so the env override has to be set before the runner starts.

---

## May 10, 2026 — AI prose cache shipped to main as `190c295`

### Shipped to main

- `190c295` — squash merge of PR #20 ("AI prose cache read path (Steps 1–5)"). Six feature-branch commits collapsed to a single SHA on main: `36a488a`, `e041016`, `acd793f`, `d51b8a8`, `78111ed`, `9a7e35c`. Remote branch deleted on merge. Local worktree and branch removed post-merge. Merged at `2026-05-10T02:37:32Z`.

### What changed

- Step 5 — end-to-end verification with isolated `workspace_id = 'verify'`. Throwaway script under `scripts/`, env-launched via `vite-node` (`VITE_SHARED_WORKSPACE_ID=verify npx vite-node scripts/verifyProseCache.ts`), deleted after run. Four scenarios passed: empty-cache miss, cache hit on reload, second-bucket miss, fallback path on proxy 500. Production rows untouched.
- `78111ed` — fix(priorities/cache): add prior-direction dimension to cache key. Two-AI review (ChatGPT, first pass) caught a determinism gap: `getAIProse` fed `priorHistory` into the prompt via `buildUserMessage`, but `buildPriorityProseCacheKey(signal)` keyed only on the current signal. Prose generated under prior-history context A could be served to readers under context B. Fix extracted direction classification into `src/lib/priorities/direction.ts` (single source of truth for both prompt path and cache key). New `classifyPriorDirection` wrapper maps null prior to `p_none` before any signal-type logic — `steady_state` with null prior maps to `p_none`, not `p_unchanged`. Cache key signature: `buildPriorityProseCacheKey(signal, priorDirection)`. `AI_PROSE_PROMPT_VERSION` bumped `v1` → `v2`. Identity-field safety comment in `ai.ts` corrected to credit `validateProseResponse` filtering, not spread order.
- `9a7e35c` — fix(priorities/cache): restore SEP + remove raw prior fields from prompt. Two-AI review (ChatGPT, second pass) caught two blocking findings. First, `cacheKey.ts` had `SEP = ''` (likely an editor-strip during the `78111ed` edit); existing 31 cache-key tests silently passed because they asserted round-trip determinism. Restored to `'\x1f'` and added a structural test asserting `key.split('\x1f')` returns exactly the expected five-part array with `length === 5` regression guard. Second, `buildUserMessage` still emitted raw `priorHistory.fired_at` and `priorHistory.metric_value` into the prompt; both were materially prose-shaping (magnitude/intensity, recency) and were not in the cache key. Removed both. Direction-only prior-history context is sufficient for owner-level decision support and matches the cache-key contract: every prior-history-dependent prompt branch is now represented by the cache key.

### Why it matters

The hero card now caches AI prose by signal shape and prior-direction. Repeat renders skip the provider call and return identical prose. Cache determinism is provable: every input that varies the prompt is represented in the cache key. The verification methodology that emerged from the May 9 incident is documented and reusable.

### Decisions locked

- Prior-history context in the AI prompt is direction-only. Raw `fired_at` and exact `metric_value` are not emitted. The five-bucket direction token (`p_none`, `p_improved`, `p_worsened`, `p_unchanged`, `p_unknown`) captures all prose-relevant prior-history semantics.
- Cache and prompt cannot drift. Both consume direction output from `direction.ts`. The prompt path uses the raw direction string; the cache-key path uses the bucket token. One source, two consumers.
- `v1` cache rows are abandoned, not migrated. The unique constraint `(workspace_id, cache_key, prompt_version)` prevents collision; stale rows are inert.
- Cache-key tests must include structural assertions, not only round-trip determinism. Round-trip determinism tests silently pass on regressions where both sides change identically (the `SEP = ''` regression is the canonical example). Future cache-format work includes structural assertions on key parts.

### Current state

- main HEAD: `190c295`, pushed.
- AI prose cache live in production architecture. First production cache-write happens on the next hero card render against a fresh signal shape.
- Working tree clean. No worktrees. No `claude/*` branches.
- Test counts: 32 cache-key tests (including the structural separator test), 13 direction tests, 84 total tests passing.
- Notion `35aad957-9339-818c-a8fa-ccc27e07879c` (cache item) ready to move from Now → Done.

### Next step

Three Notion items remain open from this work:

- `35bad957-9339-811b-adb6-e1c215591cda` (P2, Later) — Verification methodology — isolate AI cache/history smokes from production data. The validated Step 5 methodology is captured in the Why field. Stays open as durable methodology reference.
- `35cad957-9339-814f-aa0a-f3e453ba31a8` (P3, Later) — AI proxy enforces Origin allowlist — Node-based smokes must inject Origin header. Discovered during Step 5; documented for future verification work.
- `35bad957-9339-81d5-8c1e-df2110b274c2` (P2, Next) — AI prose copy refinements. Carried forward from May 9. The cache-contract bump to `v2` invalidates existing cache rows, so any SYSTEM_PROMPT change can land without coordination on cache invalidation — `v1` rows are already unreachable.

### Lessons

- Two-AI review caught two architectural gaps that single-pass review missed. First-pass review caught the cache-key/input mismatch; second-pass review caught the SEP regression and the residual raw-field emissions in `buildUserMessage`. Both findings were real and material. The discipline of routing every irreversible action through an independent reviewer paid for itself twice on a single PR.
- Round-trip determinism tests can silently mask structural regressions. The `SEP = ''` regression survived 31 cache-key tests because every test built a key and built it again — both sides changed identically. Structural tests (split on the separator, assert exact parts and count) are the load-bearing complement.
- Diagnosis-first phase-gating works at the review boundary too, not only at the implementation boundary. Each of the two ChatGPT reviews returned findings *before* the merge could happen, in time to fix and re-route. The same phase-gate discipline that catches drift in implementation prompts catches drift in approval flows.
- `WORKSPACE_ID` resolved at module load means env-launched isolation is the only correct way to route writes to a non-default workspace. `process.env` mutations inside the runner script are no-ops by the time the constant is read. The methodology fix from May 9's incident encodes this as a process boundary, not a code convention.
- Editor strips of low-byte characters are real. The original Step 2 commit likely stored `SEP` as a raw `\x1f` byte literal, which is invisible in most editors and trivially lost on a paste or save. The grep-visible escape form `'\x1f'` survives copy-paste, source control, and editor configurations that strip control characters. Future low-byte constants in the codebase should use the escape form, not the raw byte.

## May 10, 2026 — Track A truncation fail-fast shipped to main as `f3625e0`

### Shipped to main

- `f3625e0` — rebase merge of PR #22 ("feat(persistence): throw on truncated requestAllRows reads"). Single feature-branch commit `5af365a` rebased onto main; new SHA reflects GitHub's rebase-replay (new committer/timestamp), but commit message and diff are byte-identical to the reviewed artifact. Remote branch `feature/persistence-truncation-fail-fast` deleted on merge; stale remote-tracking ref pruned. Merged at `2026-05-10T12:46:30Z`.

### What changed

- `requestAllRows` in `src/lib/data/sharedPersistence.ts:168` previously detected PostgREST truncation (via `Prefer: count=exact` + `Content-Range` parse) and logged `console.error` plus an 80%-of-`PAGE_SIZE` `console.warn`, but still returned the partial array. Single boot caller `getSharedImportedStoreSnapshot` fed the result into the Today model — every signal, forecast, reserve calc, and owner distribution was downstream of that one fetch. User-visible failure mode under truncation: dashboard rendered plausible-but-wrong numbers from a partial ledger. Replaced with fail-fast: `SharedPersistenceTruncationError` (exported, `expected: number | null` to distinguish known-mismatch from missing-`Content-Range` modes) is thrown at both detection sites. The 80% `console.warn` was deleted — fail-fast supersedes its safety role. Caller behavior unchanged: `loadImportedState()` already catches thrown errors, populates `importError`, and skips `setImportedDataSet`, so truncation now surfaces through the Settings error surface instead of producing a misleading dashboard.

### Why it matters

Silent wrong-but-plausible numbers in a CFO dashboard violate the project's "Trust is non-negotiable" principle directly. A "safe" or "healthy" Today screen rendered from a partial ledger is the worst failure class the project tracks. Track A closes the gap: detected truncation now blocks the boot path, and missing `Content-Range` (which would invalidate the safety contract) also throws. The diagnosis reaffirmed that the detection code already existed — the missing piece was escalation from log to throw.

### Decisions locked

- Missing or unparseable first-page `Content-Range` is a fatal error, not a warning. The safety contract depends on `Prefer: count=exact` producing a total; without it, completeness cannot be verified. Stricter than prior behavior, intentional.
- The 80% PAGE_SIZE warning is removed permanently. Fail-fast handles the actual safety case; the early warning was a "catch it before it bites" log that loses its role once detection-with-throw exists.
- Two-AI review gate applies to the irreversible action (merge), not to feature-branch commits. Feature-branch commits are reversible. But the review packet must describe artifact state honestly — describing a committed branch when only a working-tree diff exists is the failure mode that produced the first-pass STOP this session.
- Track A and Track B are separate PRs. Track B (`shared_import_batches` boot projection) depends on Track A's fail-fast semantics and ships next. Mixing safety with optimization in one PR makes review and rollback harder.

### Current state

- main HEAD: `f3625e0`, pushed. GitHub Actions deploy triggered automatically.
- Working tree clean on main.
- Worktree at session level: main plus `jovial-wing-87949d` (this session's spawn worktree, classified abandoned-and-removable for Phase 2 disposal at session close — same pattern applied to `jolly-shirley-1e271c` earlier in the session).
- Notion `35cad957-9339-81e0-b4a9-c44ad88778be` (Track A) ready to move from Now → Done.

### Next step

Three Notion items created from this work and one carried in:

- `35cad957-9339-81de-aec4-c350851b9098` (P2, Next) — Track B `shared_import_batches` boot projection. Lowest-risk egress win identified in the diagnosis. Depends on Track A's fail-fast semantics being live, which is now true.
- `35cad957-9339-81c2-a94e-e0541246cef1` (P3, Later) — Today-level data-load error UI. Follow-up to Track A; surfaces truncation in the primary surface where the operator looks, instead of only the Settings tab.
- `35cad957-9339-8111-9331-cc4b20f68aa0` (P3, Later) — Remote branch sweep. 15 stale remote `claude/*`, `docs/*`, and `feature/*` branches surfaced during merge cleanup. Out of scope for this session, queued separately.
- `35bad957-9339-81d5-8c1e-df2110b274c2` (Done) — AI prose copy refinements. The prior handoff recommended this as the next-move; drift catch at session open found the item was already Done from May 9. Included here only because the catch shaped the session's opening sequence.

### Lessons

- Two-AI review packets must describe the artifact state honestly. The first-pass review packet for Track A described a committed branch diff (`git diff main..feature/...`), but the implementation was held at working-tree state per the original prompt's "do not commit" rule. ChatGPT correctly STOPped because the described artifact didn't exist. Fix was an explicit out-of-cycle commit-and-push step, then re-issuing the same packet against the now-real branch diff. The two-AI gate is for the irreversible action (merge), but it can only do its job if the packet matches reality.
- Rebase merge for single-commit PRs preserves diff and commit message but not SHA. GitHub's `gh pr merge --rebase` replays the commit with a new committer identity and timestamp, producing a new SHA even when nothing else changes. SHA divergence ≠ content divergence — the merge report must call this out explicitly so future audits don't read it as a deviation from the reviewed artifact.
- Codex/Claude Code role nomenclature drift surfaced mid-session. `PROJECT_CONFIG.md` describes Codex as supervisor, but `TASK_PROMPT_TEMPLATE.md` and `userPreferences` describe Codex as executor. The mismatch caused several rounds of confusion about which AI should run which prompt. Doc fix is queued separately; the operating principle holds — `Target AI:` header is the routing source of truth per `TASK_PROMPT_TEMPLATE.md`, but the template's own title line (`# Codex Task — ...`) contradicts it and reinforces the drift. Fix the title line when the doc fix lands.
- Diagnosis-first phase-gating worked again at the planning→implementation boundary. The Track A implementation prompt required diagnosis + line-by-line edit proposal before any code change. The proposal surfaced two design refinements before the editor opened — `expected: number | null` instead of a `-1` sentinel, and `from === 0` instead of `serverTotal === null` for the first-page gate. Both adjustments cleaner than the prompt's original draft; both caught at the diagnosis gate, not at the diff-review gate.
- Handoff state can drift before the next session opens. The prior handoff named AI prose copy refinements as the next active work, but the underlying Notion item had been moved to Done in the same May 9 session that shipped the cache. Drift catch ran at session open by reading Notion before acting on the handoff's recommendation. Cost was one extra read; benefit was avoiding a session spent re-shipping work that already shipped.

### May 10, 2026 — Role nomenclature reconciled, Track B boot projection shipped

**What changed**

- `a8b89ca` — PR #23 merged via rebase (replay of `bd46f29`; new committer/timestamp, content-identical). Spec-doc reconciliation: `PROJECT_CONFIG.md` AI Roles table reframed Codex symmetrically as executor; `TASK_PROMPT_TEMPLATE.md` Universal Task Prompt title `# Codex Task — ...` → `# Task Prompt — ...`. Closed Notion `35cad957-9339-816d-9106-c8dd3a23e451`.
- `53c81cd` — PR #24 squash-merged on main, aggregating `b8c4b8c` (boot projection + lazy-fetch helper) and `3bd4cf2` (round-2 finding remediation). Squash produces a new SHA on main; the merged content is the union of the two reviewed branch commits. Track B: boot fetch in `getSharedImportedStoreSnapshot` narrowed from `select=*` to 11 scalar columns; new `getSharedImportBatchById` lazy-loads JSONB example arrays when Settings → Data renders. Closed Notion `35cad957-9339-81de-aec4-c350851b9098`.

**Why it matters**

The role-nomenclature fix closes a real cross-doc contradiction the May 10 Track A Lessons section flagged: `Target AI:` is the routing source of truth, but the template title undercut it. Future prompt-drafting rides on clean canonical text.

Track B is the egress reduction Track A was the safety floor for. Boot payload drops from JSONB-bearing rows to ~370-byte scalar rows on a fetch that always runs at boot. Narrowing was only safe because Track A's hard-throw on truncation closes the silent-partial-read window — without that, a projection-induced shape regression could have been masked.

**Current state**

- main HEAD `53c81cd`, pushed.
- Working tree clean.
- Worktrees: `/Users/wesley/Code/wx-cfo-scorecard` (cross-session orphan on `claude/jovial-wing-87949d` at `23ef85d`, flagged for disposal at session close per the May 10 Track A entry) and `/Users/wesley/Code/wx-cfo-scorecard/.claude/worktrees/funny-dirac-f8b9a4` (this session's worktree, on `main`).
- Notion items closed this session: `35cad957-9339-816d-9106-c8dd3a23e451` and `35cad957-9339-81de-aec4-c350851b9098`.

**Next step**

Top-priority `Next` or `Now` items in the Notion backlog are not currently set; the open work shifts to P3 follow-ups (`35cad957-9339-81c2-a94e-e0541246cef1` Today-level data-load error UI, and `35cad957-9339-8111-9331-cc4b20f68aa0` remote branch sweep). Next session opener selects.

**Lessons**

- Two-AI review round-2 mechanics. ChatGPT correctly STOPped on PR #24 for a local-mode regression and a stale-`importId` render bug. The fix landed as a follow-up commit on the same branch (`3bd4cf2`); the same PR was re-reviewed and approved on round 2. Pattern: when round-1 findings are code-level (not workflow-level), iterate on the same branch and re-review the same PR — new-branch overhead isn't warranted for clean iteration.
- Local-mode runtime verification gap, named not papered over. Track B's local-mode render path is verified statically (TypeScript closed `'local' | 'shared'` union plus traceable IDB write → read → render) but not at runtime — seeding a minimal IDB record crashed unrelated KPI/forecast pipelines. The minimal-dataset crash is its own observability surface; flagged for the planning chat to consider as a future Notion item.
- Snapshot-refresh checklist drift caught in a review packet. The "Sync now" bullet was carried forward from a spec-doc PR's checklist into Track B's, but neither Track B file is in the snapshot-refresh list. Pattern: review-packet checklists drafted from prior packets need per-file confirmation against the snapshot-refresh list each time.
- Worktree disposal requires verifying which worktree is primary. The prior Track A entry mis-attributed `claude/jovial-wing-87949d` as Track A's spawn worktree without verifying the live worktree topology. The branch was actually a separate workflow-doc draft thread; the disposal pass discovered four commits unrelated to Track A. Three were a coherent `SESSION_CLOSE_WORKFLOW.md` improvement that shipped today as PR #25 (`064f3b6`, `aa366de`, `b4c1e46`) under rebase-replay SHAs; the fourth (`1efe082`) was intentionally dropped because PR #23 reversed its direction. Branch deleted after patch-id/content verification.
- Reviewer findings can themselves be incomplete. The disposal prompt was reviewed by both ChatGPT and Codex; Codex correctly flagged a nested-path hazard, but neither reviewer caught that the "orphan" path was actually the primary clone of the repo, not a secondary worktree. The technically-correct hazard fix was operating on the wrong mental model. Two reviewers passing an incorrect framing is a real failure mode; this addendum is the example. Future disposal prompts must verify primary/secondary status from `git worktree list --porcelain` output and repo layout, not from path naming conventions or narrative attribution.
- Narrative entries are load-bearing. The Track A entry's wrong attribution propagated forward by a full session before being caught at the disposal verification gate. Candidate rule for `SESSION_CLOSE_WORKFLOW.md`: narrative-entry drafts must be verified against live `git worktree list --porcelain` and `git log` output at draft-time, not just against the executor's running understanding. Logged as a future Notion item candidate.

---

### May 11, 2026 — Projection Table V2 shipped (clears May 6 backlog)

**What changed**

- `cee610f` — PR #7 squash-merged to main. Five commits collapsed: original feature + spec docs (`89a3857`, `0be482e`), and three pre-rebase fixes (`564f5a0` scope legacy `width: 90%` to fallback; `c1d7053` em-dash placeholder addendum; `4eb23a8` undo header restructure for Pattern G). A fourth pre-rebase fix (context-doc strip) was auto-dropped during rebase as patch-already-upstream once the conflict resolved by taking main.

**Why it matters**

V2 is now the default Projection Table on `/forecast` — left-aligned headers + cells, full-width row dividers, blank trailing total cell, locale en-US negative format. Legacy fallback preserved behind DEV-only `?oldProjectionTable=1`. Three reusable doc sections shipped alongside: `UI_RULES.md` "TailAdmin-style Data Table", `UI_CARDS.md` "Edge-to-edge Data Table Card", `CLAUDE.md` "UI replacement rollout pattern". Future data tables follow the same spec without re-deriving it.

**Current state**

- main HEAD `cee610f`. Working tree clean. Remote + local feature branches deleted. Safety tag deleted post-verification. Worktrees: 2 (primary on main, harness).

**Next step**

- Click "Sync now" — `CLAUDE.md`, `UI_RULES.md`, `UI_CARDS.md`, and this `wx_cfo_scorecard_context_v2_6.md` entry are all snapshot-refresh files (Trigger B).
- File two Notion follow-ups not yet created: mobile-wrap behavior of `.projection-table-actions` at ~375px (P3); lint script doc-drift between `PROJECT_CONFIG.md` (says "no lint runner") and project preferences (claims `npm run lint`) — `package.json` has `test` (vitest) and no `lint` (P3).

**Lessons**

- Pre-rebase fixes on a stale PR > rebase-then-fix. Four sub-task fixes landed as single-purpose commits on the feature branch before rebase; the rebase collapsed cleanly with Sub-task D auto-dropping. Reviewing each fix in isolation kept the surface tractable; rebase-first would have buried the same fixes inside conflict-resolution noise.
- Range-diff at the irreversible-action gate catches intended divergences that name-status diffs hide. Pair 2 of the pre-push range-diff showed Sub-task D's effect as content shrinkage within commit 2's patch — strict STOP-trigger reading halted; user confirmation cleared.
