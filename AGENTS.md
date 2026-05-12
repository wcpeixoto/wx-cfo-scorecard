# Agent workflow — wx-cfo-scorecard

Small personal side project. Favor momentum, small useful changes, and
quick verification over heavy process.

---

## Stack

- React + TypeScript + Vite
- TailAdmin design system, custom CSS in `src/dashboard.css` (no Tailwind utilities in JSX)
- ApexCharts + custom SVG `TrendLineChart`
- Supabase (PostgREST HTTP via hand-rolled `sharedPersistence.ts`)
- GitHub Pages deploy via GitHub Actions on push to `main`

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

---

## Working rules

- **For non-trivial changes, briefly diagnose before coding.** State:
  here's the issue → here's what I think is causing it → here's the
  smallest fix. Then implement.
- Single-purpose commits, explicit file staging (no `git add .`)
- Don't touch locked files without a clear reason
- No secrets in the frontend bundle (`VITE_*` is client-exposed by design)
- Architecture is static-site (Vite + GH Pages); Supabase Edge Functions
  or Cloudflare Workers are OK for AI proxy / key handling
- Verify UI changes on the running dev server before reporting done

---

## Locked files — don't modify without a reason

- `src/lib/kpis/compute.ts` — forecast engine, parameters grid-searched
- `src/lib/cashFlow.ts` — operating cash rules, reconciled to 0.00% variance
- `src/lib/data/contract.ts` — TypeScript schema
- `src/lib/data/sharedPersistence.ts` — Supabase layer
- `.github/workflows/` — deploy pipeline

---

## Styling

Visual tokens and styling rules live in `UI_RULES.md`. No Tailwind
utility classes in JSX, no inline styles, no invented hex values.

TailAdmin source reference for patterns (replicate, don't reinvent):
`code/Code Supporting Docs/free-react-tailwind-admin-dashboard-main/`

---

## Gotchas

**Supabase `max_rows` must be 10000.** Set in Supabase Dashboard →
Settings → Data API → Max Rows. Below that, PostgREST silently
truncates responses (HTTP 200 with partial data, no error). Never
reduce `PAGE_SIZE` in `sharedPersistence.ts` below `max_rows`.

**`shared_workspace_settings` table.** Single row, `workspace_id =
'default'`. Holds `target_net_margin`, `safety_reserve_method`,
`safety_reserve_amount`, `suppress_duplicate_warnings`,
`acknowledged_noncash_accounts`. Boot upserts on conflict.

**Operating cash excludes owner draws.** Cash Trend measures what
the business produces, not what the owner takes. T6M margin will
look higher than a P&L that includes draws. This is intentional.

**Forecast model roles.** Reality Forecast (= Conservative Floor)
is the default. Recovery Forecast (= Split Conservative) is a
Settings-only alternate. Engine and Category-Cadence are diagnostic
comparators, not user-facing choices.

**Diagnostic date construction.** Use `new Date(y, m, 1)` — never
`new Date('YYYY-MM-DD')`. ISO strings parse as UTC midnight, which
shifts the window one month early in US timezones and produces wrong
results silently.
