# Wx CFO Scorecard — Backlog

Source of truth: [Notion database](https://www.notion.so/084420fff00444de9413a542db3dddf0)
Last synced: 2026-04-30

## How to use this file at session start

Do not rely on Notion search — it is text-only and unreliable for status filtering.
Fetch each item by ID using `notion-fetch` on the Notion page URL.
Format: `https://www.notion.so/{id-without-hyphens}`

---

## Now

*Empty — no active Now items. Next session starts from Next P1s.*

---

## Next

| Item | Priority | Notion ID | Why |
|---|---|---|---|
| Big Picture layout review — final pass | P1 | `34fad9579339817d9057c55981b28ec7` | Placeholder card decision deferred to Later. Do one layout pass to confirm Big Picture balance after all card removals and Cash Trend work. |
| Phase 5.1 — Renewal engine | P2 | `34fad957933981ffb7d7fd00e590153f` | System-driven ForecastEvent objects from contract data. Next core feature after P1 complete. Drives forward-looking accuracy. |
| chartTokens.ts — create the file | P2 | `34fad95793398134975fff2c765015d1` | UI_RULES.md requires all ApexCharts hex values from src/lib/ui/chartTokens.ts. File does not yet exist. Must be created in a dedicated commit before the next new chart component. Do not create it as part of any other task. |
| Efficiency Opportunities — credible-best logic (V2) | P2 | `34fad957933981fa9f3ac95bcbe1ebca` | Ensure 'best' reflects a realistic repeatable state, not a statistical artifact. |
| Annual Performance card — add to Trends page | P2 | `34fad9579339819c98efd17d23e8e586` | T12M YoY net cash is mathematically sound. Removed from Big Picture. Belongs on Trends page. |
| Top Expense Categories redesign — dual timeframe | P2 | `34fad9579339811c8a08c88f9dd2564e` | |
| Add Monthly Revenue and Expenses to Big Picture | P2 | `34fad95793398186958fef3808c44587` | Big Picture shows net cash but not the components driving it. Revenue and expense trend lines add meaningful context. |
| Owner Distributions explanatory footnote | P2 | `34fad957933981179964ceac6ecb9579` | |
| Cash Trend chart — timeline toggle | P2 | `352ad957933981f39269f7b5dffcf4fa` | Add a segmented timeline control to the Cash Trend chart (Big Picture). Spec and class system already in place. |
| Audit and normalize dashboard grid gaps and section spacing | P2 | `352ad9579339815aa98ef17a60ff3905` | Systematic spacing audit across all pages now that the segmented toggle system is locked. Confirm all grids use the responsive gap pattern from UI_RULES.md. |

---

## Later

| Item | Priority | Notion ID | Why |
|---|---|---|---|
| Placeholder card (right of Cash Trend) — decide what goes here | P3 | `351ad9579339817c8f5ae2e2a337a1f2` | Product decision deferred. Candidates: Annual Performance compact card, target-vs-actual margin card, or other. Unlocks Big Picture layout review when decided. |
| Border radius audit — verify all cards use 16px system radius | P3 | `351ad9579339812b89eefb480069c802` | During Today top-row alignment work, noticed potential radius mismatch. Audit all card components, fix deviations, then lock the rule in UI_CARDS.md and CLAUDE.md. |
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
| Hero and secondary pill QA | P1 | `34fad957933981ebb079d1abbc244412` | `aff4491` — Verified all 10 signal × severity states. Fixed: secondary pill right-aligned (flex-end), signal-specific labels (Reserve / Cash Flow / Expenses / Revenue / Owner Draws / On Track) typed against SignalType with severity fallback. Hero labels kept generic. |
| Mobile layout pass — Today page | P1 | `34fad957933981178366ec239e54191e` | `4a17099` secondary card header row + breakpoints · `de755fa` remove header block, move reserve beside hero · `157ae64` state-based reserve pill + grid breakpoint · `8556b45` compact reserve layout narrow desktop · `5006787` hero title + softening copy removed + reserve label polish. |
| Projection Table polish | P1 | `34fad957933981e28170e9abc8f61e45` | `4bafb93` Change column · `9ca27e8` header/divider polish · `c96e7c3` segmented Compare toggle · `4c991a6` header controls spacing. Also: Projected Cash Balance card aligned to TailAdmin: `14321ad` `5c8614d` `4b4d7b6` `ea0857f` `bcad92c`. Sidebar renamed Forecast: `e93c355`. |
| Document standard segmented toggle pattern | P2 | `352ad95793398177b12de79e6a7fffa8` | `14f1d78` / `64d79d6` / `65f39aa` — Spec locked in UI_RULES.md Part 6. Three rounds: initial draft → geometry corrected (rounded-lg/rounded-md) → dimensions corrected (40px/36px/px-3 py-2/weight 500). |
| Standardize toggle menus to Settings segmented pattern | P2 | `352ad95793398154b6b9d7e873e69e54` | `3566cc6` — 8 toggles migrated across Dashboard.tsx, CashFlowForecastModule.tsx, TrendLineChart.tsx, NetCashFlowChart.tsx. Dead CSS deleted (~2.4 kB). |

---

## Sync rules

- Notion is the source of truth. This file is a repo-committed snapshot + ID index.
- At session start: fetch Now items by ID. Do not rely on Notion search.
- Sync both Notion and this file when: an item changes status, a new item is confirmed, a decision locks a constraint.
- **Do not mark Big Picture layout review as Done until the placeholder card decision is also closed.**
- Read `BACKLOG.md` at session start and use `notion-fetch` by ID for all backlog queries — never rely on `notion-search` for status lookups.

## Session-start fetch protocol

Fetch Now and top Next items directly by ID for reliable status reads:

```
Now:
(empty — start from Next P1s)

Next P1:
https://www.notion.so/34fad9579339817d9057c55981b28ec7  ← Big Picture layout review

Next P2 (new this session):
https://www.notion.so/352ad957933981f39269f7b5dffcf4fa  ← Cash Trend chart timeline toggle
https://www.notion.so/352ad9579339815aa98ef17a60ff3905  ← Audit and normalize dashboard grid gaps and section spacing
353ad957-9339-815a-8f84-f52775db42a5  ← Stage 4 — Qualitative testing
```
