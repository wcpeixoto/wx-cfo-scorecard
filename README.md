# Wx CFO Scorecard

A financial decision cockpit for small business owners. Turns raw
accounting data into plain-English operating signals so the owner can
quickly understand what is happening, whether they are safe, and what
to do next.

Built for and by the owner of Gracie Sports Fairfield, a BJJ gym.
The codebase aims at any small operator with messy month-to-month
cash flow and no CFO.

---

## What this product is

The dashboard answers four operating questions:

1. **Where do we stand right now?** — current cash, runway, reserve status,
   trailing margins.
2. **Where are we heading?** — forward cash forecast across multiple
   models, with safety-line and reserve gauges.
3. **What is driving that?** — category trends, biggest movers, payee
   concentration, owner distributions.
4. **What should I pay attention to next?** — ranked priorities and
   plain-English signals on the Today page.

CFO-style signal design with consumer-grade usability. No accounting
jargon in the UI.

---

## Stack

- **React + TypeScript + Vite** — frontend single-page app
- **TailAdmin design system + project overlay** — custom CSS class
  layer in `src/dashboard.css`; no Tailwind utility classes in JSX
- **ApexCharts** via `react-apexcharts` — main chart library; custom
  SVG `TrendLineChart` for trend/forecast charts
- **Supabase** — primary persistence layer, accessed via PostgREST HTTP
  through a hand-rolled `sharedPersistence.ts` (no Supabase JS SDK)
- **Quicken CSV import** — transaction data enters the system through
  Quicken report exports
- **HashRouter** (`react-router` v7) — single-tab routing
- **GitHub Pages** — deployment via GitHub Actions

There is **no Google Sheets integration**. Earlier docs that describe a
zero-backend Google Sheets CSV architecture are obsolete.

---

## Architecture overview

The app is a static SPA with no application backend. Persistence and
secure operations are delegated to managed services.

| Layer | Role |
|---|---|
| **Static SPA bundle** | All UI, KPI engine, and forecast logic run client-side |
| **Supabase** | Source of truth for transactions, account settings, workspace settings (REST via PostgREST) |
| **IndexedDB** | Fallback path only; not used when Supabase is configured |
| **localStorage** | Legacy only; migrated to Supabase on first boot, then removed |

Two Supabase tables hold the source-of-truth split:

- `shared_account_settings` — per-account configuration (which accounts
  count as cash, which are excluded, etc.)
- `shared_workspace_settings` — single-row workspace-level config
  (reserve method, target net margin, suppress flags, acknowledged
  non-cash accounts)

A subset of files in `src/` is **locked** — the forecast engine,
operating-cash classification rules, the data contract, and the
Supabase fetch layer. Locked files must not be modified without
explicit instruction. The authoritative locked-file list is in
[AGENTS.md](AGENTS.md).

---

## Project structure

```
src/
├── App.tsx                     — HashRouter shell
├── main.tsx                    — Vite entry
├── config.ts                   — environment config
├── dashboard.css               — all custom styles (class-based)
├── components/                 — UI components (charts, cards, header, sidebar, forecast module)
├── context/                    — React context providers (sidebar, etc.)
├── pages/                      — route-level pages (Dashboard, Today, Settings, etc.)
└── lib/
    ├── cashFlow.ts             — operating-cash classification rules (LOCKED)
    ├── accounts.ts             — account discovery and merging
    ├── dataSanity.ts           — input validation
    ├── data/                   — Supabase fetch layer, types, contract, importers
    ├── kpis/                   — forecast engine, KPI compute, forecast comparators
    ├── priorities/             — Today page ranking, signals, AI prose copy
    ├── charts/                 — chart utilities (EMA, etc.)
    └── utils/                  — small shared helpers

scripts/backtest/               — regression harness, walk-forward runner, diagnostics
backtest-results/               — locked baseline.json, generated reports, fixtures
public/                         — static assets
.github/workflows/              — GitHub Pages deploy (LOCKED — do not modify casually)
```

---

## Forecast track

Multiple forecast models live under `src/lib/kpis/`:

| Model | Source file |
|---|---|
| Engine | `src/lib/kpis/compute.ts` (locked) |
| Category-Cadence | `src/lib/kpis/categoryCadence.ts` |
| Split Conservative | `src/lib/kpis/splitConservative.ts` |
| Conservative Floor | `src/lib/kpis/conservativeFloor.ts` |

For the active model roles (which is the user-facing default, which
is an alternate posture, which are diagnostic comparators), see
[AGENTS.md](AGENTS.md) → Gotchas → Forecast model roles.

---

## Backtest + diagnostics

### Permanent regression harness

```bash
npx tsx scripts/backtest/runBacktest.ts
```

Walks the locked engine through 15 historical as-of dates and measures
forecast quality against a truth series built from the same operating-
cash rules in `src/lib/cashFlow.ts`. Three comparators run alongside:
naive YoY, T12M-average, category-cadence.

Four locked thresholds in `backtest-results/baseline.json` protect
canonical metrics from silent drift: `directionalAccuracy`, `mape90`,
`safetyLineHitRate`, `worstSingleMonthMiss`. Exit codes: `0` pass,
`1` regression, `2` missing baseline.

CLI flags:

- `--update-baseline` — write a fresh baseline (use only when
  intentional engine changes have shipped)
- `--allow-regression` — suppress non-zero exit on threshold breaches
  (diagnostic use only)

### Conservative Floor diagnostic

```bash
npx tsx scripts/backtest/conservativeFloorDiagnostic.ts
```

Repeatable downside/stress view. Compares five forecast models across
the same 5 as-of dates with Federal Tax excluded as a diagnostic-only
assumption. Writes `backtest-results/conservativeFloorReport.md` with
retrospective accuracy, current-forecast levels, and conclusions on
the Expected/Downside framing.

### Fixtures

- `backtest-results/fixtures/transactions-snapshot.jsonl` — frozen
  ~4,800-row fixture
- `backtest-results/fixtures/historical-anchors.json` — operating-cash
  anchors for level-dependent metrics
- `backtest-results/fixtures/README.md` — fixture refresh procedure

---

## Local development

```bash
npm install       # after fresh clone or dependency changes
npm run dev       # start local dev server
npm run build     # production build → dist/
npm run preview   # preview the production build locally
```

### Environment requirements

- **Supabase URL + anon key** — required at runtime for primary
  persistence. Configure via Vite env variables (see `src/config.ts`
  and [AGENTS.md](AGENTS.md) for the data layer contract). `VITE_*`
  variables are client-exposed by design; never put secret keys here.
- **Anthropic API key** — required for the Today page AI prose layer.
  Routed through a secure proxy (Supabase Edge Function or Cloudflare
  Worker), never embedded in the bundle.

The architecture explicitly forbids any secret in the frontend bundle.
Server-side operations go through Edge Functions or Workers only.

---

## Deployment

GitHub Pages via GitHub Actions. Pushes to `main` trigger an automatic
build and deploy. The workflow definitions in `.github/workflows/` are
locked — do not modify casually.

---

## Documentation index

Active root docs:

| File | Purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent workflow, locked files, project gotchas |
| [UI_RULES.md](UI_RULES.md) | Visual tokens and styling rules |
| [README.md](README.md) | App overview, local setup, deployment |
| [scripts/backtest/README.md](scripts/backtest/README.md) | Backtest harness internals |
| [backtest-results/fixtures/README.md](backtest-results/fixtures/README.md) | Fixture refresh procedure |

`CLAUDE.md` exists as a bridge that points to `AGENTS.md` (Claude Code
auto-loads it).
