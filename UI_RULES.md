# UI_RULES.md
# TailAdmin Free React — Complete Visual & Structural Standard
# Sourced directly from free-react-tailwind-admin-dashboard-main
# Single source of truth for tokens, anatomy, patterns, and page compositions.

---

## How to Use This File

**Part 1 — Tokens** — colors, type, spacing, radius, shadows, sizing.
**Part 2 — Shell** — app layout, sidebar, header, backdrop.
**Part 3 — Primitives** — every component with exact prop contracts and DOM anatomy.
**Part 4 — Card & Chart Patterns** — card headers, chart anatomy, legends, KPI cards.
**Part 5 — Page Compositions** — how pages assemble primitives and cards.
**Part 6 — Project Overlay** — project-specific rules that override or extend this base.
**Part 7 — Hard Rules & Checklist** — constraints and pre-commit gate.

Token drift and structure drift are equally harmful. Both are prevented here.

> This file documents TailAdmin-native patterns only in Parts 1–5.
> All project-specific overrides belong in Part 6 only.

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
| Chart grid lines | #EAECF0 |
| Divider (inside dropdowns, rows) | #F2F4F7 |

> Chart grid (#EAECF0) is intentionally lighter than default border (#E4E7EC). Never swap.

### Text
| Role | Hex |
|------|-----|
| Primary | #1D2939 (gray-800) |
| Primary strong | #101828 (gray-900) |
| Secondary / labels | #667085 (gray-500) |
| Muted / metadata | #98A2B3 (gray-400) |
| Inverse (on dark bg) | white/90 |

### Brand
| Role | Hex |
|------|-----|
| Primary action | #465FFF |
| Hover | #3641F5 |
| Pressed | #2A31D8 |
| Disabled | #9CB9FF |
| Soft active bg | #ECF3FF |
| Focus ring | brand-500/20 (rgba overlay) |

### Semantic
| Purpose | Color | Soft bg |
|---------|-------|---------|
| Success | #12B76A | #ECFDF3 |
| Error | #F04438 | #FEF3F2 |
| Warning | #F79009 | #FFFAEB |
| Info | #0BA5EC | #F0F9FF |

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

| Token | px | Role |
|-------|----|------|
| text-title-md | 36px | Hero value, page-level KPI |
| text-title-sm | 30px | Large metric value |
| text-2xl | 24px | Modal title (large) |
| text-theme-xl | 20px | Modal title (medium) |
| text-lg | 18px | Card title — always font-semibold |
| text-base | 16px | Body text |
| text-theme-sm / text-sm | 14px | Secondary text, labels, nav items |
| text-theme-xs | 12px | Metadata, helper text, table headers |

---

## Spacing

| Role | Value |
|------|-------|
| Page content wrapper | p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6 |
| Card padding (standard) | p-5 sm:p-6 |
| Card padding (compact KPI) | p-5 md:p-6 |
| Chart card (no bottom pad) | px-5 pt-5 sm:px-6 sm:pt-6 |
| Table card | px-4 pb-3 pt-4 sm:px-6 |
| Section gap | gap-6 or gap-8 |
| Grid gap | gap-4 md:gap-6 |

---

## Border Radius

| Element | Tailwind | px |
|---------|----------|----|
| Cards / panels | rounded-2xl | 16px |
| Dropdowns, notification panel | rounded-2xl | 16px |
| Standalone table wrapper | rounded-xl | 12px |
| Icon containers, alerts | rounded-xl | 12px |
| Inputs, buttons, ChartTab track | rounded-lg | 8px |
| ChartTab active pill, DropdownItems | rounded-md | 6px |
| Modals | rounded-3xl | 24px |
| Badges / pills, avatar | rounded-full | 999px |

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

# PART 2 — SHELL LAYOUT

---

## App Layout
*Source: AppLayout.tsx*

```
div.min-h-screen.xl:flex
├── div
│   ├── AppSidebar (fixed, left)
│   └── Backdrop (mobile only, z-40)
└── div.flex-1 [transition-all duration-300 ease-in-out]
    ├── AppHeader (sticky top, z-99999)
    └── div [p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6]
        └── <Outlet />
```

Main column shift: `lg:ml-[290px]` when expanded, `lg:ml-[90px]` when collapsed.

---

## Sidebar
*Source: AppSidebar.tsx + SidebarContext.tsx*

Fixed left, `h-screen`, `bg-white dark:bg-gray-900`, `border-r border-gray-200`, `px-5`.

**Width states:**
- Expanded: `w-[290px]` — labels visible
- Collapsed: `w-[90px]` — icons only, items lg:justify-center
- Hovered while collapsed: `w-[290px]` temporarily (mouseenter/leave)
- Mobile: `-translate-x-full` hidden, `translate-x-0` open, always 290px wide

**Logo area:** `py-8`. Full logo when expanded/hovered, icon-only when collapsed.

**Section header:** `text-xs uppercase text-gray-400 leading-[20px] mb-4`.
When collapsed: replaced by `HorizontaLDots` icon, centered.

### Nav Item Anatomy
```
button/link.menu-item.group
├── span.menu-item-icon-size   [forces svg to size-6]
├── span.menu-item-text        [hidden when collapsed]
└── ChevronDownIcon.ml-auto   [submenu items only — rotates 180° when open]
```

**CSS utility classes (defined as @utility in index.css):**

| Class | Visual |
|-------|--------|
| menu-item | relative flex items-center w-full gap-3 px-3 py-2 font-medium rounded-lg text-theme-sm |
| menu-item-active | bg-brand-50 text-brand-500 dark:bg-brand-500/[0.12] dark:text-brand-400 |
| menu-item-inactive | text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5 |
| menu-item-icon-active | text-brand-500 dark:text-brand-400 |
| menu-item-icon-inactive | text-gray-500 group-hover:text-gray-700 dark:text-gray-400 |

### Submenu Anatomy
```
div [overflow-hidden, height animated via scrollHeight inline style, transition-all duration-300]
└── ul.mt-2.space-y-1.ml-9
    └── li → Link.menu-dropdown-item
        ├── item name
        └── optional badge span [menu-dropdown-badge, "new"/"pro", rounded-full, text-xs, uppercase]
```

**Submenu item states:**
- Active: `menu-dropdown-item menu-dropdown-item-active` → `bg-brand-50 text-brand-500`
- Inactive: `menu-dropdown-item menu-dropdown-item-inactive` → `text-gray-700 hover:bg-gray-100`

**SidebarWidget (footer promo):**
`mx-auto mb-10 w-full max-w-60 rounded-2xl bg-gray-50 px-4 py-5 text-center dark:bg-white/[0.03]`.
Only renders when expanded/hovered/mobile-open.

---

## Header
*Source: AppHeader.tsx*

`header.sticky.top-0.bg-white.border-gray-200.z-99999.dark:bg-gray-900.lg:border-b`

### Desktop layout
```
header
└── div.flex.grow [lg:flex-row lg:px-6]
    ├── ROW-LEFT [flex items-center gap-2 sm:gap-4 px-3 py-3 border-b lg:border-b-0 lg:py-4 lg:px-0]
    │   ├── Hamburger [w-10 h-10 lg:w-11 lg:h-11 lg:border rounded-lg text-gray-500]
    │   ├── Logo link (mobile only, lg:hidden)
    │   ├── ApplicationMenuToggle (mobile only, 3-dot icon, lg:hidden)
    │   └── Search block (desktop only, hidden lg:block)
    │       └── div.relative
    │           ├── SearchIcon [absolute left-4 pointer-events-none fill-gray-500]
    │           ├── input.h-11 [rounded-lg border border-gray-200 pl-12 pr-14 text-sm
    │           │              xl:w-[430px] shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10]
    │           └── ⌘K pill [absolute right-2.5 rounded-lg border border-gray-200 bg-gray-50
    │                         px-[7px] py-[4.5px] text-xs text-gray-500]
    └── ROW-RIGHT [flex items-center gap-2 2xsm:gap-3 justify-between px-5 py-4 lg:justify-end lg:px-0]
        ├── ThemeToggleButton
        ├── NotificationDropdown
        └── UserDropdown
```

### Mobile layout
ROW-LEFT always visible, separated by border-b: hamburger | centered logo | 3-dot toggle.
ROW-RIGHT: conditionally shown (`flex`/`hidden`) on 3-dot tap. Has `shadow-theme-md` on mobile, `lg:shadow-none`.

**⌘K global listener:** `metaKey/ctrlKey + K` focuses search input.

### NotificationDropdown
Trigger: `h-11 w-11 rounded-full border border-gray-200 bg-white dropdown-toggle`.
Dot badge: `absolute h-2 w-2 rounded-full bg-orange-400` with `animate-ping` ring.
Panel: `rounded-2xl w-[350px] sm:w-[361px] h-[480px] p-3 shadow-theme-lg`.
Interior: title + close button row → scrollable item list (`custom-scrollbar`) → "View All" link button.
Item: `flex gap-3 rounded-lg border-b border-gray-100 px-4.5 py-3 hover:bg-gray-100`.

### UserDropdown
Trigger: `h-11 w-11 rounded-full` avatar + `font-medium text-theme-sm` name + chevron.
Panel: `rounded-2xl w-[260px] p-3 shadow-theme-lg`.
Interior: name/email → `border-b` divider → `ul.flex.flex-col.gap-1` with icon items → sign-out link.
Item: `flex items-center gap-3 px-3 py-2 rounded-lg text-theme-sm hover:bg-gray-100 group`.

---

## Backdrop
*Source: Backdrop.tsx*

`fixed inset-0 z-40 bg-gray-900/50 lg:hidden`. Renders only when `isMobileOpen`. Click → close sidebar.

---

# PART 3 — PRIMITIVES

---

## Badge
*Source: Badge.tsx*

`span.inline-flex.items-center.rounded-full.font-medium.gap-1.px-2.5.py-0.5`

| Prop | Options |
|------|---------|
| variant | light (tinted bg + colored text) · solid (full bg + white text) |
| size | sm → text-theme-xs · md → text-sm |
| color | primary · success · error · warning · info · light · dark |
| startIcon | optional, wrapped in span.mr-1 |
| endIcon | optional, wrapped in span.ml-1 |

Light primary example: `bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400`

---

## Button
*Source: Button.tsx*

`button.inline-flex.items-center.justify-center.gap-2.rounded-lg.transition`

| Variant | Classes |
|---------|---------|
| primary | bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600 disabled:bg-brand-300 |
| outline | bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 |

Sizes: sm = `px-4 py-3`, md = `px-5 py-3.5`. Both `text-sm`.
Disabled: `cursor-not-allowed opacity-50`.

---

## Alert
*Source: Alert.tsx*

`div.rounded-xl.border.p-4` with variant-specific border and bg.
`div.flex.items-start.gap-3` → 24×24 icon + content `div`.
Content: `h4.text-sm.font-semibold.text-gray-800` + `p.text-sm.text-gray-500` + optional `Link.mt-3.underline`.
Border + bg: `border-{color}-500 bg-{color}-50 dark:border-{color}-500/30 dark:bg-{color}-500/15`.

---

## Dropdown
*Source: Dropdown.tsx + DropdownItem.tsx*

`div.absolute.z-40.right-0.mt-2.rounded-xl.border.border-gray-200.bg-white.shadow-theme-lg`

- Closes on outside mousedown; trigger must have class `dropdown-toggle` to be excluded
- DropdownItem: `<button>` by default, `<Link>` when `tag="a"` + `to` prop

**Card MoreDot pattern:**
```
div.relative.inline-block
├── button.dropdown-toggle → MoreDotIcon [size-6 text-gray-400 hover:text-gray-700]
└── Dropdown [w-40 p-2]
    └── DropdownItem [flex w-full font-normal text-left text-gray-500 rounded-lg hover:bg-gray-100]
```

---

## Modal
*Source: modal/index.tsx + useModal.ts*

```
div.fixed.inset-0.flex.items-center.justify-center.overflow-y-auto.z-99999
├── backdrop overlay [fixed inset-0 bg-gray-400/50 backdrop-blur-[32px]]
└── content [rounded-3xl bg-white dark:bg-gray-900 + className]
    ├── Close button [absolute right-3 top-3 sm:right-6 sm:top-6
    │                 rounded-full bg-gray-100 h-9.5 w-9.5 sm:h-11 sm:w-11 text-gray-400]
    └── div → children
```

ESC closes. Body overflow hidden while open.
**Always use `useModal()`** hook — `{ isOpen, openModal, closeModal, toggleModal }`.

**Large modal form anatomy (max-w-[700px]):**
```
div.no-scrollbar.rounded-3xl.bg-white.p-4.lg:p-11
├── header [px-2 pr-14]
│   ├── h4.text-2xl.font-semibold  [title]
│   └── p.text-sm.text-gray-500  [description]
├── scrollable body [custom-scrollbar h-[450px] overflow-y-auto px-2 pb-3]
│   └── form sections: h5.text-lg.font-medium sectioned, grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2
└── footer [flex items-center gap-3 px-2 mt-6 lg:justify-end]
    ├── Button variant=outline "Close"
    └── Button variant=primary "Save Changes"
```

---

## Input
*Source: InputField.tsx*

`input.h-11.w-full.rounded-lg.border.px-4.py-2.5.text-sm.shadow-theme-xs`

| State | Border | Focus |
|-------|--------|-------|
| Default | border-gray-300 | border-brand-300 ring-brand-500/20 |
| Error | border-error-500 | ring-error-500/20 |
| Success | border-success-500 | ring-success-500/20 |
| Disabled | border-gray-300 opacity-40 bg-gray-100 cursor-not-allowed | — |

Hint: `p.mt-1.5.text-xs` colored by state. Dark: `dark:bg-gray-900 dark:border-gray-700 dark:text-white/90`.

---

## Select
*Source: Select.tsx*

Same height/radius/border as Input default. `appearance-none pr-11` for chevron space.
Same focus ring as Input default state.

---

## Switch / Toggle
*Source: Switch.tsx*

```
label.flex.cursor-pointer.items-center.gap-3.text-sm.font-medium
├── div.relative
│   ├── track [h-6 w-11 rounded-full transition] — brand-500/gray-200 (blue) or gray-800/gray-200 (gray)
│   └── knob [absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-theme-sm
│              transform duration-150 — translate-x-full on, translate-x-0 off]
└── label text
```

---

## Label
*Source: Label.tsx*

`label.mb-1.5.block.text-sm.font-medium.text-gray-700.dark:text-gray-400`

---

## Table
*Source: table/index.tsx*

Primitives: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell` (`isHeader` prop renders `<th>`).

**Table in card (RecentOrders):**
Card: `overflow-hidden rounded-2xl border px-4 pb-3 pt-4 sm:px-6`.
Header row: `flex flex-col sm:flex-row gap-2 mb-4 items-center justify-between`.
Action buttons: `inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium shadow-theme-xs hover:bg-gray-50`.
Header cells: `py-3 font-medium text-gray-500 text-theme-xs text-start`. Border: `border-y border-gray-100`.
Body cells: `py-3 text-theme-sm text-gray-500`. Dividers: `divide-y divide-gray-100`.

**Standalone table (BasicTableOne):**
Wrapper: `rounded-xl border border-gray-200 bg-white` (xl not 2xl, no outer padding).
Header cells: `px-5 py-3 font-medium text-gray-500 text-theme-xs text-start`. Border: `border-b`.
Body cells: `px-4 py-3 text-theme-sm text-gray-500`. Dividers: `divide-y divide-gray-100 dark:divide-white/[0.05]`.

---

## Avatar
*Source: Avatar.tsx*

6 sizes: xsmall (24px) → xxlarge (64px). Always `rounded-full object-cover`.
Status dot: `absolute bottom-0 right-0 rounded-full border-[1.5px] border-white dark:border-gray-900`.
Colors: online=success-500, offline=error-400, busy=warning-500.

---

## ComponentCard
*Source: ComponentCard.tsx*

For showcase / demo pages only.
`div.rounded-2xl.border.border-gray-200.bg-white.dark:border-gray-800.dark:bg-white/[0.03]`
Header: `px-6 py-5` → `h3.text-base.font-medium.text-gray-800` + optional `p.mt-1.text-sm.text-gray-500`.
Body: `p-4 sm:p-6 border-t border-gray-100 dark:border-gray-800` → `div.space-y-6`.

---

## PageBreadcrumb
*Source: PageBreadCrumb.tsx*

`div.flex.flex-wrap.items-center.justify-between.gap-3.mb-6`
Left: `h2.text-xl.font-semibold.text-gray-800.dark:text-white/90` (page title).
Right: `nav > ol.flex.items-center.gap-1.5` → Home link + chevron SVG + current page name `text-sm text-gray-800`.

Always the **first element** inside every AppLayout page component.

---

# PART 4 — CARD & CHART PATTERNS

---

## Pattern Lookup Table

| Surface | Source |
|---------|--------|
| Chart card — title + MoreDot | MonthlySalesChart.tsx — Pattern A |
| Chart card — title + subtitle + right controls | StatisticsChart.tsx — Pattern B |
| Chart card — title + subtitle + MoreDot | DemographicCard.tsx, MonthlyTarget.tsx — Pattern B variant |
| Chart card — multi-series + custom legend | Derived — Pattern C |
| Chart card — metrics embedded in header | PDF dashboards — Pattern H |
| KPI card — icon + label + value + delta badge | EcommerceMetrics.tsx — Pattern D |
| KPI card — value-first with inline delta | PDF dashboards — Pattern D2 |
| Inline segmented toggle | ChartTab.tsx — Pattern E |
| Radial / gauge card | MonthlyTarget.tsx — Pattern F |
| Table card | RecentOrders.tsx — Pattern G |
| Profile / content info card | UserInfoCard.tsx, UserMetaCard.tsx — Pattern I |
| UI element showcase card | ComponentCard.tsx |

---

## Pattern A — Chart Card: Title + MoreDot
*Source: MonthlySalesChart.tsx*

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
*Source: StatisticsChart.tsx*

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
*Source: TailAdmin Delivery Statistics card — pixel-perfect DOM extraction*

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
`allAligned: true` — confirmed by `getBoundingClientRect()` on the TailAdmin source.

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
*Source: EcommerceMetrics.tsx*

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
*Source: PDF dashboards (Analytics, CRM, Marketing, SaaS, Stocks)*

```
card [p-5 md:p-6]
├── label [text-sm text-gray-500]  ← top
├── row [flex items-end gap-2 mt-2]
│   ├── value [font-bold text-title-sm]
│   └── delta [inline colored text or small Badge]
└── context text [text-theme-xs text-gray-500]  "Vs last month" / "From last month"
```

---

## Pattern E — ChartTab (Inline Segmented Toggle)
*Source: ChartTab.tsx*

```
track [flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900]
├── button.active   [rounded-md bg-white text-gray-900 shadow-theme-xs px-3 py-2 text-theme-sm font-medium
│                    dark:bg-gray-800 dark:text-white]
└── button.inactive [rounded-md text-gray-500 hover:text-gray-900 px-3 py-2 text-theme-sm font-medium]
```

Track: `bg-gray-100 rounded-lg (8px)`, no border. Pill: `rounded-md (6px)`.
Always in header-right column or above chart. Never below chart.

---

## Pattern F — Radial / Gauge Card
*Source: MonthlyTarget.tsx*

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
*Source: RecentOrders.tsx*

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
*Source: PDF dashboards (CRM Statistics card)*

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
*Source: UserInfoCard.tsx, UserMetaCard.tsx*

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

| Transition | Value | Implementation |
|---|---|---|
| Header-block → content below | mb-6 (24px) | margin-bottom on header-block |
| **Subtitle → legend row** | **20px** | **`pt-5` on legend container — NOT margin** |
| Legend → chart | 0px | chart-container is flush sibling, no gap |
| Legend row → chart (old pattern) | mb-4 (16px) | only applies when legend is a standalone sibling, not in anonymous wrapper |
| Subtitle → next element (general) | mt-1 (4px) | when no legend row present |
| Icon-box → value row (KPI) | mt-5 (20px) | margin-top on value row |
| Label → value (KPI) | mt-2 (8px) | margin-top on value |
| Chart → text action link below | mt-4 to mt-6 | margin-top on action |
| Modal header → body | mt-8 | margin-top on body |
| Modal body → footer | mt-6 | margin-top on footer |
| Form field rows | gap-y-5 | grid gap |

---

## ApexCharts Config Defaults

Required on every chart.

| Setting | Value |
|---|---|
| chart.fontFamily | "Outfit, sans-serif" |
| chart.toolbar.show | false |
| chart.background | "transparent" |
| legend.show | false when using custom JSX legend |
| grid.borderColor | "#EAECF0" |
| grid.strokeDashArray | 4 |
| xaxis.axisBorder.show | false |
| xaxis.axisTicks.show | false |
| xaxis/yaxis labels fontSize | "12px" |
| xaxis/yaxis labels colors | ["#667085"] |
| dataLabels.enabled | false |
| tooltip.theme | "light" |
| tooltip.style.fontSize | "12px" |

Series colors: primary `#465FFF` · secondary `#9CB9FF` · success `#12B76A` · error `#F04438`.
Area opacity: 0.15–0.25. No 3D. No decorative gradients.

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

---

# PART 5 — PAGE COMPOSITIONS

---

## Dashboard (eCommerce)
*Source: pages/Dashboard/Home.tsx*

```
grid.grid-cols-12.gap-4.md:gap-6
├── col-span-12 xl:col-span-7 [space-y-6]
│   ├── EcommerceMetrics (Pattern D × 2 in 2-col grid)
│   └── MonthlySalesChart (Pattern A)
├── col-span-12 xl:col-span-5
│   └── MonthlyTarget (Pattern F)
├── col-span-12
│   └── StatisticsChart (Pattern B)
├── col-span-12 xl:col-span-5
│   └── DemographicCard (Pattern B variant + map content)
└── col-span-12 xl:col-span-7
    └── RecentOrders (Pattern G)
```

---

## Chart Pages
*Source: pages/Charts/BarChart.tsx, LineChart.tsx*

```
PageMeta
PageBreadcrumb
div.space-y-6
└── ComponentCard [title="Chart Name"]
    └── ChartComponent
```

Charts on dedicated pages are always wrapped in `ComponentCard`.

---

## Table Page
*Source: pages/Tables/BasicTables.tsx*

```
PageMeta
PageBreadcrumb
div.space-y-6
└── ComponentCard [title="Basic Table 1"]
    └── BasicTableOne
```

---

## Form Page
*Source: pages/Forms/FormElements.tsx*

```
PageMeta
PageBreadcrumb
div.grid.grid-cols-1.gap-6.xl:grid-cols-2
├── LEFT col [space-y-6] — DefaultInputs, SelectInputs, TextAreaInput, InputStates
└── RIGHT col [space-y-6] — InputGroup, FileInput, Checkboxes, RadioButtons, Toggles, Dropzone
```

All form element groups wrapped in `ComponentCard`.

---

## Profile Page
*Source: pages/UserProfiles.tsx*

```
PageMeta
PageBreadcrumb
div.rounded-2xl.border.bg-white.p-5.dark:bg-white/[0.03].lg:p-6
├── h3.text-lg.font-semibold.mb-5.lg:mb-7  ["Profile"]
└── div.space-y-6
    ├── UserMetaCard (Pattern I — avatar + socials + Edit modal)
    ├── UserInfoCard (Pattern I — info grid + Edit modal)
    └── UserAddressCard (Pattern I — address grid + Edit modal)
```

Profile wraps all sub-cards in a single outer card. This is different from dashboard grid layout.

---

## Calendar Page
*Source: pages/Calendar.tsx*

```
PageMeta  [no PageBreadcrumb on this page]
div.rounded-2xl.border.bg-white.dark:bg-white/[0.03]
├── div.custom-calendar → FullCalendar
└── Modal [max-w-[700px] p-6 lg:p-10]  (Add/Edit event — modal form pattern from Part 3)
```

No PageBreadcrumb. FullCalendar fills the card directly.

---

## Auth Pages
*Source: AuthPageLayout.tsx + SignInForm.tsx*

```
div.relative.p-6.bg-white.z-1 [sm:p-0]
└── div.flex.flex-col.lg:flex-row.h-screen
    ├── LEFT: form panel [flex-1 flex flex-col]
    │   ├── Back link [inline-flex items-center text-sm text-gray-500 w-full max-w-md pt-10 mx-auto]
    │   └── form container [flex-1 flex flex-col justify-center w-full max-w-md mx-auto]
    │       ├── heading [h1.font-semibold.text-title-sm sm:text-title-md + p.text-sm.text-gray-500]
    │       ├── OAuth buttons [grid grid-cols-2 gap-3 sm:gap-5]
    │       │   └── button [rounded-lg bg-gray-100 px-7 py-3 text-sm hover:bg-gray-200]
    │       ├── "Or" divider [absolute inset border-t + centered span on bg-white]
    │       └── form [space-y-6 → Label + Input + footer row]
    └── RIGHT: brand panel [hidden lg:grid lg:w-1/2 bg-brand-950]
        └── GridShape + logo + tagline text-gray-400
```

Auth pages live outside AppLayout — no sidebar, no header, no PageBreadcrumb.
ThemeTogglerTwo: `fixed bottom-6 right-6 z-50 hidden sm:block`.

---

# PART 6 — PROJECT OVERLAY

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
| **Title** | WHAT this card shows — the name of the metric, chart, or section | text-lg / font-semibold | gray-800 | Top-left of header |
| **Subtitle** | CONTEXT — timeframe, target, data source, or qualifying description | text-theme-sm / font-normal | gray-500 | mt-1 directly below title |
| **Legend label** | SERIES — the name of a data series in a multi-series chart | text-theme-sm / font-normal | gray-500 | Legend row, next to color dot |
| **Badge** | STATUS — a signal or evaluation (above/below target, on track, at risk) | text-theme-xs / font-medium | semantic color | Header-right column only |
| **Action** | NEXT STEP — a user-invokable behavior (compare, view all, export) | text-theme-sm / font-medium | brand-500 | Below chart, or header-right |
| **KPI label** | METRIC NAME — the label above or below a standalone metric value | text-sm / font-normal | gray-500 | Above or below value in KPI card |
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
- Subtitle → legend gap is **20px via `pt-5` on the legend container** — never margin-top, never flex gap on a parent
- Legend → chart gap is **0px** — chart container is flush directly below legend container
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
- [ ] `PageBreadcrumb` is first element in every AppLayout page (exception: Calendar)
- [ ] Charts on dedicated pages are wrapped in `ComponentCard`

**Project Overlay**
- [ ] All rules from Part 6 applied
