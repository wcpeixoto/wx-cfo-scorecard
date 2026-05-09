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
[CLAUDE.md](CLAUDE.md).

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

Four selectable forecast models live alongside the production toggle on
the What-If page:

| Model | Source file | Role |
|---|---|---|
| **Engine** | `src/lib/kpis/compute.ts` | Locked legacy engine. Uses aggregate baselines and seasonality weighting. Current production default. Tends to under-project expenses. |
| **Category-Cadence** | `src/lib/kpis/categoryCadence.ts` | Per-category cadence-aware projection (STABLE → trailing-3, PERIODIC/EVENT → same-month-last-year, Sales → 50/50 trailing-12 + 2-year YoY). Best on expenses; opt-in production-visible. |
| **Split Conservative** | `src/lib/kpis/splitConservative.ts` | Engine `operatingCashIn` + Cadence `operatingCashOut`, month-aligned. Calibrated expected-case hybrid. Leads retrospective accuracy at 30d and 1y; near-zero signed bias at 90d. |
| **Conservative Floor** | _diagnostic only_ — see `backtest-results/conservativeFloorReport.md` | `min(Engine, Cadence)` cash-in / `max(Engine, Cadence)` cash-out. Deliberately pessimistic stress view. **Not yet implemented in production**; lives only in the backtest diagnostic. |

Engine remains the default on every page load. The toggle is
session-only React state — no persistence, no URL parameter.

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
  and [CLAUDE.md](CLAUDE.md) for the data layer contract). `VITE_*`
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

This README is orientation only. Authoritative documentation lives in:

| File | Purpose |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Project rules, source-of-truth hierarchy, key files, locked files, dev rules, prompt discipline |
| [UI_RULES.md](UI_RULES.md) | Design system tokens, primitives, page compositions, project overlay |
| [UI_CARDS.md](UI_CARDS.md) | Card anatomy, height behavior, pairing classification |
| [wx_cfo_scorecard_context_v2_6.md](wx_cfo_scorecard_context_v2_6.md) | Current project state, architecture, queued roadmap |
| [scripts/backtest/README.md](scripts/backtest/README.md) | Backtest harness internals |
| [backtest-results/fixtures/README.md](backtest-results/fixtures/README.md) | Fixture refresh procedure |

Backlog state lives in Notion (single source of truth):
<https://www.notion.so/084420fff00444de9413a542db3dddf0>. There is no
`BACKLOG.md` in this repo.

---

## Workflow docs

Session-close, task-prompt, and shared-config doctrine live in dedicated
files at the repo root. Read these directly; do not rely on summaries.

| File | Purpose |
|---|---|
| [PROJECT_CONFIG.md](PROJECT_CONFIG.md) | Shared workflow/config source of truth: required reads, locked files, spec-doc list, arc signals, irreversible-action rules |
| [TASK_PROMPT_TEMPLATE.md](TASK_PROMPT_TEMPLATE.md) | Required template when drafting an implementation prompt for Codex, Claude Code, or another coding agent |
| [SESSION_CLOSE_WORKFLOW.md](SESSION_CLOSE_WORKFLOW.md) | Trigger model and behavior for closing a session |
| [README_SESSION_WORKFLOWS.md](README_SESSION_WORKFLOWS.md) | Map of the workflow docs above |
