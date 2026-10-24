-- Student movement dashboard read path (monthly metrics, anon SELECT, narrow).
--
-- The SPA reads with the public anon key, so exposure is limited on BOTH axes:
--   rows:    only the four student-movement metrics, only the gym-wide ('all') dimension
--   columns: SELECT only — no insert / update / delete / truncate / references / trigger
-- Nothing else changes: wodify_metrics_runs and wodify_metrics_run_tasks stay service_role
-- only (freshness for the dashboard comes from each row's own as_of), and no other table
-- or function is touched.
--
-- `revoke all ... from anon` first so the single grant below is the complete anon privilege
-- set on this table even if a default privilege or earlier grant drifted. `authenticated`
-- and `public` keep the revoke from wodify_monthly_metrics_schema.sql.

revoke all on public.wodify_monthly_metrics from anon;
grant select on public.wodify_monthly_metrics to anon;

drop policy if exists "wodify_monthly_metrics_anon_read" on public.wodify_monthly_metrics;
create policy "wodify_monthly_metrics_anon_read"
  on public.wodify_monthly_metrics
  for select
  to anon
  using (
    metric_key in ('new_students', 'rejoins', 'cancellations', 'active_students')
    and dimension = 'all'
  );

-- No insert / update / delete policy and no such grant, by design (two barriers).
-- The service-role writer (sync-wodify-metrics) bypasses RLS and needs no policy.

notify pgrst, 'reload schema';
