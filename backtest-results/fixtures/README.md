# Backtest fixtures

This directory holds **frozen** inputs for the backtest harness. The
harness is a regression test — its outputs only mean something if the
inputs don't shift between runs. Never refresh casually.

## Files

### `transactions-snapshot.csv` (required)

A CSV snapshot of the production `transactions` table at a point in time.
The harness loads it via `scripts/backtest/loadFixture.ts`.

**Required columns** (header row, exact names, case-insensitive):
- `date` — `YYYY-MM-DD`
- `amount` — absolute dollar amount (always positive)
- `rawAmount` — signed dollar amount (negative = expense / outflow)
- `category` — full category string, including `parent:child` if present

**Strongly recommended columns** (the harness uses them when present):
- `id`, `month` (`YYYY-MM`), `type` (`income` | `expense`), `payee`,
  `memo`, `account`, `transferAccount`, `tags` (pipe-separated),
  `balance`

If `month` is missing the harness derives it from `date`. If `type` is
missing it derives it from `rawAmount`'s sign.

### `historical-anchors.json` (optional but strongly recommended)

A small JSON file giving the harness known operating-cash balances at
specific historical dates. Without this, the harness zero-anchors
starting cash and only trajectory-shape metrics are trustworthy.

```json
{
  "anchors": [
    { "asOfDate": "2022-01-01", "operatingCashBalance": 0 },
    { "asOfDate": "2023-01-01", "operatingCashBalance": 0 },
    { "asOfDate": "2024-01-01", "operatingCashBalance": 0 },
    { "asOfDate": "2025-01-01", "operatingCashBalance": 0 }
  ]
}
```

- `asOfDate` is a `YYYY-MM-DD` string; the harness uses lexicographic
  comparison.
- `operatingCashBalance` should be the **operating-cash** balance —
  i.e. exclude financing accounts, owner-distribution effects,
  uncategorized activity, and pure transfers. The simplest anchor is
  the sum of cash-account balances minus any owner-draw outflow that
  has already been excluded by `cashFlow.ts`.
- Multiple anchors are allowed; the harness uses the closest preceding
  anchor for each as-of date and walks operating-cash net forward.

## Why frozen?

Phase 2 will introduce baselines and regression thresholds keyed off
specific metric values. If the fixture shifts, those baselines are no
longer comparable. Treat fixture refreshes like model retraining — done
intentionally, with an explicit baseline reset.

## How to refresh `transactions-snapshot.csv`

1. In Supabase Dashboard → Table Editor → `transactions`, export the
   full table as CSV. Confirm the row count matches the dashboard's
   System Status total.
2. Save the file to this directory as `transactions-snapshot.csv`
   (overwrite the previous one).
3. Run `npx tsx scripts/backtest/runBacktest.ts` and verify the harness
   loads cleanly and all 15 as-of runs produce metrics.
4. Commit the new fixture in its own commit with a message that
   explains *why* it was refreshed (e.g. recategorization, data
   correction, quarterly cadence).
5. Once Phase 2 lands, refreshing the fixture will require updating
   the baseline file in the same commit — do not do this lightly.

## How to refresh `historical-anchors.json`

Anchors are only refreshed when:
- A new historical period crosses a year boundary and a known balance
  is available, or
- A discovered data correction changes a previously-trusted balance.

Edit the file directly. Commit with a brief explanation.

## When the fixture is missing

The harness exits with a clear error message pointing back to this
README. Phase 1 does not auto-generate fixtures.
