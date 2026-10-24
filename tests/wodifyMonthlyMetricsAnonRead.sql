-- Post-apply check for supabase/migrations/20261024150000_wodify_monthly_metrics_anon_read.sql.
-- Run AFTER the migration is applied, as the `postgres` role (Supabase SQL Editor, or psql). It needs
-- to see every role's grants in information_schema and to `set local role anon`.
--
-- Read-only in effect: everything runs inside one transaction that is rolled back, and the
-- write probes are expected to be DENIED before they touch a row. If a probe unexpectedly
-- succeeds, the raise exception aborts the transaction, so nothing persists either way.
begin;

-- 1. Catalog state: anon holds exactly SELECT; the other roles hold nothing; RLS is on.
do $$
declare
  anon_privs text;
begin
  select string_agg(privilege_type, ',' order by privilege_type) into anon_privs
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'wodify_monthly_metrics' and grantee = 'anon';
  if anon_privs is distinct from 'SELECT' then
    raise exception 'anon privileges on wodify_monthly_metrics are %, expected SELECT only', anon_privs;
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'wodify_monthly_metrics'
      and grantee in ('authenticated', 'PUBLIC') -- information_schema reports the public grantee in caps
  ) then
    raise exception 'authenticated/public must hold no privilege on wodify_monthly_metrics';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.wodify_monthly_metrics'::regclass) then
    raise exception 'RLS is not enabled on wodify_monthly_metrics';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'wodify_monthly_metrics') <> 1 then
    raise exception 'expected exactly one policy on wodify_monthly_metrics';
  end if;
end $$;

-- 2. Behaviour as the browser's role.
set local role anon;

-- Only the four student-movement metrics, only dimension 'all', are visible.
do $$
begin
  if exists (
    select 1 from public.wodify_monthly_metrics
    where metric_key not in ('new_students', 'rejoins', 'cancellations', 'active_students')
       or dimension <> 'all'
  ) then
    raise exception 'anon can see rows outside the policy scope';
  end if;
  if not exists (select 1 from public.wodify_monthly_metrics) then
    raise exception 'anon sees no rows — policy or data missing';
  end if;
  -- Spot-check that the excluded keys really exist for service_role but not for anon.
  if exists (select 1 from public.wodify_monthly_metrics where metric_key = 'cancellations_all_clients') then
    raise exception 'cancellations_all_clients leaked to anon';
  end if;
end $$;

-- Writes are denied (privilege check fires before any row is touched).
do $$
begin
  begin
    insert into public.wodify_monthly_metrics (period_month, metric_key, dimension, value, run_id)
    values ('2099-01-01', 'new_students', 'all', 1, 'anon-probe');
    raise exception 'anon INSERT succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.wodify_monthly_metrics set value = value where false;
    raise exception 'anon UPDATE succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.wodify_monthly_metrics where false;
    raise exception 'anon DELETE succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The run-status tables stay closed to anon.
do $$
begin
  begin
    perform 1 from public.wodify_metrics_runs limit 1;
    raise exception 'anon can read wodify_metrics_runs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.wodify_metrics_run_tasks limit 1;
    raise exception 'anon can read wodify_metrics_run_tasks';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
