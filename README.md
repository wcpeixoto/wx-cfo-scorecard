# Gracie Sports Financial Dashboard

Static personal-use CFO-style dashboard built with React + TypeScript + Vite.

It reads transaction history directly from a Google Sheets CSV export and computes all KPIs client-side.

## What this app includes

- Zero backend architecture (no server, DB, or auth)
- Six-tab dashboard UI:
- Big Picture (includes Sustainability + Summary)
- Money Left on the Table
- Dig Here
- Trends
- What-If Scenarios
- Settings
- Google Sheets CSV data adapter with fallback URL support
- Transaction normalization layer (`Txn[]` contract)
- KPI engine for monthly rollups, deltas, opportunities, and projections
- GitHub Pages deployment workflow (free)

## Data source

Default source URL:

- `https://docs.google.com/spreadsheets/d/1phtPFxS7wq5tnesxp_XPWZ4rWVCJs0MRqf-qZKdWcOo/export?format=csv&gid=0`

Fallback URL:

- `https://docs.google.com/spreadsheets/d/1phtPFxS7wq5tnesxp_XPWZ4rWVCJs0MRqf-qZKdWcOo/gviz/tq?tqx=out:csv&gid=0`

Expected columns:

- `Date`
- `Account`
- `Payee`
- `Category`
- `Transfer`
- `Amount`
- `Memo/Notes`
- `Tags`

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Deployment (GitHub Pages)

Workflow file:

- `.github/workflows/deploy-pages.yml`

How to enable:

1. Push this repo to GitHub.
2. In GitHub, open `Settings` -> `Pages`.
3. Under Build and deployment, select `GitHub Actions`.
4. Push to `main` (or run workflow manually).

The workflow builds `dist/` and deploys it to GitHub Pages.

## Project structure

```text
src/
  config.ts
  lib/
    data/
      contract.ts
      fetchCsv.ts
      normalize.ts
    kpis/
      compute.ts
  components/
    KpiCards.tsx
    TrendLineChart.tsx
    ExpenseDonut.tsx
    TopPayeesTable.tsx
    MoversList.tsx
  pages/
    Dashboard.tsx
```

## Notes

- CSV logic is isolated behind a data adapter, so replacing Google Sheets later is straightforward.
- Settings tab lets you change the CSV URL without changing code.
