# wx-cfo-scorecard

A CFO-level financial dashboard for Gracie Sports Fairfield, a BJJ gym.
Personal side project — vibe coding, keep it simple.

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

## Supabase gotcha

`Supabase Dashboard → Settings → Data API → Max Rows` must be **10000**.
Below that, PostgREST silently truncates responses (HTTP 200 with partial
data, no error). Never reduce `PAGE_SIZE` in `sharedPersistence.ts` below
`max_rows`.

`shared_workspace_settings` table (single row, `workspace_id = 'default'`)
holds target margin, safety reserve config, and duplicate-warning prefs.

---

## Locked files — don't modify without a reason

- `src/lib/kpis/compute.ts` — forecast engine, parameters grid-searched
- `src/lib/cashFlow.ts` — operating cash rules, reconciled to 0.00% variance
- `src/lib/data/contract.ts` — TypeScript schema
- `src/lib/data/sharedPersistence.ts` — Supabase layer
- `.github/workflows/` — deploy pipeline

---

## Styling

- All visual values come from `UI_RULES.md`
- No Tailwind utility classes in JSX — use classes in `src/dashboard.css`
- No inline styles, no invented hex values

TailAdmin source reference (replicate, don't reinvent):
`code/Code Supporting Docs/free-react-tailwind-admin-dashboard-main/`

---

## Key learnings

**Operating cash excludes owner draws.** Cash Trend measures what the
business produces, not what the owner takes. T6M margin will look higher
than a P&L that includes draws. This is intentional.

**Forecast model roles.** Reality Forecast (= Conservative Floor) is the
default. Recovery Forecast (= Split Conservative) is a Settings-only
alternate. Engine and Category-Cadence are diagnostic comparators, not
user-facing choices.

**Diagnostic harness date construction.** Use
`new Date(y, m, 1)` — never `new Date('YYYY-MM-DD')`. ISO strings parse
as UTC midnight, which shifts the window one month early in US timezones
and produces wrong results silently.

---

## Working rules

- Diagnosis before code: describe the problem before writing the fix
- Single-purpose commits, explicit file staging (no `git add .`)
- Don't touch locked files without a clear reason
- No secrets in the frontend bundle (`VITE_*` is client-exposed by design)
- Architecture is static-site (Vite + GH Pages); Supabase Edge Functions
  or Cloudflare Workers are OK for AI proxy / key handling

---

## Archived docs

Older workflow docs (session-close rituals, handoff templates, project
config, UI cards spec, full context doc) live in `docs/archive/`. They
were over-engineered for a solo side project. Pull them back into root
if the project grows beyond one operator.
