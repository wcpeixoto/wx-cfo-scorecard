# wx-cfo-scorecard

A personal finance dashboard for CFO-level visibility into my own finances. Imports transactions from Quicken CSV exports, auto-discovers accounts, and presents spending, cash flow, and balance data in a clean React UI.

## Stack

- **React** (frontend, single-page app)
- **Vite** (build tool and local dev server)
- **Node.js** (toolchain)
- **GitHub Pages** (deployment via GitHub Actions)
- **Browser storage** — IndexedDB and localStorage hold imported transactions and account settings. This data lives only in the browser; it is not committed to git and is not synced between machines. Re-import from your Quicken CSV if you need to populate a new browser.

## Commands

```bash
npm install       # install dependencies (after fresh clone)
npm run dev       # local dev server — open http://localhost:5173 (or similar)
npm run build     # production build into dist/
npm run preview   # preview production build locally
```

Deployment is automatic: merging to `main` triggers the GitHub Actions workflow, which builds and pushes to GitHub Pages.

## Structure

```
src/
├── main.jsx (or index.jsx)   — app entry point
├── App.jsx                   — root component
├── components/               — UI components
├── hooks/                    — custom React hooks
├── utils/                    — helpers (CSV parsing, account discovery, etc.)
public/                       — static assets
.github/workflows/            — GitHub Actions deploy workflow
```

> **Note:** Fill in actual folder names after cloning if they differ from the above.

## Data model (browser-only)

- **IndexedDB**: stores imported transaction records from Quicken CSV files
- **localStorage**: stores account settings, user preferences, and discovered account mappings
- Neither is backed by a server or git. If you clear browser storage, re-import your CSV.

## Rules

- System is live and stable. No broad redesigns without a plan.
- Only fix confirmed friction — don't refactor working code speculatively.
- Commit frequently with clear messages.
- Branch for new features: `feature/[name]`
- All changes go through PR, even solo work.
- Do NOT touch `.github/workflows/` without understanding the deploy pipeline.
- Do NOT add any server-side code or secrets — this is a static site.

## Deployment

- **Target:** GitHub Pages (`gh-pages` branch or `docs/` folder, depending on workflow config)
- **Trigger:** push to `main`
- **Workflow file:** `.github/workflows/` — check this for exact build steps
- No manual deploy needed — push to main and it deploys automatically.

## Current state

- ✅ Quicken CSV import working
- ✅ Account auto-discovery working
- ✅ GitHub Actions deploy workflow in place
- ✅ Latest commit on main: `2d9ccaf`
- 🔲 [Fill in: what's currently in progress]
- 🔲 [Fill in: any known issues or planned next features]

## Session notes

*(Update this section at the end of each work session so the next session — on either machine — picks up cleanly.)*

- Last worked on: [date and machine]
- What was being worked on: [brief description]
- What's next: [next action]
