# Forecast Backtest Harness — Phase 1

A permanent diagnostic that walks the locked forecast engine forward
through history and measures how well it predicted actual cash balances.

## What it does

For each of 15 monthly as-of dates (2025-01-01 through 2026-03-01), the
harness:

1. Filters the transaction fixture to `date < asOfDate` (strict).
2. Runs the **real** forecast engine (`src/lib/kpis/compute.ts`,
   `projectScenario` with the base scenario, no events, 12-month horizon)
   to produce a forecast cash trajectory.
3. Builds a truth series by walking the actual transactions forward,
   using the **same** operating-cash rules from `src/lib/cashFlow.ts`.
4. Compares forecast vs truth and prints metrics per as-of date and an
   aggregate summary.

The forecast engine and operating-cash rules are imported live — never
copied — so the harness measures the engine that ships.

## How to run

```bash
npx tsx scripts/backtest/runBacktest.ts
```

`tsx` is invoked via `npx`; no install or `package.json` change is
needed (Phase 3 will add a script).

## What each metric means

| Metric | Plain English |
|---|---|
| `directionalAccuracy` | Share of months where the forecast and truth agree on whether cash went up or down that month. High means the engine reads the *direction* of cash flow correctly. |
| `lowestBalanceError` | Forecast trough minus actual trough, in dollars. Positive = forecast was rosier than reality (didn't go as low). |
| `mape30` / `mape60` / `mape90` | Mean absolute percentage error of the ending balance at horizon month 1, 2, and 3. |
| `endpointError` | Forecast month 12 ending balance minus actual month 12 ending balance, in dollars. Long-horizon drift. |
| `safetyLineHit` | True when the forecast's reserve breach over the horizon agrees with reality (both breached, or both didn't). Reported per run; aggregate is the share of runs that agreed. |
| `worstSingleMonthMiss` | Largest absolute dollar error across the 12-month horizon. The "worst case" the forecast missed by. |

## Anchors and what's reliable without them

The forecast and truth series both need a **starting cash balance** at
each as-of date. By default, the harness zero-anchors that balance and
sums operating-cash deltas forward — this measures the *trajectory* of
the forecast, not the absolute level.

To measure absolute levels (and trust the safety-line hit rate, lowest
balance error, endpoint error, and worst single-month miss), provide
known historical cash balances in:

```
backtest-results/fixtures/historical-anchors.json
```

See `backtest-results/fixtures/README.md` for the format. When anchors
are missing, the harness prints a banner at the top of each run noting
which metrics are unreliable.

## Known limitations

- **Account configuration is current-state only.** The engine relies on
  category and account *names* on each transaction, which travel with
  the fixture. But if accounts have been renamed or `includeInCashForecast`
  flipped since the fixture was taken, historical reconstruction may
  drift slightly. Refresh the fixture after material configuration
  changes.
- **Partial history degrades seasonality.** For as-of dates before
  enough complete years exist, the engine falls back to the momentum
  model. The harness records this implicitly via metrics — early as-of
  dates will typically show worse MAPE.
- **Anchors are point-in-time.** The harness uses the closest preceding
  anchor and walks operating-cash deltas forward from there. Anchors
  should be operating-cash balances (excluding owner draws, financing,
  transfers, uncategorized) — not raw bank balances.

## When to refresh the fixture

- After a material data correction or recategorization.
- Quarterly, to keep the regression baseline current.
- Never silently mid-phase — refreshing changes the metrics, which
  defeats the regression-detection purpose Phase 2 will build on.

The fixture procedure lives in `backtest-results/fixtures/README.md`.
