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

-- Recommended cleanup before any broader rollout:
-- 1. drop these first-test policies
-- 2. replace anon access with authenticated policies or a server-side write path
-- 3. keep RLS enabled
