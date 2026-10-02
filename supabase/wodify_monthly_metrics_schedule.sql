-- Wodify monthly metrics — schedule (apply ONLY after acceptance sign-off).
--
-- Supabase pg_cron fires at exact UTC times; GitHub's scheduler was 5h46m–7h17m
-- late on the three most recent weekly census runs (cron 12:00 UTC, started
-- 17:46–19:17 UTC), which would miss the 15:00 ET deadline. pg_cron runs in UTC.
--
--   weekly — Mondays 15:00 UTC = 11:00 EDT / 10:00 EST. Recomputes the previous
--            and current month. Runs ~10–15 min; done well before 15:00 ET
--            (19:00 UTC in EDT, 20:00 UTC in EST).
--   close  — 1st of the month 11:00 UTC = 07:00 EDT / 06:00 EST (after New York
--            midnight in both). Recomputes the two months before the current
--            one, so the older month's 30-day enrollment window has closed.
--
-- Requires wodify_monthly_metrics_schema.sql (public.wodify_metrics_start).
-- Re-applying is idempotent: cron.schedule replaces a job with the same name.

create extension if not exists pg_cron;

select cron.schedule('wodify-metrics-weekly', '0 15 * * 1', $$select public.wodify_metrics_start('weekly')$$);
select cron.schedule('wodify-metrics-close', '0 11 1 * *', $$select public.wodify_metrics_start('close')$$);

-- Undo:
--   select cron.unschedule('wodify-metrics-weekly');
--   select cron.unschedule('wodify-metrics-close');
