# Universal CFO Signal Card System

**Plus CashTrendHero Implementation Contract**

## Purpose

This document defines the reusable card anatomy for Wx CFO Scorecard dashboard cards.

The goal is to create cards that are:

- clear to a small business owner
- visually aligned with TailAdmin
- compact, not hero-like
- content-driven in height
- consistent across light/dark mode
- easy for coding agents to implement without guessing

The most basic card can be as simple as:

```
Unique Visitors
24.7K     +20% Vs last month
```

More advanced CFO signal cards may add subtitle, badge, tooltip, interpretation, proof stat, empty state, or variant behavior. Those elements are optional and must earn their space.

---

# Part 1 — Universal CFO Signal Card Rules

## 1. What a signal card must do

A dashboard signal card should help the operator quickly understand one business idea.

Every card should answer:

- What is this?
- What is the main number?
- Is it good, bad, or worth attention?
- What should I understand next?

A signal card should not try to answer every related question. If the user needs a full trend, chart, table, or drilldown, that belongs in a companion component.

---

## 2. TailAdmin reference scale

The card system follows TailAdmin's compact dashboard card scale.

### TailAdmin Analytics compact card reference

Example:

```
Unique Visitors
24.7K     +20% Vs last month
```

Container: `rounded-2xl border bg-white p-5`

| Property | Value |
|---|---|
| Padding | 20px |
| Border radius | 16px |
| Border | 1px solid light gray |
| Background | white |

| Element | Font size | Weight | Line height |
|---|---|---|---|
| Label | 14px | 400 | 20px |
| Metric | 24px | 700 | 32px |
| Delta value | 12px | 500 | 18px |
| Delta label | 12px | 400 | 18px |

### TailAdmin SaaS richer card reference

Example:

```
Churn Rate
Downgrade to Free plan
4.26%
0.31% than last Week
```

Container: `overflow-hidden rounded-2xl border bg-white p-6`

| Property | Value |
|---|---|
| Padding | 24px |
| Border radius | 16px |
| Border | 1px solid light gray |
| Background | white |

| Element | Font size | Weight | Line height |
|---|---|---|---|
| Title | 18px | 600 | 28px |
| Subtitle | 14px | 400 | 20px |
| Metric | 24px | 600 | 32px |
| Comparison line | 12px | 400 | 18px |

### Rule

Use the **SaaS richer card scale** when the card has any of:

- title + subtitle
- badge
- tooltip
- interpretation line
- proof stat
- multiple body lines

Use the **compact analytics scale** only when the card is very simple:

- label
- metric
- optional delta line
- no badge
- no interpretation
- no proof stat
- no tooltip

---

## 3. Card shell

### Fixed baseline

All CFO signal cards use the same shell unless a specific compact variant is intentionally chosen.

```css
.card {
  background: #ffffff;
  border: 1px solid #E4E7EC;
  border-radius: 16px;
  padding: 24px;
  font-family: 'Outfit', sans-serif;
}
```

| Property | Value |
|---|---|
| Background | `#ffffff` |
| Border | `1px solid #E4E7EC` |
| Border radius | `16px` |
| Padding | `24px` |
| Font family | `'Outfit', sans-serif` |

### Optional compact shell

Only use 20px padding for very compact KPI cards with no subtitle, no badge, no interpretation, no proof stat, and no tooltip.

```css
.card--compact {
  padding: 20px;
}
```

### Do not

- Do not add a shadow unless the surrounding system already uses shadows.
- Do not use fixed height.
- Do not use `min-height` to match neighboring cards.
- Do not let a placeholder or companion card define the data card's height.
- Do not stretch the card just because its grid neighbor is taller.
- Do not use random padding values like 22px, 28px, 30px unless explicitly justified.

---

## 4. Required card anatomy

Every signal card has a minimum core:

```
Title / label
Primary metric
```

Example:

```
Unique Visitors
24.7K
```

Everything else is optional.

### Optional elements

A card may include:

- Subtitle / timeframe
- Status badge
- Tooltip
- Secondary metric
- Comparison / delta
- Interpretation line
- Proof stat
- Mini visual
- Empty state

Optional elements must improve operator understanding. If an element does not make the signal clearer, remove it.

---

## 5. Title / label

Every card needs a clear title or label.

### Full title style

Use for richer cards.

| Property | Value |
|---|---|
| Font size | 18px |
| Font weight | 600 |
| Line height | 28px |
| Color | `#1D2939` |

Examples:

```
Cash Trend
Churn Rate
User Growth
Cost Spikes to Investigate
```

### Compact label style

Use for simple KPI cards.

| Property | Value |
|---|---|
| Font size | 14px |
| Font weight | 400 |
| Line height | 20px |
| Color | `#667085` |

Examples:

```
Unique Visitors
Total Revenue
Active Members
```

### Rules

- Do not make the title compete with the metric.
- Do not use vague titles like "Performance" without context.
- Do not rely on tooltip text to explain what the card is.
- If the card has a status badge, title should stay clean and readable.

---

## 6. Subtitle / timeframe

A subtitle is optional but should be used when the metric needs context.

Examples:

```
Last 6 complete months
Downgrade to Free plan
New signups website + mobile
Mar 2026 · vs your 6-month baseline
3 of the last 6 months were negative
```

| Property | Value |
|---|---|
| Font size | 14px |
| Font weight | 400 |
| Line height | 20px |
| Color | `#667085` |
| Margin top from title | 4px |

### Use subtitle when

- The metric depends on a time window.
- The card compares one period to another.
- The card needs a short qualifier.
- The card's first message is a plain-English proof statement.

### Do not

- Do not make the subtitle the only place where a key metric window is explained if users may scan straight to the number.
- Do not use subtitle for long explanations.
- Do not duplicate the same fact elsewhere unless that duplication intentionally improves comprehension.
- Do not make the subtitle louder than the metric.

---

## 7. Primary metric

Every card has one primary metric.

| Property | Value |
|---|---|
| Font size | 24px |
| Font weight | 600 or 700 |
| Line height | 32px |
| Color | `#1D2939` |

TailAdmin examples: `24.7K` · `4.26%` · `3,768`
CFO examples: `+$6.2K` · `$14.5K/mo` · `-63%`

### Rule: one card, one hero number

The primary metric is the only hero number. Supporting stats must not visually compete.

### Optional noun beside primary metric

A short noun may sit on the same baseline as the primary value.

Example:

```
+$6.2K net cash
```

Recommended noun style:

| Property | Value |
|---|---|
| Font size | 14px |
| Font weight | 500 |
| Line height | 20px |
| Color | `#475467` |

### Do not

- Do not make two numbers equally loud.
- Do not turn the primary metric into a long sentence.
- Do not use 30px+ metrics unless the card is intentionally a hero card.
- Do not use primary metric styling for proof stats.
- Do not combine too many concepts in the metric line.

---

## 8. Secondary metric / context line

A secondary metric is optional. Use it when the primary metric needs context.

Examples:

```
+20% Vs last month
6-month cumulative profit margin: +2.5%
+$14.5K/mo available if you ran at your own best level
```

### Default style (12px)

| Property | Value |
|---|---|
| Font size | 12px |
| Font weight | 400 |
| Line height | 18px |
| Color | `#667085` |

### Promoted style (14px) — narrow exception

A secondary line may be promoted to 14px / 400 / 20px **only** when the line is the user's primary action signal — the line that tells them what to do, not just additional context.

Example: `+$14,500/mo available if you ran at your own best level` — this is a directive, not metadata, so 14px is justified.

If the line is observational ("vs last month", "since Jan 2024", "6-month average"), keep it at 12px. The 14px allowance is the exception, not a flexible default.

### Value emphasis

The numeric portion may use `font-weight: 500` or `600` and `color: #344054` for readability:

```
6-month cumulative profit margin: +2.5%
```

where `+2.5%` may be slightly heavier than the surrounding label.

### Rules

- Use consistent vocabulary across the product.
- Do not introduce competing terms for the same concept.
- Do not use "cash margin" in one place and "profit margin" in another. Pick one and stay with it across all variants and surfaces.
- Prefer the business owner's existing vocabulary when the difference is not mission-critical.
- Keep the line short enough to scan.

---

## 9. Comparison / delta line

A comparison line is optional. Use for simple "up/down vs prior period" comparisons.

Examples:

```
+20% Vs last month
0.31% than last Week
```

| Element | Font size | Weight | Line height |
|---|---|---|---|
| Delta value | 12px | 500 | 18px |
| Delta label | 12px | 400 | 18px |

### Do not

- Do not use single-month YoY if it produces noise.
- Do not use explosive percentages caused by small denominators.
- Do not show deltas that contradict a more reliable signal without explanation.
- Do not make a volatile delta look more authoritative than it is.

---

## 10. Status badge

A status badge is optional. Use only when the card has a meaningful state.

Examples:

```
Building Cash
Treading Water
Under Pressure
Burning Cash
```

Use the global badge system:

```
.card-status-badge
.is-healthy
.is-warning
.is-pressure
.is-critical
.is-neutral
```

If used:

| Property | Value |
|---|---|
| Padding | 4px 10px |
| Border radius | 999px |
| Font size | 12px |
| Font weight | 500 |
| White-space | nowrap |
| Flex shrink | 0 |

### Do not

- Do not redefine badge styling inside card-specific CSS.
- Do not use status badges as decorative labels.
- Do not create a badge if the card does not have a meaningful state.
- Do not let badge text wrap.

---

## 11. Tooltip / info icon

A tooltip is optional. Use a tooltip when the operator needs to understand:

- What is this card telling me?
- What should I do with this information?
- How are the numbers calculated?

Use the global tooltip system:

```
.db-tooltip-wrap
.db-tooltip-btn
.db-tooltip-panel
.db-tooltip-panel.is-wide
.db-tooltip-list
```

### Tooltip behavior

| Concern | Behavior |
|---|---|
| Trigger | Click to open |
| Dismiss | Outside click |
| Width | `.is-wide`, readable paragraph width |
| Layering | Above neighboring cards |
| Accessibility | Button has `aria-label`; panel uses `role="tooltip"`; button is keyboard-focusable; focus-visible is visible |

### Tooltip should

- explain the job of the card
- explain what to do next
- explain the numbers in plain English
- use short paragraphs or bullets

### Tooltip should not

- only restate formulas
- introduce a strategy not visible in the card
- become a narrow vertical column
- use a card-specific tooltip system
- be longer than necessary

### Info icon style

The info icon should be quiet:

```css
border: none;
background: transparent;
color: #98A2B3;
```

Hover:

```css
background: #F2F4F7;
color: #667085;
```

The icon should be available, not attention-grabbing.

---

## 12. Interpretation line

An interpretation line is optional. Use it when the metric needs plain-English meaning.

Example:

```
Cash is positive, but the margin cannot absorb a bad month.
```

| Property | Value |
|---|---|
| Font size | 14px |
| Font weight | 500 |
| Line height | 20px |
| Color | Status accent or neutral (see rule below) |

### When to use status accent vs neutral

Use **status accent** when the card has visible breathing room around the interpretation line — half-width or wider, plenty of vertical space, no other supporting elements crowding the body.

Use **neutral** (`#344054`) when the card is dense — narrow width (~1/3 or less), the variant already crowds the body, or multiple supporting elements compete for attention. Orange or red text in a tight space reads as alarm rather than signal.

The principle: status accent is a calm voice in open space, but the same color in dense space sounds urgent.

### Use interpretation when

- the metric could be misunderstood
- positive numbers still indicate risk
- the card is meant to guide operator attention
- the card translates financial data into business meaning

### Do not

- Do not make the interpretation louder than the primary metric.
- Do not use motivational fluff.
- Do not repeat the title or subtitle.
- Do not flood the card with status color.
- Do not create a second headline.

---

## 13. Proof stat / supporting stat

A proof stat is optional. Use it to support the primary metric or status.

Example:

```
3 of 6
negative months
```

| Element | Font size | Weight | Line height | Color |
|---|---|---|---|---|
| Stat number | 18px | 600 | 28px | `#344054` |
| Stat label | 11px | 600 | 16px | `#667085` |

Optional container:

```css
background: #F9FAFB;
border: 1px solid #E4E7EC;
border-radius: 8px;
padding: 8px 12px;
```

### Do not

- Do not make proof stats as loud as the primary metric.
- Do not duplicate the same proof in subtitle and body.
- Do not use status color unless the proof stat is the only warning element.
- Do not create a second hero number.

---

## 14. Mini visual

A mini visual is optional.

Examples: sparkline, tiny bar sequence, small trend area.

Use only if the visual adds signal.

### Use when

- the card's job includes movement or trend
- the visual makes the signal clearer
- it does not duplicate a nearby chart

### Do not

- Do not add a chart just to fill space.
- Do not duplicate a larger chart directly below.
- Do not add ApexCharts unless the card truly needs chart behavior.
- Do not use full chart anatomy inside a compact KPI card.

---

## 15. Empty state

Cards that depend on history must define an empty state.

| Property | Value |
|---|---|
| Font size | 14px |
| Font weight | 400 |
| Color | `#667085` |

Rules:

- Do not show a false green state.
- Hide status badge if the state cannot be computed.
- Keep empty state calm and useful.
- Say what is missing and what is needed.

Example:

```
Not enough complete months yet to evaluate cash trend. Need at least 3 closed months.
```

---

## 16. Layout and height rules

Cards must be content-driven.

### Fixed rules

- No fixed height.
- No `min-height` unless explicitly required.
- Do not stretch to match neighboring cards.
- Do not let a placeholder card define the data card's height.

If a card is paired with a placeholder or companion card, the parent layout must not force the data card to stretch unnaturally.

### The fix when a parent grid forces stretch

The cause of card-height inflation is almost always `align-items: stretch` (the default) on the parent grid or flex container. Fix it at the parent, not on the card.

```css
/* Parent row containing data card + companion */
.signal-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 14px;
  align-items: flex-start; /* CRITICAL: prevents stretch-to-tallest */
}
```

The `align-items: flex-start` declaration is the specific rule that makes content-driven height work in a grid where one cell is taller than another. If a card looks inflated and you cannot find a `min-height` on the card itself, check the parent row first.

### Do not

- Do not use `align-items: stretch` when it causes inflated card height.
- Do not use `justify-content: space-between` inside a card unless intentionally spacing two fixed zones.
- Do not solve layout problems with `!important`.
- Do not compensate for bad parent layout by adding random padding.

---

## 17. Spacing rhythm

Use a small spacing scale.

Allowed: `4 / 8 / 12 / 16 / 24 / 32`

Default transitions:

| Transition | Default gap |
|---|---|
| Title → subtitle | 4px |
| Header → body | 16px |
| Primary metric → secondary metric | 4px |
| Metric block → interpretation | 16px |
| Body → mobile stacked stat | 12px |

Do not invent random spacing values.

---

## 18. Text wrapping rules

Cards must survive narrow widths.

### Fixed rules

- Header title may shrink before badge.
- Badge does not wrap.
- Metric noun may wrap below amount if needed.
- Interpretation can wrap to 2–3 lines.
- Tooltip text must remain readable.
- Supporting stat must shrink before causing overflow.
- Header-right content must not overlap title.

---

## 19. Dark mode

Every card must define dark-mode behavior.

Minimum dark-mode expectations:

```css
.dark .card {
  background: #1D2939;
  border-color: #344054;
}
.dark .card-title,
.dark .card-metric {
  color: rgba(255,255,255,0.9);
}
.dark .card-subtitle,
.dark .card-secondary,
.dark .card-stat-label {
  color: #98A2B3;
}
```

For card-specific classes, define dark-mode equivalents at the same time as light mode. Do not ship light-mode-only card styling.

---

## 20. Universal do-not rules

For future cards:

1. Do not use more than one hero number.
2. Do not duplicate the same proof stat in two places.
3. Do not use a chart unless the card's job requires visual trend proof.
4. Do not use status color in more than two meaningful places.
5. Do not rely only on subtitle to explain the metric window.
6. Do not introduce competing vocabulary for the same concept.
7. Do not set fixed height or `min-height` to match a neighbor.
8. Do not let a placeholder card define the data card's height.
9. Do not create card-specific tooltip systems.
10. Do not use custom font sizes outside the TailAdmin scale unless explicitly justified.
11. Do not make a card shout when it should speak.
12. Do not treat implementation history as design intent.

---

## 21. Minimal card example

```
Unique Visitors
24.7K     +20% Vs last month
```

This example uses:

- label
- primary metric
- delta line

It intentionally does not use:

- subtitle
- tooltip
- badge
- interpretation
- proof stat
- chart

This is the baseline. Add elements only when they improve operator understanding.

---

# Part 2 — CashTrendHero Implementation Contract

This section documents the exact CashTrendHero implementation. The universal system above explains how future cards should be designed. This contract locks the current CashTrendHero behavior so future agents do not have to rediscover it.

## File map

When working on CashTrendHero, the relevant files are:

- **Component:** `src/components/CashTrendHero.tsx`
- **Styles:** `src/dashboard.css` (`.cth-*` classes, `.cash-trend-row`, `.ui-lab-three-col-grid`)
- **Engine (LOCKED):** `src/lib/kpis/cashTrend.ts`
- **Companion placeholder:** `src/components/CashTrendPlaceholder.tsx`
- **Page usage:** `src/pages/Dashboard.tsx` (Big Picture row, UI Lab section 13)
- **Formatters:** `src/lib/utils/formatCompact.ts`

---

## 22. Component API

```ts
type CashTrendHeroProps = {
  result: CashTrendResult;
  negativeMonthsAsSubtitle?: boolean;
};
```

`result` comes from the Cash Trend engine.

Expected `result` shape:

```ts
type CashTrendResult = {
  noData: boolean;
  status: 'building' | 'treading' | 'pressure' | 'burning';
  priorStatus: 'building' | 'treading' | 'pressure' | 'burning';
  velocityTag: 'improving' | 'softer' | 'stable';
  t6mNetCash: number;
  t6mRevenue: number;
  t6mMargin: number;
  priorT6mMargin: number;
  negativeMonthCount: number;
  monthlyBars: {
    month: string;
    label: string;
    netCash: number;
    isNegative: boolean;
  }[];
  windowLabel: string;
  interpretation: string;
};
```

Engine output may include fields not currently rendered by the card (e.g. `velocityTag`, `monthlyBars`). Preserve them — they may serve future variants or diagnostics. Do not strip unused fields from the engine contract just because the current card does not display them.

---

## 23. CashTrendHero status classes

The card root uses status modifier classes:

```
.cth-card--building
.cth-card--treading
.cth-card--pressure
.cth-card--burning
```

Each status sets `--cth-accent`:

| Class | Accent color |
|---|---|
| `.cth-card--building` | `#12B76A` |
| `.cth-card--treading` | `#F79009` |
| `.cth-card--pressure` | `#DC6803` |
| `.cth-card--burning` | `#EF4444` |

The accent is available to child elements through:

```css
color: var(--cth-accent);
```

---

## 24. Status badge mapping

CashTrendHero uses the global `.card-status-badge` system.

| Status | Badge label | Badge modifier |
|---|---|---|
| building | Building Cash | `.is-healthy` |
| treading | Treading Water | `.is-warning` |
| pressure | Under Pressure | `.is-pressure` |
| burning | Burning Cash | `.is-critical` |

Do not define badge styles inside `.cth-*`.

---

## 25. CashTrendHero variants

CashTrendHero has two variants.

### 25.1 Default variant

Activated when `negativeMonthsAsSubtitle === false` or when prop is omitted.

**Use case:**

- card displayed at half-width or wider
- there is enough space for a right-side stat block

**Behavior:**

- Subtitle = "Last 6 complete months"
- Info icon = header-right, after status badge
- Mini-stat block = visible
- Interpretation = status accent color

**Layout example:**

```
Cash Trend                                      Under Pressure  ⓘ
Last 6 complete months
+$6.2K net cash                         3 of 6
6-month cumulative profit margin: +2.5% negative months
Cash is positive, but the margin cannot absorb a bad month.
```

### 25.2 Inline-stat variant

Activated when `negativeMonthsAsSubtitle === true`.

**Use case:**

- card displayed at 1/3 width or narrower
- right-side stat would crowd the body

**Behavior:**

- Subtitle = "N of the last 6 months were negative"
- Info icon = moves next to title
- Mini-stat block = hidden
- Interpretation = neutral `#344054`, not status accent
- Interpretation `margin-top` = 32px

**Layout example:**

```
Cash Trend ⓘ                            Under Pressure
3 of the last 6 months were negative
+$6.2K net cash
6-month cumulative profit margin: +2.5%
Cash is positive, but the margin cannot absorb a bad month.
```

**Rule of thumb:** if usable body width is below roughly 360px, use the inline-stat variant.

---

## 26. CashTrendHero shell

```css
.cth-card {
  background: #ffffff;
  border: 1px solid #E4E7EC;
  border-radius: 16px;
  padding: 24px;
  font-family: 'Outfit', sans-serif;
  display: flex;
  flex-direction: column;
}
```

**Important:**

- No fixed height.
- No `min-height`.
- Height must be content-driven.

---

## 27. CashTrendHero header

```css
.cth-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}
```

### Header left

```css
.cth-header-left {
  min-width: 0;
}
```

### Title row

Used especially when info icon moves next to title.

```css
.cth-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
```

### Title

```css
.cth-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 28px;
  color: #1D2939;
}
```

### Subtitle

```css
.cth-subtitle {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: #667085;
}
```

Default subtitle: `Last 6 complete months`
Inline-stat subtitle: `N of the last 6 months were negative`

### Header right

```css
.cth-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
```

- Default variant: Status badge + info icon in header-right
- Inline-stat variant: Status badge in header-right; info icon in title row

---

## 28. CashTrendHero tooltip

CashTrendHero uses the global blue-tinted tooltip system:

```
.db-tooltip-wrap
.db-tooltip-btn
.db-tooltip-panel.is-wide
.db-tooltip-list
```

Trigger button: `.db-tooltip-btn.cth-info-icon`

### Exact tooltip copy

```
Cash Trend shows whether the business is building cash or operating too close to the edge.
If this card shows pressure, look below for cost spikes and efficiency gaps.
Net cash shows how much cash the business accumulated in the last 6 complete months. Margin shows that cash as a percent of revenue over the same period.
```

Tooltip content may be rendered as bullet list items if using `.db-tooltip-list`, but the wording should remain the same.

### Info icon style

```css
.cth-info-icon.db-tooltip-btn {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border: none;
  background: transparent;
  color: #98A2B3;
  font-size: 14px;
  cursor: pointer;
  border-radius: 50%;
  padding: 0;
  transition: all 150ms ease;
}
.cth-info-icon.db-tooltip-btn:hover {
  color: #667085;
  background: #F2F4F7;
}
```

The icon must not have a visible border at rest.

---

## 29. CashTrendHero body

```css
.cth-body {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
```

Body splits into `.cth-body-left` and `.cth-stat-block`.

### Body left

```css
.cth-body-left {
  flex: 1;
  min-width: 0;
}
```

---

## 30. CashTrendHero primary metric

```css
.cth-metric-primary {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
```

### Amount

```css
.cth-metric-amount {
  font-size: 24px;
  font-weight: 600;
  line-height: 32px;
  letter-spacing: -0.01em;
  color: #1D2939;
}
```

### Noun

```css
.cth-metric-noun {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: #475467;
}
```

Rendered example: `+$6.2K net cash`

---

## 31. CashTrendHero secondary metric

```css
.cth-metric-secondary {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  color: #667085;
}
```

### Percentage value

```css
.cth-metric-margin {
  font-weight: 600;
  color: #344054;
}
```

### Final copy (both variants)

```
6-month cumulative profit margin: +2.5%
```

This phrase is used identically across both variants. Do not introduce alternate vocabulary like "cash margin" anywhere user-facing.

---

## 32. CashTrendHero interpretation

### Default

```css
.cth-interpretation {
  margin-top: 16px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: var(--cth-accent);
}
```

### Inline-stat variant override

```css
.cth-card--inline-stat .cth-interpretation {
  margin-top: 32px;
  color: #344054;
}
```

Rendered example: `Cash is positive, but the margin cannot absorb a bad month.`

---

## 33. CashTrendHero mini-stat block

Visible only in the default variant. Hidden in inline-stat variant.

```css
.cth-stat-block {
  flex-shrink: 0;
  text-align: center;
  background: #F9FAFB;
  border: 1px solid #E4E7EC;
  border-radius: 8px;
  padding: 8px 12px;
  min-width: auto;
}
```

### Number

```css
.cth-stat-number {
  font-size: 18px;
  font-weight: 600;
  line-height: 28px;
  color: #344054;
}
```

### Label

```css
.cth-stat-label {
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #667085;
}
```

Rendered copy:

```
N of 6
negative months
```

Do not use status accent color in the mini-stat.

---

## 34. CashTrendHero empty state

Trigger: `result.noData === true`.

Behavior:

- card root uses `.cth-card--treading`
- header shows title and subtitle only
- no badge
- no tooltip
- body replaced with `.cth-empty`

Exact copy:

```
Not enough complete months yet to evaluate cash trend. Need at least 3 closed months.
```

Style:

```css
.cth-empty {
  font-size: 14px;
  font-weight: 400;
  color: #667085;
  padding: 8px 0 4px;
}
```

---

## 35. CashTrendHero dark mode

```css
.dark .cth-card {
  background: #1D2939;
  border-color: #344054;
}
.dark .cth-title,
.dark .cth-metric-amount {
  color: rgba(255,255,255,0.9);
}
.dark .cth-subtitle,
.dark .cth-metric-noun,
.dark .cth-metric-secondary,
.dark .cth-stat-label {
  color: #98A2B3;
}
.dark .cth-metric-margin {
  color: rgba(255,255,255,0.7);
}
.dark .cth-stat-block {
  background: rgba(255,255,255,0.03);
  border-color: #344054;
}
.dark .cth-stat-number {
  color: rgba(255,255,255,0.9);
}
.dark .cth-info-icon {
  color: #667085;
}
.dark .cth-info-icon:hover {
  color: #98A2B3;
  background: rgba(255,255,255,0.05);
}
.dark .cth-card--inline-stat .cth-interpretation {
  color: rgba(255,255,255,0.8);
}
.dark .card-status-badge.is-pressure {
  color: #FDB022;
  background: rgba(220,104,3,0.15);
}
```

(Placeholder dark-mode rules are defined in section 38, where the placeholder is fully specified.)

---

## 36. CashTrendHero mobile behavior

At ≤639px:

```css
@media (max-width: 639px) {
  .cth-body {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
  }
  .cth-stat-block {
    margin-top: 12px;
  }
}
```

At ≤767px, layout wrappers collapse to single column.

---

## 37. CashTrendHero layout wrappers

### Big Picture row

```css
.cash-trend-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 14px;
  align-items: flex-start;
}
```

At ≤767px:

```css
.cash-trend-row {
  grid-template-columns: 1fr;
}
```

This row creates: Cash Trend card = 1/3 width; Placeholder companion = 2/3 width.

The row must not stretch Cash Trend to match the placeholder. The `align-items: flex-start` declaration is what enforces this.

### UI Lab three-column grid

```css
.ui-lab-three-col-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-items: flex-start;
}
```

At ≤767px:

```css
.ui-lab-three-col-grid {
  grid-template-columns: 1fr;
}
```

---

## 38. CashTrendHero placeholder companion

The placeholder companion is part of the Cash Trend row layout.

### Light mode

```css
.cth-placeholder {
  background: #ffffff;
  border: 1px solid #E4E7EC;
  border-radius: 16px;
  padding: 24px;
  font-family: 'Outfit', sans-serif;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cth-placeholder-text {
  font-size: 14px;
  font-weight: 400;
  color: #98A2B3;
}
```

### Dark mode

```css
.dark .cth-placeholder {
  background: #1D2939;
  border-color: #344054;
}
.dark .cth-placeholder-text {
  color: #667085;
}
```

### Important

- Placeholder may match the data card's height.
- Placeholder must not force the data card's height.
- Parent row uses `align-items: flex-start`.

The `min-height: 100%` rule lives only on the placeholder. It tells the placeholder to grow up to the height set by its taller-than-it neighbor — but because the parent row uses `align-items: flex-start`, neither cell is forced to stretch beyond its own content. The placeholder ends up matching whatever height the data card naturally produces.

---

## 39. CashTrendHero formatting rules

Helpers:

```
formatCompact
formatSignedCompact
formatSignedPct
```

Do not invent local formatters.

### Net cash

Format: signed compact currency.

Examples:

```
+$6.2K
-$23K
$0
```

Rules:

- explicit `+` for positive values
- explicit `-` for negative values
- `$0` when zero

### Margin

Format: signed percent with 1 decimal.

Examples:

```
+2.5%
-12.3%
0.0%
```

Values smaller than 0.05% may collapse to `0.0%`.

### Negative month count

Format:

```
N of 6
```

or, in inline-stat subtitle form:

```
N of the last 6 months were negative
```

---

## 40. CashTrendHero final rendered example

### Default variant

```
Cash Trend                                      Under Pressure  ⓘ
Last 6 complete months
+$6.2K net cash                         3 of 6
6-month cumulative profit margin: +2.5% negative months
Cash is positive, but the margin cannot absorb a bad month.
```

### Inline-stat variant

```
Cash Trend ⓘ                            Under Pressure
3 of the last 6 months were negative
+$6.2K net cash
6-month cumulative profit margin: +2.5%
Cash is positive, but the margin cannot absorb a bad month.
```

---

## 41. CashTrendHero verification checklist

Before committing changes to this card, verify:

| Check | Expected |
|---|---|
| Card shell | White, 1px border, 16px radius, 24px padding |
| Height | Content-driven, no fixed height, no `min-height` |
| Title | 18px / 600 / 28px |
| Subtitle | 14px / 400 / 20px |
| Header spacing | Title → subtitle 4px; header → body 16px |
| Primary metric | 24px / 600 / 32px |
| Metric noun | 14px / 500 / 20px |
| Secondary metric | 12px / 400 / 18px |
| Interpretation | 14px / 500 / 20px |
| Mini-stat | Neutral, secondary, not accent color |
| Tooltip | Opens, readable, global blue-tinted style, exact copy preserved |
| Badge | Uses global `.card-status-badge` |
| Empty state | no badge, no tooltip, correct copy |
| Mobile | stacks cleanly |
| Dark mode | all text and surfaces readable |
| Vocabulary | "cumulative profit margin" used in both variants; "cash margin" appears nowhere user-facing |
| No duplicates | no repeated proof stat |
| No charts | CashTrendHero does not render chart |
| No regressions | Monthly Net Cash Flow and Cost Spikes unchanged |

---

## Final Implementation Principle

A card is successful when the operator can understand the business signal in under five seconds without reconciling contradictions.

For CashTrendHero, the story is:

> Three of the last six months were negative.
> The business still accumulated cash.
> But the cumulative margin is too thin to absorb a bad month.

The UI should make that story obvious, compact, and calm.

---

## Card Height & Pairing Behavior

This section governs how cards behave in height when placed alongside other cards in a grid or flex row.
These rules exist because two categories of card pairings require opposite height strategies. Applying the wrong strategy produces either a card that stretches to an unnatural height, or a paired unit that looks disconnected.

**Height behavior must be decided at the row/layout level first. Do not start by forcing individual cards with `height`, `min-height`, or `height: 100%`.**

---

### The two pairing categories

#### CONTENT-DRIVEN

The card's height is determined by its own content. It does not stretch to match a neighbor.
Use when the card is a compact signal, KPI, or summary sitting beside a larger chart or unrelated card.

```css
/* Parent row */
.row-class {
  align-items: flex-start;
}

/* Card itself — only if inspection shows forced height exists */
.card-class {
  height: auto;
  min-height: 0;
}
```

Rule: never force a compact signal card to match the height of a chart card. The chart earns its height. The signal card hugs its content.

---

#### EQUAL-HEIGHT PAIRED

Both cards stretch to match each other because they are intentionally paired as one narrative unit — one card is the claim, the other is the evidence.
Use when two real data cards are designed to be read together as a single story.

```css
/* Parent row */
.row-class {
  align-items: stretch;
}

/* Children */
.row-class > * {
  height: 100%;
}
```

Rule: when using equal-height pairing, the internal layout of each card must be verified. Stretching will expose empty space if the card's inner content is not designed to fill height.

---

### Classification criteria

Before assigning a category, answer these two questions:

1. **Are both cards real data cards intentionally designed to be read as a pair?**
   YES → EQUAL-HEIGHT PAIRED
   NO → CONTENT-DRIVEN

2. **Is one card a chart and the other a compact signal or summary?**
   YES → CONTENT-DRIVEN, always. Never equalize.
   NO → evaluate question 1.

If the answer is uncertain, default to CONTENT-DRIVEN. Stretching a card that should not stretch is usually more visually damaging than letting a paired card sit at its natural height.

---

### Known classified pairings

| Row | Card A | Card B | Classification | Reason |
|-----|--------|--------|---------------|--------|
| `today-top-grid` | HeroPriorityCard | OperatingReserveCard | EQUAL-HEIGHT PAIRED | Hero = narrative, Reserve = proof. Designed as one unit. |
| `cash-trend-row` | Cash Trend signal card | Monthly Net Cash Flow chart | CONTENT-DRIVEN | Chart earns its height. Signal card hugs content. |

New card pairings must be classified here before implementation.

---

### What not to do

- Do not apply `height: 100%` to all grid children as a default.
- Do not use `min-height` on cards to approximate a desired height.
- Do not equalize height between a placeholder card and a real data card.
- Do not let a placeholder drive the height of a real card.
- Do not assume equal-height is the safe default. Content-driven is the safe default.
