# CFO Assistant — replay evaluation artifact (total-cash basis)

> Read-only diagnostic. Rubric scoring is a SEPARATE human step — nothing here is auto-scored.

- Generated: 2026-05-23T17:49:54.405Z
- Fixture: `/Users/wesley/Code/wx-cfo-scorecard/backtest-results/fixtures/transactions-snapshot.jsonl` (4851 txns)
## Cash definition (matches production configuration)

- **Reserve basis: TOTAL BANK CASH.**
- Cash-included accounts: **Bank of America, Card Amex**
- Excluded (notable): Cash (petty), Wodify, CC Corp 8839, CC Deborah, CC Marcio, S/T Loan SH, Merchant Fee
- Total-cash anchor: 2021-12-01=$27,367
- Source: production shared_account_settings (read-only lookup 2026-05-23)
- This cash definition matches production `shared_account_settings` — not a replay-only assumption.
- Operating-cash comparison: included below (excludes owner draws; overstates available cash; NOT the reserve basis)
- As-of dates: 15

**Fidelity caveats:** (1) cash_flow signals use the engine base projection, NOT the production composed Conservative Floor; reserve heroes are unaffected (they ignore the projection). (2) Account config / categories are current-state (travel with the fixture).

## Hero-bucket distribution (TOTAL-cash basis — use this for week selection)

| Hero type | Count | Dates |
|---|---:|---|
| reserve_warning | 9 | 2025-01-01, 2025-02-01, 2025-03-01, 2025-05-01, 2025-06-01, 2025-07-01, 2025-08-01, 2025-09-01, 2025-11-01 |
| reserve_critical | 4 | 2025-12-01, 2026-01-01, 2026-02-01, 2026-03-01 |
| expense_surge | 1 | 2025-04-01 |
| cash_flow_tight | 1 | 2025-10-01 |

## Summary table

| As-of | Hero (total) | Sev | % funded (total) | Total cash | Reserve target | Grounded target | Execute | [cmp] Hero (op) | [cmp] % funded (op) |
|---|---|---|---:|---:|---:|---|---|---|---:|
| 2025-01-01 | reserve_warning | warning | 84.0% | $33,948 | $40,640 | grounded ($225/wk) | levers | reserve_warning | 84.0% |
| 2025-02-01 | reserve_warning | warning | 55.0% | $21,327 | $39,013 | grounded ($150/wk) | levers | reserve_warning | 85.0% |
| 2025-03-01 | reserve_warning | warning | 82.0% | $30,450 | $37,054 | grounded ($100/wk) | levers | expense_surge | 111.0% |
| 2025-04-01 | expense_surge | critical | 105.0% | $34,731 | $33,223 | — | n/a | expense_surge | 157.0% |
| 2025-05-01 | reserve_warning | warning | 71.0% | $28,465 | $40,318 | grounded ($175/wk) | levers | expense_surge | 113.0% |
| 2025-06-01 | reserve_warning | warning | 74.0% | $29,555 | $40,199 | grounded ($150/wk) | levers | expense_surge | 114.0% |
| 2025-07-01 | reserve_warning | warning | 55.0% | $23,602 | $42,819 | grounded ($100/wk) | levers | reserve_warning | 95.0% |
| 2025-08-01 | reserve_warning | warning | 96.0% | $36,175 | $37,700 | grounded ($125/wk) | levers | expense_surge | 144.0% |
| 2025-09-01 | reserve_warning | warning | 76.0% | $28,686 | $37,565 | grounded ($150/wk) | levers | expense_surge | 133.0% |
| 2025-10-01 | cash_flow_tight | warning | 100.0% | $37,967 | $38,062 | — | n/a | expense_surge | 156.0% |
| 2025-11-01 | reserve_warning | warning | 82.0% | $31,433 | $38,445 | grounded ($175/wk) | levers | expense_surge | 140.0% |
| 2025-12-01 | reserve_critical | critical | 43.0% | $16,682 | $39,196 | grounded ($50/wk) | levers | expense_surge | 120.0% |
| 2026-01-01 | reserve_critical | critical | 49.0% | $21,480 | $43,902 | grounded ($150/wk) | levers | expense_surge | 129.0% |
| 2026-02-01 | reserve_critical | critical | 44.0% | $18,338 | $41,980 | grounded ($175/wk) | levers | expense_surge | 144.0% |
| 2026-03-01 | reserve_critical | critical | 19.0% | $8,024 | $42,079 | grounded ($50/wk) | levers | expense_surge | 115.0% |

## Per-date detail (total-cash basis)

### 2025-01-01

- Data through: 2024-12 · txns: 3243 · runway status: self-funded
- Total cash: $33,948 · reserve target: $40,640 · % funded: 84.0%
- [comparison] operating cash: $33,948 · % funded (op): 84.0% · hero (op): reserve_warning
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $6,502
- Commitment draft (illustrative @ recommended): Move $225 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$225 · floor=$25 · weeklyCapacity=$647 · ceiling=$6,502
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: W-2 Staff ran $3,284 above its recent average.
  - alt: Federal Tax — $1,923 above average
  - alt: Merchant Fees — $1,328 above average

### 2025-02-01

- Data through: 2025-01 · txns: 3325 · runway status: self-funded
- Total cash: $21,327 · reserve target: $39,013 · % funded: 55.0%
- [comparison] operating cash: $33,262 · % funded (op): 85.0% · hero (op): reserve_warning
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $17,556
- Commitment draft (illustrative @ recommended): Move $150 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$150 · floor=$25 · weeklyCapacity=$449 · ceiling=$17,556
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Federal Tax ran $1,963 above its recent average.
  - alt: 1099 Front Desk — $457 above average
  - alt: Marketing Agencies — $250 above average

### 2025-03-01

- Data through: 2025-02 · txns: 3403 · runway status: self-funded
- Total cash: $30,450 · reserve target: $37,054 · % funded: 82.0%
- [comparison] operating cash: $40,971 · % funded (op): 111.0% · hero (op): expense_surge
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $6,670
- Commitment draft (illustrative @ recommended): Move $100 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$100 · floor=$25 · weeklyCapacity=$314 · ceiling=$6,670
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Uniforms & Retail ran $2,968 above its recent average.
  - alt: Ads — $777 above average
  - alt: State Tax — $215 above average

### 2025-04-01

- Data through: 2025-03 · txns: 3488 · runway status: self-funded
- Total cash: $34,731 · reserve target: $33,223 · % funded: 105.0%
- [comparison] operating cash: $52,145 · % funded (op): 157.0% · hero (op): expense_surge
- **Hero:** expense_surge (critical)
- Recommended action: Review "Payroll:1099 Instructors" — spending spiked above your normal range last month.
- Gap amount: $1,593
- Commitment draft: none (hero is not commitment-ready)
- Execute (n/a): hero is not reserve-funding (Execute is reserve-only)

### 2025-05-01

- Data through: 2025-04 · txns: 3577 · runway status: self-funded
- Total cash: $28,465 · reserve target: $40,318 · % funded: 71.0%
- [comparison] operating cash: $45,626 · % funded (op): 113.0% · hero (op): expense_surge
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $11,692
- Commitment draft (illustrative @ recommended): Move $175 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$175 · floor=$25 · weeklyCapacity=$558 · ceiling=$11,692
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Other, Cash ran $8,855 above its recent average.
  - alt: 1099 Instructors — $7,056 above average
  - alt: State Tax — $6,986 above average

### 2025-06-01

- Data through: 2025-05 · txns: 3678 · runway status: self-funded
- Total cash: $29,555 · reserve target: $40,199 · % funded: 74.0%
- [comparison] operating cash: $45,772 · % funded (op): 114.0% · hero (op): expense_surge
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $10,452
- Commitment draft (illustrative @ recommended): Move $150 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$150 · floor=$25 · weeklyCapacity=$438 · ceiling=$10,452
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: 1099 Instructors ran $6,018 above its recent average.
  - alt: Refunds & Allowances — $3,206 above average
  - alt: Rent or Lease — $1,000 above average

### 2025-07-01

- Data through: 2025-06 · txns: 3808 · runway status: self-funded
- Total cash: $23,602 · reserve target: $42,819 · % funded: 55.0%
- [comparison] operating cash: $40,844 · % funded (op): 95.0% · hero (op): reserve_warning
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $19,269
- Commitment draft (illustrative @ recommended): Move $100 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$100 · floor=$25 · weeklyCapacity=$332 · ceiling=$19,269
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Refunds & Allowances ran $1,945 above its recent average.
  - alt: Ads — $1,665 above average
  - alt: 1099 Instructors — $1,526 above average

### 2025-08-01

- Data through: 2025-07 · txns: 3939 · runway status: self-funded
- Total cash: $36,175 · reserve target: $37,700 · % funded: 96.0%
- [comparison] operating cash: $54,432 · % funded (op): 144.0% · hero (op): expense_surge
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $1,508
- Commitment draft (illustrative @ recommended): Move $125 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$125 · floor=$25 · weeklyCapacity=$410 · ceiling=$1,508
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Ads ran $3,799 above its recent average.
  - alt: Payroll Fees — $2,497 above average
  - alt: Telephone & Internet — $476 above average

### 2025-09-01

- Data through: 2025-08 · txns: 4039 · runway status: self-funded
- Total cash: $28,686 · reserve target: $37,565 · % funded: 76.0%
- [comparison] operating cash: $50,002 · % funded (op): 133.0% · hero (op): expense_surge
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $9,016
- Commitment draft (illustrative @ recommended): Move $150 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$150 · floor=$25 · weeklyCapacity=$476 · ceiling=$9,016
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: 1099 Instructors ran $2,201 above its recent average.
  - alt: W-2 Staff — $1,598 above average
  - alt: Gas & Electric — $621 above average

### 2025-10-01

- Data through: 2025-09 · txns: 4163 · runway status: self-funded
- Total cash: $37,967 · reserve target: $38,062 · % funded: 100.0%
- [comparison] operating cash: $59,206 · % funded (op): 156.0% · hero (op): expense_surge
- **Hero:** cash_flow_tight (warning)
- Recommended action: Cash stays positive but dips below your Operating Reserve — watch for timing gaps.
- Gap amount: $96
- Commitment draft: none (hero is not commitment-ready)
- Execute (n/a): hero is not reserve-funding (Execute is reserve-only)

### 2025-11-01

- Data through: 2025-10 · txns: 4266 · runway status: self-funded
- Total cash: $31,433 · reserve target: $38,445 · % funded: 82.0%
- [comparison] operating cash: $53,717 · % funded (op): 140.0% · hero (op): expense_surge
- **Hero:** reserve_warning (warning)
- Recommended action: Keep building your Operating Reserve — you're funded but below the full target.
- Gap amount: $6,920
- Commitment draft (illustrative @ recommended): Move $175 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$175 · floor=$25 · weeklyCapacity=$538 · ceiling=$6,920
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: W-2 Staff ran $6,930 above its recent average.
  - alt: Uniforms & Retail — $1,769 above average
  - alt: Payroll Taxes — $1,495 above average

### 2025-12-01

- Data through: 2025-11 · txns: 4362 · runway status: self-funded
- Total cash: $16,682 · reserve target: $39,196 · % funded: 43.0%
- [comparison] operating cash: $46,861 · % funded (op): 120.0% · hero (op): expense_surge
- **Hero:** reserve_critical (critical)
- Recommended action: Build your Operating Reserve — current level is below your goal.
- Gap amount: $22,342
- Commitment draft (illustrative @ recommended): Move $50 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$50 · floor=$25 · weeklyCapacity=$187 · ceiling=$22,342
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Insurance ran $2,857 above its recent average.
  - alt: W-2 Staff — $2,166 above average
  - alt: Refunds & Allowances — $2,140 above average

### 2026-01-01

- Data through: 2025-12 · txns: 4493 · runway status: self-funded
- Total cash: $21,480 · reserve target: $43,902 · % funded: 49.0%
- [comparison] operating cash: $56,427 · % funded (op): 129.0% · hero (op): expense_surge
- **Hero:** reserve_critical (critical)
- Recommended action: Build your Operating Reserve — current level is below your goal.
- Gap amount: $22,390
- Commitment draft (illustrative @ recommended): Move $150 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$150 · floor=$25 · weeklyCapacity=$433 · ceiling=$22,390
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Rent or Lease ran $9,000 above its recent average.
  - alt: Uniforms & Retail — $4,100 above average
  - alt: Immigration Instructors — $4,012 above average

### 2026-02-01

- Data through: 2026-01 · txns: 4604 · runway status: self-funded
- Total cash: $18,338 · reserve target: $41,980 · % funded: 44.0%
- [comparison] operating cash: $60,655 · % funded (op): 144.0% · hero (op): expense_surge
- **Hero:** reserve_critical (critical)
- Recommended action: Build your Operating Reserve — current level is below your goal.
- Gap amount: $23,509
- Commitment draft (illustrative @ recommended): Move $175 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$175 · floor=$25 · weeklyCapacity=$527 · ceiling=$23,509
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Employee Benefit (other than pension or profit-sharing) ran $1,681 above its recent average.
  - alt: Uniforms & Retail — $979 above average
  - alt: Immigration Mgt Staff — $667 above average

### 2026-03-01

- Data through: 2026-02 · txns: 4695 · runway status: self-funded
- Total cash: $8,024 · reserve target: $42,079 · % funded: 19.0%
- [comparison] operating cash: $48,434 · % funded (op): 115.0% · hero (op): expense_surge
- **Hero:** reserve_critical (critical)
- Recommended action: Build your Operating Reserve — current level is below your goal.
- Gap amount: $34,084
- Commitment draft (illustrative @ recommended): Move $50 into your operating reserve this week.
- Grounded target: classification=grounded · recommended=$50 · floor=$25 · weeklyCapacity=$144 · ceiling=$34,084
- Execute (levers): Here's where spending ran above its recent norm this month — pick one to pull back:
  - Start here: Uniforms & Retail ran $645 above its recent average.
  - alt: Other, Cash — $579 above average
  - alt: Office Expenses — $519 above average
