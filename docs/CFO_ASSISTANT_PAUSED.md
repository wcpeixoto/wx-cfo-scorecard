# CFO Assistant — Paused

**Date paused:** 2026-05-23
**Canonical reference:** This file
**Notion lane:** CFO Assistant column (see Notion card drafts below)

---

## Status

The CFO Assistant work is **paused** after Week 1 of replay-driven rubric
review. The pause is intentional. A core architectural blocker was
identified, and continued scoring of the remaining 4 weeks would produce
diminishing returns — the same root cause would surface repeatedly with
worsening magnitude.

The remaining product surfaces (diagnostic pages: Today, Forecast,
Operating Reserve, Big Picture, etc.) will ship first. Real owner usage
of those surfaces will inform the assistant's redesign far better than
further analysis can today.

---

## Why this is paused (the headline blocker)

**The system conflates the reserve *outcome* with the reserve *action*.**

The CFO Assistant currently recommends actions like:

> "Move $225 into your operating reserve this week."
> "Move $50 into your operating reserve this week."

These satisfy the system's recommendation rule (measurable result, clear
purpose, one action, one-week deadline) but they violate the outcome
principle (every recommendation must increase the owner's odds of
achieving the business result).

A $50/week transfer against a $34,000 reserve gap is not a meaningful
action. It is bookkeeping. The owner who follows it perfectly will not
see a meaningful change in trajectory. The owner who ignores it will
correctly conclude the assistant is not telling them anything important.

### The deeper finding

**Reserve is the destination, not the action.** The real action that
moves the business toward a funded reserve is one of:

- Increase revenue
- Reduce structural costs

Both typically require multi-week strategic work that the current
one-week commitment architecture cannot express. The system, forced to
fit a one-week window, shrinks the goal to fit — producing trivial
recommendations instead of breaking real goals into weekly chunks.

### Why this matters more than it looks

The assistant is technically working as designed. Every guardrail fires
correctly. The grounded target math is sound. The signals detect the
right states. The Execute layer surfaces real cost overruns.

But the *whole* — what the owner experiences when they open the
assistant — fails the outcome test. The architecture is satisfying its
own rules at the cost of doing what it exists to do.

---

## Week 1 rubric results (2025-01-01)

The full rubric was 6 questions per week across 5 weeks. We scored 3
questions on Week 1, then paused. The findings were already clear.

| Q | Question | Score | Severity |
|---|----------|-------|----------|
| 1 | Right top priority? | **Fail** | High |
| 2 | Recommendation obvious & useful? | **Fail** | High |
| 3 | Commitment target realistic? | **Watch** | High |
| 4 | "Help me execute" enough direction? | Not scored | — |
| 5 | Would owner know next step? | Not scored | — |
| 6 | Anything generic/confusing/fake? | Deferred | — |

### Q1 — Right top priority? — Fail / High

Reserve is a valid concern (84% funded, December 2024 was negative). The
*signal* is directionally right. But the *action* — "Move $225 into your
operating reserve this week" — treats the reserve outcome as the action.

The real action this week should be revenue/cost work. Payroll is often
the first area to inspect because payroll + rent represent roughly
60–65% of costs/expenses, but payroll should not be assumed as the
answer before reviewing the numbers.

The current commitment architecture cannot express multi-week strategic
actions broken into weekly sub-commitments. The system satisfies the
recommendation rule (measurable, weekly, one action) by violating the
outcome principle (meaningful change in trajectory).

### Q2 — Recommendation obvious & useful? — Fail / High

Two distinct failures:

1. **Redundant with existing UI.** The Operating Reserve card already
   tells the owner they're below their safety line. The AI assistant's
   job is supposed to be telling the owner *how to fix it*, not
   restating the problem.

2. **Operationally meaningless.** "Move $225 into your operating
   reserve" tells the owner nothing about what to physically do. Is it
   a bank transfer? An account designation? An auto-transfer setup?
   The recommendation collapses to outcome language dressed up as
   action language — but with no actual action.

### Q3 — Commitment target realistic? — Watch / High

The target math is internally consistent (capacity $647/week, floor
$25, recommended $225, ceiling $6,502). $225 is affordable. But
"affordable" is not the same as "meaningful." Q3 is therefore Watch,
not Fail — financially realistic, product-weak.

The same pattern, worse magnitude, would appear at every subsequent
review week (predicted, not scored):

| Week | Hero | % funded | Recommendation | Reserve gap |
|------|------|----------|----------------|-------------|
| 2025-01 | warning | 84% | $225/week | $6,500 |
| 2025-07 | warning | 55% | $100/week | $19,000 |
| 2025-12 | critical | 43% | $50/week | $22,000 |
| 2026-03 | critical | 19% | $50/week | $34,000 |

As the situation worsens, the weekly ask shrinks (because the model's
cash capacity also shrinks). $50/week against a $34K gap is mathematical
nonsense as an action — it is barely a rounding error in the business.

### Q6 — deferred for all weeks

Q6 ("anything generic, confusing, or fake?") cannot be honestly scored
on broken output. Style criticism on a recommendation that fails on
substance is wasted energy. Q6 becomes a post-fix verification
question, not a pre-fix scoring question.

---

## Required architecture direction (when work resumes)

### Two-layer commitment model

**Layer 1 — Outcome target.**
Example: "Rebuild operating reserve to one month of expenses."

This is the destination. It's measured in weeks or months. It's the
answer to "what are we trying to achieve?"

**Layer 2 — Weekly strategic action.**
Example: "Identify the top 3 payroll roles or shifts that changed
since your best-margin months. Compare them to revenue. Bring the
list to your next session."

This is what the owner *does this week*. It is one specific, physical,
nameable activity that moves them toward Layer 1.

Both layers must be visible. The owner needs to see "I'm working
toward reserve funding" *and* "this week I'm reviewing payroll." They
should not see one without the other.

### Multi-week strategic actions with weekly sub-commitments

A serious business problem (under-funded reserve, declining revenue,
structural cost overrun) typically requires 4–8 weeks of work to
address meaningfully. The system must:

1. Recognize the problem
2. Propose a multi-week path
3. Define the **first week's chunk** of that path as the commitment
4. Track progress week-over-week
5. Adjust the path based on what actually happened

Example progression:

- Week 1: "Review payroll changes since your best-margin months.
  Identify the 3 biggest deltas."
- Week 2: "Decide which of the 3 deltas to address first. Define what
  changing it would actually look like."
- Week 3: "Make the change." (Could be hiring conversation, schedule
  restructure, contractor renegotiation — the action this week is
  the execution.)
- Week 4: "Verify the change is reflected in next month's data.
  Decide if more is needed."

Each week's commitment is honestly named for the actual work that
week. Analysis weeks are analysis. Execution weeks are execution.
The system should not soften reality.

### AI freedom + context

The current prompts are heavily constrained (one action, one deadline,
measurable result, etc.). These constraints exist for good reasons —
they prevent vague, bundled, or fake recommendations.

But the constraints also prevent the AI from doing the one thing it's
uniquely good at: **understanding the business context and proposing
meaningful actions that fit the situation.**

The redesign needs to find a way to give the AI enough freedom to
suggest context-appropriate actions (e.g., "given your business is
mostly payroll-driven and revenue has been flat, here's a 4-week
payroll review path") while keeping the guardrails that prevent
hallucination.

This is the hardest part of the redesign. It is not a prompt-tuning
problem. It is an architecture problem.

---

## Language guardrails (identified during Week 1 review)

1. **No "free up."** The phrase sounds like unlocking something already
   there. Reducing costs usually means hard decisions (firing people,
   cutting services, renegotiating contracts). The system must not
   soften the reality of what the owner needs to do.

2. **Action must be physical.** "Move $X" is meaningless without
   defining the physical action. The recommendation must say what the
   owner *does*, not what should happen.

3. **Analysis vs. execution.** A payroll review is a few days, maybe a
   week. The 4+ weeks come from *executing* the change (hiring
   conversations, schedule transitions, contractor renegotiations).
   The system should not call analysis "a 4-week review" — that's
   inflating the work to fit the calendar.

---

## What NOT to do when work resumes

- **Do not extend reserve recommendation to be "smarter" within the
  current architecture.** That is polish on a broken foundation. The
  architecture is the problem.

- **Do not add more commitment-ready signals until the two-layer
  action model is resolved.** Adding more signals would just multiply
  the same architectural failure across more states.

- **Do not add AI everywhere.** The fix is not "use more AI." The
  AI needs context and freedom, which comes from architecture changes,
  not from more prompting.

- **Do not relitigate cash basis, reserve target, or signal
  thresholds.** These are correct and validated. The failure is in
  what the system does *with* the signals, not the signals themselves.

---

## Re-entry criteria (when to resume this work)

Resume CFO Assistant work only when **all of the following** are true:

1. The other product surfaces (Today, Forecast, Operating Reserve, Big
   Picture, etc.) are shipped and in real owner use.
2. Real usage data exists showing which questions owners actually have
   when they look at the diagnostic pages. Those questions are the
   real spec for the next assistant iteration.
3. The two-layer architecture redesign can be approached with usage
   evidence, not with guesses.

Until then, the assistant code remains as-shipped. It still works
within its own guardrails — it does not crash, does not lie, does not
recommend dangerous things. It simply does not yet do what it exists
to do.

---

## Replay infrastructure (preserved for resumption)

A read-only assistant replay harness exists at
`scripts/assistant-replay/runReplay.ts`. It runs the assistant against
historical fixtures across multiple as-of dates and emits an
evaluation artifact. It uses production-faithful cash basis (total
bank cash from Bank of America + Card Amex per
`shared_account_settings`).

When the assistant is redesigned, the same harness can re-run the
same 5 weeks (or more) and produce a fresh rubric-review artifact.
This is the validation path: redesign → re-run replay → re-score
rubric → if the same architectural failures appear, the redesign is
not done; if they're resolved, the redesign is working.

The Week 1 rubric findings in this doc are the baseline against which
any future redesign is judged.

### Node CLI import constraint

The replay harness (and any future Node CLI tool in `scripts/`) must
import commitments leaf modules directly (`execute.ts`,
`reserveWarningCommitment.ts`, etc.) — NOT the barrel
`src/lib/commitments/index.ts`. The barrel re-exports `groundedSummary`,
which reaches `sharedPersistence`, which uses Vite-only
`import.meta.env` and crashes under Node. This pattern repeats across
CLI harnesses and applies to any future tsx/node tool.

---

## Cross-references

- `scripts/assistant-replay/runReplay.ts` — replay harness
- `assistant-replay-results/replay.md` — full distribution across 15 dates
- `assistant-replay-results/rubric-review.md` — focused artifact for Week 1–5
- `src/lib/priorities/signals.ts` — current signal detection (clock-free)
- `src/lib/commitments/` — commitment loop (leaf modules safe for Node)
- `src/lib/commitments/execute.ts` — Execute Stage 1 (reserve-only, generic)
- `docs/CFO_ASSISTANT_PRINCIPLES.md` — principles doc (still canonical for
  what the assistant should be; this paused doc is canonical for why the
  current implementation falls short)
