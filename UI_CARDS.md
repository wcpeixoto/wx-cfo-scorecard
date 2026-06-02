# UI_CARDS.md — card outer surface rules (locked)

Locked subset of `UI_RULES.md` for **card outer elements**. The
properties in the "Locked rules" table below cannot deviate without
explicit Wesley sign-off before merge. Inner-element styling (badges,
buttons, list rows, inputs, icon containers, tooltips, dropdowns, chart
chrome) follows the broader scale in `UI_RULES.md` Part 2 and is **not**
constrained by this doc.

## What counts as a card outer element

The top-level container of any dashboard widget — the element a person
would call "the Hero card", "the Operating Reserve card", "the Cash on
Hand card", "the KPI tile", "the Top Expenses drawer panel", "the
chart card", etc.

Concretely, the shared shells:

- `.card`, `.ta-card`, `.glass-panel` — standard bordered shells
- `.kpi-card`, `.revenue-card`, `.total-balance-card` — borderless tile
  variant (see Approved exceptions)
- Component-level wrappers that compose or replace those shells —
  `.today-hero-card`, `.reserve-card`, `.priority-card-v2`,
  `.forecast-decision-card`, `.statistics-card`, `.ie-card`, `.pe-card`,
  `.bv-card`, `.nod-card`, `.cth-card`, etc.
- Drawer panels and modal panels (see Approved exceptions for their
  carve-outs)

NOT in scope: sub-elements inside a card (`.card-head`, `.kpi-card__title`,
`.reserve-stat-card`, `.txn-drawer-summary`, etc.), chart pills, badges,
buttons, tooltips, list rows.

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

## Approved exceptions

These are the only existing carve-outs. Adding a new component that
matches one of these patterns does not require fresh sign-off; the
pattern itself is pre-approved.

| Variant | Radius | Shadow | Border | Where (selectors) | Why |
|---|---|---|---|---|---|
| Borderless tile | 12px | none | none | `.kpi-card`, `.revenue-card`, `.total-balance-card` | TailAdmin `/sales` "Total Revenue" pattern. Borderless + 12px reads as a compact metric tile rather than a bordered card. Must use `border: none` AND `box-shadow: none` to qualify. |
| Modal | 24px | shadow OK | none | `.settings-unlock-modal` (and any future `rounded-3xl` modal) | UI_RULES Part 2 — modals are `rounded-3xl`. |
| Side drawer | 16px on the inner edge only | shadow OK | left-edge border | `.txn-drawer-panel`, `.ie-drawer-panel` | Full-height slide-ins are flush against the screen edge; only the inward-facing corners take a radius (`border-top-left-radius` + `border-bottom-left-radius`). |

## Adding a new exception

1. Builder identifies the proposed deviation **before** writing the CSS
   and calls it out in the build prompt.
2. Wesley signs off explicitly. Verbal/chat sign-off is enough; the PR
   description references it.
3. The new exception gets appended to the table above in the same PR
   that introduces the CSS.

A card-outer `border-radius`, `box-shadow`, `border`, or `background`
that does not match either the locked rules or one of the rows in the
Approved exceptions table is a **deviation** and must not land.

## Reviewer (Codex) checklist

When reviewing any PR that touches card-outer CSS or JSX:

- Grep the diff for `border-radius`, `box-shadow`, `border:`, and
  `background:` declarations on selectors that look like card outer
  elements (anything ending in `-card`, `-panel`, `-tile`, `-shell`,
  `-hero`, or composing `.card` / `.ta-card`).
- For each, confirm it matches a Locked rules row OR an Approved
  exceptions row.
- If a value diverges and the PR description does not document
  explicit Wesley sign-off, flag it. Do not assume "looks intentional"
  is approval.

## See also

- `UI_RULES.md` Part 2 — full radius scale (inner elements: 4/6/8/12/14/16/24/999)
- `UI_RULES.md` Part 4 — card patterns and the documented shadow exceptions (e.g., gauge inner section)
- `UI_RULES.md` Part 6 — canonical card-shell specs (padding, border-color, family-specific overrides)
