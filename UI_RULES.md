# UI_RULES.md
# Wx CFO Scorecard — Visual Standard Reference
# Read this before writing any UI code, CSS, or class names.
# This is the single source of truth. Do not deviate from it.

---

## The Standard

Every UI element in this project must visually match TailAdmin's
design system. When in doubt, the answer is in this file.
Do not invent values. Do not guess. Look it up here first.

This project uses a custom CSS class system in `src/dashboard.css`.
It does NOT use Tailwind utility classes directly in JSX.
All token values below must be applied as CSS property values
inside `src/dashboard.css` — not as Tailwind class names in JSX.

---

## Font

**This project uses Outfit.**

```css
@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap");

body {
  font-family: 'Outfit', sans-serif;
}
```

Font weights:
- Regular: 400
- Medium: 500
- Semibold: 600
- Bold: 700

Never use any other font. Never mix fonts.

---

## Colors

### Page and surface backgrounds
| Role | Hex |
|------|-----|
| Page background | #F9FAFB |
| Card / panel background | #FFFFFF |
| Muted surface (inside cards) | #F2F4F7 |

### Borders
| Role | Hex |
|------|-----|
| Default border | #E4E7EC |
| Strong border | #D0D5DD |
| Chart grid lines | #EAECF0 |

### Text
| Role | Hex |
|------|-----|
| Primary text | #101828 |
| Secondary / label text | #667085 |
| Muted / metadata text | #98A2B3 |

### Brand (actions, active states)
| Role | Hex |
|------|-----|
| Primary action | #465FFF |
| Hover | #3641F5 |
| Pressed | #2A31D8 |
| Disabled | #9CB9FF |
| Active background (soft) | #ECF3FF |

### Semantic
| Role | Hex | Soft background |
|------|-----|-----------------|
| Success | #12B76A | #ECFDF3 |
| Error / negative | #F04438 | #FEF3F2 |
| Warning | #F79009 | #FFFAEB |

---

## Typography

| Role | Size | Weight | Color |
|------|------|--------|-------|
| Page title (h2) | 28px | 700 | #101828 |
| Card title | 20px | 700 | #101828 |
| KPI / metric value | 32px | 700 | #101828 |
| Section label | 14px | 400 | #667085 |
| Body text | 16px | 400 | #101828 |
| Secondary / metadata | 12px | 500 | #667085 |

Rule: never use the same font size for two different semantic
roles on the same page.

---

## Spacing

| Role | Value |
|------|-------|
| Card internal padding | 24px (use 20px for smaller cards) |
| Gap between cards in a grid | 16px |
| Gap between page sections | 14–16px |
| Page header min-height | 109px |

---

## Border Radius

| Element | Value |
|---------|-------|
| Cards and panels | 16px |
| Inputs and small controls | 8px |
| Segmented toggles and icon containers | 12px |
| Badges and pills | 999px |
| Modals | 24px |

Never use any other radius values.

---

## Shadows

| Role | Value |
|------|-------|
| Cards / panels | No shadow. Border only: 1px solid #E4E7EC |
| Segmented toggle active pill | 0 1px 2px rgba(16, 24, 40, 0.05) |
| Dropdowns / popovers | 0 8px 24px rgba(16, 24, 40, 0.08) |

Never use dramatic or layered shadows.
Never add box-shadow to cards or panels.

---

## Cards

Standard card pattern:
```css
background: #FFFFFF;
border: 1px solid #E4E7EC;
border-radius: 16px;
padding: 24px;
box-shadow: none;
```

KPI / metric card internal layout:
- Label: 14px, weight 400, color #667085 — top
- Value: 32px, weight 700, color #101828 — below label
- Min-height: 118px

---

## Segmented Toggle

```css
/* Track */
background: #F2F4F7;
border: 1px solid #E4E7EC;
border-radius: 12px;
padding: 2px;
gap: 0;

/* All buttons */
border-radius: 12px;
height: 44px;
padding: 0 16px;
font-size: 0.875rem;
font-weight: 500;
color: #667085;
background: transparent;

/* Active button */
background: #FFFFFF;
color: #101828;
font-weight: 600;
box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
```

---

## Page Header Block

Every page has a header block styled with `.top-bar.glass-panel`.

Standard values:
```css
background: #FFFFFF;
border: 1px solid #E4E7EC;
border-radius: 16px;
padding: 18px;
min-height: 109px;
```

Inner layout (`.top-bar-main`):
```css
display: grid;
grid-template-columns: 1fr auto;
align-items: center;
min-height: 109px;
```

Title (h2): 28px, weight 700, color #101828
Subtitle (p): 14px, weight 400, color #667085

---

## Charts

- Chart card: white background, 1px solid #E4E7EC border,
  16px radius, no shadow
- Grid lines: #EAECF0 (not #E4E7EC — intentionally lighter)
- Axis labels: 12px, color #667085
- Primary series color: #465FFF
- Positive/growth: #12B76A
- Negative/loss: #F04438
- Area fill opacity: 0.15–0.25
- No gradients, no 3D effects

---

## Hard Rules — Never Violate These

1. No raw hex values invented outside this file
2. No border-radius values outside the system above
3. No box-shadow on cards or panels
4. No font sizes outside the typography table above
5. No inline styles in JSX
6. No new CSS class names that depend on values not in this file
7. Cards are always white (#FFFFFF) — never tinted or gradient
8. Page background is always #F9FAFB — never gradient

---

## Before Writing Any CSS

Ask yourself:
1. Is the color value in this file? If not, stop and ask.
2. Is the border-radius in this file? If not, stop and ask.
3. Is the font size / weight in this file? If not, stop and ask.
4. Am I adding a shadow to a card? If yes, remove it.
5. Am I inventing a new class name? If yes, reuse an existing one.

---

## Quick Lookup

| I need to... | Use this value |
|---|---|
| Set page background | #F9FAFB |
| Set card background | #FFFFFF |
| Set card border | 1px solid #E4E7EC |
| Set card radius | 16px |
| Set card padding | 24px |
| Set primary text | #101828 |
| Set secondary/label text | #667085 |
| Set a KPI value | 32px, weight 700, #101828 |
| Set a card label | 14px, weight 400, #667085 |
| Set a page title | 28px, weight 700, #101828 |
| Set active action color | #465FFF |
| Set success color | #12B76A |
| Set error/negative color | #F04438 |
| Set toggle track background | #F2F4F7 |
| Set toggle active pill | #FFFFFF bg, #101828 text |
| Set page header min-height | 109px |
