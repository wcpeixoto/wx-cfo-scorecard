-- Wodify monthly metrics — schema + access model (docs/wo-wodify-monthly-sync.md Phase B).
--
-- SELF-CONTAINED SNAPSHOT (repo convention): tables, grants, RLS, the gate token
-- and the RPCs live together so the security boundary is auditable in one file.
-- Re-applying is idempotent. Live migration name: wodify_monthly_metrics_v1.
-- The SCHEDULE is separate (wodify_monthly_metrics_schedule.sql) so it can be
-- switched on only after acceptance.
--
-- AGGREGATES ONLY. Every row is a monthly count / sum / rate (formulas in
-- docs/wodify-metrics.md). No name, email, phone, client id, lead id,
-- membership id or invoice id is stored anywhere in these tables; the writer
-- (sync-wodify-metrics) also rejects any row outside the aggregate contract.
--
-- ACCESS: service_role only (the Edge Function). No anon / authenticated grant
-- and no policy — the monthly report and attack plan read these with SQL. A
-- dashboard read path is a separate WO.

-- ─── Metrics (long format) ─────────────────────────────────────────────────
create table if not exists public.wodify_monthly_metrics (
  period_month date not null,                -- first day of the New York month
  metric_key text not null,
  dimension text not null default 'all',     -- 'all' or '<family>:<catalog value>'
  value numeric not null,
  as_of timestamptz not null default now(),  -- when the run that wrote this row finished
  run_id text not null,
  source_as_of date null,                    -- v3 census snapshot date for v3-derived rows, else null
  primary key (period_month, metric_key, dimension),
  constraint wodify_monthly_metrics_month_chk check (extract(day from period_month) = 1)
);

-- ─── Runs (one row per run; counts only) ──────────────────────────────────
create table if not exists public.wodify_metrics_runs (
  run_id uuid primary key,
  kind text not null check (kind in ('weekly', 'close', 'backfill', 'manual')),
  months text[] not null,                    -- 'YYYY-MM' months covered
  status text not null check (status in ('running', 'succeeded', 'failed', 'abandoned')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null,
  calls_made integer not null default 0,     -- Wodify GET calls
  rate_limited integer not null default 0,   -- Wodify 429s (any 429 fails the run)
  links integer not null default 0,          -- function invocations used
  tasks jsonb not null,                      -- [{key, status, calls, ms}]
  error text null,                           -- fixed-vocabulary code, never a message body
  diagnostics jsonb null                     -- counts only
);
create index if not exists wodify_metrics_runs_started_at_idx on public.wodify_metrics_runs (started_at desc);

-- Per-task aggregate rows of a run, merged at finalize. Aggregate rows only.
create table if not exists public.wodify_metrics_run_tasks (
  run_id uuid not null references public.wodify_metrics_runs (run_id) on delete cascade,
  task_key text not null,
  finished_at timestamptz not null default now(),
  calls integer not null,
  rows jsonb not null,
  diagnostics jsonb null,
  primary key (run_id, task_key)
);

-- ─── Grants + RLS: service_role only ──────────────────────────────────────
revoke all on public.wodify_monthly_metrics from public, anon, authenticated;
revoke all on public.wodify_metrics_runs from public, anon, authenticated;
revoke all on public.wodify_metrics_run_tasks from public, anon, authenticated;
grant select, insert, update, delete on public.wodify_monthly_metrics to service_role;
grant select, insert, update, delete on public.wodify_metrics_runs to service_role;
grant select, insert, update, delete on public.wodify_metrics_run_tasks to service_role;
alter table public.wodify_monthly_metrics enable row level security;
alter table public.wodify_metrics_runs enable row level security;
alter table public.wodify_metrics_run_tasks enable row level security;

-- ─── Gate token (Vault) ───────────────────────────────────────────────────
-- Random 64-hex token generated in the database; its value never appears in the
-- repo, a GitHub secret, or a log. Callers read it from Vault server-side.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'wodify_metrics_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'wodify_metrics_token',
      'Gate token for the sync-wodify-metrics Edge Function (pg_net / pg_cron callers)'
    );
  end if;
end $$;

create or replace function public.wodify_metrics_check_token(t text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    t is not null and length(t) >= 32 and
    extensions.digest(t, 'sha256') = (
      select extensions.digest(s.decrypted_secret, 'sha256')
      from vault.decrypted_secrets s
      where s.name = 'wodify_metrics_token'
      limit 1
    ),
    false
  );
$$;
revoke all on function public.wodify_metrics_check_token(text) from public, anon, authenticated;
grant execute on function public.wodify_metrics_check_token(text) to service_role;

-- ─── Atomic month replace (idempotent writer) ────────────────────────────
-- Upserts the run's rows and deletes rows of the same months that the run no
-- longer produces (e.g. a class slot that disappeared), in one transaction.
create or replace function public.wodify_metrics_replace_months(p_run_id text, p_months date[], p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(period_month date)
    where not (r.period_month = any (p_months))
  ) then
    raise exception 'row outside run months';
  end if;

  delete from public.wodify_monthly_metrics m
  where m.period_month = any (p_months)
    and not exists (
      select 1 from jsonb_to_recordset(p_rows) as r(period_month date, metric_key text, dimension text)
      where r.period_month = m.period_month and r.metric_key = m.metric_key and r.dimension = m.dimension
    );

  insert into public.wodify_monthly_metrics (period_month, metric_key, dimension, value, as_of, run_id, source_as_of)
  select r.period_month, r.metric_key, r.dimension, r.value, now(), p_run_id, r.source_as_of
  from jsonb_to_recordset(p_rows) as r(period_month date, metric_key text, dimension text, value numeric, source_as_of date)
  on conflict (period_month, metric_key, dimension) do update
    set value = excluded.value, as_of = excluded.as_of, run_id = excluded.run_id, source_as_of = excluded.source_as_of;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.wodify_metrics_replace_months(text, date[], jsonb) from public, anon, authenticated;
grant execute on function public.wodify_metrics_replace_months(text, date[], jsonb) to service_role;

-- ─── Start helper (pg_cron and operators) ─────────────────────────────────
-- Fires the Edge Function through pg_net with the Vault token. kind: weekly |
-- close | backfill | manual (manual needs p_months, e.g. '{2026-09}').
create or replace function public.wodify_metrics_start(p_kind text, p_months text[] default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'wodify_metrics_token';
  if v_token is null then
    raise exception 'wodify_metrics_token missing';
  end if;
  return net.http_post(
    url := 'https://gzgxcvjvoivlwaksnmxy.supabase.co/functions/v1/sync-wodify-metrics',
    body := jsonb_strip_nulls(jsonb_build_object('mode', 'start', 'kind', p_kind, 'months', to_jsonb(p_months))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-metrics-token', v_token),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function public.wodify_metrics_start(text, text[]) from public, anon, authenticated;

notify pgrst, 'reload schema';
