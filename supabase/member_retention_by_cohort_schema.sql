-- member_retention_by_cohort — monthly Class-Plan MEMBERSHIP retention (New / Returning / Lost),
-- partitioned by AGE COHORT, one row per (workspace_id, period_month, cohort_band).
--
-- DEEP-MANUAL age-segment pipeline (WO-1). The substrate is Wodify's CLIENT-GRAIN "Member Retention"
-- export ⋈ /clients date_of_birth, aged as-of each event's MAPPED retention period. Feasibility is
-- CLOSED: the gym-wide sums reconcile EXACTLY to member_retention_rates (#495) under the proven +1
-- month mapping (period_month = client-grain First-Of-Month + 1 month), the count basis is the Change
-- Type LABEL (a Lost ROW = one member), and the DOB join age-resolves 465/465 with 100% usable DOB and
-- no churn-population bias. Built by scripts/wodify/buildMemberRetentionByCohort.ts under the two-AI
-- gate; the data rows are written by the GATED import (Supabase MCP), NEVER by an anon browser path.
--
-- THIS IS CLASS-PLAN MEMBERSHIP RETENTION — NOT attendance-based classifyMember / Silent-Churn churn
-- (that is the recency/lapsed STOCK in wodify_retention_aggregate.cohort_histogram, a different metric,
-- source, and grain). The two are both age-banded, which is exactly why cohort_histogram is enumerated
-- as an auxiliary reconstruction margin by the suppression contract (its stock-vs-flow linkage is weak).
--
-- WHY ANON-READABLE (the member-PII anon-key blocker): the SPA reads with the public anon key, safe
-- ONLY because the row holds NO PII — every column is a period label, a cohort-band LABEL, a count, or a
-- boolean. There is structurally no member-level column. Age is derived server-/build-side from
-- date_of_birth, which never leaves the local join step; only the per-cohort COUNTS land here. Per the
-- owner-dashboard "Retention page data policy" (AGENTS.md, 2026-06-27) these aggregate counts — including
-- small ones and counts of 1 — may be shown; there is no <5 suppression on the owner-dashboard rows. The
-- `suppressed` column + the build's solver are retained ONLY for a possible future public/export mode.
-- Access mirrors wodify_retention_aggregate (#440-hardened):
-- anon SELECT only; NO anon write path. This is deliberately TIGHTER than member_retention_rates, whose
-- anon-write relaxation does not extend here.
--
-- Self-contained (DDL + constraints + grants + RLS in one file) so the security boundary is auditable
-- at a glance, mirroring wodify_retention_schema.sql / member_retention_rates_schema.sql. Apply in the
-- Supabase SQL Editor; order-independent (it references no other table).
--
-- Re-application note: `create table if not exists` does NOT backfill columns on an existing table. If a
-- prior version was applied, add new columns explicitly with `alter table ... add column if not exists`.

create table if not exists public.member_retention_by_cohort (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',     -- soft scope, mirrors repo convention + the anon RLS policy
  period_month text not null,                        -- 'YYYY-MM' aggregate period = client-grain First-Of-Month + 1 month
  cohort_band text not null,                          -- one of the 3 build-local ids below (Youth / Adults 16+ / Unknown)
  -- New / Returning / Lost counts for this (period, cohort), counted by Change Type LABEL (a Lost ROW =
  -- one member). NULLABLE on purpose: a SUPPRESSED row carries all three as null (see suppressed +
  -- the integrity check below). An unsuppressed row carries explicit non-null counts, including a real 0.
  new_members integer,
  returning_members integer,
  lost_members integer,
  -- Row-level suppression flag. For the OWNER-DASHBOARD output this is ALWAYS false and all three counts
  -- are real (AGENTS.md "Retention page data policy" — aggregate counts incl. 1 may be shown; identity-
  -- level data forbidden). The column + the null-when-true shape are RETAINED for a possible future
  -- public/shared/export mode (the build's PUBLIC_EXPORT_MODE), where a sensitive small or complementary
  -- cell would publish null. When true, all three counts are null (enforced below).
  suppressed boolean not null default false,
  fetched_at timestamptz not null default now(),     -- when the build ran; latest-write selector

  -- retention_rate is DELIBERATELY NOT a column. It is derived on read as
  -- returning_members / (returning_members + lost_members), guarding prior = 0 (a zero-event band → null,
  -- never 0/0). Persisting a 2-decimal rate is the #495 drift bug Gate 2 caught: a stored rounded rate
  -- can disagree with the counts. Counts are the source of truth; the rate is a pure function of them.

  -- workspace_id sanity (non-empty); RLS scopes reads to 'default'.
  constraint member_retention_by_cohort_workspace_chk check (length(workspace_id) > 0),
  -- strict 'YYYY-MM' (months 01..12 only) — rejects a stray day-level date or a malformed period.
  constraint member_retention_by_cohort_period_chk check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- cohort_band allowlist — the build-LOCAL Youth/Adults banding, DECOUPLED from cohortBands.ts COHORT_BANDS
  -- (which stays 4-band for the live SPA surfaces: MembersByAgeGroupCard / churnRiskByCohort /
  -- wodifyRetentionAggregate → the sync-wodify-retention Edge Function). youth3to15 = the union of ages 1–15
  -- (the prior kids3to6 ∪ kids7to9 ∪ teens10to15 windows; floor 1, under-3s folded in per cohortBands.ts),
  -- adults16plus = 16+, unknownCohort = unusable/out-of-range DOB. The build asserts this same 3-set
  -- (SCHEMA_BAND_ALLOWLIST) so the SQL and the build script cannot silently drift.
  constraint member_retention_by_cohort_band_chk check (
    cohort_band in ('youth3to15', 'adults16plus', 'unknownCohort')
  ),
  -- nonnegative counts (when present).
  constraint member_retention_by_cohort_new_nonneg_chk check (new_members is null or new_members >= 0),
  constraint member_retention_by_cohort_returning_nonneg_chk check (returning_members is null or returning_members >= 0),
  constraint member_retention_by_cohort_lost_nonneg_chk check (lost_members is null or lost_members >= 0),
  -- suppression integrity: suppressed ⇔ all three counts null; unsuppressed ⇔ all three non-null.
  -- Owner-dashboard rows are always the unsuppressed branch (real counts). The check is KEPT (not relaxed)
  -- so the retained public/export mode cannot emit a half-suppressed row that leaks one measure.
  constraint member_retention_by_cohort_suppress_chk check (
    (suppressed and new_members is null and returning_members is null and lost_members is null)
    or
    (not suppressed and new_members is not null and returning_members is not null and lost_members is not null)
  )
);

-- Idempotency key: one row per (workspace_id, period_month, cohort_band). The gated import upserts on
-- this key (ON CONFLICT DO UPDATE) and NEVER deletes/truncates, so re-running a later month PRESERVES
-- all earlier months. A NAMED constraint via ALTER TABLE (not a bare CREATE UNIQUE INDEX) so it is clear
-- to introspect AND fires this project's pgrst_ddl_watch schema-cache reload (makes the on_conflict
-- arbiter visible to the Data API). Guarded with a DO block so this snapshot file stays re-appliable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_retention_by_cohort_workspace_period_band_key'
      and conrelid = 'public.member_retention_by_cohort'::regclass
  ) then
    alter table public.member_retention_by_cohort
      add constraint member_retention_by_cohort_workspace_period_band_key
      unique (workspace_id, period_month, cohort_band);
  end if;
end $$;

create index if not exists member_retention_by_cohort_workspace_period_idx
  on public.member_retention_by_cohort (workspace_id, period_month);

notify pgrst, 'reload schema';

-- Access model -------------------------------------------------------------
-- Mirrors wodify_retention_aggregate (#440-hardened), NOT member_retention_rates. After this file:
--   anon          → SELECT only (the browser reads with the anon key; no write path)
--   authenticated → SELECT only
--   service_role  → SELECT + INSERT + UPDATE (the gated import upserts to persist; bypasses RLS)
-- Supabase's default privileges grant the FULL DML set to anon + authenticated on every new public
-- table, so `grant select to anon` alone does NOT restrict writes — the broad defaults are REVOKED
-- below (defense in depth atop RLS). NEVER revoke SELECT/INSERT/UPDATE from service_role.
-- NOTE: the gated import may run as the platform SQL-editor role via Supabase MCP execute_sql (OUTSIDE
-- the Data API), governed by human authorization (Reviewer PASS + owner GO), not by these grants —
-- exactly the silent_dues_snapshot precedent. The grants here cover the service_role Data-API path.
grant select on public.member_retention_by_cohort to anon;
grant select, insert, update on public.member_retention_by_cohort to service_role;

revoke insert, update, delete, truncate, references, trigger
  on public.member_retention_by_cohort
  from anon, authenticated;

alter table public.member_retention_by_cohort enable row level security;

-- anon read policy, scoped to the default workspace. There is intentionally NO anon write policy — this
-- RLS gap is the PRIMARY barrier blocking anon writes, reinforced by the grant revoke above (two
-- barriers). The service-role / gated writer bypasses RLS and needs no policy.
drop policy if exists "member_retention_by_cohort_anon_read" on public.member_retention_by_cohort;
create policy "member_retention_by_cohort_anon_read"
  on public.member_retention_by_cohort
  for select
  to anon
  using (workspace_id = 'default');
