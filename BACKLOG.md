# Backlog

**This file is the single source of truth for the backlog and next-steps across the project — and the priority authority for "what's next" (per `AGENTS.md`).** Notion retired 2026-06-17.

Every item carries the canonical three fields — **Result** (what changes for the owner), **Why** (the problem / risk / friction it reduces), and **Premise** (whether it is still necessary or has been overtaken) — in its body below, exactly as migrated.

**Status taxonomy:** `Now` · `Next` · `Later` · `Cleanup` · `Paused — CFO Assistant`. One section per status follows (no items are currently `Now`). A `Retention (priority)` focus band sits above `Next` (2026-06-20 reprioritization); items lifted into it keep their original status label.

---

## Retention (priority) (6)

### Churn time-series substrate probe — reconstruction feasibility

Result: A read-only, non-PII probe that determines whether a historical churn curve can be reconstructed from per-membership start + end/cancellation dates in the All-Memberships export — i.e. whether the churn-evolution chart can be backed by REAL history now, versus waiting on forward snapshots to accrue.

Why: The churn-evolution chart is blocked on time-depth — the weekly Tenure Snapshot Clock (#474) only began accumulating 2026-06-11 (~weeks deep), so a 6-month / 1yr / 2yr window is near-empty until ~Dec 2026. If the All-Memberships export carries end-dates, a real multi-year curve is buildable immediately; if not, the chart waits on snapshot accrual. This probe is the cheap read-only test that picks the path.

Premise / guardrail: §5 safe-output contract — emit ONLY field-name presence (boolean), populated coverage (counts/percent), and a feasibility verdict; NEVER member rows, names, dates, or dues. Export stays local (~/.config/wx-cfo/dues/), 0600, never committed (CFO repo is PUBLIC). Use the RAW export ("Keep the data formatted" UNCHECKED → ISO dates). Any eventual reconstruction is server-side → aggregate (§4), never member-level in the SPA. Builder drafts probe plan → Reviewer gates → then run.

### Churn-evolution-over-time chart

Result: A churn-evolution chart (follow the existing ProjectedCashBalanceChart.tsx rendering pattern + chartTokens) showing churn/retention over time, with two toggles: TIMEFRAME (6 months [default] / 1 year / 2 years / all / custom) and SEGMENT (age cohort: Kids 3–6, Kids 7–9, Teens 10–15, Adults 16+ — reuse cohortBands.ts + the per-snapshot cohort_histogram already written weekly by sync-wodify-retention).

Why: Turns the point-in-time retention cards into the first true longitudinal view — whether churn is improving or worsening, by segment, over time. The north-star retention read.

Premise / blocker: GATED on the substrate probe (prior item). HARD rule — "No fake history" (AGENTS.md:299): the time axis shows only real dated data; empty windows render honestly empty, never interpolated or fabricated. Segment axis reuses the shipped cohort bands + the weekly cohort_histogram (no schema change). Substrate = historical reconstruction IF the probe confirms end-dates, else forward snapshots (full 6-month view honest ~Dec 2026).

### Monthly Critical Groups — month-over-month delta

**Status / Priority:** Later

Result: A retention read that shows month-over-month change in the critical (at-risk / silent) groups, pairing the current snapshot with the nearest ~30-day-prior snapshot within a 21–45 day tolerance. When no clean prior match exists it shows worst-now-only, clearly labeled — never a fabricated delta.

Why: Turns the point-in-time retention snapshot into the first longitudinal signal — whether the critical groups are growing or shrinking month over month — instead of a single static reading.

Premise / blocker: Blocked on accumulated dated snapshots. The Tenure Snapshot Clock (the weekly Mon 12:00 UTC GitHub Action that upserts a dated aggregate row) builds the second delta endpoint beside the existing 2026-06-11 snapshot; the first in-band delta lands ~3–4 weekly runs out. The anchor-lock rule is already decided (nearest ~30-day-prior, 21–45 day tolerance, else worst-now-only labeled); build waits on the snapshots accumulating.

### Churn by Belt — longitudinal / seasonal

**Status / Priority:** Later

Result: A longitudinal Churn-by-Belt card — churn history across belt levels, surfacing seasonal patterns in how members progress and drop off by rank.

Why: Belt progression is a core engagement signal in a BJJ gym; a seasonal churn-by-belt read shows where on the rank ladder members are most at risk over time.

Premise / blocker: Belt data is EXPORT-FEASIBLE (not blocked) via Admin UI → People → Progressions (Current + Previous Levels, with Date Achieved) — Wodify recon 2026-06-14, read-only. But the desired card is the longitudinal/seasonal version, which needs the dated Previous Levels data plus accumulated history — a NEW pipeline, not a cross-sectional view over the live aggregate. PARKED until the cross-sectional retention cards are shipped and stable; the Progressions column-verification intake is deferred until belt comes off the park.

### Retention: Silent Churn split — Recovery card + Today polish

**Status / Priority:** Later · P3

Separate "who is at risk now" (Today, exists) from "are we getting better at recovering at-risk members" (Recovery, performance-over-time). Recovery is blocked on dated check-in history. Do not interrupt the current Risk by Time as Member rotation.

#### Context

The current Silent Churn card answers: **Who is at risk right now?** That card is useful and already exists.

The next improvement is to separate two different questions:

1. **Silent Churn Today** — Who is currently at risk? Operational card. Buildable now.
2. **Silent Churn Recovery** — Are we getting better at bringing at-risk members back? Performance-over-time card. Blocked until we confirm dated check-in history exists.

This does **not** conflict with the current Risk by Time as Member card, which lives in the Patterns section and answers a different question: *which membership-duration group holds the most risk?*

#### Priority

Do not interrupt the current Patterns rotation. Finish **Risk by Time as Member** first, then revisit the Silent Churn split.

#### Future work

##### 1. Silent Churn Today polish

Current card exists. Later polish:

- Reduce prominence of member names.
- Move names into a drawer or "View members" detail area.
- Keep current risk count and monthly dues at risk visible.
- Keep Sample data badge while using fixture data.

##### 2. Silent Churn Recovery card

**Blocked.** Do not build until we confirm dated attendance/check-in history. This card should eventually show:

- Newly at-risk members
- Recovered members
- Still at-risk members
- Recovery rate
- Risk trend over time

*Example takeaway: Recovered 7 of 12 at-risk members.*

#### Data gate

Before building the Recovery card, run a probe for the `Client Sign-ins` endpoint.

- If it provides **dated check-in events**, the Recovery card becomes buildable.
- If it only provides **latest check-in** data, Recovery stays parked.

#### Guardrails

- Do not fake recovery data.
- Do not infer recovery from only `lastCheckIn`.
- Do not add real member storage yet.
- Do not add PII fields.
- Do not add Wodify integration as part of this card.
- Keep all member-risk definitions shared with the existing Retention classifier.
- Future cards must use the same `classifyMember` logic so Silent Churn, Attendance Health, and Risk by Time as Member do not drift.

#### Current decision

Finish the current Risk by Time as Member card first. File this backlog item now. Run the `Client Sign-ins` probe separately.

### Program/style retention — Gi vs No-Gi (Phase 2)

**Status / Priority:** Later

Result: A program/style retention card that splits churn by real training discipline (Gi vs No-Gi, Competition vs Fundamentals), sourced from Attendance check-ins.

Why: Shows whether retention differs by what members actually train — a signal the current age-derived cohort reads don't capture.

Premise / blocker: Phase 2 — Attendance data only. `Programs` is NOT a usable cohort source: it is multi-valued and, for adults, lists plan ENTITLEMENT (the full ~20-program bundle; 5-member proof 2026-06-15), not training discipline. Real program/style discipline lives ONLY in Attendance check-ins, so this needs the Attendance table — a separate later pipeline, not a view over the live aggregate.

Guardrail (do not violate): a class type's worth = retention strength × ease of acquisition, NOT churn alone. Do NOT build a cancel/keep recommendation on churn alone — a class that churns fast but is trivial to fill (a feeder) would be wrongly condemned, and one that holds members but is hard to fill needs protection. The acquisition axis (conversion / ease-of-acquisition by class type, authoritative source TBD) is not in Wodify or the repo and is parked under the Growth-Levers thread.


## Next (6)

### Unclassified category detector in Settings

**Status / Priority:** Next · P2

Result: A Settings page indicator that flags any Quicken categories from the imported CSV that don't appear in categoryRegistry.ts. The owner sees the list with a count of affected transactions and can decide how to classify each one before trusting the dashboard.

Why it matters: When a Quicken re-import introduces a new category, the system silently maps it to "unknown" and includes/excludes it from totals based on default rules — the owner gets no warning. Silent miscounts erode trust in every dashboard number. Settings is the natural home: it's the first place an owner looks after a re-import.

Premise check: Appears still necessary. Grep of recent ships (#252 onward) shows nothing in Settings touching unclassified-category detection. No stale-premise risk; concrete build, not discovery.

### Category classification Settings page (V2)

**Status / Priority:** Next · P2

Result: A Settings page where the owner can: (a) view every Quicken category alongside its classification (income / business expense / capital / suppressed), (b) override the default classification for any category, and (c) work through a queue of unclassified categories — without editing categoryRegistry.ts or any code.

Why it matters: Today every classification decision lives in code. The owner has to ask Claude (or learn TypeScript) to change anything. That gates a routine maintenance task on engineering effort. V2 makes classification a self-service Settings concern, matching how every other rule (target margin, safety reserve) already works.

Premise check: Likely still necessary, but premise needs a check before build. Two questions: (1) Does the unclassified-detector task (the prerequisite P2) ship first and define the data surface this page would consume? (2) Has any partial categoryRegistry override pathway been added since this was filed? If either materially changes scope, do a fast rescope pass before opening a build PR.

### Efficiency Opportunities — credible-best logic (V2)

**Status / Priority:** Next · P2

Result: A second filter on the "Your best" benchmark that excludes windows where the category was dormant. The owner sees a "best" that reflects realistic operation of the category, not a statistical artifact from an inactive period. Adds a per-row bestSpendQualified: boolean (extending the existing global benchmarkRevenueQualified flag). On this gym's stable-revenue fixture, visible numbers likely don't change (same as #257) — the value is preventing future dormancy artifacts as new categories appear.

Why it matters: V1 picks the lowest 3-month spend/revenue ratio across all candidate windows. If a category was dormant ($0 spend) in a candidate window, the ratio is 0% — which trivially wins "best." The card then claims "you used to spend 0% on X" — misleading and useless as a benchmark. #257 fixed the revenue-axis pathology (low-revenue windows winning); this V2 fixes the spend-axis pathology (dormant categories winning). Orthogonal problems, same severity.

Premise check: Verified not stale (rescope pass, 2026-05-26). #257 (revenue qualification, dual floor) and #258 (fallback disclosure) addressed window-by-revenue-scale comparability; neither addresses dormant categories. Confirmed in code: src/lib/kpis/efficiencyOpportunities.ts:350-361 per-category best-window loop has no spend filter; tests cover only the revenue axis. This is category-spend qualification, NOT revenue qualification. Build-ready with four spec extensions: (1) per-category, not global; (2) fallback behavior mirroring revenue's (use unfiltered best when too few windows qualify, mark bestSpendQualified=false); (3) "25% of 24-month median" is a candidate threshold — validate on real fixture before locking, same as #257's 0.7 ratio; (4) UI disclosure deferred to a follow-up PR, matching #257→#258 pattern.

### Settings enhancements: Logo

**Status / Priority:** Next · P4

_No Result / Why / Premise recorded in the Notion export — name and status migrated as-is._

### Audit and normalize dashboard grid gaps and section spacing

**Status / Priority:** Next · P2

Result: A consistent vertical and inter-card spacing rhythm across the dashboard. Every card-row gap, section gap, and grid gap uses one of four canonical values (14, 16, 24, 32 px). Scope: Today page vertical spacing (top grid, secondary cards, Owner Distributions), Big Picture card row gaps, Forecast chart/table spacing, shared grid classes (.two-col-grid, .today-secondary-row, .today-context-section, .stack-grid, .cash-trend-row). Explicit rules for row gaps vs section gaps.

Why it matters: Current spacing is ad-hoc — some grids use 16, others 20, others 24. Inconsistency reads as visual noise even when no single value is wrong. Standardizing shrinks the surface for one-off spacing tweaks in future PRs and makes the dashboard feel more deliberate.

Premise check: Appears still necessary. Card-shell padding/radius/height normalization is a separate concern this task depends on ("run after card-shell normalization is verified and committed") — before starting, verify card-shell is done; if not, this task stays queued behind it.

### Big Pic Top Block Sparklines must change with timeframe

**Status / Priority:** Next

_No Result / Why / Premise recorded in the Notion export — name and status migrated as-is._


## Later (44)

### Expand systematic test coverage

**Status / Priority:** Later · P5

No automated tests exist. A QA layer would catch regressions before they reach production. Deferred until the feature set stabilizes.

### Egress reduction and payload optimization

**Status / Priority:** Later · P3

~4MB boot payload is the dominant cost driver. Reducing it is the highest-leverage performance improvement available.

### Rename dashboard for Bob CFO — branding pass

**Status / Priority:** Later · P4

Productize and brand the dashboard for use outside of Gracie Sports. Requires all core features to be stable first.

### Startup performance — sequential Supabase requests

**Status / Priority:** Later · P3

Boot sequence makes sequential HTTP requests. Parallelizing them would cut perceived load time meaningfully.

### Settings page — full layout normalization pass

**Status / Priority:** Later · P3

The Settings page uses a legacy .ta-page / .ta-section / .ta-card structure that doesn't match the rest of the app. Spacing will self-resolve once rebuilt with standard .card and .stack-grid patterns. Avoid spot-fixing .ta-* rules in the meantime — they will be removed. Deferred from session 2026-04-30 during spacing normalization pass.

### Backtest fixturePath portability fix

**Status / Priority:** Later · P4

baseline.json currently stores an absolute or otherwise non-portable fixturePath that produces spurious diffs when the harness runs on a different machine. Fix is to make the fixturePath relative to the repo root before serialization, and accept either form when reading. Bites mid-Stage-5 if a teammate (or future-you on a different machine) runs the harness, so worth landing before that work begins. Single-prompt scope.

### Stage 4 — Qualitative testing of forecast models

**Status / Priority:** Later · P2

Posture work, not a discrete task. Trigger: when new monthly actuals close, re-run the conservative floor diagnostic (scripts/backtest/conservativeFloorDiagnostic.ts) and review whether Split Conservative still calibrates. Phase 1 and Phase 2 shipped (Cadence native, Split Conservative selectable). Conservative Floor diagnostic landed 2026-05-02 as repeatable artifact (commit 691cdcd, backtest-results/conservativeFloorReport.md).

### Stage 6 — Promote category-cadence to default forecast

**Status / Priority:** Later · P2

Reframed 2026-05-02: this is no longer a single-model promotion item. Diagnostic 691cdcd confirmed two distinct jobs — Split Conservative is the calibrated expected-case hybrid (best 30d abs error, +$101 90d signed bias) and Conservative Floor is the deliberately pessimistic downside/stress view (best 90d/1y abs error but under-projects 1y net 4/5 windows). Product direction: Expected Case = Split Conservative, Downside Case = Conservative Floor, with Engine and Cadence as diagnostic comparators. Default flip deferred — the next decision is the Forecast page UX (4th toggle option vs Expected/Downside redesign), not which single model wins.

### Decide fate of Sales rule trough diagnostic

**Status / Priority:** Later · P3

Disposable diagnostic at scripts/backtest/salesRuleTroughDiagnostic.ts answered the May 2026 production swap decision (Sales rule trailing-12 → 50/50, commit 4a97cbd), then was un-wired from runBacktest.ts before commit. File is currently untracked. Decision needed: (a) make it a permanent operator-vantage check by re-wiring and updating its labels (trailing-12 is no longer 'production' — 50/50 is), or (b) delete the file. Coupling that decision to the production swap was deliberately avoided. Revisit in a future session when there's appetite to evaluate whether parametric copies of the projection logic are worth maintaining as production drifts.

### Audit classifyCategories cutoff-safety for statistical fallback

**Status / Priority:** Later · P3

Surfaced 2026-05-01 during Sales rule swap (commit 4a97cbd). Sales projection lookups in categoryCadence.ts are cutoff-safe — Sales is hard-coded EVENT with full-string override, both 50/50 components query strictly months before startMonth. But classifyCategories runs on the full txns array and uses statistical fallback (months-active ratio + CV) for non-hard-coded categories. Future-dated rows could shift those statistics for any category that falls through to the fallback path. Not implicated by the Sales swap; documented as residual non-Sales risk in commit 4a97cbd's message. Audit needed: (a) confirm whether statistical fallback is actually invoked in production for any current category, (b) if so, gate it on cutoff date so future-dated rows can't influence classification.

### Quicken category renames — update system references

**Status / Priority:** Later · P1

Wes renamed categories in Quicken. Old → new mappings to be confirmed with Wes. System references (import logic, compute, cashFlow, forecast assumptions, any hardcoded category names) need to be audited and updated to prevent silent miscategorization. First priority after forecast model fix.

### AR/AP carry deprecation pass

**Status / Priority:** Later · P3

Composed Forecast Policy (locked May 3, 2026) declares AR/AP out of scope. The hidden Settings slider labeled 'AR/AP days — Coming soon' should be removed from the user surface. AR/AP terminology stripped from any UI copy. Engine carry layer at compute.ts:2293–2374 is dead from a user perspective (Reality and Recovery composers drop it; slider is hidden) and stays in place for backtest compatibility but should carry a code comment marking it not-surfaced. Single-file UI change plus a code comment. Real AR/AP becomes a separate feature only when the data model has receivable/payable entities (invoice-level data, aging, payment terms). Tiny commit, low risk.

### Forecast chart event spike rendering — smooth curve interpolation issue

**Status / Priority:** Later · P3

After Commit 2 (1a9f7f2) made events affect the forecast line, a +$100K event on Jun 1 renders as a smooth ramp from May 25 to Jun 8 instead of a sharp spike on Jun 1. Math is correct (Jun row shifts by full +$100K in projection table); visual is misleading because Apex uses curve: smooth and weekly data points on short ranges interpolate the jump into a curve. Three fix options: (a) switch to curve: stepline or straight globally — changes whole chart aesthetic, (b) step only at event months — needs additional Apex tricks, (c) render daily data points — bigger change. Decide visual direction before implementing. Worth a focused chart UX pass alongside the marker tooltip redesign.

### Today cash-floor card — add trough month to copy

**Status / Priority:** Later · P3

Today's 'Cash floor drops to $X' card shows the dollar value but not when. Operator can't tell if the trough is next month or 11 months out — materially changes urgency. Add the trough month to the cash_flow_negative and cash_flow_tight signal copy in signals.ts (or the TodayPage rendering layer). Format: 'Cash floor drops to $15K in Apr 2027' or similar. Single-file copy change.

### Today cards — add dark-mode CSS coverage

**Status / Priority:** Later · P5

DEPRIORITIZED 2026-05-12 — dark mode is a "plus" surface for this product, not a primary target (same class as mobile). System is designed for desktop light mode. Dropped to P5/Later. Pick up only when a dark-mode pass is the deliberate focus, or if a dark-mode toggle is about to ship.

Note (carry-forward from PR #33 sweep): the original Why cites UI_http://CARDS.md as the source of the dark-mode requirement. UI_http://CARDS.md is deleted. Verify whether the dark-mode requirement is in UI_http://RULES.md before implementing.

---

ORIGINAL: Today page cards currently have no .dark .today-* / .dark .hero-* CSS coverage, even though UI_http://CARDS.md requires dark-mode behavior for every card. QA confirmed adding .dark to <html> produces no visual change on Today. There is no dark-mode toggle exposed today, so this is not user-visible yet, but it should be fixed before any dark-mode setting ships. Source: Today posture-aware QA pass, May 4 2026, finding F-1.

### Remove unused receivableDays/payableDays plumbing

**Status / Priority:** Later · P4

Vestigial AR/AP timing props still flow through Dashboard.tsx and CashFlowForecastModule.tsx but are not rendered in any UI control. Defaults (3 days each) feed compute.ts's carry layer, which is itself not surfaced per Composed Forecast Policy (cash-basis only, May 2026). Cleanup requires locked-file approval because contract.ts defines ScenarioInput.receivableDays/payableDays and compute.ts consumes them. No urgency — invisible to users. Source: Phase 1 diagnosis of AR/AP carry deprecation pass, May 4 2026, deferred per scope discipline. Related commit: c3aec05.

### Forecast chart datetime x-axis for true sub-bucket marker placement

**Status / Priority:** Later · P3

Forecast chart x-axis is currently categorical with weekly/monthly buckets; event markers land on bucket boundaries even when an event has a sub-bucket exact date. Switching to xaxis.type: 'datetime' would enable continuous date interpretation and place markers at exact dates. Architectural rework; touches ProjectedCashBalanceChart.tsx and possibly chart series construction. Marker label commit 0ec6f57 mitigates operator confusion in the meantime by displaying the exact date in the label even when the dot is bucket-aligned. This is not blocking current use because marker labels now show the exact event date; the remaining issue is physical dot placement on the chart. Source: Forecast chart curve research, May 4 2026 evening session, deferred Issue B Tier 2.

### Verify whether baselineForCategory should respect cashFlowMode

**Status / Priority:** Later · P4

Orphaned Mar-29 audit-fix commit had changed baselineForCategory to accept and respect cashFlowMode. Main hardcodes 'operating' instead. May be deliberate (savings opportunities tied to operating cash baseline regardless of view) or a small bug. Verify product intent. ~3-line fix if confirmed.

Surfaced during the Phase 5.1 stale-branch cleanup spot-check on `codex/audit-fixes-safe-patches` (now deleted, see commit `d0a2fa9`).

#### Current behavior on main

In `src/lib/kpis/compute.ts:1622`:

```tsx
function baselineForCategory(monthlyRollups, txns, category, excludeMonth): number {
  ...
  txns.forEach((txn) => {
    if (txn.category !== category) return;
    if (!monthSet.has(txn.month)) return;
    total += expenseContribution(txn, 'operating');  // hardcoded
  });
  ...
}
```

Opportunity baselines always use operating-mode expense contributions, even when the operator is viewing total cash flow mode.

#### What the orphaned commit did differently

Threaded `cashFlowMode` through `buildOpportunities → baselineForCategory` so the baseline tracks the user's current view mode, consistent with the rest of the d0a2fa9 changes that were applied to main (categoryTotals, buildExpenseSlices, buildTopPayees, buildMovers, buildOpportunities all take cashFlowMode on main).

#### Why this may be intentional

"Always show savings opportunities against operating cash baseline" is a defensible product stance even when the user is in total-mode view — it keeps the recommendation stable across UI mode toggles.

#### Why it may be a bug

The rest of the d0a2fa9 changes were applied to main consistently (every other expense-aggregation builder takes cashFlowMode). `baselineForCategory` is the lone holdout. That asymmetry is a smell — either it was a deliberate carve-out (worth a comment in the code) or it was missed during the larger refactor.

#### If confirmed as a bug

Likely small fix:

- Add `cashFlowMode` parameter to `baselineForCategory`.
- Pass it through from `buildOpportunities` (which already receives `cashFlowMode`).
- Replace hardcoded `'operating'` with the passed mode at line 1633.

Would touch `compute.ts` (a locked file). No schema, no UI, no overlay change.

#### Not blocking

Not blocking Phase 5.1. Worth verifying when next Phase 4/5 owner has time, or when an opportunity recommendation looks visibly inconsistent with the active view mode.

### Persistence observability cleanup

**Status / Priority:** Later · P3

Cross-cutting gap surfaced during Branch 4 503 diagnostic. saveSharedForecastEvents has no try/catch (uncaught throws on save failure); savePriorityHistory has a silent catch. Address in a dedicated branch post-Phase-5.1 to standardize structured warnings and return-value semantics across the persistence layer.

### vite.config.js tracked-output cleanup

**Status / Priority:** Later · P5

vite.config.js is committed alongside vite.config.ts (regenerated by tsc -b). Tracked compiled output is a low-grade smell. Add to .gitignore, delete the file, adjust tsc emit if needed.

### forecast_events RLS policy alignment

**Status / Priority:** Later · P4

Live DB has qual=true (broader than workspace-scoped); supabase/first_test_policies.sql documents workspace-scoped pattern matching first_test_*. Decide direction: align live to file (tighter) or align file to live (looser). Surfaced during Branch 4 RLS hotfix work.

### "Go to Contracts" deep link from renewal steer message

**Status / Priority:** Later · P5

Phase 5.1 Branch 5 ships block + steer behavior on renewal-row edit clicks, but the steer panel has no navigation button. Adding a "Go to Contracts" button requires lifting Settings activeSection state out of Dashboard local state or introducing a URL-fragment scheme. Out of scope for Branch 5; deferred as low-priority polish.

### Per-instance enabled/disabled state for generated renewal rows

**Status / Priority:** Later · P3

Branch 5 V1 hides the toggle on renewal rows because regeneration would silently flip toggled-off events back to enabled — there is no overlay layer that survives delete/reinsert. Future approach: in saveSharedRenewalEvents, read existing (contract_id, generated_date, enabled) tuples before delete; pass to generator (or post-process) so newly-generated events inherit enabled=false where prior matching events were disabled. ~15 lines, no overlay system needed. Restores per-instance disable without exposing full override semantics. Deferred from Phase 5.1 Branch 5.

### Forecast UI — Business-calendar X-axis labels

**Status / Priority:** Later · P2

Forecast chart x-axis labels currently use Apex tickAmount to create readable adaptive spacing. This solved crowding and preserved cash event annotations (shipped in commit d995623, PR #5). A future improvement is to make short-range labels more operator-friendly by anchoring labels to business-calendar dates: always show the first and last visible chart dates, prefer the 1st and 15th of each month, and suppress anchor labels that are too close to the first/last or another selected label. This better matches how business owners think about cash timing: beginning of month, mid-month, and end of period. Preserve forecast math, bucket generation, cash event annotations, and tooltip behavior.

Implementation rules (for when this is picked up):

For 30/60/90-day views:
1. Always show the first visible chart date.
2. Always show the last visible chart date.
3. Prefer business-calendar anchors: 1st of each month, 15th of each month.
4. If the chart is weekly bucketed and there is no exact 1st/15th bucket, label the bucket closest to the 1st/15th.
5. Do not show an anchor label if it is too close to the first or last label, or too close to another selected label.

Spacing rule:
- 30-day view: minimum 7 days between shown labels
- 60-day view: minimum 10 days between shown labels
- 90-day view: minimum 10-12 days between shown labels; use 12 if it still looks crowded

Example: If the chart starts Apr 27 and the next anchor is May 1, skip May 1 because it is too close to Apr 27. Show May 15 instead.

For monthly views:
- 6 months: show every month
- 12 months: show every 1-2 months
- 24 months: show every 2-3 months
- Always show first and last visible month labels.

Guardrails:
- Do not change forecast math.
- Do not change bucket generation unless explicitly approved.
- Do not break cash event annotations.
- Do not reintroduce formatter suppression using empty string or U+200B / zero-width space without solving Apex annotation matching.
- If label selection requires formatter suppression, stop and diagnose first.
- Current tickAmount behavior from #7 is the safe baseline.

### Sparkline fixtures: lift from Dashboard.tsx to shared lib

**Status / Priority:** Later · P3

UI_LAB_SPARKLINE_OPTIONS and UI_LAB_SPARKLINE_SERIES currently live as module-scope fixtures in src/pages/Dashboard.tsx. Lift to src/lib/ui-lab/sparklineDefaults.ts (or similar) when the second sparkline-bearing canonical card lands — premature now with only one consumer.

### requestAllRows truncation runbook — fail-fast trigger

**Status / Priority:** Later · P2

Background for when requestAllRows fail-fasts on truncation. Current behavior (src/lib/data/sharedPersistence.ts:185-248): inline fetch with Prefer: count=exact reads Content-Range; if server total > received rows, or first-page Content-Range is missing/unparseable, throws SharedPersistenceTruncationError. Replaces the prior 80% PAGE_SIZE warning (see earlier item history).

When SharedPersistenceTruncationError appears (table name + counts surfaced on the error): (1) check Supabase max_rows setting — must be >= PAGE_SIZE (currently 10,000) in Dashboard → Settings → Data API; (2) decide between raising max_rows, raising PAGE_SIZE, or moving to cursor/keyset pagination. PAGE_SIZE 10,000 currently has substantial headroom over production row count. Document the decision tree before the error first reaches a user-visible failure in production.

Rewritten 2026-05-12: original premise (80% warn fires) is stale — fail-fast replaced the warn. Decision tree preserved; trigger updated to the error type that surfaces the same choices.

### Audit Dashboard.tsx JSX color swatches against chartTokens

**Status / Priority:** Later · P3

During the chartTokens migration on May 7, 2026, the named const blocks UI_LAB_SPARKLINE_OPTIONS and STATISTICS_CARD_OPTIONS in src/pages/Dashboard.tsx were migrated cleanly (commit b1eef83). However, JSX color swatches at approximately lines 4326 and 4334 were intentionally left untouched because they were outside the scope of the named const migration.

Risk: if those swatches reference the same hex values that are now token-bound (e.g., #465FFF, #12B76A, #89DBB5), they will drift the moment a token value is changed elsewhere. Silent visual inconsistency.

Work: read the live Dashboard.tsx file, identify JSX swatch locations, determine whether their colors map to existing chartTokens entries, and migrate them if so. If they reference values not in chartTokens, decide commit-by-commit whether to add tokens or accept inline (same pattern as the main migration).

Not urgent — swatches are likely UI Lab demo elements, not production-facing. P3 Later.

### Tighten ?? model.latestMonth fallback in categoryCadence.ts

**Status / Priority:** Later · P4

The fallback at categoryCadence.ts:392 introduced in 7da6e09 (addMonths(lastForecastRollup?.month ?? model.latestMonth, 1)) is unreachable today: the line-373 guard returns early when forecastCashRollups is empty. If that guard is ever loosened, the fallback silently re-introduces the original alignment bug (cadence start would shift to model.latestMonth, which can include partial in-progress months). Independent reviewer flagged considering an assertion or clearer unreachable-state handling. Not blocking; brief code-clarity pass.

#### Context

In production hotfix [7da6e09](https://github.com/wcpeixoto/wx-cfo-scorecard/commit/7da6e09), `projectCategoryCadenceScenario` was changed to source its start month from `model.forecastCashRollups[last].month` (mirroring the engine's complete-month rule) with `?? model.latestMonth` as a fallback.

The fallback is unreachable in normal flow because the function's pre-existing early-return guard at `categoryCadence.ts:373` already handles `forecastCashRollups.length === 0`. So the `?? model.latestMonth` branch is defensive dead code today.

#### Risk

If the line-373 guard is ever loosened (e.g. allowing the function to proceed with empty rollups under some new condition), the fallback would silently re-introduce the original alignment bug — cadence start would shift back to `model.latestMonth`, which can include partial in-progress months, breaking `composeConservativeFloor`'s month-alignment invariant.

#### Options to consider

1. **Replace fallback with assertion.** `if (!lastForecastRollup) throw new Error('projectCategoryCadenceScenario invariant: forecastCashRollups must be non-empty when reaching startMonth derivation')`. Loud failure beats silent regression.
2. **Restructure to prove non-emptiness via TypeScript.** Pull the rollup access above the guard so the type narrows naturally.
3. **Leave as-is, document the invariant.** Add a comment explicitly naming the unreachable-today, defensive-against-future-changes contract.

#### Out of scope

- Any change to the actual fix or alignment behavior.
- Refactoring beyond the start-month derivation block.

#### Related

- Hotfix commit: [7da6e09](https://github.com/wcpeixoto/wx-cfo-scorecard/commit/7da6e09)
- Independent reviewer flagged this as a low-priority residual risk.

### Mobile wrap behavior: .projection-table-actions at ~375px

**Status / Priority:** Later · P5

DEPRIORITIZED 2026-05-12 — mobile is a "plus" surface for this product, not a primary target. System is designed for desktop. Dropped from P2/Next to P5/Later. Pick up only when a mobile pass is the deliberate focus, or if the underlying flex-wrap pattern surfaces on a desktop layout.

---

ORIGINAL: Forecast page Projection Table V2 header right-controls cluster (Compare year toggle + Export CSV) uses .projection-table-actions { flex-wrap: wrap; justify-content: space-between } at ≤767px. At ~375px, Export CSV wraps to a second line and left-flushes due to space-between on a single-item wrap row. Likely fix: justify-content: flex-end on the wrap state, or a gap + flex-end combo so the wrapped button aligns to the right edge. Pre-existing CSS quirk, not introduced by PR #7.

PROMOTED 2026-05-11 (late): PR #30 banner (.dashboard-load-error) inherits the same narrow-viewport wrap behavior — second surface confirmed for the same flex-wrap pattern. No longer a single-page quirk; promote to P2/Next so the next mobile pass closes both with one tokenized fix. Refs: PR #7 visual smoke 2026-05-11 (initial), PR #30 close 2026-05-11 (late, recurrence).

### Forecast Compare — full hybrid (momentum + multi-year)

**Status / Priority:** Later · P2

PR #38 + PR #39 shipped seasonality comparison for 6mo and 1Y monthly horizons. Still open:

(1) Momentum comparison for 30d/60d/90d horizons. Currently Compare is disabled at weekly granularity. Hybrid model defined 2026-05-12 says these horizons should compare against the immediately previous N-day window ("is the business improving vs recent momentum?") rather than year-over-year. Requires new prior-window arithmetic helper distinct from priorPeriodSeries.ts, and a decision on weekly-granularity prior synthesis (rejected once already for seasonality; same question recurs here).

(2) Seasonality comparison for 2Y/3Y horizons. Forecast extends beyond actuals boundary (e.g. May 2026 → Apr 2028 with prior May 2024 → Apr 2026 — stops at today). Visual treatment of "shorter prior line" is unresolved: overlay aligned at y-axis center requires dual-x-axis (ApexCharts doesn't do natively); overlay aligned in time produces side-by-side rather than comparison view.

(3) 6mo is the contested horizon. Currently in seasonality bucket per PR #39, but momentum read is also legitimate. May want a segmented sub-toggle ("Previous 6 months" / "Same months last year") when picked up.

Roughly 3× the work of PR #38 by Code's diligence estimate. Not blocking; defer until short-horizon comparison friction is felt in actual use.

### Remove dead .app-nav / .app-top-nav CSS cluster

**Status / Priority:** Later

#### Context

Discovered during PR 5a (#63) — Wx CFO Scorecard helper-text dead-CSS purge.

The entire `.app-nav*` / `.app-top-nav*` family in `src/dashboard.css` appears nowhere in any `src/` file. ~21 references across lines 59, 81, 96, 119, 126, 139, 143, 149, 161, 230, 4204, 4209, 4213, 4231, 4239, 4245, 4254, 4258, 4266, 4300.

Flagged out-of-scope across PRs 5a (#63) and 5b (#64) because navigation cleanup has larger blast radius than the helper-text sweep.

#### Why this is its own PR

- Navigation is structurally separate from the helper-text cluster
- Larger blast radius — visual regression risk warrants its own visual diff
- Independent verification needed (the prior verification proved helper-text-cluster dead, not nav-cluster dead)

#### Proof standard required before deletion

Same 6-check standard as PRs 5a / 5b:

1. `className=` literal grep across `src/**/*.{tsx,ts,jsx,js}`
2. Raw `class=` grep
3. Bare-substring grep across all `src/` non-CSS files
4. Dynamic-construction scan (template literals, string concat, object/map lookups, conditional expressions, clsx/classnames calls)
5. Grouped-selector check
6. `git log -S '<selector>'` for context

#### Suggested PR title

`chore(css): remove dead .app-nav* / .app-top-nav* cluster`

#### Reasoning mode

Extra-High (navigation cleanup; visual regression risk)

#### Dependencies / sequencing

- Not blocking the helper-text typography sweep (different area of CSS)
- Can be picked up after the 12px / 14px / ambiguous snap PRs complete
- Or earlier if a clean break in the typography work makes sense

#### Stop-and-report triggers

- Any selector now has a live reference (something changed since PR 5a)
- Any selector is in a grouped rule with a live sibling
- Mobile / responsive `@media` blocks reference the cluster in unexpected ways

### Scope KPI / trend badge semantics

**Status / Priority:** Later · P3

Decide whether .kpi-badge usage in KpiCards and TrendLineChart should remain a trend badge primitive using ▲/▼ semantics, or whether any subset should migrate into .card-status-badge with the ↓/✓/none status glyph framework. Do not implement until the semantic decision is made.

Context: surfaced during the May 2026 status pill audit (post-PR #102 / #103). Audit found 23 pills across the dashboard with 8–9 distinct primitives, of which .kpi-badge is one of two undocumented primitives in KpiCards and TrendLineChart. Trend semantics (rising/falling indicator) is distinct from status semantics (acceptable/warning/critical), so absorption into the status framework would be a regression unless a clear subset is identified as status, not trend.

### Scope data-health status badge migration

**Status / Priority:** Later · P3

Evaluate .sys-status-badge data-health usage as a legitimate .card-status-badge migration candidate. This is likely a real status/state badge, but should get its own scoping pass before implementation.

Context: surfaced during the May 2026 status pill audit. Of the 8–9 non-conforming primitives identified, .sys-status-badge is the most likely candidate for clean migration into the documented .card-status-badge framework (UI_http://RULES.md, shipped via PR #102). Unlike KPI/trend badges and informational pills, data-health is genuinely status-shaped — pass/warn/fail maps cleanly to is-healthy/is-warning/is-critical. Scoping pass should confirm classifier semantics before implementation.

### Preserve non-status pill boundary

**Status / Priority:** Later · P3

Document/confirm that informational, lifecycle, and frequency labels such as .contracts-status-badge, .settings-badge, and .forecast-event-status are not automatic .card-status-badge migration targets. Sweeping these into the status framework may be a regression, not cleanup.

Context: surfaced during the May 2026 status pill audit. Of the 10 non-conforming pills identified, ~3 are informational labels rather than status indicators: contract lifecycle states (Active/Renewed/etc.), settings-source markers, and forecast event frequency labels. Forcing these into .card-status-badge would create false semantic equivalence (e.g., 'Active contract' reading as a status state when it's just a lifecycle marker). This item is documentation/policy work — codify the boundary in UI_http://RULES.md so future audits don't sweep these in by default.

### 🧭 PRINCIPLE — CFO Assistant Roadmap (north-star, not a task)

**Status / Priority:** Later · P5

North-star principle for the full assistant vision. Remember decisions, not conversations. Not Phase 1b scope. Filed in backlog DB for visibility; move to a docs/principles page when one exists.

#### Principle

**The CFO Assistant remembers decisions, not conversations.**

---

#### The accountability loop

1. **Diagnose** — Dashboard detects the situation. *"Cash is tight."* *"Reserve is below goal."* *"Owner distribution is not safe yet."*
2. **Recommend** — Assistant proposes one short, calm, specific action.
3. **Owner consent** — One-tap response: *"I'll do this"* / *"Not this week"* / *"I'll do something else."* The tap *is* the commitment.
4. **Store** — Structured note only: action, date, related metric, check-in window, status. No chat transcript.
5. **Follow up** — Acknowledge follow-through briefly. Ask about lapses without judgment.

---

#### Rules

- **One open commitment at a time.** New commitments replace old with a calm transition.
- **Explicit consent is the hinge.** Nothing stored unless the owner taps. Silence is not consent.
- **Structured memory, not chat memory.** Save the decision, not the conversation.
- **Asymmetric follow-up tone.** Follow-through → brief acknowledgment. Lapse → ask what got in the way. No cheerleading, no nagging.
- **Data must be able to answer.** Auto-check only commitments the dashboard can verify; the rest are self-reported.

---

#### Scope

This is a north-star principle for the full assistant vision. **Not Phase 1b scope.**

Phase 1b ships one chip wired to one deterministic sentence. The commitment loop is a later phase with its own discovery pass, storage decision, UI surface, and copy work.

---

#### Test for future design decisions

- Does this remember a *decision* or a *conversation*?
- Is there one open commitment or many?
- Did the owner actually agree, with a tap?
- Is the follow-up *asking* or *telling*?

---

*Locked 2026-05-21.*

### Accessible staged-dropdown component

**Status / Priority:** Later · P3

Staged (multi-step) dropdowns need accessibility scaffolding the app doesn't have yet: focus into menu on open, focus restore to trigger on close, Escape at every step, outside-click close, roving keyboard navigation, and screen-reader announcement of step changes. Surfaced during the Owner Distributions 'Compare' control work — we shipped a single-level fallback dropdown instead. Reusable once it exists across 5+ call sites: PeriodDropdown, action-dropdown x3 in CashFlowForecastModule, NetCashFlowChart, OwnerDistributionsChart Compare menu, Big Picture timeframe menu. P3: nothing is blocked on it today.

**What:** Build a reusable, accessible staged (multi-step) dropdown/menu primitive.

**Why this is its own task:** staged menus carry real accessibility scope that single-level menus don't:

- focus into the menu on open, restore focus to the trigger on close
- Escape closes at every step
- outside-click close
- roving keyboard navigation (arrow keys) between items
- screen-reader announcement of the step change

The app currently only has single-level `useState` dropdowns; extending one with another `useState` to fake steps does not satisfy the above.

**Reuse (5+ call sites could adopt it):**

- `PeriodDropdown`
- `action-dropdown` x3 in `CashFlowForecastModule`
- `NetCashFlowChart` timeframe menu
- `OwnerDistributionsChart` Compare menu (year picker)
- Big Picture timeframe menu

**Context:** surfaced during the Owner Distributions "Compare" dropdown work. That change shipped a single-level fallback dropdown (Distributions only / Compare to annual income / Compare to <year>), so no surface is blocked — hence **P3**.

### Diagnostic audit — after first full system draft

**Status / Priority:** Later · P5

Locked routing decision (2026-05-24): the diagnostic audit is deferred until the first full system draft is complete. Until then, build remaining new cards to the diagnostic standard — what is the number/result, is it good/bad/neutral, and what owner decision does it support. Full audit runs only after the system is whole (judge the full dashboard/pages in context, avoid false work). CFO Assistant re-entry depends on diagnostic surface stability, but that comes downstream of the first full draft.

Diagnostic audit is deferred until the **first full system draft** is complete.

Until then, remaining new cards should be built to the **diagnostic standard**:

- What is the number/result?
- Is it good, bad, or neutral?
- What owner decision does it support?

The full audit should run only after the system is whole, so we can judge the full dashboard/pages in context instead of creating false work too early.

CFO Assistant re-entry depends on diagnostic surface stability, but that comes **downstream** of the first full draft.

### Cash on Hand copy review — “At this pace”

**Status / Priority:** Later · P5

The Cash on Hand card now uses the Forecast page's canonical first-negative month (negativeCashMonth), so the run-out timing is correct and shown as month/year (matching Forecast). However, the copy “At this pace…” may imply a simple linear extrapolation, while the value now comes from the full forecast model. Diagnostic standard — Number/result: first month the forecast projects cash below zero. Good/bad/neutral: bad (actionable warning). Owner decision: whether to act now to extend runway via expense cuts, collections, financing, or revenue action. Notes: consider wording like “Based on your forecast…” instead of “At this pace…”. (Follow-up from PR #226.)

The Cash on Hand card now uses the Forecast page's canonical first-negative month (`negativeCashMonth`), so the run-out timing is correct and shown as **month/year** (matching the Forecast). However, the copy **“At this pace…”** may imply a simple linear extrapolation, while the value now comes from the full forecast model.

#### Diagnostic standard

- **What is the number/result?** First month the forecast projects cash below zero.
- **Is it good/bad/neutral?** Bad — actionable warning.
- **What owner decision does it support?** Whether to act now to extend runway (expense cuts, collections, financing, or revenue action).

#### Notes

- Consider wording like “Based on your forecast…” instead of “At this pace…”.
- The card now shows month/year (e.g. “June 2026”), matching Forecast style, not a duration.
- Follow-up from PR #226 (run-out date alignment).

### Equalize Cash Trend / Income & Expense card heights on Big Picture

**Status / Priority:** Later · P5

Cosmetic asymmetry introduced when PR #229 swapped CashTrendPlaceholder for the Income & Expense card. Cash Trend renders at ~222px natural height; Income & Expense at ~386px. Empty space below Cash Trend. Out of scope for the original PR ('no Cash Trend changes'). File-and-track; address when picked up.

#### Diagnostic standard

**What is the number?** N/A — purely visual.

**Is it good / bad / neutral?** N/A — cosmetic polish.

**What owner decision does it support?** None directly; reduces visual noise so the cards beside each other read as a unit.

#### Problem

On Big Picture, the Cash Trend card renders at its natural height (~222px) while the Income & Expense card next to it is taller (~386px). This leaves empty space below Cash Trend. The row uses `align-items: flex-start` to keep Cash Trend at its natural size; equalizing the heights means either stretching Cash Trend or capping Income & Expense.

#### Scope

Small visual decision, not urgent:

- Option A: Let Cash Trend stretch to fill the row height.
- Option B: Cap Income & Expense chart height so the two match.
- Option C: Accept the asymmetry (current state).

Pick whichever feels right when picked up. No data changes, no logic changes.

#### Out of scope

- Anything that changes what either card shows.
- Cash Trend's data/calculations.

### Standardize on "Income & Expense" as canonical card name

**Status / Priority:** Later · P4

Card title, type names, file names, and PRs #229/#230 all use "Income & Expense." Stray references to "Revenue & Expenses" or "These costs are taking more of your revenue than they did at your best" have appeared in prompts and planning docs. Pick one name and use it consistently across future prompts, docs, and any in-app copy. Recommended: "Income & Expense" (matches shipped reality).

#### Context

The card shipped in PR #229 and updated in PR #230 is named **Income & Expense** everywhere it lives in the repo:

- Card title (UI)
- `IncomeExpenseCard.tsx` (component file)
- `incomeExpenseSeries.ts` (data lib)
- `IncomeExpenseTimeframe` (type name)
- PR titles

Stray references to "Revenue & Expenses" have surfaced in layout-planning prompts. Future prompts and docs should use **Income & Expense** consistently.

#### What to do when picked up

- Audit any planning docs, prompts, or in-app copy that reference the card by another name.
- Rewrite to "Income & Expense."
- No code change expected — this is a naming-consistency cleanup, not a refactor.

### Old-route URL rewrite on fallback

**Status / Priority:** Later · P5

After Stage 1, deleted routes (/focus, /trends, /dig-here, /money-left) fall back to the Today page but the URL is not rewritten — a bookmarked /focus shows Today while the address bar still reads /focus. Optionally rewrite to /today on fallback. Tiny, optional, low priority; Stage 2+.

Surfaced during Stage 1 verification (PR #252 — [https://github.com/wcpeixoto/wx-cfo-scorecard/pull/252](https://github.com/wcpeixoto/wx-cfo-scorecard/pull/252)).

Current behavior: `pathToTab` defaults unknown routes to `today`, so deleted routes render the Today page but the hash URL is left unchanged (fallback, not redirect; no 404).

Optional improvement: on fallback, `navigate('/today', { replace: true })` so the URL matches the rendered page. Defer to Stage 2 or later.

### Cleanup dead trajectory compute path

**Status / Priority:** Later · P5

computeTrajectorySignals / model.trajectorySignals are user-facing dead — rendered nowhere; consumed only by the DEV self-test (Dashboard.tsx debug.trajectoryRows, ~lines 1679–1730). Refs: contract.ts:284 (trajectorySignals field), :153/:155 (TrajectorySignalId / TrajectorySignal types); compute.ts:1206–1210 (TRAJECTORY_SIGNALS config incl. the "Annual Performance" label), :1837/:1900/:1930. Touches LOCKED files (compute.ts, contract.ts), so do not bundle with unrelated work. Origin: #4 "Annual Performance card" closed as stale 2026-05-25.

### Cash Trend: a11y label on trend block (state announced)

**Status / Priority:** Later · P3

Result: Trend block carries a single aria-label combining "Trend" with the worsening/stable state; eyebrow span gets aria-hidden so screen readers don't read a bare "Trend" with no follow-up data.

Why it matters: Today the SVG is aria-hidden and the only worsening encoding is stroke color (red vs blue). Color-blind and screen-reader users get no signal that the trend is worsening — violates WCAG 1.3.1 / 1.4.1 (info not by color alone). The status pill does NOT cover this: a Building or Treading card can still show a worsening slope, so the pill text doesn't imply trend direction.

Premise check: Surfaced in code review of PR #272 (squash f4dba18, merged 2026-05-26). Implementation site is src/components/CashTrendHero.tsx; CashTrendCompactLine already computes the isWorsening boolean — either lift it to the wrapper so .cth-trend-block can render an aria-label, or pass it back via callback. Small, additive change. Premise still valid: no other path encodes the worsening signal.

### Decide forecast starting-cash basis: all In-Forecast accounts vs Cash-typed only

**Status / Priority:** Later · P4

Result:
Decide whether the cash-flow forecast's starting cash uses all In-Forecast accounts (current behavior) or Cash-typed accounts only — then align both the code and the Account Setup copy to that decision.

Why:
The "Cash anchor" note and the bullet at Dashboard.tsx:4093 claim the forecast anchors on cash-typed accounts only, but the code feeds it the all-types currentCashBalance (Dashboard.tsx:3295 -> CashFlowForecastModule.tsx:644). Copy and code disagree, so the forecast's starting line is currently accidental rather than chosen.

Premise:
Still needed, not urgent — forecast-only. Surfaced 2026-06-01 during the Event Payables reserve work; PR #373 fixed only the cash-basis note and intentionally left 4093 for this decision. Reserve is verified correct and unaffected.

**Decision needed:** what should the cash-flow forecast use as its starting cash?

**Current behavior (code):** the forecast is handed the all-types `currentCashBalance` — every active In-Forecast account regardless of type — via `Dashboard.tsx:3295` → `CashFlowForecastModule.tsx:644`. The Operating Reserve uses the same value, and it is verified correct ($28,287 after the Roger Gracie seminar import, with Event Payables netted).

**What the copy says:** the "Cash anchor" note (corrected in PR #373) and the bullet at `Dashboard.tsx:4093` describe a Cash-typed-only anchor.

**Options:**

1. Keep all-types (forecast = reserve basis). Fix the `:4093` bullet copy to match.
2. Switch the forecast anchor to Cash-typed accounts only. The forecast then diverges from the reserve basis, and the `:4093` copy becomes correct.

Either way, code and copy should move together. Reserve is unaffected by this decision.


## Cleanup (5)

### Audit and tokenize warning-tinted legacy CSS surfaces (.error-banner and .forecast-warning-callout)

**Status / Priority:** Cleanup · P3

Pattern existed before PR #30. Same violation class Codex caught on .dashboard-load-error (#7a3b00, #fff, 14px/10px). Two surfaces confirmed: (1) .error-banner at src/dashboard.css:724 uses #f2c8d4, #fff0f4, #8f2f48, 14px. (2) .forecast-warning-callout (used as the .dashboard-load-error round-2 reference precedent) uses color-mix(in srgb, var(--warning) 8%, #fff) — #fff literal inside the mix, text token correct. Lesson from PR #30 round-2: copying a precedent in full is not safe; verify token compliance per element. Both surfaces should fold to color-mix(--warning N%, var(--bg-panel)) with var(--text-primary) and UI_http://RULES.md alert/input radii. Flagged during PR #30 round-2 review and narrative-entry drafting; out of scope for the merge gate.

### gh pr merge --delete-branch non-atomic when invoked outside primary-on-main

**Status / Priority:** Cleanup · P2

Promoted to P2 on 2026-05-12 after 5 confirmed occurrences crossed the self-set threshold ("consider P2 promotion if a fourth occurrence surfaces").

Pattern: gh pr merge --delete-branch is non-atomic across remote-merge and remote-branch-delete when invoked from anywhere other than primary-on-main. Remote merge succeeds; --delete-branch short-circuits on the post-merge worktree-switch step ('fatal: main is already used by worktree at primary'); remote branch survives until manual gh api DELETE fallback.

Occurrences:
(1) 2026-05-11 PR #29 — remote branch delete failed, branch held by harness worktree.
(2) 2026-05-11 PR #30 — worktree-switch short-circuit; manual fallback.
(3) 2026-05-12 PR #31 (squash 932c03d) — same mechanic; manual fallback.
(4) 2026-05-12 PR #38 — forecast compare; manual fallback.
(5) 2026-05-12 PR #39 (squash 5177456) — 6mo seasonality flip; manual fallback.

Mitigation candidates (pick when scheduling):
(a) invoke gh pr merge from primary clone only.
(b) always follow with explicit gh api -X DELETE fallback.
(c) check exit code and run fallback unconditionally.
(d) PREFERRED — enable GitHub repo-setting "Automatically delete head branches" (Settings → General → Pull Requests). Fires server-side after merge, sidesteps the worktree-switch hazard entirely. May obsolete this whole class of issue — verify after enabling. Only covers merged PRs; closed-without-merge branches still need manual delete (rare).

Related: path case-mismatch hazard (35ead957-9339-8176-a43d-f1a412e03290) — both stem from multi-worktree workflows interacting badly with gh's assumptions about repo state.

### Handoff template: state-only, no pre-picked next move

**Status / Priority:** Cleanup · P2

Handoff docs that say Recommended: X or Next move: X create anchoring — the next agent reads them as authority and skips the Notion Now lookup. The opening handoff this session pre-picked Finding #3 from PR #34, which is the bias we identified mid-chat. Rule to encode in the handoff template: handoffs describe state (what shipped, what is loose, what is in flight) but never recommend a next move. The Now-column lookup is the recommendation step.

### Remove dead .cth-placeholder CSS and stale comment in CashTrendHero.tsx

**Status / Priority:** Cleanup · P5

Result:
Remove .cth-placeholder rule from src/dashboard.css and the stale comment at CashTrendHero.tsx:4. The CashTrendPlaceholder export was already deleted in a prior PR.

Why:
Dead CSS and stale comments are low-signal noise that mislead future readers. This finishes the tidy-up PR #229 left out of scope.

Premise:
Still needed. Export gone; CSS rule + comment confirmed present. No recent PR has touched these lines.

#### Diagnostic standard

N/A — pure code hygiene. No owner-facing surface.

#### Problem

PR #229 replaced `<CashTrendPlaceholder />` with `<IncomeExpenseCard />` at Dashboard.tsx:3282 but left the `CashTrendPlaceholder` export in `src/components/CashTrendHero.tsx:48-54` and the `.cth-placeholder` CSS in `src/dashboard.css:8461` untouched (out of scope: 'no Cash Trend changes').

#### Scope

- Remove `CashTrendPlaceholder` export from `CashTrendHero.tsx`.
- Remove `.cth-placeholder` CSS from `dashboard.css`.
- Confirm no other consumers via grep before removing.
- Typecheck + tests green.

#### Out of scope

- Anything else in `CashTrendHero.tsx`.
- Other Cash Trend changes.

### Dead-CSS sweep after Stage 1 deletions

**Status / Priority:** Cleanup · P5

Stage 1 nav simplification (PR #252) deliberately left now-unused CSS to keep the diff focused: .focus-*, .movers-list, .rollups-table, and a stale TrendLineChart comment in dashboard.css. Remove in a focused follow-up. Deliberate deferral, not tech debt.

Deliberate follow-up from Stage 1 (PR #252 — [https://github.com/wcpeixoto/wx-cfo-scorecard/pull/252](https://github.com/wcpeixoto/wx-cfo-scorecard/pull/252)).

Dead CSS left in `src/dashboard.css` after the Where to Focus + Trends page deletions:

- `.focus-*` (focus-banner, focus-section, focus-row, focus-movers-list, etc.)
- `.movers-list`
- `.rollups-table` / `.rollups-table-card`
- stale `TrendLineChart` comment (~line 2135)

Low priority, can run anytime. Grep each selector for live usage before removing.


## Paused — CFO Assistant (6)

### CFO Assistant: committed-mode Why chip can explain current hero instead of active commitment

**Status / Priority:** Paused — CFO Assistant · P3

Committed-mode 'Why this step?' can explain the ranked hero instead of the active commitment (principle #5); inherited from PR #181, not a #191 regression.

**Symptom:** During an active commitment, tapping "Why this step?" can display rationale for a different signal than the one the owner committed to. Violates the commitment-mode invariant (card stays anchored to active commitment) and principle #5.

**Evidence:**

- `src/components/CfoAssistantCard.tsx:76` sources `copy` from the ranked hero (`getFallbackCopy(hero)`).
- `:160` and `:522` render `copy.why` in committed mode.
- Inherited from `93e48ee6` / PR #181 (Phase 1c structural chips). NOT a #191 regression — provenance settled 2026-05-22.

**Fix direction:** Pin committed-mode rationale to the active commitment, or hide/remap the chip while committed. Separate from copy-only pass.

### CFO Assistant Execute Stage 1: "nothing ran above norm" leaves no next move during active commitment

**Status / Priority:** Paused — CFO Assistant · P2

Execute Stage 1's 'nothing ran above norm' fallback leaves no immediate next move during an active commitment; working as designed (#3), evidence for candidate (b) toothlessness.

**Symptom:** When Execute Stage 1 finds no overspending lines, copy reads "Nothing ran above its recent norm this month, so there's no obvious line to cut. The reserve gap stands — revisit when spending moves." Honest, but gives no immediate fallback for an active commitment.

**Evidence:**

- `src/lib/commitments/execute.ts:115` — origin PR #202 (B-2).
- Working as designed per the Phase 3a #3 principle (no faked precision).
- Discovery flagged as evidence for candidate (b) — Execute toothlessness / "I did this" affordance.

**Fix direction:** Keep the honesty; add one non-fake next move for the current commitment. Likely scoped under candidate (b) when that thread is picked up.

---

**Architecture context (2026-05-22):** Filed before the constrained-generator architecture decision. The current hand-authored-template approach may not be the right substrate for this fix. Under the planned architecture, tone-layer copy moves to a typed-shape AI generator with deterministic fallback, while invariants such as one action, target, deadline, and anchor-to-commitment stay in code.

Re-evaluate this item against that architecture before implementing. If the generator slice ships, this item may dissolve or change shape.

See the queued constrained-generator discovery slice for scoping.

### CFO Assistant: owner_distributions_high action has split completion conditions

**Status / Priority:** Paused — CFO Assistant · P3

owner_distributions_high action bundles a compare-step and draw-leveling with different completion conditions; not commitment-ready under #2. Defer until the signal is commitment-ready.

**Symptom:** Current action: "Compare your current cash balance to your Operating Reserve — if it's below, level your draw rate until it recovers." "Compare current cash to reserve" and "level your draw rate" are two moves with different completion conditions. Acceptable as awareness copy today; not commitment-ready under principle #2.

**Evidence:** `src/lib/priorities/copy.ts` — `owner_distributions_high` action field. Identified during PR-1 discovery sweep, left out of PR-1 scope (Code's restraint was correct).

**Fix direction:** Defer until this signal is on the commitment-ready path. At that point, separate the diagnostic compare-step from the commitment action, or pick one as the primary.

---

**Architecture context (2026-05-22):** Filed before the constrained-generator architecture decision. The current hand-authored-template approach may not be the right substrate for this fix. Under the planned architecture, tone-layer copy moves to a typed-shape AI generator with deterministic fallback, while invariants such as one action, target, deadline, and anchor-to-commitment stay in code.

Re-evaluate this item against that architecture before implementing. If the generator slice ships, this item may dissolve or change shape.

See the queued constrained-generator discovery slice for scoping.

### CFO Assistant — Multi-week strategic actions with weekly sub-commitments

**Status / Priority:** Paused — CFO Assistant · P5

Serious business problems (under-funded reserve, declining revenue, structural cost overruns) typically require 4–8 weeks of meaningful work. The current one-week-only commitment window forces the system to shrink real goals into trivial weekly tasks ($50/week against a $34K gap). The system must: (1) recognize the problem, (2) propose a multi-week path, (3) define the first week's chunk as the commitment, (4) track progress week-over-week, (5) adjust the path based on what actually happened. Each week's commitment must be honestly named for the actual work that week — analysis weeks are analysis, execution weeks are execution. No softening to fit the calendar. Dependencies: Two-layer commitment model.

#### The problem

The current commitment architecture has a hard one-week window. Larger goals are supposed to be "broken into weekly sub-commitments" per memory rule, but in practice the system just shrinks the goal to fit a week. The result is trivial recommendations against serious gaps.

#### The required system behavior

1. Recognize the problem (signal layer — already works)
2. Propose a multi-week path (new)
3. Define the **first week's chunk** of that path as the commitment (new)
4. Track progress week-over-week (extends existing follow-up loop)
5. Adjust the path based on what actually happened (new)

#### Example progression

- **Week 1:** Review payroll changes since your best-margin months. Identify the 3 biggest deltas.
- **Week 2:** Decide which of the 3 deltas to address first. Define what changing it would actually look like.
- **Week 3:** Make the change. (Hiring conversation, schedule restructure, contractor renegotiation — the action this week is the execution.)
- **Week 4:** Verify the change is reflected in next month's data. Decide if more is needed.

#### Honesty principle

Each week's commitment must be honestly named for the actual work that week. Analysis weeks are analysis. Execution weeks are execution. The system should not soften reality (e.g., calling analysis "a 4-week review" inflates work to fit the calendar).

#### Dependency

Two-layer commitment model

### CFO Assistant — AI freedom + context

**Status / Priority:** Paused — CFO Assistant · P5

Current prompts are heavily constrained (one action, one deadline, measurable result). These constraints prevent vague/bundled/fake recommendations — they exist for good reasons. But the constraints also prevent the AI from doing what it's uniquely good at: understanding business context and proposing actions that fit the situation. The redesign needs to: give the AI enough context (business shape, recent history, owner constraints); give the AI enough freedom to suggest situation-appropriate paths; keep guardrails that prevent hallucination. This is the hardest part of the redesign. It is NOT a prompt-tuning problem — it is an architecture problem. Dependencies: Two-layer commitment model; Multi-week strategic actions.

#### The tension

Current prompts have strong guardrails:

- One action per recommendation
- One deadline
- Measurable result
- No bundled options

These exist for good reasons — they prevent vague, bundled, or fake recommendations.

But they also prevent the AI from doing what it's uniquely good at: **understanding business context and proposing actions that fit the situation**.

#### What the redesign needs

1. Give the AI enough **context** — business shape, recent history, owner constraints, what was tried before
2. Give the AI enough **freedom** to suggest situation-appropriate paths (e.g., "given the business is mostly payroll-driven and revenue has been flat, here's a 4-week payroll review path")
3. Keep **guardrails** that prevent hallucination, fake precision, or unsafe advice

#### Why this is hard

This is NOT a prompt-tuning problem. Adding more rules to the prompt makes the AI more constrained, not less. The fix is architectural — what information the AI has access to, what structure its output takes, what the deterministic fallback looks like.

This is the hardest part of the redesign.

#### Dependencies

- Two-layer commitment model
- Multi-week strategic actions with weekly sub-commitments

### CFO Assistant — Two-layer commitment model

**Status / Priority:** Paused — CFO Assistant · P5

The current architecture has one layer: a weekly commitment with a measurable target. This forces the system to treat outcome (build reserve) as action (move $X). The redesign needs two layers: Layer 1 — Outcome target (multi-week destination, e.g. 'Rebuild operating reserve to one month'). Layer 2 — Weekly strategic action (what the owner does this week, e.g. 'Identify the top 3 payroll roles that changed since your best-margin months'). Both layers must be visible to the owner. They should see what they're working toward AND what they're doing this week. This is the foundational change. Most other architecture work depends on it. Dependencies: CFO Assistant — paused 2026-05-23 (master).

#### Layer 1 — Outcome target

The destination. Measured in weeks or months. Answers "what are we trying to achieve?"

**Example:** Rebuild operating reserve to one month of expenses.

#### Layer 2 — Weekly strategic action

What the owner does this week. One specific, physical, nameable activity that moves them toward Layer 1.

**Example:** Identify the top 3 payroll roles or shifts that changed since your best-margin months. Compare them to revenue.

#### Why both must be visible

The owner needs to see what they're working toward AND what they're doing this week. They should not see one without the other.

#### Why this is foundational

Most other architecture work (multi-week strategic actions, AI freedom + context) depends on this two-layer model being in place. Without it, the system continues to confuse outcome with action.

#### Dependency

CFO Assistant — paused 2026-05-23 (master)

---

_Migrated from the Notion "Wx CFO Scorecard — Backlog" export, 2026-06-17 (Step 1). Three retention candidates appended to Later on 2026-06-17 (Step 2) from the retired retention plan doc. Statuses as-of migration; a grooming/reconciliation pass against shipped state is pending (some Later items may already be done). Reprioritized 2026-06-20: a `Retention (priority)` section was created above `Next` — 4 retention items lifted from Later (48→44) and 2 new items added (churn time-series substrate probe + churn-evolution-over-time chart), 6 total in dependency order._
