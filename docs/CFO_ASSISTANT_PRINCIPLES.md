# CFO Assistant — Locked Principles

Canonical source of truth for the CFO Assistant product loop.
Memory caches in Claude/Codex sessions may go stale; this doc wins on conflict.

> **These describe the target state.** Shipped surfaces (recommendation
> bundling, portfolio Watch metric) converge to these in Phase 2.5.

## 1. Outcome principle (overrides all else)

The outcome is the target. Never lose sight of the outcome.
Every recommendation, commitment, follow-up, and execution helper exists
for one reason: increase the odds the owner achieves the business result.
If a design decision improves UI but reduces outcome probability, the
outcome wins.

## 2. Recommendation rule

No recommendation without:
- Measurable result (target amount or metric)
- Clear purpose (why it matters now)
- One primary action (not three)
- Deadline (date)

Bundled options ("renewals, promotion, or collections") are invalid —
that's three actions, not one. Fallback paths belong in Execute, not in
the recommendation.

## 3. STOP rule (Phase 2.5 gate)

If a signal cannot honestly produce a measurable result, deadline, and
action-tied watch metric from available data, STOP. Classify it as
"not commitment-ready."

Awareness is fine ("This needs attention"). Faking precision destroys the
accountability loop and violates the outcome principle.

## 4. Chip → RPM mapping

- "What should I do next?" = Result (commitment with target + deadline)
- "Why this step?" = Purpose
- "What should I watch?" = action-tied outcome metric (NOT portfolio)

Watch metric must match the action. Reserve % belongs in Purpose, not Watch.

Watch metrics live in a per-type registry (`src/lib/commitments/watchMetrics.ts`).
Entries are added per type as each becomes commitment-ready; awareness-only types
retain their current watch metric until then. Per-type commitment generators MUST
build deadlines via the shared anchor (`commitments/anchor`) and watch values via
the registry — never re-derive them — so action, deadline, and watch can't drift apart.

## 5. Commitment is an accountability surface

Once committed, the card becomes Commitment Mode and stays fixed on Today
until resolved, replaced, or expired. Assistant never silently replaces
a commitment. Unrelated questions are answered through the lens of the
active commitment when relevant. The commitment remains the anchor.

## 6. Commitment Mode escape hatches (4)

Before deadline, owner has:
1. Help me execute — keeps commitment active
2. Update plan — edits in place, no second commitment
3. Not doing this — closing requires showing business consequences
   ("Closing means [X]. Still close?"). Not shame, real accountability.
4. Ask about this — answers in context of active commitment

No guilt language anywhere.

## 7. Check-in states (after deadline)

1. Achieved — celebrate briefly, offer "Close" / "Next step"
2. Partial — "You collected $X of $Y. What got in the way?"
3. Missed — same calm framing

Attribution when unclear: compare actual vs forecast, ask owner to confirm
(Yes mostly / Partly / No / Not sure). Never claim the system knows intent.

## 8. During-window follow-ups

Follow-ups happen during the commitment window, not only after.
Default cadence for 1-week commitment:
- Day 1: offer execution help
- Midpoint: progress check + suggest next move if behind
- Day before deadline: final push offer
- After deadline: check-in state

Channels owner-controlled: in-app default; email and WhatsApp/SMS later.

## 9. Commitment window

Default = one week or less. Larger goals MUST be broken into weekly
sub-commitments. Quarterly/monthly goals tracked as a series of weekly moves.

## 10. Full loop

Diagnose → Decide → Commit → Help Execute → Check Progress → Adjust →
Achieve Outcome.

Execute layer surfaces AFTER commit, not on the fresh card (keeps calm
hierarchy — one decision at a time).
