# wx-cfo-scorecard

A personal finance dashboard that gives CFO-level visibility into my own finances. It imports transactions from Quicken CSV exports, auto-discovers accounts, and presents spending, cash flow, and balance data in a clean React UI.

## Purpose

This project is meant to be practical, fast, and reliable. It is a personal operating dashboard for understanding money clearly, not a speculative product redesign exercise. The priority is accurate data import, stable calculations, useful visibility, and a smooth UI.

## Stack

- **React** — frontend single-page app
- **Vite** — build tool and local dev server
- **Node.js** — toolchain
- **GitHub Pages** — deployment via GitHub Actions
- **Browser storage** — IndexedDB and localStorage store imported transactions and account settings

## Important data behavior

This app is browser-local.

- **IndexedDB** stores imported transaction records from Quicken CSV files
- **localStorage** stores account settings, user preferences, and discovered account mappings
- This data is **not committed to git**
- This data is **not synced between machines**
- If a new machine or browser needs data, re-import the Quicken CSV

This is important: the code syncs through GitHub, but the imported financial data does not.

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

Notes
- `npm install` after a fresh clone or when dependencies change
- `npm run dev` starts the local server
- `npm run build` creates the production build in `dist/`
- `npm run preview` previews the production build locally

## Deployment

Deployment is automatic.

- Platform: GitHub Pages
- Trigger: merge or push to `main`
- Pipeline: GitHub Actions in `.github/workflows/`
- No manual deployment should be needed in normal use

Do not change the deployment workflow casually.

## Structure

```
src/
├── main.jsx (or index.jsx)   — app entry point
├── App.jsx                   — root component
├── components/               — UI components
├── hooks/                    — custom React hooks
├── utils/                    — helpers such as CSV parsing and account discovery
public/                       — static assets
.github/workflows/            — GitHub Actions deploy workflow
```

If the real folder names differ, update this section to match reality.

## Rules

- System is live and should remain stable
- No broad redesigns without a clear reason and plan
- Fix confirmed friction before chasing theoretical improvements
- Avoid speculative refactors when current behavior is working
- Commit frequently with clear messages
- Use feature branches for new work: `feature/[name]`
- All changes go through PR, even when working solo
- Do not edit `.github/workflows/` unless the deploy pipeline is understood
- Do not add server-side code, secrets, or backend dependencies
- Keep this a static-site architecture unless there is an explicit decision to change that

## Development priorities

When making decisions, prioritize in this order:

1. Correctness of imported financial data
2. Stability of calculations and summaries
3. Clarity of UI and usefulness of information
4. Simple maintainable code
5. Nice-to-have polish only after the above are solid

## Current state

- Quicken CSV import is working
- Account auto-discovery is working
- GitHub Actions deploy workflow is in place
- Local project setup is complete in `~/Code/wx-cfo-scorecard`
- Latest known setup checkpoint on main: `2d9ccaf`
- Current environment transition is complete: dotfiles, Brewfile, repo clone, and machine-sync workflow are in place
- Next priority: validate that the app runs cleanly on the new setup and confirm key workflows still behave correctly
- Next likely checks:
  - verify CSV import on current machine
  - verify discovered accounts behave correctly
  - verify totals / spending / cash flow views match expectations
  - verify GitHub Pages deployment still works from current workflow
- Known architectural constraint: imported data is browser-local only, so each machine/browser may need its own CSV import

## Known risks / watch-outs

- Browser storage can make the app appear "empty" on a newly set up machine even when the code is correct
- Clearing browser storage will remove imported local data
- Deploy workflow should be treated carefully because a small change there can break publishing
- Because this is personal finance software, incorrect calculations are worse than missing polish

## Session notes

Update this section at the end of each work session so the next session starts fast on either machine.

- Last worked on: transition/setup session completing seamless MacBook ↔ iMac workflow
- What was being worked on: setting up dotfiles, Brewfile, repo cloning, and AI continuity workflow
- What's next: run the app, verify import and dashboard behavior, then identify the next real friction point or feature to improve

## How to work with this project

When starting a new AI-assisted session:

1. Read this file first
2. Confirm current branch and git status
3. Understand whether the task is bug fix, validation, or feature work
4. Prefer small safe changes
5. Review diffs before committing
6. Update this file if priorities or current state changed

## Branching guidance

- Use `main` only for stable, deployable code
- Use `feature/*` for new work
- Use small focused commits
- If experimenting, isolate the work in a branch before making bigger changes

## Definition of a good next step

A good next step is one that improves confidence or removes real friction, such as:

- proving import works correctly
- confirming account mapping is stable
- validating calculation accuracy
- fixing a real UI pain point
- tightening a workflow that already causes confusion

A bad next step is broad refactoring without evidence it is needed.
