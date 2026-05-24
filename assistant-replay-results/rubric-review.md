# CFO Assistant — rubric-review artifact (5 weeks, total-cash basis)

> FACTS ONLY — evidence for human rubric review. Nothing here is scored, ranked, or commented.

## Cash definition (matches production configuration)

- Reserve basis: TOTAL BANK CASH.
- Cash-included accounts: **Bank of America, Card Amex**
- Excluded (notable): Cash (petty), Wodify, CC Corp 8839, CC Deborah, CC Marcio, S/T Loan SH, Merchant Fee
- Total-cash anchor: 2021-12-01=$27,367
- Source: production shared_account_settings (read-only lookup 2026-05-23)
- Operating-cash shown for comparison only (excludes owner draws; not the reserve basis).
- Fixture: 4851 txns. Review weeks: 2025-01-01, 2025-04-01, 2025-07-01, 2025-12-01, 2026-03-01.

## 2025-01-01

- Hero signal: **reserve_warning**
- Severity: warning
- Reserve % funded (total cash): 84.0%
- recommendedAction: "Keep building your Operating Reserve — you're funded but below the full target."
- Commitment draft action (at grounded recommended target): "Move $225 into your operating reserve this week."
- Grounded target:
  - recommended: $225
  - floor: $25
  - weeklyCapacity: $647
  - ceiling (full reserve gap): $6,502
  - grounding classification: grounded
  - consent mode: commit
- Execute output (levers):
  - lead: "Here's where spending ran above its recent norm this month — pick one to pull back:"
  - Start here: "W-2 Staff ran $3,284 above its recent average."
  - alternate: "Federal Tax — $1,923 above average"
  - alternate: "Merchant Fees — $1,328 above average"
- Model context:
  - currentCashBalance (total cash): $33,948
  - reserveTarget: $40,640
  - latest complete month: 2024-12 · net cash flow: -$3,195
  - top expense deltas vs trailing-3-month baseline (model.opportunities):
    - Control Payroll:W-2 Staff: $3,284 above baseline — Current month is 3284.07 above recent baseline.
    - Control Taxes and Licenses:Federal Tax: $1,923 above baseline — Current month is 1923.07 above recent baseline.
    - Control Merchant Fees: $1,328 above baseline — Current month is 1328.48 above recent baseline.
- Operating-vs-total comparison:
  - total-cash % funded: 84.0% · hero (total): reserve_warning
  - operating-cash % funded: 84.0% · hero (operating): reserve_warning

## 2025-04-01

- Hero signal: **expense_surge**
- Severity: critical
- Reserve % funded (total cash): 105.0%
- recommendedAction: "Review "Payroll:1099 Instructors" — spending spiked above your normal range last month."
- Commitment draft action: — (hero is not commitment-ready)
- Grounded target: — (no draft)
- Execute output: n/a — hero is not reserve-funding (Execute is reserve-only)
- Model context:
  - currentCashBalance (total cash): $34,731
  - reserveTarget: $33,223
  - latest complete month: 2025-03 · net cash flow: $11,174
  - top expense deltas vs trailing-3-month baseline (model.opportunities):
    - Control Payroll:1099 Instructors: $1,593 above baseline — Current month is 1593.02 above recent baseline.
    - Control Utilities:Gas & Electric: $707 above baseline — Current month is 707.24 above recent baseline.
    - Control Office Expenses: $619 above baseline — Current month is 619.18 above recent baseline.
- Operating-vs-total comparison:
  - total-cash % funded: 105.0% · hero (total): expense_surge
  - operating-cash % funded: 157.0% · hero (operating): expense_surge

## 2025-07-01

- Hero signal: **reserve_warning**
- Severity: warning
- Reserve % funded (total cash): 55.0%
- recommendedAction: "Keep building your Operating Reserve — you're funded but below the full target."
- Commitment draft action (at grounded recommended target): "Move $100 into your operating reserve this week."
- Grounded target:
  - recommended: $100
  - floor: $25
  - weeklyCapacity: $332
  - ceiling (full reserve gap): $19,269
  - grounding classification: grounded
  - consent mode: commit
- Execute output (levers):
  - lead: "Here's where spending ran above its recent norm this month — pick one to pull back:"
  - Start here: "Refunds & Allowances ran $1,945 above its recent average."
  - alternate: "Ads — $1,665 above average"
  - alternate: "1099 Instructors — $1,526 above average"
- Model context:
  - currentCashBalance (total cash): $23,602
  - reserveTarget: $42,819
  - latest complete month: 2025-06 · net cash flow: -$4,929
  - top expense deltas vs trailing-3-month baseline (model.opportunities):
    - Control Refunds & Allowances: $1,945 above baseline — Current month is 1945.27 above recent baseline.
    - Control Marketing:Ads: $1,665 above baseline — Current month is 1665.46 above recent baseline.
    - Control Payroll:1099 Instructors: $1,526 above baseline — Current month is 1526.33 above recent baseline.
- Operating-vs-total comparison:
  - total-cash % funded: 55.0% · hero (total): reserve_warning
  - operating-cash % funded: 95.0% · hero (operating): reserve_warning

## 2025-12-01

- Hero signal: **reserve_critical**
- Severity: critical
- Reserve % funded (total cash): 43.0%
- recommendedAction: "Build your Operating Reserve — current level is below your goal."
- Commitment draft action (at grounded recommended target): "Move $50 into your operating reserve this week."
- Grounded target:
  - recommended: $50
  - floor: $25
  - weeklyCapacity: $187
  - ceiling (full reserve gap): $22,342
  - grounding classification: grounded
  - consent mode: commit
- Execute output (levers):
  - lead: "Here's where spending ran above its recent norm this month — pick one to pull back:"
  - Start here: "Insurance ran $2,857 above its recent average."
  - alternate: "W-2 Staff — $2,166 above average"
  - alternate: "Refunds & Allowances — $2,140 above average"
- Model context:
  - currentCashBalance (total cash): $16,682
  - reserveTarget: $39,196
  - latest complete month: 2025-11 · net cash flow: -$6,856
  - top expense deltas vs trailing-3-month baseline (model.opportunities):
    - Control Insurance: $2,857 above baseline — Current month is 2856.5 above recent baseline.
    - Control Payroll:W-2 Staff: $2,166 above baseline — Current month is 2166.13 above recent baseline.
    - Control Refunds & Allowances: $2,140 above baseline — Current month is 2139.98 above recent baseline.
- Operating-vs-total comparison:
  - total-cash % funded: 43.0% · hero (total): reserve_critical
  - operating-cash % funded: 120.0% · hero (operating): expense_surge

## 2026-03-01

- Hero signal: **reserve_critical**
- Severity: critical
- Reserve % funded (total cash): 19.0%
- recommendedAction: "Build your Operating Reserve — current level is below your goal."
- Commitment draft action (at grounded recommended target): "Move $50 into your operating reserve this week."
- Grounded target:
  - recommended: $50
  - floor: $25
  - weeklyCapacity: $144
  - ceiling (full reserve gap): $34,084
  - grounding classification: grounded
  - consent mode: commit
- Execute output (levers):
  - lead: "Here's where spending ran above its recent norm this month — pick one to pull back:"
  - Start here: "Uniforms & Retail ran $645 above its recent average."
  - alternate: "Other, Cash — $579 above average"
  - alternate: "Office Expenses — $519 above average"
- Model context:
  - currentCashBalance (total cash): $8,024
  - reserveTarget: $42,079
  - latest complete month: 2026-02 · net cash flow: -$12,220
  - top expense deltas vs trailing-3-month baseline (model.opportunities):
    - Control COGS:Uniforms & Retail: $645 above baseline — Current month is 644.78 above recent baseline.
    - Control Payroll:Other, Cash: $579 above baseline — Current month is 579.06 above recent baseline.
    - Control Office Expenses: $519 above baseline — Current month is 518.64 above recent baseline.
- Operating-vs-total comparison:
  - total-cash % funded: 19.0% · hero (total): reserve_critical
  - operating-cash % funded: 115.0% · hero (operating): expense_surge
