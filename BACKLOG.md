# Wx CFO Scorecard — Backlog

Source of truth: [Notion database](https://www.notion.so/084420fff00444de9413a542db3dddf0)
Last synced: 2026-04-29

## How to use this file at session start

Do not rely on Notion search — it is text-only and unreliable for status filtering.
Fetch each item by ID using `notion-fetch` on the Notion page URL.
Format: `https://www.notion.so/{id-without-hyphens}`

---

## Now

| Item | Priority | Notion ID | Why |
|---|---|---|---|
| Placeholder card (right of Cash Trend) — decide what goes here | P1 | `351ad9579339817c8f5ae2e2a337a1f2` | Cash Trend is live at 1/3 width. The 2/3-width placeholder still shows 'Coming soon.' Product decision, not a build task — pick the signal before writing any code. Decision unlocks Big Picture layout review. Candidates: Annual Performance compact card, target-vs-actual margin card, or other. |

---

## Next

| Item | Priority | Notion ID | Why |
|---|---|---|---|
| Hero and secondary pill QA | P1 | `34fad957933981ebb079d1abbc244412` | Verify all 8 signal states on Today page render correctly. Secondary pills must be right-aligned, not full width. |
| Mobile layout pass — Today page | P1 | `34fad957933981178366ec239e54191e` | Today is the landing page. Must work cleanly on narrow screens. Not deprioritized. |
| Projection Table polish | P1 | `34fad957933981e28170e9abc8f61e45` | $ difference before %, spacing and hierarchy, full-year comparison. |
| Phase 5.1 — Renewal engine | P2 | `34fad957933981ffb7d7fd00e590153f` | System-driven ForecastEvent objects from contract data. Next core feature after P1 complete. Drives forward-looking accuracy. |
| chartTokens.ts — create the file | P2 | `34fad95793398134975fff2c765015d1` | UI_RULES.md requires all ApexCharts hex values from src/lib/ui/chartTokens.ts. File does not yet exist. Must be created in a dedicated commit before the next new chart component. Do not create it as part of any other task. |
| Efficiency Opportunities — credible-best logic (V2) | P2 | `34fad957933981fa9f3ac95bcbe1ebca` | Ensure 'best' reflects a realistic repeatable state, not a statistical artifact. |
| Annual Performance card — add to Trends page | P2 | `34fad9579339819c98efd17d23e8e586` | T12M YoY net cash is mathematically sound. Removed from Big Picture. Belongs on Trends page. |
| Top Expense Categories redesign — dual timeframe | P2 | `34fad9579339811c8a08c88f9dd2564e` | |
| Add Monthly Revenue and Expenses to Big Picture | P2 | `34fad95793398186958fef3808c44587` | Big Picture shows net cash but not the components driving it. Revenue and expense trend lines add meaningful context. |
| Owner Distributions explanatory footnote | P2 | `34fad957933981179964ceac6ecb9579` | |

---

## Later

| Item | Priority | Notion ID | Why |
|---|---|---|---|
| Big Picture layout review — final pass | P1 | `34fad9579339817d9057c55981b28ec7` | Do not rearrange until placeholder card decision is made and closed. Then one layout pass to confirm balance. |
| Startup performance — sequential Supabase requests | P3 | `34fad957933981d69028de98578440b2` | Boot makes sequential HTTP requests. Parallelizing would cut perceived load time meaningfully. |
| Decision UX layer | P3 | `34fad9579339816fa375c5fa2e30b065` | Turns the dashboard from a read surface into an action surface. |
| QA layer — systematic testing | P3 | `34fad957933981089bdfc5f55da524ba` | No automated tests exist. Deferred until core feature set stabilizes. |
| Settings enhancements — logo, naming, structure | P3 | `34fad9579339812aadc8ecca968d9b6d` | |
| Secure server proxy for AI prose | P3 | `34fad957933981af9cdcd1c16daf2663` | |
| Full AI cache read path | P3 | `34fad957933981b4bf9ceeb515eeed86` | Skip API call when a recent priority_history row exists for the same signal type and severity. |
| Egress reduction and payload optimization | P3 | `34fad95793398178a4cde190ee8624ba` | |
| Warning near 10,000 input lines limit | P3 | `34fad9579339819c8a6ed4d43bce7b0a` | |
| Next owner distribution card | P4 | | Operators need to plan personal cash flow alongside business cash flow. |
| Forecast baseline comparison | P4 | | |
| Sustainability breakdown (4 cards) | P4 | | |
| Crisis mode | P5 | | Emergency operating mode for critically low cash position. |

---

## Done

| Item | Priority | Notion ID | Commit / notes |
|---|---|---|---|
| Cash Trend — visual redesign to TailAdmin quality | P1 | `34fad957933981c78a09f7493c188761` | `57225d1` — Two-variant pattern. TailAdmin Churn Rate spec baseline. One card, one hero number. Content-driven height. |
| Extract Cash Trend spec into UI_CARDS.md | P1 | `351ad957933981179ce3d33015435a24` | `6dc00ed` — Universal CFO Signal Card System + CashTrendHero contract. UI_RULES.md cross-link + CLAUDE.md updated. |

---

## Sync rules

- Notion is the source of truth. This file is a repo-committed snapshot + ID index.
- At session start: fetch Now items by ID. Do not rely on Notion search.
- Sync both Notion and this file when: an item changes status, a new item is confirmed, a decision locks a constraint.
- **Do not mark Big Picture layout review as Done until the placeholder card decision is also closed.**

## Session-start fetch protocol

Fetch Now and top Next items directly by ID for reliable status reads:

```
Now:
https://www.notion.so/351ad9579339817c8f5ae2e2a337a1f2  ← Placeholder card decision (P1)

Next P1s:
https://www.notion.so/34fad957933981ebb079d1abbc244412  ← Hero and secondary pill QA
https://www.notion.so/34fad957933981178366ec239e54191e  ← Mobile layout pass — Today page
https://www.notion.so/34fad957933981e28170e9abc8f61e45  ← Projection Table polish
```
