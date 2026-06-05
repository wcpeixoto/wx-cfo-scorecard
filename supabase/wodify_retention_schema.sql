-- Wodify Retention aggregate — schema + access model (RETENTION_FINISH_PLAN.md §6).
--
-- SELF-CONTAINED ON PURPOSE. Unlike the shared-persistence tables (DDL in
-- shared_persistence_schema.sql, policies in first_test_policies.sql, all
-- anon read+write), this table introduces the repo's FIRST service-role write
-- path, so its DDL and access model live together here to keep the security
-- boundary auditable in one file. Apply this file in the Supabase SQL Editor
-- alongside the other two (order-independent — it references no other table).
--
-- WHY THIS TABLE IS ANON-READABLE (the member-PII anon-key blocker):
-- the SPA reads it with the public anon key, which is safe ONLY because the row
-- holds NO PII. There is structurally no member-level column here — every column
-- is a snapshot-level date, a count, or the counts-only days-absent histogram.
-- No id, name, exact member date, or dues value is ever stored. The Edge
-- Function sync-wodify-retention is the only writer and writes with the
-- service-role key (which bypasses RLS); anon gets SELECT only.
--
-- Storage pattern: append-only snapshots. Each manual/admin-triggered sync
-- inserts one row; "latest" = highest fetched_at (see the index). History is
-- kept cheaply for a future trend, but no trend is computed in this slice.
--
-- Data API exposure: as of the Supabase rollout (new projects 2026-05-30 /
-- existing 2026-10-30) tables in `public` are not auto-exposed to the Data API,
-- so the explicit `grant select ... to anon` below is REQUIRED for the SPA to
-- read this table even with a permissive RLS policy.

create table if not exists public.wodify_retention_aggregate (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default', -- soft scope, mirrors repo convention
  source text not null default 'wodify',
  as_of date not null,                           -- our whole-day-diff anchor (server fetch date)
  fetched_at timestamptz not null default now(), -- when the sync ran; latest-row selector
  active_total integer not null,                 -- active members scanned this snapshot
  -- Threshold-free exact-day histogram over ACTIVE members (non-PII counts only):
  -- { maxExactDays: 364, countsByDaysAbsent: { "<days>": <count> }, overflow365Plus: <count> }.
  -- The SPA derives Silent Churn count + Healthy/Watch/Silent at ANY owner threshold from this.
  days_absent_histogram jsonb not null,
  unknown_count integer not null,                -- active, missing/sentinel/invalid lastCheckIn
  -- Silent Churn dues gap: /clients carries no dues, so the dollar is unavailable
  -- this slice. Always null + missing flag true — never a fabricated 0.
  monthly_dues_at_risk numeric null,
  missing_monthly_dues boolean not null default true,
  -- Diagnostics: Wodify's own at-risk flag count (not used to classify).
  wodify_at_risk_count integer not null default 0,
  -- Data quality counters.
  unknown_status integer not null default 0,     -- rows with unmappable status (excluded)
  future_last_check_in integer not null default 0, -- lastCheckIn after asOf (binned at day 0)
  pages_fetched integer not null default 0,
  clients_scanned integer not null default 0
);

-- Latest snapshot per workspace = order by fetched_at desc limit 1.
create index if not exists wodify_retention_aggregate_workspace_fetched_at_idx
  on public.wodify_retention_aggregate (workspace_id, fetched_at desc);

-- Access model -------------------------------------------------------------
-- anon: SELECT only (safe — non-PII). NO insert/update/delete grant.
-- service_role: insert + select (the Edge Function writer). service_role also
-- bypasses RLS, so the read policy below is purely for the anon browser path.
grant select on public.wodify_retention_aggregate to anon;
grant select, insert on public.wodify_retention_aggregate to service_role;

alter table public.wodify_retention_aggregate enable row level security;

-- anon read policy (scoped to the default workspace, matching the writer). There
-- is intentionally NO anon write policy: combined with the missing write grant,
-- anon writes are blocked two ways (defense in depth). The service-role writer
-- bypasses RLS entirely and needs no policy.
drop policy if exists "wodify_retention_aggregate_anon_read" on public.wodify_retention_aggregate;
create policy "wodify_retention_aggregate_anon_read"
on public.wodify_retention_aggregate
for select
to anon
using (workspace_id = 'default');
