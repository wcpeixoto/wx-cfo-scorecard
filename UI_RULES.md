# UI_RULES.md
# TailAdmin Free React — Complete Visual & Structural Standard
# Single source of truth for tokens, anatomy, patterns, and page compositions.

---

## How to Use This File

**Part 1 — Tokens** — colors, type, spacing, radius, shadows, sizing.
**Part 2 — Shell** — app layout, sidebar, header, backdrop.
**Part 3 — Primitives** — component roles and DOM anatomy; project badge/tag specs live in Part 6.
**Part 4 — Card & Chart Patterns** — card headers, chart anatomy, legends, KPI cards.
**Part 5 — Page Compositions** — this app ships one Dashboard page; TailAdmin demo layouts are reference only.
**Part 6 — Project Overlay** — project-specific rules that override or extend this base.
**Part 6B — Card Coherence Rule** — numbers within one card must reconcile.
**Part 7 — Decision Rules** — card-header, text-role, and alignment decision systems.
**Part 8 — Hard Rules & Checklist** — constraints and pre-commit gate.

Token drift and structure drift are equally harmful. Both are prevented here.

> This file documents TailAdmin-native patterns only in Parts 1–5.
> All project-specific overrides belong in Part 6 only.
>
> Source citations in earlier versions referenced the TailAdmin reference
> repo (per AGENTS.md), not files in this project.

## Card design

For card patterns, follow the components already present in
`src/dashboard.css` and existing card components.

`UI_RULES.md` covers global design tokens, CSS conventions, and project-wide visual rules.

---

# PART 1 — TOKENS

---

## Font

TailAdmin ships with **Outfit**.

```css
@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap");
body { font-family: 'Outfit', sans-serif; }
```

Weights: 400 Regular · 500 Medium · 600 Semibold · 700 Bold

---

## Colors

### Surfaces
| Role | Hex |
|------|-----|
| Page background | #F9FAFB |
| Card / panel | #FFFFFF |
| Card dark mode | white/[0.03] |
| Muted surface (inside cards) | #F2F4F7 |
| Soft nested surface | #FCFCFD |

> `#FCFCFD` (gray-25) is for surfaces nested inside a white card only — code blocks, read-only wells.
> Never use as a card or panel background.

### Borders
| Role | Hex |
|------|-----|
| Default border | #E4E7EC |
| Strong border | #D0D5DD |
| Chart grid lines | #e0e0e0 |
| Divider (inside dropdowns, rows) | #F2F4F7 |

### Text
| Role | Hex |
|------|-----|
| Primary | #1D2939 (gray-800) |
| Primary strong (reserved — see note) | #101828 (gray-900) |
| Card title / strong secondary | #344054 (gray-700) |
| Secondary / labels | #667085 (gray-500) |
| Muted / metadata | #98A2B3 (gray-400) |
| Inverse (on dark bg) | white/90 |

> **Note on `#101828` (Primary strong):** Reserved. Not used on card content —
> every KPI value renders at `#1D2939` (`text-gray-800`), same as titles. Do not
> apply to card titles, KPI values, or hero metrics. (Known non-card uses:
> dropdown hover color, segmented-control active text, table row hover/active state.)

### Chart-specific text
| Role | Hex |
|------|-----|
| Chart axis labels (TailAdmin Sales) | #373d3f |
| Chart axis labels (general) | #667085 |

> Use `#373d3f` for axis labels on chart-cards sourced from the TailAdmin Sales/Pro dashboards
> (statistics-card, future sales-family cards). Use `#667085` for axis labels on all other charts.
> Do not mix within the same card.

### Brand
| Role | Hex |
|------|-----|
| Primary action | #465FFF |
| Hover | #3641F5 |
| Pressed | #2A31D8 |
| Disabled | #9CB9FF |
| Brand-400 (icon accent) | #637AEA |
| Soft active bg | #ECF3FF |
| Focus ring | brand-500/20 (rgba overlay) |

### Semantic
| Purpose | Color | Soft bg |
|---------|-------|---------|
| Success accent (filled badge / icon) | #12B76A | #ECFDF3 |
| Success text on white | #039855 | — |
| Error | #F04438 | #FEF3F2 |
| Warning | #F79009 | #FFFAEB |
| Under Pressure (project) | #DC6803 | #FEF3E2 |
| Info | #0BA5EC | #F0F9FF |

> `#12B76A` and `#039855` are both green but serve distinct roles. Use `#12B76A` for filled
> accent surfaces (badge bg tint, icon fills, sparkline stroke/gradient). Use `#039855` for
> success *text* rendered directly on a white card surface (e.g. delta percentage in a KPI card
> header). Never swap them.

### Interaction States
| State | Value |
|-------|-------|
| Hover background | hover:bg-gray-100 |
| Active / selected background | bg-brand-50 |
| Focus ring | focus:ring-3 focus:ring-brand-500/20 |
| Transition | transition-colors duration-150 ease-in-out |

### Dark Mode
Via `.dark` class on `<html>`. Managed by `ThemeContext`. Stored in localStorage `"theme"`.

```
bg-white              → dark:bg-white/[0.03]
border-gray-200       → dark:border-gray-800
text-gray-800         → dark:text-white/90
text-gray-500         → dark:text-gray-400
bg-gray-100           → dark:bg-gray-800
bg-white (sidebar)    → dark:bg-gray-900
```

Every component requires dark variants.

---

## Type Scale

Font family is **Outfit** across all pages. The roles below are the canonical
source of truth — pick the role first, then the size/weight follows.

| Token | px | Role |
|-------|----|------|
| text-title-md | 36px | Hero value, page-level KPI |
| text-title-sm | 30px | Large metric value |
| text-2xl | 24px | Modal title (large) |
| text-theme-xl | 20px | Modal title (medium) |
| text-lg | 18px | Card title (standard) — font-semibold 600 |
| text-base | 16px | Body text |
| text-theme-sm / text-sm | 14px | Secondary text, labels, nav items |
| text-theme-xs | 12px | Metadata, helper text, table headers |
| (chart y-axis) | 11px | Chart Y-axis numeric scale labels — Regular (400) |

### Roles (TailAdmin source of truth)

Each entry below is a normal tier — not an exception. Choose by role,
not by visual size.

| Size / Weight | Role | TailAdmin reference examples |
|---|---|---|
| **30px / 600 or 500** | Hero metric value (primary KPI inside a stat card) | "$10,590", "1,320" (Sales Total Revenue / Total Sales); "19,857.00" Total Balance hero, "$24,830" stat card (Finance); "10,590", "$90,369" (AI). Use 600 for currency/revenue, 500 for balance/neutral. |
| **24px / 600 or 500** | Large chart label or secondary hero value (slightly below primary stat) | "13.5M" donut center (AI); "$9,758.00" Total Revenue in Cashflow Overview (Finance). |
| **20px / 600** | Page title — once per page only | "Sales Dashboard" (Sales). Not used in card bodies. |
| **18px / 600** | Card title (primary) — standard for major cards/sections | "Top Products", "Recent Transactions", "API Token Usages", "Quick Send", "My Cards", "Spending". Most consistent title style in the system. |
| **16px / 600** | Stat card label or strong sub-section title | "Total Revenue", "Total Sales", "Refund Rate" stat-card labels (Sales). |
| **16px / 500** | Card sub-title or category label | "Total Balance", "Cashflow Overview" sub-titles (Finance); "GPT", "Gemini", "xAI" model labels (AI). |
| **16px / 400** | Descriptive inline label paired with a metric | "Total Balance", "Monthly Income", "Total Spent", "Saving Rate" descriptions inside stat cards (Finance). |
| **14px / 500** | Navigation and UI controls — button labels, nav links, toggle text | Sidebar items "Dashboard", "eCommerce", "Analytics"; toggles "Daily", "Weekly", "Monthly"; period selectors "Monthly", "Quarterly", "Annually". |
| **14px / 400** | Body and supporting text below titles or beside metrics | "Track revenue, performance, and sales growth in real-time" subtitles (Sales); "Overview of your current funds", "than last month", "Primary Account:" (Finance); "Last 30 Days" metadata (AI). |
| **12px / 500** | Table column headers and status/badge labels | "Product Name", "Product ID", "Sales", "Earnings" (Sales table); "Order ID", "Activity", "Price", "Date" (Finance table); "Active", "Expired" token status (AI); "New" sidebar badges. |
| **12px / 400** | Chart axis labels (X-axis), legend labels, section labels, metadata | "Jan", "Feb", "Mar" chart X-axis; "Online Sales", "Offline Sales" legends (Sales); "Users", "Revenue" legends (AI); "MENU" sidebar section header; "Token used", "of total user" card metadata (AI). |
| **11px / 400** | Chart Y-axis numeric scale labels — the smallest text in the system | "20K", "15K", "10K", "5K" (Sales); "35K", "30K" (AI); "25K", "20K" (Finance). |

**Rule — confirm typographic role before adding new text.** Whenever new
text is requested (metric, card title, label, body, etc.), confirm which
role above it serves so the correct size and weight are chosen. Do not
introduce a size or weight that is not on this table.

### Card title roles

Two card title roles. Pick by content, not by taste.

| Role | Size | Weight | Line height | Color | When to use |
|------|------|--------|-------------|-------|-------------|
| Standard card title | 18px | 600 | 28px | `#1D2939` | Default for all cards |
| KPI label title | 16px | 600 | 24px | `#344054` | Required when title sits above a metric value ≥24px (text-2xl+) |

Font family: `Outfit, sans-serif`. Title tag: `<h3>`. Dark mode: title color is `white/90`.

**Mechanical rule, not a judgment call.** If the card's primary content
is a metric value ≥24px (text-2xl, text-title-sm, text-title-md), use
the KPI label title. Otherwise use the standard card title. There is
no third option.

### Card subtitle

When a card has a subtitle directly under the title:

| Property | Value |
|----------|-------|
| Size | 14px (`text-theme-sm`) |
| Color | `gray-500` (`#667085`) light / `gray-400` (`#98A2B3`) dark |
| Gap from title | 4px (`mt-1` on the subtitle) |
| Perceived text-to-text gap | ~12px (accounts for line-box descent) |

---

## Spacing

### Allowed values

Only these pixel values are permitted for gap, padding, and margin.
Values outside this set are off-grid and must not be used.

| px | Tailwind | Typical use |
|----|----------|-------------|
| 2px | gap-0.5 / p-0.5 | Toggle track internal only |
| 4px | gap-1 | Inline metadata, dot-to-label |
| 8px | gap-2 | Tight inline pairs |
| 12px | gap-3 / py-3 | Inner element rows, table cell vertical |
| 16px | gap-4 / p-4 | Grid gap mobile, table card top padding |
| 20px | gap-5 / p-5 | Card padding mobile, header internal gap |
| 24px | gap-6 / p-6 | Grid gap desktop, card padding desktop, header→body margin |
| 32px | gap-8 / py-8 | Section gap generous, sidebar logo vertical |
| 44px | pb-11 | Gauge card bottom only (chart overflow) — exception |

Any value not in this table is off-grid. Flag in code review.

---

### Page and layout level

**Page content wrapper**
`p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6` — 16px mobile, 24px desktop.

**Page grid**
`grid grid-cols-12 gap-4 md:gap-6` — 16px mobile, 24px desktop.
`align-items` is not declared — browser default `normal` (stretch) applies.

**Vertical rhythm between sections**
TailAdmin uses `space-y-6` (24px) between sibling blocks inside a column.
This project uses `margin-top` instead — functionally equivalent.
Either is acceptable. Do not mix both on the same page or section level.
Never use `gap` on a parent grid for vertical rhythm between sections —
`gap` on a grid interacts with child height; `space-y-*` and `margin-top` do not.

---

### Card padding

| Card type | Class | Mobile | Desktop |
|-----------|-------|--------|---------|
| Standard card | `p-5 sm:p-6` | 20px | 24px |
| Chart card (no bottom pad) | `px-5 pt-5 sm:px-6 sm:pt-6` | 20px sides/top | 24px sides/top |
| Table card root | `pt-4` only | 16px top, 0 sides | 16px top, 0 sides |
| Table card inner header | `px-6` | 24px sides | 24px sides |

Table card uses intentionally asymmetric padding — `pt-4` on root,
horizontal padding pushed into the inner header child. This is TailAdmin-native.
Do not normalize it to uniform padding.

#### Fixed-scale card shells (canonical components — not responsive)

Some canonical cards use a fixed, non-responsive padding and do not use the responsive
`sm:p-6` pattern. See Part 6 — Canonical card shells for the binding spec.

| Shell | Padding | Border radius | Border |
|-------|---------|---------------|--------|
| Metric card (`.metric-card`) | 20px fixed | 16px | 1px `#E4E7EC` |
| Revenue card (`.revenue-card`) | 20px fixed | 12px | **none** |
| Chart-card (`.statistics-card` family) | 24px fixed | 16px | 1px `#E4E7EC` |

> Use fixed-scale shells for components built as UI Lab canonical references. These do not vary
> with viewport.

---

### Card internal spacing

| Element | Class | Value |
|---------|-------|-------|
| Header → body margin (standard) | `mb-6` on header row | 24px |
| Header → body margin (chart-card) | `mb-8` on header row | 32px |
| Header internal gap | `gap-5` | 20px |
| Inner element rows | `gap-3` | 12px |
| Sub-list vertical rhythm | `space-y-5` | 20px |
| Table cell vertical | `py-3` | 12px |

> The 32px chart-card header margin applies to large chart-cards (statistics-card family) where a
> chart area of 250px+ height follows the header. The extra 8px creates breathing room between the
> title/tabs and the chart. Standard signal cards and KPI cards use the 24px default.

---

### Grid gap

**Card grid standard: `gap-4 md:gap-6`** — 16px mobile, 24px desktop.

This responsive pattern is mandatory for every grid that holds cards. A fixed
`gap: 16px` without a desktop breakpoint is not acceptable — it applies mobile
sizing at every viewport width and produces gaps that are too tight on desktop.

**TailAdmin uses equal horizontal and vertical gaps.** Do not split row-gap and
column-gap to different values on card grids. The single `gap-*` value applies
to both axes uniformly.

**Two distinct gap categories — do not confuse them:**

| Category | Value | Use |
|----------|-------|-----|
| Card grids (cards as children) | `gap-4 md:gap-6` (16→24px) | Required for any grid holding card components |
| Dense internal layouts (form rows, toolbars, button groups, tile clusters) | `gap-2`, `gap-3`, or fixed `gap-4` | Internal mechanics — do not need responsive expansion |

A card grid is any grid whose direct children are card-level components
(`.card`, `.kpi-card`, `.cth-card`, `.today-secondary-card`, etc.).
A dense internal layout is everything else — form input rows, toolbar control
strips, button groups, summary tile clusters, etc.

**Exception:** rows with 3+ card columns may keep `gap-4` at desktop to prevent
overcrowding when card content is text-heavy. Document the exception in code
with a comment when used.

**Verification:** every card grid must compute to 24px gap at desktop width.
Test with DevTools at viewport ≥768px before considering a grid layout complete.

---

### align-items on grids

TailAdmin never declares `align-items` on grid containers — it relies on the
browser default `normal` (which resolves to stretch in a grid context).

**Wx CFO rule:** Every grid or flex row that holds cards must declare
`align-items` explicitly. Do not rely on the browser default.

| Intent | Rule |
|--------|------|
| Cards hug their own content | `align-items: flex-start` |
| Cards match each other's height | `align-items: stretch` |

TailAdmin relies on default stretch. Wx CFO does not.

---

### What not to do

- Do not use off-grid values (14px, 18px, 28px) — these are drift, not decisions
- Do not use `gap` on a parent grid for vertical rhythm — use `space-y-*` or `margin-top`
- Do not mix `space-y-*` and `margin-top` at the same page or section level
- Do not leave `align-items` undeclared on any grid or flex row that holds cards
- Do not normalize table card padding to uniform — the asymmetric pattern is intentional
- Do not use `gap-6` or larger inside a card body — that is a section-level value
- Do not use the same gap value for outer grid and inner nested grid

---

## Border Radius

| Element | Tailwind | px |
|---------|----------|----|
| Cards / panels (standard) | rounded-2xl | 16px |
| Cards / panels (borderless variant) | rounded-xl | 12px |
| Dropdowns, notification panel | rounded-2xl | 16px |
| Standalone table wrapper | rounded-xl | 12px |
| Icon containers, alerts | rounded-xl | 12px |
| Inputs, buttons, ChartTab track | rounded-lg | 8px |
| ChartTab active pill, DropdownItems | rounded-md | 6px |
| Modals | rounded-3xl | 24px |
| Badges / pills, avatar | rounded-full | 999px |

> **Borderless card shell (12px):** A card with no border, `border-radius: 12px`, 20px padding,
> and white background. Used on compact/metric cards where the card sits in a grid without a visible
> border separation. Source: TailAdmin /sales "Total Revenue" tile. See Part 6 — Canonical card
> shells for the full spec.

---

## Shadows

TailAdmin uses a shadow scale. Cards themselves have **no shadow** — border only.
Shadows appear on specific interactive surfaces only.

| Surface | Shadow token | Notes |
|---------|-------------|-------|
| Cards / panels | **none** | border only |
| Input fields | shadow-theme-xs | subtle lift |
| Outline buttons | shadow-theme-xs | |
| Icon-circle buttons (social, edit) | shadow-theme-xs | |
| ChartTab active pill | shadow-theme-xs | white pill on gray track |
| Dropdowns / popovers | shadow-theme-lg | |
| Modal backdrop | bg-gray-400/50 backdrop-blur-[32px] | not a shadow |
| Gauge card inner white section | shadow-default | **exception — see note** |

> **Shadow exception:** Pattern F (gauge/radial card) uses `shadow-default` on the inner white
> content section because it sits on a gray-100 outer track background. This is structurally
> justified by the layered card composition. Do not generalize this to other card patterns.

---

## Control Sizing

| Control | Size |
|---------|------|
| All inputs / selects | h-11 (44px) |
| Standard buttons (md) | px-5 py-3.5 text-sm |
| Compact buttons (sm) | px-4 py-3 text-sm |
| Header icon buttons | h-11 w-11 |
| Social / edit icon buttons | h-11 w-11 rounded-full |
| Switch track | h-6 w-11 |
| Switch knob | h-5 w-5 |
| Sidebar expanded | w-[290px] |
| Sidebar collapsed | w-[90px] |

---

## Button height taxonomy (canonical — three sizes only)

There are **three approved button heights** in this design system. No
other heights are allowed for new buttons. Pick the role first, then the
height follows.

| Height | Role | When to use | TailAdmin reference examples |
|---|---|---|---|
| **44px** | Primary action | High-priority, full-weight actions at the top level of a page or card. Page-header actions and card-level primary CTAs. | `Filter` / `Export` (Sales page header); `Transfer` / `Received` (Finance Total Balance card); sidebar/notification/dark-mode header icons |
| **40px** | Secondary card-level | Supporting actions inside a card — filtering, toggling views, navigating between segments. Sits beside or below a primary action. | `Daily` / `Weekly` / `Monthly` (Users & Revenue Statistics); `Filter` / `See All` (Top Products); `Monthly` / `Quarterly` / `Annually` (AI dashboard chart); `Send Money` / `Filter` (Finance page) |
| **36px** | Compact selector / dropdown | Space-constrained filter, scope, or configuration controls placed next to a card title. Typically a dropdown trigger. | `USD` / `June 2025` (Total Balance header); `2025` / `3 Month` (Cashflow Overview header); `Add Card` (My Cards) |

### Rules

- **Three sizes, no others.** If a new button would need 38px / 42px / 48px
  to "fit," redesign the layout — don't invent a fourth size.
- **Border color follows the action-dropdown trigger spec** (`#D0D5DD`,
  see Part 6) regardless of which of the three heights is used. `#E4E7EC`
  is for card / menu / input borders, not trigger buttons.
- **Border radius is always 8px** for all three sizes.
- **Icon-only buttons** at 44px are square (44×44); at 40px are square
  (40×40). 36px icon-only buttons are reserved for dropdown carets within
  split buttons.

### Required AI behavior — ask before creating a button

When the user asks for a new button to be created (any of: page header
action, card action, dropdown trigger, segmented toggle option, icon
button), the assistant **must**:

1. Suggest the best-fit size based on the role table above, with a one-
   sentence justification ("Sits in the page header next to other primary
   actions → 44px").
2. **Ask the user to confirm** which of the three heights — **44px**,
   **40px**, or **36px** — to use before writing any CSS or JSX.
3. Only proceed once the user has confirmed.

This applies even when the answer seems obvious. The taxonomy is a hard
rule; the confirmation step is what keeps it from drifting.

---

# PART 2 — SHELL LAYOUT

---

The shell is built once and rarely changes. `AppSidebar.tsx` and
`AppHeader.tsx` are the real project files; the structural facts below are
load-bearing — the full TailAdmin DOM/Tailwind anatomy is reference only.

## App Layout
Sidebar (fixed, left) + Backdrop (mobile, `z-40`) beside a `flex-1` main
column (`transition-all duration-300`) holding a sticky `AppHeader` and the
page content wrapper (`p-4 md:p-6`, `max-w-(--breakpoint-2xl)`, centered).
Main column shift: `ml-[290px]` expanded, `ml-[90px]` collapsed.

## Sidebar
Fixed left, `h-screen`, white (`dark:bg-gray-900`), right border, `px-5`.
- Width: expanded `290px` (labels) · collapsed `90px` (icons, centered) ·
  hover-while-collapsed expands to `290px` temporarily · mobile slides in at `290px`.
- Logo area `py-8`. Section header: 12px uppercase gray-400; collapses to a
  centered dots icon.
- Nav items use the `menu-item` / `menu-item-active` / `menu-item-inactive`
  utility classes (active = brand-50 bg + brand-500 text; inactive = gray-700,
  hover gray-100). Submenu items use the `menu-dropdown-item*` classes with the
  same active/inactive coloring, plus an optional "new"/"pro" badge.
- `SidebarWidget` footer promo renders only when expanded/hovered/mobile-open.

## Header
`sticky top-0`, white, `z-99999`, `border-b` on `lg`.
- Desktop: left = hamburger + desktop search (with ⌘K shortcut); right = theme
  toggle, `NotificationDropdown`, `UserDropdown`.
- Mobile: left row always visible (hamburger | logo | 3-dot toggle); right row
  toggles open on the 3-dot tap.
- ⌘K (`metaKey/ctrlKey + K`) focuses the search input.
- Notification/user triggers are `h-11 w-11 rounded-full` buttons opening
  `shadow-theme-lg` panels; the notification dot uses an `animate-ping` ring.

## Backdrop
`fixed inset-0 z-40 bg-gray-900/50 lg:hidden`, rendered only when the mobile
sidebar is open; click closes it.

---

# PART 3 — PRIMITIVES

---

This project uses **no TailAdmin React primitives and no Tailwind** — every
component is custom CSS in `src/dashboard.css`. The specs below are TailAdmin
reference values to translate into a `dashboard.css` class; never paste
Tailwind into JSX. **Bold** items are the load-bearing project rules.

## Badge → moved to Part 6
Project status badges (`.card-status-badge`, `.is-pressure`) and domain tags
(`.card-domain-tag`) are a project overlay — the binding spec is **Part 6 —
Status badges & domain tags**. The TailAdmin `Badge.tsx` primitive
(light/solid variants, `rounded-full px-2.5 py-0.5`) is not used here.

---

## Reference primitives
Compact specs for the TailAdmin primitives this project re-implements in CSS.
Dark variants follow the global mappings in Part 1 — Dark Mode.

| Primitive | Spec |
|-----------|------|
| Button | `inline-flex items-center justify-center gap-2 rounded-lg transition`; primary = `bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600 disabled:bg-brand-300`; outline = `bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50`; sizes sm `px-4 py-3` / md `px-5 py-3.5`, both `text-sm`; disabled `cursor-not-allowed opacity-50`. Heights: Part 1 button taxonomy. |
| Alert | `rounded-xl border p-4`; `flex items-start gap-3` → 24×24 icon + content (`h4 text-sm font-semibold text-gray-800` + `p text-sm text-gray-500` + optional `Link mt-3 underline`); border/bg `border-{color}-500 bg-{color}-50`. |
| Input | `h-11 w-full rounded-lg border px-4 py-2.5 text-sm shadow-theme-xs`; default `border-gray-300`, focus `border-brand-300 ring-brand-500/20`; error/success swap to the semantic border + ring; disabled `opacity-40 bg-gray-100 cursor-not-allowed`; hint `mt-1.5 text-xs`. |
| Select | Same height/radius/border/focus as Input default; `appearance-none pr-11` for the chevron. |
| Label | `mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400`. |
| Avatar | `rounded-full object-cover`, 6 sizes 24px (xsmall) → 64px (xxlarge); status dot bottom-right, `border-[1.5px]` (online success-500 / offline error-400 / busy warning-500). |
---

## Dropdown
Panel: `absolute z-40 right-0 mt-2 rounded-xl border bg-white shadow-theme-lg`; closes on outside mousedown. **Triggers must carry the `dropdown-toggle` class** so the outside-click handler excludes them. `DropdownItem` is a `<button>` by default, `<Link>` when `tag="a"` + `to`.
- **Card MoreDot:** `div.relative.inline-block` → `button.dropdown-toggle` (MoreDot icon `size-6 text-gray-400 hover:text-gray-700`) + a `w-40 p-2` panel of left-aligned `text-gray-500 rounded-lg hover:bg-gray-100` items.
- **In-app menus (`.action-dropdown`):** the Forecast Scenario picker (Base/Best/Worst/Custom) is canonical for timeframe / range / scope menus; `.action-dropdown-menu` styles the panel and the `.timeframe-list` alias inherits it (Forecast horizon, NetCashFlow timeframe, Big Picture range). Trigger varies by surface. See **Part 6 — Action dropdown** for the full trigger + menu spec.

---

## Modal
**Always use the `useModal()` hook** (`{ isOpen, openModal, closeModal, toggleModal }`) — never raw `useState`. Backdrop `fixed inset-0 bg-gray-400/50 backdrop-blur-[32px]`; container `z-99999`; content `rounded-3xl bg-white`; close button `rounded-full bg-gray-100`. ESC closes; body overflow hidden while open. Large form variant (`max-w-[700px]`, `p-4 lg:p-11`): header (`h4 text-2xl font-semibold` + `p text-sm`) → scrollable body (`custom-scrollbar h-[450px]`, grid `gap-x-6 gap-y-5 lg:grid-cols-2`) → footer (`mt-6 lg:justify-end`) with outline "Close" + primary "Save Changes".

---

## Switch / Toggle
A single on/off control (to switch between views of the same data use the segmented toggle — **Part 6**). `label.flex.items-center.gap-3.text-sm.font-medium` → track (`h-6 w-11 rounded-full`, brand-500 on / gray-200 off) + knob (`absolute h-5 w-5 rounded-full bg-white shadow-theme-sm`, `translate-x-full` on / `translate-x-0` off).

---

## Table
TailAdmin primitives `Table` / `TableHeader` / `TableBody` / `TableRow` / `TableCell` (`isHeader` → `<th>`); header cells `py-3 font-medium text-gray-500 text-theme-xs text-start`, body cells `py-3 text-theme-sm text-gray-500`, dividers `divide-gray-100`. **The canonical project table spec is Part 6 — Data Table Pattern (Projection Table V2)** — use it for any dense data table.

---

## PageBreadcrumb
`flex flex-wrap items-center justify-between gap-3 mb-6`: left `h2 text-xl font-semibold` page title, right Home-link → chevron → current-page name `text-sm`. **When used, it is the first element inside an AppLayout page.**

---

# PART 4 — CARD & CHART PATTERNS

---

## Pattern Lookup Table

| Surface | Pattern |
|---------|---------|
| Chart card — title + MoreDot | A |
| Chart card — title + subtitle + right controls | B |
| Chart card — title + subtitle + MoreDot | B variant |
| Chart card — multi-series + custom legend | C |
| Chart card — metrics embedded in header | H |
| KPI card — icon + label + value + delta badge | D |
| KPI card — value-first with inline delta | D2 |
| Inline segmented toggle | E |
| Radial / gauge card | F |
| Table card | G |
| Profile / content info card | I |
---

## Pattern A — Chart Card: Title + MoreDot

```
card [rounded-2xl border bg-white px-5 pt-5 sm:px-6 sm:pt-6 overflow-hidden]
├── header [flex items-center justify-between]
│   ├── h3.text-lg.font-semibold.text-gray-800
│   └── MoreDot dropdown
└── chart-wrapper [max-w-full overflow-x-auto custom-scrollbar]
    └── min-width inner div → <Chart />
```

No subtitle. No legend. No bottom padding — chart extends to card edge.

---

## Pattern B — Chart Card: Title + Subtitle + Right Controls

```
card
├── header-block [flex flex-col gap-5 mb-6 sm:flex-row sm:justify-between]
│   ├── LEFT [w-full]
│   │   ├── h3.text-lg.font-semibold.text-gray-800
│   │   └── p.mt-1.text-gray-500.text-theme-sm  [subtitle]
│   └── RIGHT [flex items-center gap-3 sm:justify-end]
│       └── ChartTab | date-picker | status badge | MoreDot
└── chart-wrapper
```

Subtitle at `mt-1` (4px) directly below title. RIGHT column holds only controls — never text content.

---

## Pattern C — Chart Card: Custom Legend Row

```
card  [p-6, block, 2 direct children only]
├── child[0]: header-row  [flex items-center justify-between gap-5]
│   ├── LEFT block  [title H3 + subtitle P, no gap between them]
│   └── RIGHT: controls (ChartTab | dropdown | MoreDot)
└── child[1]: anonymous block wrapper  [no class, display: block, full content width]
    ├── legend-container  [flex items-center gap-5, pt-5]  ← pt-5 is the subtitle→legend gap
    │   └── item  [flex items-center gap-1.5]
    │       ├── dot  [h-2.5 w-2.5 = 10×10px, rounded-full]
    │       └── label  [text-sm text-gray-500]
    └── chart-container  [h-[Npx] w-full]  ← flush below legend, 0px gap
        └── <Chart />
```

**Spacing — exact values:**
| Gap | Value | Implementation |
|-----|-------|----------------|
| Title → subtitle | 0px | Both in same block parent, line-height only |
| Subtitle → legend | 20px | `pt-5` on legend-container — NOT margin, NOT flex gap |
| Legend → chart | 0px | chart-container is flush sibling in the anonymous wrapper |

**Alignment — all three share the same left edge:**
Title left edge = subtitle left edge = legend left edge = card `padding-left` origin.

**Legend item spec:**
- Container: `flex items-center gap-5` (20px between items) + `pt-5` (20px top padding)
- Each item: `flex items-center gap-1.5` (6px between dot and label)
- Dot: `h-2.5 w-2.5 rounded-full` (10×10px)
  - Active / primary series: `bg-brand-500` (#465FFF)
  - Secondary / inactive series: `bg-brand-200` (#9CB9FF)
- Label: `text-sm text-gray-500` (14px, #667085)

**Critical rules:**
- Set `legend: { show: false }` in ApexOptions — ApexCharts native legend must be empty
- The anonymous wrapper is `display: block` — legend and chart stretch to full content width naturally
- Do NOT use `inline-flex` or `width: fit-content` on the legend container — it must be full-width
- Do NOT use `margin-top` on the legend container — use `pt-5` only
- The card has exactly **2 direct children**: header-row and the anonymous wrapper. Never add a third.

---

## Pattern D — KPI Card: Icon Variant

```
card [p-5 md:p-6]
├── icon-box [w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800 flex items-center justify-center]
│   └── Icon [size-6 text-gray-800 dark:text-white/90]
└── row [flex items-end justify-between mt-5]
    ├── LEFT
    │   ├── span.text-sm.text-gray-500  [label]
    │   └── h4.mt-2.font-bold.text-title-sm  [value]
    └── RIGHT: Badge [variant=light color=success|error, startIcon=Arrow]
```

---

## Pattern D2 — KPI Card: Value-First with Inline Delta

```
card [p-5 md:p-6]
├── label [text-sm text-gray-500]  ← top
├── row [flex items-end gap-2 mt-2]
│   ├── value [font-bold text-title-sm]
│   └── delta [inline colored text or small Badge]
└── context text [text-theme-xs text-gray-500]  "Vs last month" / "From last month"
```

---

## Pattern E — Segmented Toggle (Inline)

A horizontal control for switching between mutually-exclusive views of the
same data. In-card placement only — header-right column or above the chart,
**never below the chart**. The canonical spec (single scale: 44px track /
40px buttons / 10px×12px padding / 8px+6px radii; `.segmented-toggle` global
+ `.statistics-card__tab*` scoped) lives in **Part 6 — Segmented toggle
(standard pattern)**. There is no `.chart-tab` class in this codebase.

---

## Pattern F — Radial / Gauge Card

```
outer [rounded-2xl border bg-gray-100 dark:bg-white/[0.03]]
└── inner [rounded-2xl bg-white shadow-default dark:bg-gray-900 px-5 pt-5 pb-11]
    ├── header [flex justify-between]
    │   ├── LEFT: h3.text-lg.font-semibold + p.mt-1.text-theme-sm.text-gray-500
    │   └── RIGHT: MoreDot
    ├── chart area [radialBar, height 330, sparkline enabled]
    │   └── progress badge [absolute centered, rounded-full bg-success-50 text-success-600 px-3 py-1 text-xs]
    └── summary p [mx-auto mt-10 text-center text-sm text-gray-500]
footer [flex items-center justify-center gap-5 sm:gap-8 px-6 py-3.5 sm:py-5]
    ├── Stat block [label text-theme-xs text-gray-500 mb-1 + value text-base font-semibold + arrow icon]
    ├── Divider [w-px bg-gray-200 h-7]
    └── Stat block
```

> `shadow-default` on the inner section is correct here. See Part 1 Shadows for the explanation.

---

## Pattern G — Table Card

```
card [overflow-hidden rounded-2xl border px-4 pb-3 pt-4 sm:px-6]
├── header [flex flex-col sm:flex-row gap-2 mb-4 items-center justify-between]
│   ├── h3.text-lg.font-semibold
│   └── action buttons [flex items-center gap-3]
│       └── outline button [rounded-lg border-gray-300 px-4 py-2.5 text-theme-sm shadow-theme-xs]
└── scroll wrapper [max-w-full overflow-x-auto]
    └── Table
```

---

## Pattern H — Chart Card: Metrics Embedded in Header

```
card
├── header-block [Pattern B — title + subtitle + right ChartTab]
├── metrics-row [flex gap-8 mb-4]  ← between header-block and chart-wrapper
│   └── metric [value (large font-bold, colored) + delta badge + sublabel text-xs]
└── chart-wrapper
```

Used when 2–3 key values are tightly coupled to the chart context.

---

## Pattern I — Profile / Content Info Card

```
card [p-5 border rounded-2xl lg:p-6]
├── top row [flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6]
│   ├── LEFT: h4.text-lg.font-semibold + content grid
│   └── RIGHT: Edit button [rounded-full border h-11 inline-flex items-center gap-2 shadow-theme-xs]
└── content grid [grid grid-cols-1 gap-4 lg:grid-cols-2]
    └── field [p.text-xs.text-gray-500.mb-2 (label) + p.text-sm.font-medium.text-gray-800 (value)]
```

Edit button uses `rounded-full`. This is profile-card specific — not `rounded-lg`.

---

## Card Spacing Reference

Header-block→content spacing is specified in Part 1 — Spacing (Card internal
spacing: `mb-6`/24px standard, `mb-8`/32px chart-card); the legend-row gaps
(subtitle→legend 20px via `pt-5`, legend→chart 0px) are specified once in
Pattern C. This table covers the remaining KPI / modal / form transitions.

| Transition | Value | Implementation |
|---|---|---|
| Subtitle → next element (general) | mt-1 (4px) | when no legend row present |
| Icon-box → value row (KPI) | mt-5 (20px) | margin-top on value row |
| Label → value (KPI) | mt-2 (8px) | margin-top on value |
| Chart → text action link below | mt-4 to mt-6 | margin-top on action |
| Modal header → body | mt-8 (32px) | margin-top on body |
| Modal body → footer | mt-6 (24px) | margin-top on footer |
| Form field rows | gap-y-5 (20px) | grid gap |

---

## ApexCharts Config Defaults

Required on every chart.

Every ApexCharts options object **must** set `chart.fontFamily` to the
literal string `"Outfit, sans-serif"`. `'inherit'` is not allowed, and
omitting `fontFamily` is not allowed — ApexCharts renders inside an SVG
sandbox where the page font does not cascade reliably.

| Setting | Value |
|---|---|
| chart.fontFamily | "Outfit, sans-serif" |
| chart.toolbar.show | false |
| chart.background | "transparent" |
| legend.show | false when using custom JSX legend |
| grid.borderColor | "#e0e0e0" |
| grid.strokeDashArray | 4 |
| xaxis.axisBorder.show | false |
| xaxis.axisTicks.show | false |
| xaxis/yaxis labels fontSize | "12px" |
| xaxis/yaxis labels colors (standard) | ["#667085"] |
| xaxis/yaxis labels colors (Sales-family chart-cards) | ["#373d3f"] |
| dataLabels.enabled | false |
| tooltip.theme | "light" |
| tooltip.style.fontSize | "12px" |

Series colors: primary `#465FFF` · secondary `#9CB9FF` · success `#12B76A` · error `#F04438`.
Area opacity: 0.15–0.25. No 3D. No decorative gradients.

---

## Tooltips (ApexCharts)

All ApexCharts tooltips use the native tooltip with `theme: 'light'`.
Custom HTML tooltip renderers (`tooltip: { custom: ... }`) are not
used — with one documented exception (see below).

Every ApexCharts instance must include:

```ts
tooltip: {
  theme: 'light'
}
```

This enables the `.apexcharts-theme-light` CSS class which the
global tooltip styles in `dashboard.css` target.

| Property | Value |
|---|---|
| Background | `rgba(255, 255, 255, 0.96)` |
| Border | `1px solid #E4E7EC` |
| Border radius | `8px` |
| Box shadow | `0px 1px 3px rgba(16,24,40,0.10), 0px 1px 2px rgba(16,24,40,0.06)` |
| Padding | `12px` |
| Title font size | `10px` |
| Title color | `#344054` |
| Title background | `transparent` |
| Title border-bottom | `none` |
| Series text font size | `12px` |
| Series text color | `#475467` |
| Series value font weight | `500` |
| Marker size | `8px × 8px` |
| Marker shape | Circle (`border-radius: 50%`) |
| Marker color | `currentColor` (inherits series color set by ApexCharts) |
| Marker margin-right | `6px` |
| Font family | `Outfit`, sans-serif |

### ApexCharts v4/v5 marker behavior

ApexCharts v4+ renders tooltip markers via a `::before` pseudo-element
using a Unicode glyph (`●`) rather than a plain `div` with
`background-color` (the v3 approach used by TailAdmin's reference
implementation).

The correct fix is to suppress the glyph and paint the marker using
`background-color: currentColor`. ApexCharts sets the series color
as `color: rgb(...)` on the marker element — `currentColor` picks
that up and renders a solid filled circle.

Do not size the `::before` glyph — set `font-size: 0px` and
`content: ""` to collapse it, then use `background-color` on the
wrapper element for the fill.

The working CSS is in `dashboard.css` under
`.apexcharts-tooltip-marker` and `.apexcharts-tooltip-marker::before`.

### Bar chart crosshairs

Bar charts must set `crosshairs: { width: 'barWidth' }` in the
chart options. The default `'auto'` uses slot width which is
significantly wider than the bar and looks wrong on hover.

To hide the crosshair column background entirely while preserving
tooltip behavior, add the appropriate opacity override to the
crosshairs config (confirmed shape varies by ApexCharts version —
check existing usage in the component before adding).

### Exception — OwnerDistributionsChart custom tooltip

`OwnerDistributionsChart.tsx` uses `tooltip: { custom: ... }` to
render a Total row (Actual + Forecast = full year distribution).
This is a deliberate, documented exception to the no-custom-tooltip
rule. The custom renderer wrapper must include `.apexcharts-theme-light`
so global tooltip CSS applies.

### Exception — TopCategoriesCard custom tooltip

`TopCategoriesCard.tsx` uses `tooltip: { custom: ... }` to render
a single-slice tooltip on the donut chart. The standard x/y formatter
pattern causes multi-series stacking on pie/donut charts. The custom
renderer uses `.ec-donut-tooltip` classes defined in `dashboard.css`
which visually match the dashboard tooltip standard. See the Pie/donut
exception section in Part 6 for the full policy.

### Hard rules

- Never use `tooltip: { custom: ... }` except in OwnerDistributionsChart and TopCategoriesCard (documented exceptions above)
- Never set tooltip background to `transparent`
- Never size the `::before` glyph — use `background-color: currentColor`
- The global `.apexcharts-tooltip` transparent reset block must
  not exist in `dashboard.css`
- Every ApexCharts bar chart must have `crosshairs: { width: 'barWidth' }`

---

## Anti-Patterns

1. **Apex legend + custom JSX legend simultaneously.** Choose one.
2. **Subtitle used as series label.** Subtitle = context. Legend = dot + label pairs below header.
3. **Badge in the title stack.** Badge lives in header-right only.
4. **Legend inside chart scroll wrapper.** Legend is a sibling block before chart-wrapper.
5. **ChartTab below chart.** Always in header-right or above.
6. **Layout invented without tracing a source pattern.** Use the Lookup Table.
7. **Card title weight 400 or 500.** TailAdmin card titles are font-semibold (600).
8. **Dropdown trigger missing `dropdown-toggle` class.** Outside-click handler needs it.
9. **Modal state via raw useState.** Use `useModal()`.
10. **Shadow added to card or panel without justification.** Pattern F is the only valid exception.
11. **`rounded-md` or `rounded-sm` on cards.** Cards are always `rounded-2xl`.
12. **Toggle pattern other than the standard segmented control.** For new toggle work, use `.segmented-toggle` — the single canonical 44/40/10 scale (chart-card consumers use the locally scoped `.statistics-card__tab*` class with the same spec). See Part 6 Segmented toggle for the spec. Do not introduce `.chart-tab` as a new class.

---

# PART 5 — PAGE COMPOSITIONS

---

This project ships a single application page — `src/pages/Dashboard.tsx` —
which composes the card components specified in Parts 3–4. The TailAdmin
demo page layouts (eCommerce dashboard, Charts/Tables/Forms demos, Profile,
Calendar, Auth) are not used here; they remain in the TailAdmin reference
repo (per AGENTS.md) and are not replicated in this project.

Page-level layout tokens — content-wrapper padding, the 12-column grid, grid
gap, and vertical rhythm between sections — are specified in Part 1 — Spacing
(Page and layout level). Charts rendered on their own surface follow the
chart-card patterns in Part 4.

---

# PART 6 — PROJECT OVERLAY

## CSS Architecture — Current Implementation Reality

This project uses legacy custom CSS only. All styling lives in `src/dashboard.css`
as flat utility-namespaced classes (.cth-*, .wna-*, .kpi-*). There is no Tailwind
in this project — no config files, no PostCSS, no @apply, no Tailwind utility
classes in JSX.

Tailwind utility class references that appear anywhere in this document
(e.g. text-lg, bg-brand-50, rounded-2xl) are descriptive shorthand for the
design values to use — they are NOT literal class strings to paste into JSX.
Translate every Tailwind reference into an appropriate project CSS class in
dashboard.css using raw hex values from this document.

Raw hex values are allowed in dashboard.css because it is the token
implementation layer for this project. Components consume styles via class
names only — never by referencing hex directly in TSX.

Raw hex is also allowed in src/lib/ui/chartTokens.ts (see Addition 3 below).

If and when this project migrates to Tailwind, this section will be revised.
Until then, legacy CSS is the only sanctioned implementation path.

---

## Segmented toggle (standard pattern)

A horizontal segmented control for switching between mutually exclusive view modes within a card or page section.

### When to use

Use whenever the user must choose exactly one of 2–5 options that are views of the same data:
- Timeframe selectors (Last 6 months / Last 12 months / All time)
- View mode selectors (Operating / Total)
- Section selectors (Data / Accounts / Rules)

### When not to use

- Multi-select filters — use checkboxes or a multi-select dropdown
- More than 5 options — use a dropdown
- A single on/off control — use a Switch (Part 3 — Switch / Toggle)
- Navigation between pages — use the sidebar

### Canonical spec (single scale)

Implemented as `.segmented-toggle` (global) and `.statistics-card__tab*` (locally scoped inside
chart cards). Both use the same visual spec — no exceptions, no second scale.

| Element | Token | Value |
|---------|-------|-------|
| Track background | `bg-gray-100` | #F2F4F7 |
| Track border radius | `rounded-lg` | 8px |
| Track internal padding | `p-0.5` | 2px |
| Track gap between segments | `gap-0.5` | 2px |
| Track height | — | 44px |
| Active segment background | `bg-white` | #FFFFFF |
| Active segment text | `text-gray-900` / `font-medium` | #101828, weight 500 |
| Active segment shadow | `shadow-theme-xs` | 0 1px 2px rgba(16,24,40,.05) |
| Active segment border radius | `rounded-md` | 6px |
| Inactive segment background | none | — |
| Inactive segment text | `text-gray-500` / `font-medium` | #667085, weight 500 |
| Segment height | — | 40px |
| Segment padding | — | 10px vertical, 12px horizontal |
| Font family / size | Outfit | 14px |
| Hover / focus / transition | none | matches TailAdmin source |
| Layout | single row, horizontal, no wrapping | — |

No border on the track. No shadow on the track. Shadow on the active pill only. No hover state,
no focus ring, no transition — matches the TailAdmin Analytics card Monthly/Quarterly/Annually
toggle exactly.

**Reference implementation:** UI Lab `.statistics-card__tabs/__tab/__tab--active`
([src/dashboard.css](src/dashboard.css) `.statistics-card__tabs` rule block).
Global consumers: Settings page (`#/settings`) Data / Accounts / Rules; Forecast horizon
toggle; Trends timeframe; Contracts cadence; Net Cash Flow chart mode; Rules-row controls.

---

## Action dropdown (standard pattern)

A single compact dropdown trigger that opens a small menu — used for card- or page-header
actions where a segmented toggle is too heavy (e.g. 4+ mutually-exclusive options that
don't need to all be visible at rest).

**Reference implementation:** Forecast header scenario selector — `.action-dropdown`
(see [src/dashboard.css](src/dashboard.css)).

### When to use

- Card- or page-header control with 3–8 mutually-exclusive options where only the
  selected one needs to be visible at rest.
- Replacing a segmented toggle that has grown crowded or is competing visually with the
  card title.

### When not to use

- 2–4 always-visible options where comparison matters at a glance → use the segmented
  toggle (above).
- More than ~8 options or hierarchical menus → use a full dialog or sidebar nav.
- Single on/off → use a Switch.

### Trigger spec

| Element | Token | Value |
|---------|-------|-------|
| Height | per role | 44 / 40 / 36px — see Part 1 "Button height taxonomy" |
| Padding | `px-2.5` | 0px vertical, 10px horizontal |
| Gap (label ↔ chevron) | `gap-1.5` | 6px |
| Border | `border border-gray-300` | 1px solid #D0D5DD (uniform on all 4 sides) |
| Border radius | `rounded-lg` | 8px (uniform on all 4 corners) |
| Outline | none rendered | `outline-style: none`; reserved value `1.5px #344054` for focus/interaction states |
| Box shadow | none | `none` |
| Background | none | transparent (light mode) |
| Text color | `text-gray-700` | #344054 |
| Font family / size / weight | Outfit | 14px / 500 |
| Line height | — | 20px |
| Layout | `flex items-center justify-center` | row, centered |
| Chevron icon | `FiChevronDown` (or equivalent) | 16px, #667085, rotates 180° when open |
| Min width | none | auto-sized to content |
| Hover / open state | optional soft-gray fill | #F9FAFB (subtle, light-mode only) |

**Border-color is the load-bearing token.** Any action-button-style trigger
(card-header action, page-header action, split-button caret, Export, Add,
Compare, etc.) must use `#D0D5DD` for its 1px border. Do not use `#E4E7EC`
for trigger borders — that color is reserved for card shells, menu panels,
and input fields.

### Menu spec

| Element | Value |
|---------|-------|
| Anchor | absolute, `top: calc(100% + 6px)`, `right: 0` |
| Background | #FFFFFF |
| Border | 1px solid #E4E7EC |
| Border radius | 8px |
| Shadow | `0 4px 16px rgba(16, 24, 40, .08)` |
| Padding | 4px |
| z-index | 200 |
| Row | 8px×12px padding, 6px radius, Outfit 14/500, color #344054 |
| Row hover | bg #F2F4F7, color #101828 |
| Row active (current selection) | bg #F2F4F7, color #101828 |

### Behavior

- Click trigger toggles the menu open/closed.
- Click a row: applies the selection and closes the menu.
- Outside-click closes the menu.
- Escape closes the menu.
- Mobile (`<768px`): trigger fills row width.

---

## Status badges & domain tags

*Relocated from Part 3 by the "UI_RULES Parts 2–5 condense" PR — these are
project-specific overrides, so they belong in Part 6. Search history for
`.card-status-badge` / `.card-domain-tag` may point at the old Part 3 home.*

### Shared badge primitive

All card-level status badges use `.card-status-badge` with variants:
- `.is-critical` — red (`#F04438` / `#FEF3F2`)
- `.is-warning` — amber (`#F79009` / `#FFFAEB`)
- `.is-healthy` — green (`#12B76A` / `#ECFDF3`)
- `.is-neutral` — gray (`#667085` / `#F2F4F7`)

### `.is-pressure` — Under Pressure (project overlay)
- Background: `#FEF3E2`
- Text: `#DC6803`
- Dark bg: `rgba(220, 104, 3, 0.15)`
- Dark text: `#FDB022`
- Used exclusively on: CashTrendHero status badge when status = 'pressure'
- This is the only case that uses project pressure orange instead of the
  standard amber `.is-warning`. Do not reach for it for generic warnings.

Badge spec (matches shipped `.card-status-badge` in `src/dashboard.css`):

```
display: inline-flex;
align-items: center;
gap: 4px;
padding: 4px 10px;
border-radius: 999px;
font-size: 12px;       /* the size .card-status-badge already uses — do not introduce a new one */
font-weight: 500;
white-space: nowrap;
flex-shrink: 0;
```

> The shipped base sets `inline-flex` (auto-width, single-line via
> `white-space: nowrap`), so it does not set `justify-content`; centering
> is moot for nowrap label content. TailAdmin's pill/badge utilities are
> the visual source of inspiration, but the canonical implementation in
> this repo is the `.card-status-badge` CSS class and its `.is-*`
> variants — never Tailwind utility strings in JSX, and never a new
> parallel pill-prefixed CSS namespace.

### Status pill labels

`.card-status-badge` is a **label-visible pill framework**: the visible
text label carries the precise state, and color collapses six labels
onto the existing three color bands (plus neutral gray). No per-label
`.is-*` modifier is needed — reuse the variants above:

| Label          | Variant       | Band            | Bg / Text             |
|----------------|---------------|-----------------|-----------------------|
| Critical       | `.is-critical`| red             | `#FEF3F2` / `#F04438` |
| Vulnerable     | `.is-warning` | warning / amber | `#FFFAEB` / `#F79009` |
| Below target   | `.is-warning` | warning / amber | `#FFFAEB` / `#F79009` |
| Nearly funded  | `.is-neutral` | neutral gray    | `#F2F4F7` / `#667085` |
| Fully funded   | `.is-healthy` | success green   | `#ECFDF3` / `#12B76A` |
| Above target   | `.is-healthy` | success green   | `#ECFDF3` / `#12B76A` |

> This is a label-visible pill framework. Vulnerable/Below target share
> warning styling, and Funded/Above target share success styling; labels
> and thresholds distinguish them. If a future visualization has no
> visible label, collapse to critical / warning / healthy / neutral
> instead of trying to encode all six states by color alone.

Never create a new *status* badge pattern — reuse `.card-status-badge`.
The only sanctioned non-status pill is `.card-domain-tag`, defined below.

### `.card-domain-tag` — domain tag (distinct primitive)

A domain tag answers "*which area?*", not "*what state?*". The visible
label is a **domain** (Reserve, Cash Flow, Expenses, Revenue, Owner
Draws, On Track); the `.is-*` variant **tints** it by severity using
the same three bands as `.card-status-badge`. It is the only pill where
the label is NOT a status string — the color carries severity, the
label carries domain.

- Used by: `SecondaryPriority` (Today secondary cards).
- **No glyph.** The universal ↓/✓ glyph rule applies to status pills
  only; domain tags are explicitly exempt.
- Variants (same hex pairs as `.card-status-badge` — no new colors):

| Variant        | Band            | Bg / Text             |
|----------------|-----------------|-----------------------|
| `.is-critical` | red             | `#FEF3F2` / `#F04438` |
| `.is-warning`  | warning / amber | `#FFFAEB` / `#F79009` |
| `.is-healthy`  | success green   | `#ECFDF3` / `#12B76A` |

Base spec (matches shipped `.card-domain-tag` in `src/dashboard.css` —
intentionally distinct from `.card-status-badge`, not a drifted copy):

```
display: inline-flex;
align-items: center;
gap: 6px;
padding: 4px 10px;
border-radius: 999px;
font-size: 12px;
font-weight: 500;
line-height: 1;
```

Reconcile exactly with `src/dashboard.css`. Never encode the domain in
color alone — the label is load-bearing.

---

## Icon implementation pattern

All icon SVGs in this project use `stroke="currentColor"` (not hardcoded hex). Color is
driven by a CSS class on the icon container — this centralizes color in CSS and lets status
modifier classes propagate color without JSX conditionals.

```tsx
// Correct — color set by CSS class
<span className="metric-card__icon">
  <MyIcon />  {/* SVG uses stroke="currentColor" or fill="currentColor" */}
</span>
```

```css
/* Color lives in CSS */
.metric-card__icon { color: #637AEA; }  /* brand-400 */
```

**TailAdmin deviation:** TailAdmin's own SVG components sometimes hardcode `stroke="#xxxxxx"` as
an SVG attribute. This project deliberately overrides that pattern. When copying TailAdmin SVGs,
replace any hardcoded `stroke` or `fill` hex attrs with `currentColor`.

---

## Sparkline canonical config

Standard sparkline pattern for all inline chart components (revenue-card, future KPI cards with
trend line).

```ts
// Series
const SPARKLINE_SERIES = [{ data: [...numbers] }];

// Options
const SPARKLINE_OPTIONS: ApexCharts.ApexOptions = {
  chart: {
    type: 'area',
    sparkline: { enabled: true },  // hides axes, grid, labels — sparkline mode
    fontFamily: 'Outfit, sans-serif',
    toolbar: { show: false },
  },
  stroke: { curve: 'smooth', width: 1 },
  fill: {
    type: 'gradient',
    gradient: {
      opacityFrom: 0.45,  // top opacity
      opacityTo: 0,       // bottom opacity (transparent)
    },
  },
  // All suppressed in sparkline mode — no explicit config needed:
  // grid, legend, xaxis, yaxis, markers, dataLabels, tooltip
};
```

**Token values for the revenue-card sparkline:**
- Stroke color: `#12B76A` (success accent) — 1px
- Gradient top opacity: 0.45 — bottom: 0 (transparent)
- Dimensions: 99×70px (set on `<ReactApexChart width={99} height={70} />`)

**Rules:**
- `chart.sparkline.enabled = true` suppresses all axes, grid, legend, markers automatically.
  Do not add explicit `grid: { show: false }` or `xaxis: { show: false }` — they are redundant.
- Use `curve: 'smooth'` — TailAdmin sparklines always use smooth curves.
- Use `stroke.width: 1` — sparkline strokes are thin; wider values look heavy at 70px height.
- Sparkline fixtures (series + options) live as module-scope `const` in the component file.
  Lift to a shared lib only when a second sparkline-bearing card needs the same config.

---

## Canonical card shells

Three canonical shells. Classes are locked references — do not modify without explicit instruction.

| Shell class | Radius | Border | Padding |
|-------------|--------|--------|---------|
| `.metric-card` | 16px | 1px `#E4E7EC` | 20px |
| `.revenue-card` | 12px | none | 20px |
| `.statistics-card` | 16px | 1px `#E4E7EC` | 24px |

All three are in `src/dashboard.css`. Their UI Lab canonical variants live in `src/pages/UILab.tsx`.

---

This section contains project-specific rules that override or extend the TailAdmin base.
All rules in Parts 1–5 apply unless explicitly superseded here.

Replace this section's content for each project that uses this base spec.

**Typical overlay entries to define per project:**
- Font override (e.g. Inter instead of Outfit)
- CSS architecture (Tailwind in JSX vs custom CSS class system)
- Routing library version constraints
- Icon source path
- Typography size overrides (e.g. KPI value size)
- Domain-specific color semantics (e.g. financial positive/negative)
- Any additional card or layout patterns beyond the TailAdmin base
- **Legend row alignment override** — TailAdmin base is left-aligned (`flex items-center gap-6`). If a specific card requires a centered or right-aligned legend, declare it here by card name: e.g. "RevenueComparisonCard legend row: `flex items-center justify-center gap-6`". Any legend not listed here must follow the base left-aligned rule.
- **Card overflow override** — TailAdmin base cards use default overflow (hidden). If a card contains a dropdown that must escape the card boundary, declare it here: e.g. "OwnerDistributionsChart `.owner-dist-card`: `overflow: visible` — required to allow the compare-year dropdown panel to escape the card boundary. Do not revert."

---

## Tooltip Standard

All ApexCharts tooltips in this project must follow this standard.

### Approved pattern
- `theme: 'light'` on every chart tooltip config
- `y.formatter`: import `formatTooltipY` from
  `src/lib/utils/formatCompact.ts`
- `x.formatter`: use raw category string or import
  `formatTooltipX` for passthrough
- Visual styling: handled by the shared CSS block in
  `dashboard.css` — do not add per-chart tooltip CSS
  unless it intentionally overrides the standard
- Per-chart overrides must include a comment explaining
  why they differ

### Forbidden patterns
- `custom` HTML formatter — breaks visual consistency
  and bypasses the shared CSS standard
- Inline tooltip CSS that duplicates the shared block
- Reimplementing currency formatting inline —
  always import `formatTooltipY`

### Pie/donut exception

Pie/donut charts may use a custom ApexCharts tooltip renderer when
the standard tooltip pattern produces multi-series stacking or
incorrect slice behavior. The custom renderer must visually match
the dashboard tooltip standard (typography, colors, border, radius,
shadow, spacing). This exception is narrowly scoped — it does not
authorize custom tooltips on Cartesian charts (line, bar, area, column).

### Current exceptions
The two sanctioned custom-tooltip exceptions (TopCategoriesCard donut,
OwnerDistributionsChart Total row) are described in full — with the rationale
for each — in **Part 4 — Tooltips (ApexCharts)**.

---

## Chart Token File

All hex color values used in ApexCharts configurations must be imported from
src/lib/ui/chartTokens.ts. This is the single source of truth for chart colors.
No chart component may re-type a hex value inline in its options object.

If src/lib/ui/chartTokens.ts does not yet exist, it must be created in a
separate, dedicated commit before any new chart component is written. Do not
create it as part of a documentation patch.

Example structure:
  export const chartTokens = {
    brand:           '#465FFF',
    brandSecondary:  '#9CB9FF',
    brand400:        '#637AEA',
    success:              '#12B76A',   // accent: filled badge/icon/sparkline
    successGradientEnd:   '#89DBB5',   // gradient fade end for success sparkline
    successText:          '#039855',   // text on white
    error:           '#F04438',
    warning:         '#F79009',
    pressure:        '#DC6803',
    gridBorder:      '#e0e0e0',   // chart grid lines
    crosshairStroke: '#b6b6b6',   // x-axis crosshair on hover
    axisText:        '#667085',   // standard charts
    axisTextSales:   '#373d3f',   // Sales-family chart-cards
  } as const;

---

## Project semantic colors — extension

The TailAdmin base ships three warm semantic tones (Warning #F79009, Error #F04438).
This project extends the palette with one additional deep-amber tone for the
Cash Trend severity ramp (green → light amber → deep amber → red), which
requires a distinguishable middle step between Treading Water and Burning Cash.

| Purpose | Color | Used by |
|---------|-------|---------|
| Deep amber / pressure | #DC6803 | Cash Trend "Under Pressure" status accent |

Do not reuse #DC6803 for unrelated UI. The token's purpose is the four-level
severity ramp on the Cash Trend hero only.

---

## Cash Trend Card

### Status accent system
Cash Trend uses a CSS custom property `--cth-accent` set per status modifier
class on the card root. Child elements that need status color inherit via
`color: var(--cth-accent)`. This avoids per-element status conditionals in JSX.

| Modifier class | --cth-accent | Status |
|----------------|--------------|--------|
| `.cth-card--building` | `#12B76A` | Building Cash |
| `.cth-card--treading` | `#F79009` | Treading Water |
| `.cth-card--pressure` | `#DC6803` | Under Pressure |
| `.cth-card--burning`  | `#F04438` | Burning Cash |

### Compact trend sparkline (right column)
Bottom-right of the card, a 160×70 ApexCharts area sparkline plots a
**straight two-point result line** from a `$0` baseline to the 6-month
cumulative profit margin (`t6mMargin`). The slope direction follows the
sign of the margin: a meaningfully positive margin slopes up, a
meaningfully negative one slopes down, and a near-zero margin (below
the display rounding cutoff) renders flat. No bar chart, no full-width
chart, no axes, gridlines, labels, markers, or tooltip. No visible
eyebrow label; the chart container carries the accessible name instead.

**Why a straight result line, not a multi-point trajectory.** This card
is *Cash Trend* — the visual must reinforce the headline number, not
introduce an independent second signal. Earlier iterations tried both
a linear best-fit of the monthly net-cash values (the chart trended
down while `t6mNetCash` was positive) and a 7-point cumulative trajectory
(still read as a multi-turn sparkline). The straight result line is the
narrowest visual that answers the only question the card needs to
answer: *did the 6-month period finish net up or net down?* The
neighboring Monthly Net Cash Flow card already shows the raw
month-by-month shape with full chrome — repeating it here in 160×70
adds noise, not signal.

**Why margin (percent), not dollars.** The supporting line directly
under the hero amount reads "6-month cumulative profit margin: +X.X%".
Plotting the line to `t6mMargin` instead of `t6mNetCash` keeps the
sparkline directly tied to the labeled percentage the owner is reading.
For the sign question this card answers, dollars and margin always
agree (`sign(t6mNetCash) === sign(t6mMargin)`); the choice is a
labeling/readability call, not a math one.

**Three-color rule (tied to the hero).** Color follows the same sign
test that drives slope direction:
- Brand blue (`chartTokens.brand`, `#465FFF`) when `t6mMargin > 0`.
- Error red (`chartTokens.error`, `#F04438`) when `t6mMargin < 0`.
- Neutral grey (`chartTokens.neutral`, `#98A2B3`) when
  `|t6mMargin| < 0.0005` (matches `formatSignedPct`'s `"0.0%"` cutoff).
- Never green; the pill carries "good" / "healthy" already.
- ApexCharts options must read hex from `chartTokens.ts` — chart
  internals can't resolve CSS custom properties.

The earlier slope-based color rule (red when monthly best-fit slope ≤
−$1,500/mo) was intentionally dropped with the move to a straight
result line. With the chart now carrying a single signal, having color
encode a *different* signal than slope direction re-introduces the
dual-narrative confusion the redesign removed. The pill carries the
nuance (Treading / Pressure / Burning) when monthly cash flow is
deteriorating in spite of a positive period.

**Area fill — Apex-native, line-anchored.** Apex draws the area below
the line and fades it via a gradient (`opacityFrom: 0.6 → opacityTo: 0`,
same hue as the stroke). Two settings make this work with the padded
y-axis:
1. **`plotOptions.area.fillTo: 'end'`** — by default Apex anchors the
   area's lower edge to zero (`'origin'`), which with our padded
   y-axis collapses the fill to a thin sliver near the baseline.
   `'end'` anchors the lower edge to the chart canvas bottom (=
   sparkline container bottom = the supporting-metric baseline). The
   fill becomes a proper trapezoid from line down to the baseline.
2. **Apex `fill.gradient`** then fades that trapezoid from line
   (`opacityFrom: 0.6`) to baseline (`opacityTo: 0`).

No CSS background layer behind the chart. A CSS pseudo-element belongs
to the container, not the line, so any tint set on it reads as a
rectangle regardless of stops or opacity. Apex's line-anchored area is
the only shape that gives the TailAdmin "soft area under a line" feel.

**Stroke curve.** `curve: 'straight'` — a two-point line is a straight
segment by construction; any smoothing setting would be a no-op (or
worse, invent a curve through the two points).

**Three-state accessible label (semantic).** The chart container has
an `aria-label` driven by the same sign test as the color rule:
- `t6mMargin > 0` (and not flat): "6-month cash result — net positive"
- `t6mMargin < 0` (and not flat): "6-month cash result — net negative"
- `|t6mMargin| < 0.0005`: "6-month cash result — net flat"

**Y-axis scaling.** Symmetric around 0 with a **fixed** half-range so
steepness scales with margin magnitude across the realistic gym P&L
range — not with a per-data-point auto-fit, which would flatten the
visual at any margin above the floor.
- `VISUAL_HALF_RANGE = 0.20` (±20 percentage points). Picked to cover
  razor-thin (0–5%), healthy (5–15%), and strong (15–25%) margins
  without clipping at the high end of the typical range.
- `chartMin = −VISUAL_HALF_RANGE × 1.15`,
  `chartMax = +VISUAL_HALF_RANGE × 1.15` (15% padding keeps the line
  off the container edges even at the domain edge).
- **Plotted endpoint is clamped** to `[−VISUAL_HALF_RANGE,
  +VISUAL_HALF_RANGE]` so margins outside the domain (e.g. +30%) hit
  the visual edge without overshooting. The aria-label still describes
  the true sign — only the visual maxes out.
- Resulting line positions: +2% ends at 10% above center; +8.1% at
  40.5%; +15% at 75%; +20% at 100% of the half-range (the domain
  edge); +30% clamps to 100%.

**Card layout.** `.cth-card` is a 2-column CSS grid (`minmax(0, 1fr) auto`).
Row 1: title block (col 1) + pill (col 2). Row 2: metric block (col 1,
`align-self: end`) + sparkline (col 2, `align-self: end + justify-self:
end`). Row 3: verdict, spans both columns. The sparkline's bottom lines
up with the supporting-metric line's bottom by virtue of both grid
items sharing row 2 and bottom-aligning — no absolute positioning, no
hard-coded offsets.

**Responsive.** `.cth-card` declares `container-type: inline-size`. When
the card is narrower than 380px (`@container (max-width: 380px)`), the
sparkline hides (`display: none`) so it can't collide with text. Pill
remains in the right column; metric and verdict reflow naturally.

**Edge cases.**
- Fewer than 6 monthly bars: the sparkline is hidden by the
  `showTrendLine` gate (`result.monthlyBars.length >= 6`); the rest of
  the card renders normally.
- Card narrower than 380px: the sparkline is hidden via container query;
  the rest of the card renders normally.
- `t6mMargin` outside `[−0.20, +0.20]`: clamped at the visual edge.
  The line still finishes at the top or bottom of the half-range,
  visually identical to any other margin past the edge — but the
  hero amount + supporting margin line carry the true magnitude.
- `t6mMargin` exactly at the near-zero band (`|m| < 0.0005`): flat
  line at center, neutral grey, "net flat" aria-label. Matches the
  `"0.0%"` display rounding so the chart and the supporting line agree.

### Operating cash definition
Cash Trend's T6M metrics are computed from `computeMonthlyRollups('operating')`.
This excludes: transfers, owner draws/distributions, capital distributions,
loan principal. This makes T6M margin appear higher than a P&L that includes
owner draws. This is intentional — Cash Trend measures what the business
produces operationally, not what the owner takes.

### Cash Trend diagnostic harness
`computeCashTrendForDate(rollups, referenceDate)` — exported named function
for backtesting against any month. Always use local-time date constructor
`new Date(y, m, 1)` — never ISO string `new Date('YYYY-MM-DD')`, which
parses as UTC midnight and shifts the window one month early in US timezones.

### Cash Trend thresholds
- Building Cash: T6M Margin ≥ 10% AND neg months ≤ 2
- Burning Cash: T6M Margin ≤ -1.5% AND neg months ≥ 3
- Under Pressure: margin between -1.5% and +5% AND neg months ≥ 3
- Treading Water: everything else
- Target margin: 10% (hardcoded — TODO: surface in workspace settings)
- Hysteresis: stateless two-window comparison, 1.5pp buffer
- Velocity: current T6M margin − prior T6M margin, ±2pp threshold

---

## Data Table Pattern (Projection Table V2)

Canonical visual spec for dense financial data tables in this project. The shipped Forecast Projection Table V2 (`src/components/ProjectionTableV2.tsx`, styled in `src/dashboard.css`) is the reference implementation — every value below matches what currently ships. Reuse this pattern for any new tabular data view (transaction lists, account ledgers, monthly rollups, etc.).

### Purpose

Use this pattern when the table is the primary content of its card — header, rows, and any totals share a single typographic rhythm and divider system. Do not use for narrative cards, KPI cards, or mixed-content cards.

### Card / table width

- Table must be `width: 100%`
- Never `width: 90%`, `auto`, or content-sized for this pattern
- Visual containment comes from **cell padding and column rhythm**, not from shrinking the table

### Card shell

- Background: `var(--bg-panel)` / white
- Border: `1px solid var(--line)`
- Border radius: `16px`
- Padding: `24px`

### Header / title row

- Title:
  - `font-size: 1.06rem`
  - `font-weight: 700`
  - `color: #1D2939` (card title — see §6 Card title roles)
- Right-side controls (Compare toggle, Export CSV, etc.) align with the title row and remain outside the table itself
- Segmented toggles follow the standard pattern (`.projection-compare-toggle*` — see "Segmented toggle (standard pattern)" above)

### Table header band

- Background fill: `#F9FAFB` (Tailwind `gray-50`) — bookends the table with the total row, which uses the same fill
- Header cells:
  - `padding: 12px 16px`
  - `font-size: 14px`
  - `font-weight: 600`
  - `color: var(--text-primary)` / `#1D2939`
  - `white-space: nowrap`
  - `text-transform: none`, `letter-spacing: normal` (title-case, not uppercase)
  - `border-top: 1px solid var(--bg-muted)` and `border-bottom: 1px solid var(--bg-muted)`
- Header label padding matches body cell padding (`12px 16px`) so titles sit flush-left over their column data

### Body cells

- `padding: 12px 16px`
- `border-bottom: 1px solid var(--bg-muted)`
- Drop the bottom border on the last body row (or let a `<tfoot>` top border take over when present)

### Total row

- Background: `#F9FAFB` (Tailwind `gray-50`) — same fill as the header band so the table is bookended top and bottom
- Top divider: `border-top: 1px solid var(--line)` (slightly heavier than the `--bg-muted` body dividers — anchors the row visually)
- Cell borders: `border-top: none; border-bottom: none` on tfoot cells so the row reads as a single band
- `font-weight: 600`
- Same `12px 16px` cell padding as body rows
- **Trailing-cell rule:** when no aggregation applies to the trailing column (e.g., per-month "Cumulative Net" or "Balance"), render the cell as **blank** (`<td />`). Do not insert an `&mdash;` or any other placeholder unless explicitly designed and verified — a centered placeholder will misalign with right- or left-aligned values above it.
- **Comparison-mode placeholder exception:** in comparison-mode Change and `%` cells where the prior-year value is `0` or undefined (so the diff or ratio is mathematically meaningless), render `&mdash;` instead of leaving the cell blank or printing `NaN`/`Infinity`. The em-dash signals "no comparison available," not "no value." This is the only context where `&mdash;` is permitted; the blank-trailing-cell rule above still governs simple-mode total cells.

### Alignment rules

All columns are **left-aligned** — headers, body cells, and total cells all `text-align: left`. This is the universal default; **UI Lab cards are the source of truth for alignment**, and they ship left-aligned (the Projection Table V2 simple-mode `.ui-lab-projection-table-shell` scope is the reference).

Right-aligned numeric ("financial-table convention") is **not used** in this project.

**Forbidden:** mixing left-aligned headers with right-aligned values, or vice versa. The header label must sit directly above its values — left-aligned on both.

When implementing a new table, scope the alignment override (and any width/typography rules) via a component-specific class on the wrapper (e.g., `.ui-lab-projection-table-shell` for the V2 simple mode, `.rollups-table-card` for Monthly Rollups). The shared `.table-card td:nth-child(n+2)` rule right-aligns from the second column on; any new table must override this via a scoped left-align rule. Do not modify the shared `.table-card` rules — they govern unrelated surfaces.

### Negative number format

- Negative currency must render with a **leading minus sign before the dollar sign**:
  - `-$4,118` ✓
- Forbidden:
  - `$-4,118`
  - `($4,118)` / accountant-style parentheses
  - Red-only / color-only with no minus sign (color cannot carry the sign — fails accessibility and copy/paste)
- Use `formatCurrency(value)` (locale `undefined` resolving to en-US in this project) — `toLocaleString` with `style: 'currency'` already produces the correct format
- CSV export must preserve the sign (`(-4118).toFixed(2)` → `-4118.00`)

### Mobile behavior

- A scroll wrapper (e.g., `.projection-table-scroll`) provides `overflow-x: auto` for horizontal scroll
- On narrow viewports the table can grow beyond the card width; `min-width: 100%` keeps it from shrinking below the container
- Do not compress numeric columns until values become unreadable
- Do not use mobile-specific column hiding without an explicit decision

### Anti-patterns / lessons learned

- ❌ Do not shrink the table to create visual breathing room (`width: 90%`, `auto`, or content-sized) — use cell padding instead
- ❌ Do not solve edge-stretching by reducing table width — the symptom is a "floating mini-table" feel; the fix is always cell padding + column rhythm
- ❌ Do not rely on the shared `.table-card` baseline rules for new table variants — `.table-card th` uppercases header text (0.78rem, letter-spacing 0.04em) and the `.table-card td:nth-child(n+2)` rule right-aligns from the second column on. The first will fight title-case headers; the second will fight any left-aligned scheme. Override or scope.
- ✅ Scope new table variants by a component-specific class on the wrapper (e.g., `.ui-lab-projection-table-shell`, `.rollups-table-card`) — keeps rules from bleeding into siblings

### Reference implementations

- Forecast Projection Table V2 (left-aligned simple mode): `src/components/ProjectionTableV2.tsx` — table-only; card shell, title, Compare toggle, and Export CSV live in `src/pages/Dashboard.tsx`. CSS: `.projection-table-card`, `.projection-table`, `.ui-lab-projection-table-shell`.
- Trends Monthly Rollups (left-aligned): inline in `src/pages/Dashboard.tsx` ("Monthly Rollups" section). CSS: `.rollups-table-card`, `.rollups-table`.

---

# PART 6B — CARD COHERENCE RULE

All numbers shown within a single card (badge, tooltip, subtitle, chart axes,
KPI value) must be reconcilable by the user without external explanation.

Rules:
- If two elements in the same card can be derived from each other, they must
  use the same time basis and the same calculation method
- If two elements intentionally use different bases (e.g. YTD vs trailing),
  each must be explicitly labeled — never leave the user to guess
- Never display conflicting interpretations of the same metric in one card

**Why this exists:** A badge saying "12% of target" and a chart showing
calendar-year bars creates an implicit contradiction if the badge uses
trailing 12 months. The user sees two numbers about the same thing that
don't reconcile. This breaks trust faster than any visual defect.

Time window consistency is a specific application of this rule: every
card must use a single, explicitly-labeled time basis (YTD, trailing-N,
calendar period). Cards mixing bases must label each element.

---

# PART 7 — DECISION RULES

These three sections close the gap between knowing the patterns and applying them correctly.
They answer the questions that cause drift when left to individual judgment.

---

## 7A — Card Header Decision System

Before writing any card or chart component, run this decision tree top to bottom.
Stop at the first rule that matches. Use that pattern — do not invent a hybrid.

```
Does the chart have multiple data series that need labels?
  YES → Pattern C (custom legend row required, regardless of other conditions)
  NO  ↓

Are there key metrics that belong to the chart and must read alongside it?
  YES → Pattern H (metrics row between header and chart)
  NO  ↓

Is there a subtitle (context text below the title)?
  YES → Pattern B (title + subtitle, right column for controls)
  NO  ↓

Is there an action menu or overflow control?
  YES → Pattern A (title + MoreDot only)
  NO  → Pattern A with no right control (title only, still flex justify-between)
```

**Combination rules:**
- Pattern B + status badge in right column: allowed (badge goes in RIGHT, not in title stack)
- Pattern B + ChartTab in right column: allowed
- Pattern B + both ChartTab and status badge: allowed (ChartTab first, badge second, gap-3)
- Pattern C always starts from Pattern B — it adds a legend row, it does not replace the header block
- Pattern H always starts from Pattern B — it adds a metrics row, it does not replace the header block
- **Patterns A and B cannot be mixed** — a card either has a subtitle or it does not
- **Never add a subtitle to Pattern A after the fact** — if a subtitle is needed, rebuild as Pattern B

---

## 7B — Text Role Hierarchy

Every visible text element in a card has a semantic role. The role determines placement, size,
weight, and color. When in doubt about where text goes, identify its role first.

| Role | Semantic meaning | Size / weight | Color | Position |
|------|-----------------|---------------|-------|----------|
| **Title** | WHAT this card shows — the name of the metric, chart, or section | text-lg / font-semibold | gray-800 (#1D2939) | Top-left of header |
| **Subtitle** | CONTEXT — timeframe, target, data source, or qualifying description | text-theme-sm / font-normal | gray-500 | mt-1 directly below title |
| **Legend label** | SERIES — the name of a data series in a multi-series chart | text-theme-sm / font-normal | gray-500 | Legend row, next to color dot |
| **Badge** | STATUS — a signal or evaluation (above/below target, on track, at risk) | text-theme-xs / font-medium | semantic color | Header-right column only |
| **Action** | NEXT STEP — a user-invokable behavior (compare, view all, export) | text-theme-sm / font-medium | brand-500 | Below chart, or header-right |
| **KPI label** | METRIC NAME — the label above or below a standalone metric value | text-sm / font-normal | gray-700 (#344054) | Above or below value in KPI card |
| **KPI value** | THE NUMBER — the primary data point | text-title-sm or larger / font-bold | gray-800 | Dominant position in KPI card |
| **Delta** | CHANGE — direction and magnitude vs a comparison period | text-sm / font-medium | success/error semantic | Inline with or below KPI value |
| **Context** | COMPARISON BASIS — "Vs last month", "From last month" | text-theme-xs / font-normal | gray-500 | Below delta in KPI card |

**Rules that follow from this:**

- A subtitle is never a legend. If text names a data series, it is a legend label and belongs in a legend row with a color dot — not in the subtitle slot.
- A badge is never a title modifier. "Below target" is a status badge, not an addition to the title text.
- An action link is never a subtitle. "Compare 2026 to a past year" is an action — it goes below the chart (Pattern G text action) or in header-right, not at mt-1 below the title.
- A legend label is never a subtitle. "Actual vs Forecast" in the subtitle slot is wrong. Legend labels belong in the legend row.
- Multiple roles in the same visual position is always wrong. Each position holds exactly one role.

---

## 7C — Header Alignment Rules

These rules lock the left/right column contract for all card headers.
They specify what is allowed in each zone and what happens in edge cases.

### Left column rules
- Contains: title (required) + subtitle (optional)
- Never contains: badges, action links, legend items, controls of any kind
- When subtitle is absent: title sits alone, no extra margin added below it
- When subtitle is present: subtitle sits at mt-1 (4px) below title, no other elements between them
- Width: `w-full` on mobile, natural width on sm+ when right column is present

### Right column rules
- Contains: controls only — ChartTab, date picker, status badge, MoreDot dropdown
- Never contains: title text, subtitle text, legend items, large explanatory copy
- Alignment: `flex items-center gap-3 sm:justify-end`
- When empty (no controls): omit the right column entirely, do not render an empty flex container
- When only a MoreDot is present: `div.relative.inline-block` wrapping the button (Pattern A)
- When ChartTab + badge coexist: ChartTab first, badge second, gap-3 between them

### Legend row rules
- Lives inside an **anonymous block wrapper** (child[1] of the card) alongside the chart container — NOT as a direct sibling of the header-block at the card level
- The anonymous wrapper has no class and is `display: block` — both legend and chart stretch to full content width naturally
- **TailAdmin base alignment: left-aligned** — `flex items-center gap-5` on the legend container, no justify-center, no justify-end
- Left edge of legend dots aligns exactly with left edge of title and subtitle (all share card `padding-left` origin)
- Spacing: subtitle→legend and legend→chart gaps follow Pattern C — the single source for those values; do not restate or diverge here
- Legend container must be **full content width** — never `inline-flex`, never `width: fit-content`
- Each item: `flex items-center gap-1.5` — dot (10×10px rounded-full) + label (text-sm text-gray-500)
- Right-aligned or centered legend rows are **not TailAdmin-native** — any project that needs them must declare this explicitly in Part 6 as a named overlay deviation
- When a chart has no multiple series: no legend row — do not add one for decoration

### When controls are absent
- Pattern A: header is `flex items-center justify-between` — MoreDot on the right
- If there is truly no right-side element: use `flex items-center` without justify-between
- Do not add an empty div to preserve spacing on the right

### When subtitle is absent in Pattern B context
- Pattern B without subtitle collapses to Pattern A behavior — just title + right controls
- Do not leave an empty `p` element where the subtitle would go

---

# PART 8 — HARD RULES & CHECKLIST

---

## What Is Absolute vs. Contextual

The constraints below are calibrated to the actual TailAdmin source — not stricter.

**Absolute (no exceptions in source):**
- No box-shadow on standard cards or panels (Pattern F inner section is the only documented exception)
- No radius values outside the system table
- No font sizes outside the type scale
- Apex built-in legend and custom JSX legend never combined on the same chart
- `toolbar.show: false` on every ApexCharts chart
- `chart.fontFamily` set on every ApexCharts chart
- Every component has dark mode variants

**Contextual (follow the pattern, not a blanket prohibition):**
- Inline SVGs: acceptable for non-icon graphics (brand logos, GridShape decorative elements)
- Shadows: acceptable on interactive controls (inputs, buttons, active pills) and Pattern F
- Direct class combinations in JSX: acceptable when no appropriate primitive exists

---

## Pre-Commit Checklist

**Tokens**
- [ ] All colors from Part 1
- [ ] All border-radius from Part 1 radius table
- [ ] Font sizes map to named type scale roles
- [ ] No box-shadow on card or panel (Pattern F inner section only exception)
- [ ] Dark mode variants on every element

**Decision Rules (Part 7)**
- [ ] Card header pattern selected by running the 7A decision tree — not by preference
- [ ] Every text element's semantic role identified against the 7B hierarchy table
- [ ] No subtitle used as a legend, action link, or badge substitute
- [ ] No legend label placed in the subtitle slot
- [ ] Left column contains only title + optional subtitle
- [ ] Right column contains only controls — no text, no legends
- [ ] Legend row (if present) is left-aligned, separate from header-block and chart-wrapper
- [ ] Empty right column omitted entirely — no placeholder div

**Structure**
- [ ] Source pattern confirmed against Lookup Table in Part 4
- [ ] Title, subtitle, legend, badge, and controls in positions matching the chosen pattern
- [ ] Legend (if present) is custom JSX below header-block, not inside it
- [ ] `legend.show: false` set in ApexOptions when custom JSX legend is used
- [ ] `toolbar.show: false` and `chart.fontFamily` set on every chart
- [ ] Chart wrapper uses `overflow-x-auto`
- [ ] Spacing matches Card Spacing Reference in Part 4

**Shell & Primitives**
- [ ] Nav items use `menu-item`, `menu-item-active`, `menu-item-inactive` utilities
- [ ] Submenu items use `menu-dropdown-item` utilities
- [ ] Dropdown triggers have `dropdown-toggle` class
- [ ] Modals use `useModal()` hook
- [ ] `PageBreadcrumb` is first element in every AppLayout page

**Project Overlay**
- [ ] All rules from Part 6 applied

---

## Component Spec: Efficiency Opportunities Card

### Card shell
- Class: `ta-card` — `border: 1px solid #E4E7EC`, `border-radius: 16px`, `background: #FFFFFF`, `padding: 24px`
- Width: half-page on desktop (2-column grid), full width on mobile

### Header (Pattern B)
- Title: 18px, font-weight 600, color `#1D2939`
- Subtitle: 14px, font-weight 400, color `#667085`, margin-top 4px

### Headline strip
- Background: `#F2F4F7`, border-radius 12px, padding `14px 20px`
- Layout: flex row, `align-items: baseline`, gap 10px, flex-wrap
- Amount: 30px, font-weight 700, color `#1D2939` (KPI value — matches TailAdmin CRM top-strip hero render)
- Label: 13px, font-weight 400, color `#667085`

### Column headers
- Grid: `1fr 70px 70px 140px`
- Font: 12px, font-weight 500, color `#667085`, uppercase, letter-spacing 0.04em
- Bottom border: `1px solid #E4E7EC`
- Alignment: Category left · Your best center · Today center · Extra/mo right
- "mo" in "Extra/mo" rendered via nested span with `text-transform: none`

### Rows
- Same 4-column grid: `1fr 70px 70px 140px`
- Padding: 12px top and bottom
- Row separator: `1px solid #E4E7EC` (last row: none)

**Col 1 — Category**
- Name: 14px, font-weight 600, color `#101828`, ellipsis on overflow
- Anchor label: 12px, font-weight 400, color `#667085`

**Col 2 — Your best %**
- 14px, font-weight 700, color `#667085` (muted), center-aligned

**Col 3 — Today %**
- 14px, font-weight 700, color `#1D2939` (stronger), center-aligned

**Col 4 — Extra/mo**
- Amount: Outfit, 18px, font-weight 600, line-height 28px, color `#1D2939`, right-aligned
- Bar: below amount, full column width, max-width 130px, height 8px, border-radius 4px
  - Track: `#F2F4F7`
  - Green segment (left — your best): `${100 - barFill}%` wide, color `#74D3AE`
  - Red segment (right — extra cost): `${barFill}%` wide, color `#F87171`
  - barFill = (today% - best%) / today% × 100, clamped 0–100

### Footnote
- 12px, font-weight 400, color `#667085`, line-height 1.6
- Top border: `1px solid #E4E7EC`, padding-top 12px, margin-top 16px
