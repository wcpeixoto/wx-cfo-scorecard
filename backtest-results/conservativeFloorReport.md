# Conservative Floor Diagnostic Report

## Frame

- **Generated (UTC):** 2026-05-02
- **Fixture path:** `backtest-results/fixtures/transactions-snapshot.jsonl`
- **Fixture row count:** 4,842
- **Fixture earliest transaction:** 2021-12-08
- **Fixture latest transaction:** 2026-04-21
- **Last closed realized month:** 2026-03
- **As-of dates evaluated:**
  - 2025-05-01
  - 2025-08-01
  - 2025-11-01
  - 2026-01-01
  - 2026-02-01
- **Excluded category (diagnostic-only):** `Taxes and Licenses:Federal Tax`
  - Excluded from both projected and realized cash-out for scoring purposes.
  - Production behavior is unaffected.

## Retrospective backtest

Aggregated across the 5 as-of dates listed above. Federal Tax
excluded from both projected and realized cash-out.

### 30d

| Model | Avg abs net err | Avg signed bias | Under-proj count (n=5) |
|---|---:|---:|---:|
| engine | $12,493 | +$10,744 | 1/5 |
| category_cadence | $8,625 | +$6,546 | 1/5 |
| split_conservative | **$7,823** | +$4,824 | 2/5 |
| h50_50_net | $8,892 | +$8,645 | 1/5 |
| conservative_floor | $8,238 | +$4,409 | 2/5 |

### 90d

| Model | Avg abs net err | Avg signed bias | Under-proj count (n=5) |
|---|---:|---:|---:|
| engine | $11,740 | +$10,960 | 1/5 |
| category_cadence | $6,800 | +$2,574 | 1/5 |
| split_conservative | $6,890 | +$101 | 2/5 |
| h50_50_net | $6,767 | +$6,767 | 0/5 |
| conservative_floor | **$6,512** | −$3,386 | 3/5 |

### 1y

| Model | Avg abs net err | Avg signed bias | Under-proj count (n=5) |
|---|---:|---:|---:|
| engine | $26,199 | +$26,199 | 0/5 |
| category_cadence | $15,527 | +$11,301 | 1/5 |
| split_conservative | $9,728 | +$6,222 | 1/5 |
| h50_50_net | $18,750 | +$18,750 | 0/5 |
| conservative_floor | **$6,686** | −$4,291 | 4/5 |

## Current forecast

Basis: full fixture. Latest model month: `2026-04`. First forecast month: `2026-05`.
Federal Tax excluded from training. h50_50 cash-in / cash-out shown as "—" because they are not separately defined.

### 30d

| Model | Cash In | Cash Out | Net |
|---|---:|---:|---:|
| engine | $35,924 | $32,595 | $3,329 |
| category_cadence | $36,620 | $34,730 | $1,890 |
| split_conservative | $35,924 | $34,730 | $1,194 |
| h50_50_net | — | — | $2,610 |
| conservative_floor | $35,924 | $34,730 | $1,194 |

### 90d

| Model | Cash In | Cash Out | Net |
|---|---:|---:|---:|
| engine | $117,923 | $105,664 | $12,260 |
| category_cadence | $114,898 | $102,044 | $12,855 |
| split_conservative | $117,923 | $102,044 | $15,880 |
| h50_50_net | — | — | $12,557 |
| conservative_floor | $111,067 | $108,443 | $2,623 |

### 1y

| Model | Cash In | Cash Out | Net |
|---|---:|---:|---:|
| engine | $465,056 | $428,386 | $36,670 |
| category_cadence | $467,236 | $422,023 | $45,213 |
| split_conservative | $465,056 | $422,023 | $43,033 |
| h50_50_net | — | — | $40,941 |
| conservative_floor | $449,411 | $451,647 | -$2,236 |

## Conclusions

**Q1.** Yes — at the 90d and 1y horizons. Conservative Floor wins absolute-net accuracy at: 90d, 1y. (Winners — 30d: split_conservative ($7,823); 90d: conservative_floor ($6,512); 1y: conservative_floor ($6,686).)

**Q2.** Floor's 1y signed bias is −$4,291 and it under-projected actuals in 4/5 retrospective windows at 1y. The bias is negative, meaning Floor systematically projects lower net than realized — the intended pessimism for a floor view, not a calibration error.

**Q3.** Not at every horizon. Lowest current net by horizon — 30d: split_conservative ($1,194); 90d: conservative_floor ($2,623); 1y: conservative_floor (-$2,236). Floor's current nets — 30d: $1,194; 90d: $2,623; 1y: -$2,236.

**Q4.** Treat Conservative Floor as a downside/stress view, not the primary forecast. Its 1y signed bias of −$4,291 and under-projection rate of 4/5 at 1y indicate a deliberately pessimistic view rather than a best-estimate. Using it as primary would systematically understate cash and trigger false safety alarms.

**Q5.** Split Conservative remains the strongest best-estimate candidate. Its avg abs net error is $7,823 (30d), $6,890 (90d), $9,728 (1y), with signed bias +$4,824 / +$101 / +$6,222 respectively. Split beats or ties Floor on absolute error at 1/3 horizons — Floor's accuracy advantage at longer horizons reflects pessimism, not calibration superiority.

**Q6.** Yes. The data supports a two-view framing: **Expected Case = Split Conservative** (calibrated best estimate, near-zero signed bias at 90d) and **Conservative Case = Conservative Floor** (deliberately pessimistic stress view for safety-line and reserve decisions). A single-forecast product would force a choice between calibration and conservatism; surfacing both lets the operator see expected outcomes and downside risk simultaneously.

## When to re-run

- After fixture refresh
- After any change to `projectScenario` semantics
- After any change to `projectCategoryCadenceScenario` semantics
- Before any production implementation of `composeConservativeFloor()`
- After material changes to Federal Tax handling assumptions
