-- Temporary first-test RLS policies for a dedicated non-production Supabase project.
-- Use only for local/staging verification with non-sensitive data.
-- Replace every occurrence of 'default' below if you use a different
-- VITE_SHARED_WORKSPACE_ID in your local .env.local.
--
-- This policy set intentionally allows anon browser access for one workspace
-- so the current client-only integration can be tested across browsers.
-- Do not use this policy file for production rollout.

alter table public.shared_imported_transactions enable row level security;
alter table public.shared_import_batches enable row level security;
alter table public.shared_account_settings enable row level security;

revoke all on function public.replace_shared_imported_store(text, jsonb, jsonb) from public;
grant execute on function public.replace_shared_imported_store(text, jsonb, jsonb) to anon;

drop policy if exists "first_test_read_shared_imported_transactions" on public.shared_imported_transactions;
drop policy if exists "first_test_write_shared_imported_transactions" on public.shared_imported_transactions;
drop policy if exists "first_test_read_shared_import_batches" on public.shared_import_batches;
drop policy if exists "first_test_write_shared_import_batches" on public.shared_import_batches;
drop policy if exists "first_test_read_shared_account_settings" on public.shared_account_settings;
drop policy if exists "first_test_write_shared_account_settings" on public.shared_account_settings;

create policy "first_test_read_shared_imported_transactions"
on public.shared_imported_transactions
for select
to anon
using (workspace_id = 'default');

create policy "first_test_write_shared_imported_transactions"
on public.shared_imported_transactions
for all
to anon
using (workspace_id = 'default')
with check (workspace_id = 'default');

create policy "first_test_read_shared_import_batches"
on public.shared_import_batches
for select
to anon
using (workspace_id = 'default');

create policy "first_test_write_shared_import_batches"
on public.shared_import_batches
for all
to anon
using (workspace_id = 'default')
with check (workspace_id = 'default');

create policy "first_test_read_shared_account_settings"
on public.shared_account_settings
for select
to anon
using (workspace_id = 'default');

create policy "first_test_write_shared_account_settings"
on public.shared_account_settings
for all
to anon
using (workspace_id = 'default')
with check (workspace_id = 'default');

-- Forecast events: same first-test pattern as the tables above.
-- Single-workspace read+write for anon, scoped by workspace_id.
-- Requires the forecast_events table from shared_persistence_schema.sql.

alter table public.forecast_events enable row level security;

drop policy if exists "first_test_read_forecast_events" on public.forecast_events;
drop policy if exists "first_test_write_forecast_events" on public.forecast_events;

create policy "first_test_read_forecast_events"
on public.forecast_events
for select
to anon
using (workspace_id = 'default');

create policy "first_test_write_forecast_events"
on public.forecast_events
for all
to anon
using (workspace_id = 'default')
with check (workspace_id = 'default');

-- Renewal contracts (Phase 5.1): same first-test pattern as the tables
-- above. Single-workspace read+write for anon, scoped by workspace_id.
-- Requires the renewal_contracts table from shared_persistence_schema.sql.
-- Without these policies, anon clients see an empty result set even when
-- rows exist (RLS-enabled table with no policy = deny by default).

alter table public.renewal_contracts enable row level security;

drop policy if exists "first_test_read_renewal_contracts" on public.renewal_contracts;
drop policy if exists "first_test_write_renewal_contracts" on public.renewal_contracts;

create policy "first_test_read_renewal_contracts"
on public.renewal_contracts
for select
to anon
using (workspace_id = 'default');

create policy "first_test_write_renewal_contracts"
on public.renewal_contracts
for all
to anon
using (workspace_id = 'default')
with check (workspace_id = 'default');

-- Priority history (CFO Assistant): unlike the tables above, these live
-- policies are scoped to the public role with unconditional predicates
-- (using true / with check true) rather than to anon with a workspace_id
-- filter. Snapshot matches what was created out-of-band in the dashboard.
-- Requires the priority_history table from shared_persistence_schema.sql.

alter table public.priority_history enable row level security;

drop policy if exists "Enable read access for all users" on public.priority_history;
drop policy if exists "first_test_write_priority_history" on public.priority_history;

create policy "Enable read access for all users"
on public.priority_history
for select
to public
using (true);

create policy "first_test_write_priority_history"
on public.priority_history
for all
to public
using (true)
with check (true);

-- Priority prose cache (CFO Assistant): same public-role / unconditional
-- pattern as priority_history above.
-- Requires the priority_prose_cache table from shared_persistence_schema.sql.

alter table public.priority_prose_cache enable row level security;

drop policy if exists "Enable read access for all users" on public.priority_prose_cache;
drop policy if exists "first_test_write_priority_prose_cache" on public.priority_prose_cache;

create policy "Enable read access for all users"
on public.priority_prose_cache
for select
to public
using (true);

create policy "first_test_write_priority_prose_cache"
on public.priority_prose_cache
for all
to public
using (true)
with check (true);

-- Recommended cleanup before any broader rollout:
-- 1. drop these first-test policies
-- 2. replace anon access with authenticated policies or a server-side write path
-- 3. keep RLS enabled
