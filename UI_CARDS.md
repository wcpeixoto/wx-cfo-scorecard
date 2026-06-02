# UI_CARDS.md — card outer surface rules (locked)

Locked subset of `UI_RULES.md` for **card outer elements**. The
properties in the "Locked rules" table below cannot deviate without
explicit Wesley sign-off before merge.

Inner-element styling (badges, buttons, list rows, inputs, icon
containers, tooltips, dropdowns, chart chrome) follows the broader
scale in `UI_RULES.md` Part 2 and is **not** constrained by this doc.

Adjacent surface families — **modals** and **side drawers** — have
their own rules and are **not card outers**. They follow `UI_RULES.md`
(modals = `rounded-3xl` / 24px) and the drawer chrome convention
(partial 16px on the inner edge only), respectively. The "Adjacent
surfaces" table below is informational only — surfacing the right
pointer fast for a reader who lands here looking for "what radius for
X." Do not treat those rows as card variants.

## What counts as a card outer element

The top-level container of any dashboard widget — the element a person
would call "the Hero card", "the Operating Reserve card", "the Cash on
Hand card", "the KPI tile", "the chart card", etc.

Concretely, the shared shells:

- `.card`, `.ta-card`, `.glass-panel` — standard bordered shells
- `.kpi-card`, `.revenue-card`, `.total-balance-card` — borderless tile
  variant (see Card variant exception)
- Component-level wrappers that compose or replace those shells —
  `.today-hero-card`, `.reserve-card`, `.priority-card-v2`,
  `.forecast-decision-card`, `.statistics-card`, `.ie-card`, `.pe-card`,
  `.bv-card`, `.nod-card`, `.cth-card`, etc.

**NOT card outers and NOT in scope:**

- Sub-elements inside a card (`.card-head`, `.kpi-card__title`,
  `.reserve-stat-card`, `.txn-drawer-summary`, etc.) and inner chrome
  (badges, buttons, tooltips, list rows, chart pills).
- Modals and side drawers — see "Adjacent surfaces" below for their
  rules and selectors.
- Layout regions, sidebars, top nav, overlays, tooltip panels,
  notification panels.

## Locked rules

| Property | Value | Source |
|---|---|---|
| `border-radius` | **16px** | UI_RULES Part 2 — radius scale, `rounded-2xl` row |
| `box-shadow` | **none** (border only) | UI_RULES Part 4 — Pattern A |
| `border` | `1px solid var(--line)` (or `#E4E7EC`) | UI_RULES Part 4 |
| `background` | `var(--bg-panel)` (white `#FFFFFF`) | UI_RULES Part 1 |

Padding is intentionally **not** locked here — canonical card shells
use different padding by family (standard `p-5 sm:p-6`, table-card
asymmetric `pt-4`, chart-card `px-5 pt-5`, etc.). Follow UI_RULES Part 5
for padding; this doc does not override it.

## Card variant exception

The borderless tile is the only pre-approved card variant. A card
using this pattern does not require fresh sign-off; the pattern itself
is pre-approved.

| Variant | Radius | Shadow | Border | Where (selectors) | Why |
|---|---|---|---|---|---|
| Borderless tile | 12px | none | none | `.kpi-card`, `.revenue-card`, `.total-balance-card` | TailAdmin `/sales` "Total Revenue" pattern. Borderless + 12px reads as a compact metric tile rather than a bordered card. Must use `border: none` AND `box-shadow: none` to qualify. |

## Adjacent surfaces (informational only — NOT card exceptions)

These surfaces have their own rules elsewhere. Listed here so a reader
who lands on this doc finds the right pointer fast. **Do not treat
them as card variants** and do not append new rows here to expand the
card-rule scope — change to a modal or drawer follows its own surface
rules, not this doc.

| Surface | Radius | Where (selectors) | Source |
|---|---|---|---|
| Modal | 24px (`rounded-3xl`) | `.settings-unlock-modal` | `UI_RULES.md` Part 2 |
| Side drawer | 16px on the inner edge only (`border-top-left-radius` + `border-bottom-left-radius`) | `.txn-drawer-panel`, `.ie-drawer-panel` | Drawer chrome convention — full-height slide-ins are flush against the screen edge |

## Adding a new card exception

1. Builder identifies the proposed deviation **before** writing the CSS
   and calls it out in the build prompt.
2. Wesley signs off explicitly. Verbal/chat sign-off is enough; the PR
   description references it.
3. The new exception gets appended to the **Card variant exception**
   table in the same PR that introduces the CSS.

A card-outer `border-radius`, `box-shadow`, `border`, or `background`
that does not match either the **Locked rules** or the **Card variant
exception** is a **deviation** and must not land.

(Changes to modal or drawer surfaces follow their own rules elsewhere
and are out of scope for this doc.)

## Reviewer (Codex) checklist

When reviewing any PR that touches card-outer CSS or JSX:

- Grep the diff for `border-radius`, `box-shadow`, `border:`, and
  `background:` declarations on selectors that look like card outer
  elements: anything ending in `-card`, `-tile`, `-shell`, `-hero`, or
  composing `.card` / `.ta-card` / `.glass-panel`.
- The `-panel` suffix is usually **not** a card — modal panels, drawer
  panels, tooltip panels, notification panels all follow their own
  surface rules. Check the surface family before flagging.
- For each card-outer change, confirm it matches the **Locked rules**
  row OR the **Card variant exception** row.
- If a value diverges and the PR description does not document
  explicit Wesley sign-off, flag it. "Looks intentional" is not
  approval.

## See also

- `UI_RULES.md` Part 2 — full radius scale (inner elements: 4/6/8/12/14/16/24/999)
- `UI_RULES.md` Part 4 — card patterns and the documented shadow exceptions (e.g., gauge inner section)
- `UI_RULES.md` Part 6 — canonical card-shell specs (padding, border-color, family-specific overrides)
