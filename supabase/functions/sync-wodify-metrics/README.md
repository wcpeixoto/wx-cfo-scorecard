# sync-wodify-metrics

Writes monthly Wodify counts to `public.wodify_monthly_metrics` (formulas:
`docs/wodify-metrics.md`; work order: `docs/wo-wodify-monthly-sync.md`).

- **GET only.** The Wodify key can write, so the client in
  `src/lib/gym/wodifyMonthlyMetrics.ts` allowlists `GET` and throws on any other
  method before a request is built (tested).
- **Counts only.** Person-level rows live in memory inside one request. Only
  aggregate rows are stored (`assertAggregateRows` rejects anything else).
- **Gate.** `verify_jwt = false`; every request must carry `x-metrics-token`,
  checked by the service-role-only RPC `public.wodify_metrics_check_token`
  against the Vault secret `wodify_metrics_token`. Fails closed.
- **Secrets used.** `WODIFY_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  (project-level, shared with `sync-wodify-retention`). No new secret to set.

## Run model

`start` creates a `wodify_metrics_runs` row with ordered tasks and returns 202.
Work runs in the background (`EdgeRuntime.waitUntil`). A link runs tasks until
~100 s have elapsed, then POSTs `continue` to itself; the last link merges the
task rows with the v3 census rows and replaces the run's months atomically
(`public.wodify_metrics_replace_months`). One run at a time; a run with no
progress for 20 minutes is marked `abandoned` by the next start. Any Wodify 429
fails the run (`error = 'wodify_http_429'`).

Tasks: `core` (clients, memberships, leads, conversion details, rejoin details) ·
`funnel` (lead reservations, lead + client sign-ins) · `cancel:0..2` (details of
non-active clients, split by id) · `inv:YYYY-MM` (invoices + line details).

## Operate

```sql
-- start (kind: weekly | close | backfill | manual)
select public.wodify_metrics_start('manual', '{2026-09}');

-- watch
select run_id, kind, months, status, calls_made, rate_limited, links, error, finished_at
from public.wodify_metrics_runs order by started_at desc limit 5;
```

Schedule (apply after acceptance): `supabase/wodify_monthly_metrics_schedule.sql`.

## Deploy

```bash
supabase functions deploy sync-wodify-metrics --no-verify-jwt
```
