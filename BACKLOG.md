# Wx CFO Scorecard — Backlog

Source of truth: [Notion database](https://www.notion.so/084420fff00444de9413a542db3dddf0)
Last synced: 2026-04-28

---

## Now

| Item | Priority | Why |
|---|---|---|
| Placeholder card (right of Cash Trend) — decide what goes here | P1 | Currently shows "Coming soon." Must decide before Big Picture layout review. Candidates: Annual Performance compact card, target-vs-actual margin card, or something else. Decision first, then prompt. |
| Big Picture layout review — final pass | P1 | Trajectory gone, Cash Trend simplified. Do not rearrange until placeholder card decision is made and Cash Trend redesign is shipped. Then do one layout pass to confirm balance. |
| Hero and secondary pill QA | P1 | |
| General copy review | P1 | |
| Mobile layout pass — Today page | P1 | |

---

## Next

| Item | Priority | Why |
|---|---|---|
| Startup performance — sequential Supabase requests | P2 | Root cause identified: requestAllRows() makes 5 sequential paginated round-trips. PAGE_SIZE raised to 10,000 achieves 9x speedup but exposes silent truncation risk (Supabase max_rows default 1,000). Pending: raise max_rows to 50,000 in Supabase dashboard, then land and verify the PAGE_SIZE commit. Silent truncation hardening (Content-Range / Prefer: count=exact) scoped as a separate follow-up prompt. |
| Phase 5.1 — Renewal engine | P2 | Generate system-driven ForecastEvent objects from contract data, feeding the existing event pipeline alongside manual events. |
| Projection Table polish | P2 | |
| chartTokens.ts — create the file | P2 | UI_RULES.md now requires all ApexCharts hex values to come from src/lib/ui/chartTokens.ts. File does not exist yet. |
| priority_history Supabase table — create in Supabase | P2 | |
| Efficiency Opportunities — credible-best logic (V2) | P2 | |
| Annual Performance card — add to Trends page | P2 | T12M YoY net cash is mathematically sound (full seasonal cycle, no small-denominator problem). Removed from Big Picture; belongs on Trends page. |
| Top Expense Categories redesign — dual timeframe | P2 | |
| Add Monthly Revenue and Expenses to Big Picture | P2 | Big Picture shows net cash but not the components driving it. Revenue and expense trend lines add meaningful context. |

---

## Later

| Item | Priority | Why |
|---|---|---|
| Decision UX layer | P3 | |
| QA layer — systematic testing | P3 | No automated tests exist. A QA layer would catch regressions before they reach production. Deferred until core feature set stabilizes. |
| Settings enhancements — logo, naming, structure | P3 | |
| Category classification Settings page (V2) | P3 | |
| Unclassified category detector in Settings | P3 | |
| Secure server proxy for AI prose | P3 | |
| Full AI cache read path | P3 | |
| Egress reduction and payload optimization | P3 | |
| Warning near 10,000 input lines limit | P3 | |
| Next owner distribution card | P4 | Operators need to plan personal cash flow alongside business cash flow. |
| Forecast baseline comparison | P4 | |
| Sustainability breakdown (4 cards) | P4 | Expand Sustainability section into 4 dedicated signal cards. Design TBD. |
| Crisis mode | P5 | Emergency operating mode for when cash position drops critically. Design TBD. |

---

## Done

| Item | Priority | Commit / notes |
|---|---|---|
| Cash Trend — visual redesign to TailAdmin quality | P1 | `57225d1` — Two-variant pattern (default half-width+, inline-stat ~1/3-width). TailAdmin Churn Rate spec baseline: 24px padding, 16px radius, 18/600/28 title, 24/600/32 metric. One card, one hero number. Content-driven height. Status-accent interpretation in default variant only. |
| Extract Cash Trend spec into UI_CARDS.md | P1 | `6dc00ed` — Universal CFO Signal Card System (Part 1) + CashTrendHero implementation contract (Part 2). UI_RULES.md cross-link added. CLAUDE.md required-reading updated. |

---

## Sync rules

- Notion is the source of truth. This file is a repo-committed snapshot for offline reference and Codex context.
- Sync both files when: an item changes status, a new item is confirmed, a decision locks a constraint.
- Do not sync for speculative or exploratory items not yet confirmed.
- **Do not mark Big Picture layout review as Done until the placeholder card decision is also closed.**
