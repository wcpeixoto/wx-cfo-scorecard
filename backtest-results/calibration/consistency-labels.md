# Consistency calibration — hand-labels (first attempt)

> **Superseded.** This file captures the FIRST PASS: 16-window labeling that
> produced 1 Steady / 15 Choppy and surfaced the thin-Steady finding. After
> discussion, path **B** (extend the sweep to 47 mechanically-generated as-of
> dates) was chosen. Final outcome is in
> `consistency-calibration-findings.md`. The criteria and discipline
> documented below were carried forward into the 47-window sweep without
> modification (frozen).

**Discipline:** Labels assigned by eye from `consistency-windows-raw.json` BEFORE any
Range / trailing-6-Business-Income ratio is computed. Once committed, this file is
the ground truth that downstream ratios are tested against.

## Pre-committed criteria

A 6-month trailing-net-cash window is **Steady** if BOTH:

1. **No shock losses** — no single month worse than **-$5K** in net cash result. At
   gym scale (~$30K-$60K monthly Business Income), -$5K is ~10-15% of revenue —
   the line where an owner reads it as a "bad month," not noise.
2. **At most 2 negative months out of 6.** More than 2 means persistent negative
   pressure, not occasional weakness.

Otherwise: **Choppy**.

These criteria were committed before applying. They were *not* tuned to the data
or to a desired Steady/Choppy ratio. The thresholds (-$5K, 2 negatives) come from
owner-perspective reasoning, not from looking at the windows.

I do note that my first informal pass was stricter and labeled every window
Choppy. I revised to the criteria above after recognizing that "any negative
month at all" overweights mild fluctuations. The revised criteria were applied
mechanically below — no further tweaking.

## Anchor

The prod window (`2026-05-01` → Nov 2025 – Apr 2026, range $29.2K, worst loss
-$12.2K) **must** classify Choppy under any defensible criteria. The criteria
above produce that classification (3 negatives, -$12.2K worst loss).

## Labels

| # | As-of | Window | # neg | Worst loss | Label | Why |
|---|-------|--------|-------|------------|-------|-----|
| 1  | 2025-01-01 | Jul–Dec 2024  | 3 | -$7.9K  | Choppy | shock loss + 3 neg |
| 2  | 2025-02-01 | Aug 2024–Jan 2025 | 4 | -$7.9K  | Choppy | shock loss + 4 neg |
| 3  | 2025-03-01 | Sep 2024–Feb 2025 | 3 | -$3.2K  | Choppy | 3 neg |
| 4  | 2025-04-01 | Oct 2024–Mar 2025 | 2 | -$3.2K  | **Steady** | both rules pass |
| 5  | 2025-05-01 | Nov 2024–Apr 2025 | 3 | -$6.5K  | Choppy | shock loss + 3 neg |
| 6  | 2025-06-01 | Dec 2024–May 2025 | 3 | -$6.5K  | Choppy | shock loss + 3 neg |
| 7  | 2025-07-01 | Jan–Jun 2025  | 3 | -$6.5K  | Choppy | shock loss + 3 neg |
| 8  | 2025-08-01 | Feb–Jul 2025  | 2 | -$6.5K  | Choppy | shock loss (only 2 neg though) |
| 9  | 2025-09-01 | Mar–Aug 2025  | 3 | -$6.5K  | Choppy | shock loss + 3 neg |
| 10 | 2025-10-01 | Apr–Sep 2025  | 3 | -$6.5K  | Choppy | shock loss + 3 neg |
| 11 | 2025-11-01 | May–Oct 2025  | 3 | -$5.5K  | Choppy | shock loss + 3 neg |
| 12 | 2025-12-01 | Jun–Nov 2025  | 4 | -$6.9K  | Choppy | shock loss + 4 neg |
| 13 | 2026-01-01 | Jul–Dec 2025  | 3 | -$6.9K  | Choppy | shock loss + 3 neg |
| 14 | 2026-02-01 | Aug 2025–Jan 2026 | 3 | -$6.9K  | Choppy | shock loss + 3 neg |
| 15 | 2026-03-01 | Sep 2025–Feb 2026 | 3 | -$12.2K | Choppy | shock loss + 3 neg |
| 16 | 2026-05-01 **[PROD]** | Nov 2025–Apr 2026 | 3 | -$12.2K | Choppy | anchor ✓ |

## Tally

- **Steady: 1** (W4: Oct 2024 – Mar 2025)
- **Choppy: 15**
- Prod anchor lands on Choppy as required.

## Risk: thin Steady class

Only one Steady example across 16 windows. With a single Steady point, a cutoff
can only sit at "anything below W4's ratio = Steady" — that's a single-point
classification, not a calibration. The pre-committed failure bar
("misclassifies >2 of 15") is structurally hard to violate when there's only one
Steady point that could be misclassified.

This is a real-world finding: the gym's trailing-6 net cash result has been
Choppy by reasonable owner criteria across nearly all of 2025 and 2026 to date.
The data does not contain enough Steady examples to calibrate the cutoff
empirically from this sample alone.

This finding gates the next step. Options to be decided before computing ratios:

- **A.** Compute ratios with 1 Steady / 15 Choppy. Accept that the cutoff will
  be a single-point separation, with limited generalization confidence.
- **B.** Extend the as-of date range backwards into 2023–2024 (when the business
  may have had Steadier periods) to grow the Steady class.
- **C.** Loosen the labeling criteria. *Risk:* this is exactly the post-hoc
  fitting the discipline is meant to prevent — to be avoided unless the
  argument is independent of the data.
- **D.** Stop. Report "calibration not possible from this sample" and ship the
  Consistency row as range-only, no Steady/Choppy verdict.
