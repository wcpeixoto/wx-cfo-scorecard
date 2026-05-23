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

### Closed vs Missed — storage convention (Phase 2c)

"Not doing this" (Closed, #6) and a passed deadline (Missed, #7) both resolve to
`status='lapsed'` — Closed does not get its own status value (a live schema
change wasn't justified when the distinction is recoverable). They stay
distinguishable by timestamp: `resolved_at < deadline_date` is Closed (resolved
before the window ended); `resolved_at >= deadline_date` is Missed.

This holds only because Closed fires strictly pre-deadline (#6) and Missed
strictly post-deadline (#7). Any new path that writes `status='lapsed'` must
preserve that partition, or promote `status` to an explicit `closed` value with a
backfill first — otherwise the distinction is lost retroactively.

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

## 11. Recommendation is always visible (render invariant)

Every signal renders a recommendation on the card, every time — no path renders
an empty card. The recommendation appears in exactly one place per state:
- **Commitment-ready, not yet committed** → inside the consent slot.
- **Committed** → inside the committed summary (beat-aware, #8).
- **Awareness-only** (not commitment-ready, #3) → as a standalone paragraph.

Any refactor that moves or removes one of these surfaces MUST preserve a visible
recommendation for **every** signal state, not just the committable one. Enumerate
the render branches before changing a shared affordance — seed data exercises one
branch; the others stay blank until production hits them.

(Added after #195: dropping the "do-next" chip in #191 left awareness-only
signals — reserve_critical, the prod default — showing "Understand this
recommendation" with nothing to understand.)

## Substrate: where each principle lives

The principles above do not change. Their *implementation home*
has been clarified as the CFO Assistant matures past hand-authored
templates.

### Invariants — deterministic layer (code)

These principles belong in code because violations would break trust
or accountability:

- **Principle #1 (outcome-anchored):** code chooses which signal fires
  and what business outcome the assistant is trying to improve.
- **Principle #2 (one primary action with target + deadline):** code
  owns the action shape, target, deadline, and fallback. AI may
  re-tone the message only inside those bounds. Current shipped
  validation enforces exact amount grounding for the `reserve_warning`
  `day_one` summary; structural one-action validation and date
  grounding remain separate future slices.
- **Principle #4 (action-tied watch metric):** code wires the watch
  metric to the action. This is not a copy concern.
- **Principle #5 (anchor to active commitment):** the card's state
  machine must pin commitment-mode copy to the active commitment.
  This is a wiring concern, not a generation concern.
- **Principle #10 (calm advisor frame, including AI placement):** for
  commitment-state copy, AI generation should not run in
  keystroke-interactive consent slots. The first shipped
  commitment-state AI surface is the post-commit `day_one` summary.
- **Principle #11 (recommendation always visible — render invariant):**
  the recommendation surface is always present in commitment-state UI.
  Render contract, enforced by the card's state machine.

### Voice — AI layer (with deterministic fallback)

These principles describe the *feel* of owner-facing copy. They are
expressed by the AI layer within the deterministic bounds the code
sets:

- **Principle #3 (no fake precision, no fake levers):** AI is prompted
  to surface honest STOP states when no real lever exists. The
  deterministic fallback enforces the floor.
- **Principle #6 (no guilt, no judgment):** prompt-shaped. Fallback
  copy holds the same standard.
- **Principle #7 (plain language, no jargon):** prompt-shaped.
- **Principle #8 (owner as hero):** prompt-shaped.
- **Principle #9 (calm, low cognitive load):** prompt-shaped.

### Implication

Hand-authored template copy in `copy.ts` is the **deterministic
fallback**, not the primary owner-facing surface for committed-state
fields. Future copy work should ask: "is this principle an invariant
(enforce in code) or a voice quality (express in prompt + validator)?"
The answer determines where the fix lives.

See `AGENTS.md` → "Architecture: deterministic + AI layers" for the
mechanical contract.
