-- member_retention_rates — monthly "Member Retention Rates" aggregate (Class Plan member/renewal
-- retention), sourced from Wodify Analytics → Custom Reports Beta. NON-PII: monthly counts + a rate
-- only, never member rows. Anon-readable (the SPA reads it for the churn-evolution chart); seeded by
-- a human-gated upsert from the local CSV (scripts/wodify/seedMemberRetentionRates.ts) — there is no
-- edge writer for this table yet (manual re-load to refresh; automation is a later follow-up).
--
-- Self-contained (DDL + grants + RLS in one file) so the security boundary is auditable at a glance,
-- mirroring wodify_retention_schema.sql. Apply in the Supabase SQL Editor; order-independent.

create table if not exists public.member_retention_rates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  period_month text not null,                       -- 'YYYY-MM' calendar month
  current_members integer not null,                 -- members active at month-end
  prior_members integer not null,                   -- members active at the start of the month (the rate denominator)
  lost_members integer not null,
  new_members integer not null,
  returning_members integer not null,               -- prior − lost (the rate numerator), as reported
  retention_rate numeric not null,                  -- returning / prior, 0..1, as reported
  is_seed_boundary boolean not null default false,  -- tracking-onboarding boundary month — excluded from the trend (No fake history)
  fetched_at timestamptz not null default now()
);

-- Idempotency key: one row per (workspace, month). Re-seeding upserts on conflict.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'member_retention_rates_workspace_period_key'
  ) then
    alter table public.member_retention_rates
      add constraint member_retention_rates_workspace_period_key
      unique (workspace_id, period_month);
  end if;
end $$;

create index if not exists member_retention_rates_workspace_period_idx
  on public.member_retention_rates (workspace_id, period_month);

-- Access model — anon SELECT only (RLS-scoped to the default workspace); service_role writes.
grant select on public.member_retention_rates to anon;
grant select, insert, update on public.member_retention_rates to service_role;

revoke insert, update, delete, truncate, references, trigger
  on public.member_retention_rates
  from anon, authenticated;

alter table public.member_retention_rates enable row level security;

drop policy if exists "member_retention_rates_anon_read" on public.member_retention_rates;
create policy "member_retention_rates_anon_read"
  on public.member_retention_rates
  for select
  to anon
  using (workspace_id = 'default');

notify pgrst, 'reload schema';
