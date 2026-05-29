# Consistency Steady/Choppy verdict — calibration attempt 2026-05-29

**Outcome: D — Consistency row stays range-only, no verdict pill. The
informational ratio footnote indicates the metric itself is wrong for this
purpose, so a future revisit should reach for a different metric, not wait
for more data.**

## Metric (locked before data inspection)

Range / trailing-6 Business Income, with numerator and denominator drawn
from the **same** 6-month window for each as-of date.

Chosen over CoV (σ/|μ|) and MAD/|median| because it sidesteps the
near-zero-mean failure mode by normalizing against revenue, which is
always positive and order-of-magnitude larger than net cash result.

## Labeling criteria (frozen before mechanical application)

A 6-month trailing-net-cash window is **Steady** iff both:

1. No single month worse than **−$5K** in net cash result (no shock loss
   — at gym scale, the line where an owner reads it as a bad month not
   noise).
2. **≤2** negative months out of 6.

Otherwise **Choppy**. Criteria locked before any ratio was computed and
applied mechanically by `consistencyLabel.ts`.

Noted: an earlier informal pass labeled every window Choppy ("any
negative = bad"). I revised once to the current rules before any ratio
existed. The user explicitly approved this revision as legitimate
(over-strict → owner-grounded, made blind to ratios). No further revision
was permitted under the freeze; the 47-window sweep used the rules above
without modification.

## Sweep design

47 as-of dates, generated mechanically:

- **46 regular**: monthly first-of-month from `2022-06-01` to `2026-03-01`
  inclusive. Start date `2022-06-01` is the earliest valid trailing-6
  given the fixture's data start of 2021-12.
- **1 prod anchor**: `2026-05-01` (today is 2026-05-29; the live render
  excludes the current incomplete calendar month, so its trailing-6
  ends April 2026).

Per as-of: `computeMonthlyRollups(txns where date < asOf, 'operating').slice(-6)`.

## Pre-set pass bar

≥4 Steady windows AND ≥4 Steady clusters, where a cluster is a maximal
run of consecutive Steady as-of dates with each pair ≤6 months apart
(their trailing-6 windows would overlap, so they are not independent
observations).

## Result — bar fails

**Tally:** 16 Steady / 31 Choppy / 0 insufficient.

**Steady clusters: 3.**

| # | Cluster | Windows | Spans data |
|---|---------|---------|------------|
| C1 | 2022-06 → 2023-04 | 10 | late 2021 through early 2023 |
| C2 | 2023-11 → 2024-03 | 5  | mid-2023 through early 2024 |
| C3 | 2025-04           | 1  | Oct 2024 – Mar 2025 |

**Prod anchor** (2026-05-01) → Choppy ✓ (matches pre-committed anchor).

**Bar:** Steady count 16 ≥4 **YES**; cluster count 3 ≥4 **NO** → **FAIL → D**.

## Informational footnote (outside pre-committed flow, NOT validated)

Computed after the gate failed, to tell a future revisit which door is
still open. **No cutoff is proposed, named, or validated.**

**Distribution shape:**

| Label  | n  | min    | median | max    |
|--------|----|--------|--------|--------|
| Steady | 16 | 0.0582 | 0.1250 | 0.1390 |
| Choppy | 31 | 0.0585 | 0.0830 | 0.1914 |

**Distributions overlap heavily.** 38 of 47 windows sit between
max(Steady)=0.139 and min(Choppy)=0.059. And the direction is unexpected:
**Steady median (0.125) > Choppy median (0.083).**

Why: my Steady criteria are downside-focused (no shock losses, few
negatives), but Range mixes upside AND downside swings. A Steady window
with one strong positive month (+$11K-$17K) has a high range despite
being calm by the labeling criteria. A Choppy window with mild bilateral
negatives can have a low range despite tripping the shock-loss rule.

**Door this opens for a future revisit:** the metric is structurally
wrong for this label structure. More observations won't fix it.
Candidates to consider next: a downside-only dispersion measure (e.g.
absolute worst-loss magnitude relative to BI), semivariance below zero,
or — given that the labeling criteria are already classifier-like — a
threshold-based verdict that directly uses the criteria (worst-loss and
negative-count thresholds) rather than a continuous ratio at all.

## Artifacts (this directory)

- `consistency-windows-raw.json` — original 16-window raw extraction (first attempt)
- `consistency-labels.md` — original 16-window labels and criteria doc (first attempt)
- `consistency-labels.json` — original 16-window labels (machine-readable)
- `consistency-windows-raw-full.json` — 47-window raw extraction
- `consistency-labels-full.json` — 47-window mechanical labels + cluster check
- `consistency-ratios-informational.json` — informational ratio footnote
- `consistency-calibration-findings.md` — this doc

## Scripts (`scripts/backtest/`)

- `consistencyExtract.ts` — 16-window extraction (first attempt)
- `consistencyExtractFull.ts` — 47-window extraction
- `consistencyLabel.ts` — mechanical labeling (frozen criteria + cluster gate)
- `consistencyRatios.ts` — informational ratios footnote (no cutoff search)

Re-run end-to-end:
```
npx tsx scripts/backtest/consistencyExtractFull.ts
npx tsx scripts/backtest/consistencyLabel.ts
npx tsx scripts/backtest/consistencyRatios.ts
```

## Status

Consistency row continues to render as range-only with no verdict pill.
This extends the existing verdict-exempt posture (per
`project_kpi_to_today_ia` — Consistency is verdict-exempt at <6mo data
with empty cell as the deliberate signal) to also cover "insufficient
independent Steady evidence + metric structurally wrong."

No code change ships from this session. The artifacts above are the
durable record so a future revisit has full reproducibility.
