-- member_retention_rates — monthly "Member Retention Rates" aggregate (Class Plan member/renewal
-- retention), sourced from Wodify Analytics → Custom Reports Beta. NON-PII: monthly counts + a rate
-- only, never member rows. Anon-readable (the SPA reads it for the churn-evolution chart) AND
-- anon-WRITABLE: the click-only Settings → Data import (src/lib/gym/memberRetentionImport.ts) upserts
-- the RAW Wodify export straight from the browser, which holds only the public anon key. The CLI seed
-- (scripts/wodify/seedMemberRetentionRates.ts) still emits gated SQL for a service_role apply.
--
-- SECURITY BOUNDARY — CONSCIOUS RELAXATION. anon now holds INSERT/UPDATE (not just SELECT), mirroring
-- the financial-transactions import (shared_imported_transactions; first_test_policies.sql). The
-- public anon key ships in the SPA bundle, so these monthly retention COUNTS become writable by anyone
-- holding that key — the same posture the imported-transaction data already has. Acceptable here
-- because the table is NON-PII monthly aggregates only (counts + a rate), never member rows. anon has
-- NO delete/truncate (blocked at BOTH the grant and RLS layers). Tighten to authenticated / a
-- server-side write path before any broader rollout.
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

-- Access model — anon SELECT + INSERT/UPDATE (RLS-scoped to the default workspace); service_role
-- retains full write. anon explicitly has NO delete/truncate. Mirrors the financial-transactions
-- import grants in first_test_policies.sql.
grant select, insert, update on public.member_retention_rates to anon;
grant select, insert, update on public.member_retention_rates to service_role;

revoke delete, truncate, references, trigger
  on public.member_retention_rates
  from anon, authenticated;

alter table public.member_retention_rates enable row level security;

drop policy if exists "member_retention_rates_anon_read" on public.member_retention_rates;
create policy "member_retention_rates_anon_read"
  on public.member_retention_rates
  for select
  to anon
  using (workspace_id = 'default');

-- Anon write policies — INSERT + UPDATE scoped to the default workspace, as SEPARATE policies (not a
-- single `for all`) so anon-DELETE is blocked at BOTH layers: no grant AND no RLS policy. Defense in
-- depth — if a future `grant all` ever re-adds delete to anon, the missing delete policy still blocks
-- it. INSERT needs only WITH CHECK; UPDATE needs USING (to see the conflicting row) + WITH CHECK (keep
-- it in-workspace). Together they satisfy the PostgREST merge-duplicates upsert
-- (INSERT … ON CONFLICT DO UPDATE) while granting strictly less than `for all`.
drop policy if exists "member_retention_rates_anon_write" on public.member_retention_rates;  -- retire any prior for-all policy
drop policy if exists "member_retention_rates_anon_insert" on public.member_retention_rates;
create policy "member_retention_rates_anon_insert"
  on public.member_retention_rates
  for insert
  to anon
  with check (workspace_id = 'default');

drop policy if exists "member_retention_rates_anon_update" on public.member_retention_rates;
create policy "member_retention_rates_anon_update"
  on public.member_retention_rates
  for update
  to anon
  using (workspace_id = 'default')
  with check (workspace_id = 'default');

notify pgrst, 'reload schema';
