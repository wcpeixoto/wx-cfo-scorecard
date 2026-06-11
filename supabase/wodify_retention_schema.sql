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
-- is a snapshot-level date, a count, or a counts-only histogram (days-absent /
-- tenure-band). No id, name, exact member date, or dues value is ever stored. The Edge
-- Function sync-wodify-retention is the only writer and writes with the
-- service-role key (which bypasses RLS); anon gets SELECT only.
--
-- Storage pattern: one snapshot row per (workspace_id, as_of) day, written by an
-- IDEMPOTENT UPSERT (see the unique constraint below + the Edge Function writer). A
-- re-pull on the same day REPLACES that day's row (latest pull wins) instead of
-- duplicating it; rows still accumulate across days. "latest" = highest
-- fetched_at (see the fetched_at index). History is kept cheaply for a future
-- trend, but no trend is computed in this slice.
--
-- Data API exposure: as of the Supabase rollout (new projects 2026-05-30 /
-- existing 2026-10-30) tables in `public` are not auto-exposed to the Data API,
-- so the explicit `grant select ... to anon` below is REQUIRED for the SPA to
-- read this table even with a permissive RLS policy.
--
-- Re-application note: `create table if not exists` does NOT backfill columns on
-- an existing table. If a prior version of this table was already applied to the
-- project, re-running this file silently skips any newly-added column. Add new
-- columns explicitly, e.g.:
--   alter table public.wodify_retention_aggregate
--     add column if not exists reached_page_cap boolean not null default false;

create table if not exists public.wodify_retention_aggregate (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default', -- soft scope, mirrors repo convention
  source text not null default 'wodify',
  as_of date not null,                           -- our whole-day-diff anchor (server fetch date)
  fetched_at timestamptz not null default now(), -- when the sync ran; latest-row selector
  active_total integer not null,                 -- active members scanned this snapshot
  -- Member Movement census (§6, BINARY rescope 2026-06-10): the inactive
  -- head-count beside active_total. Binary because Wodify /clients is binary —
  -- the vocab gate proved client_status is exactly Active/Inactive, and the
  -- field-discovery probe proved no other /clients field separates paused from
  -- ended (a paused/ended census is unsourceable; the earlier draft
  -- paused_total/ended_total columns were never applied live and are replaced
  -- by this column). NULLABLE on purpose — a row written before this slice (or
  -- before a re-armed pull) carries no census, and the SPA must tell "column
  -- absent/null → fall back to sample" apart from a real zero. NEVER NOT NULL /
  -- NEVER default 0 (a default would masquerade as a live "0 inactive" census
  -- on a pre-census row).
  inactive_total integer null,                   -- inactive members this snapshot (null until populated)
  -- Threshold-free exact-day histogram over ACTIVE members (non-PII counts only):
  -- { maxExactDays: 364, countsByDaysAbsent: { "<days>": <count> }, overflow365Plus: <count> }.
  -- The SPA derives Silent Churn count + Healthy/Watch/Silent at ANY owner threshold from this.
  days_absent_histogram jsonb not null,
  -- Churn-by-Tenure (§6 aggregate extension): the per-tenure-band partition of
  -- days_absent_histogram + unknown_count over the SAME active members, keyed by
  -- band id (lt3m/3to6m/6to12m/1to2y/2yplus + unknownTenure), each
  -- { countsByDaysAbsent, overflow365Plus, unknownRecency }, plus the bandEdges
  -- contract the SPA validates EXACTLY against its own TENURE_BANDS. Counts only
  -- — no member-level data, sourced from Wodify member_since which never leaves
  -- the server's normalize step. NULLABLE on purpose (same rule as
  -- inactive_total): a row written before this slice carries no tenure
  -- structure, and the SPA must tell "absent/null → Sample fallback" apart from
  -- a real value. NEVER NOT NULL / NEVER a default.
  tenure_band_histogram jsonb null,
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
  reached_page_cap boolean not null default false, -- MAX_PAGES hit with has_more still true → partial snapshot
  clients_scanned integer not null default 0
);

-- Backfill the Member Movement census column onto an ALREADY-APPLIED table.
-- `create table if not exists` above does NOT add columns to a table that already
-- exists (see the re-application note at the top of this file), so this idempotent
-- ALTER is how inactive_total lands on the live table when this snapshot file is
-- re-applied. NULLABLE + no default, matching the column def above: a pre-census
-- row stays null and the SPA falls back to sample rather than showing a fabricated
-- zero. `add column if not exists` makes re-running this file a no-op. (The earlier
-- draft paused_total / ended_total backfills were REMOVED before ever being applied
-- — the live table has never had census columns, verified 2026-06-10.)
alter table public.wodify_retention_aggregate
  add column if not exists inactive_total integer;

-- Backfill the Churn-by-Tenure column the same way (NULLABLE + no default, see
-- the column def above): pre-tenure rows stay null and the SPA falls back to
-- sample rather than rendering a fabricated empty tenure split. `add column if
-- not exists` keeps this file safely re-appliable. The live apply happens only
-- inside the gated §6 run (Step B), never on merge.
alter table public.wodify_retention_aggregate
  add column if not exists tenure_band_histogram jsonb;

-- Latest snapshot per workspace = order by fetched_at desc limit 1.
create index if not exists wodify_retention_aggregate_workspace_fetched_at_idx
  on public.wodify_retention_aggregate (workspace_id, fetched_at desc);

-- Idempotency key: at most one snapshot per (workspace_id, as_of) day. The Edge
-- Function writer upserts on this key (PostgREST `on_conflict=workspace_id,as_of`
-- + `Prefer: resolution=merge-duplicates`), so a same-day re-pull REPLACES the
-- day's aggregate instead of duplicating it. Both columns are NOT NULL, so the
-- unique constraint is exact (non-partial).
--
-- A NAMED UNIQUE CONSTRAINT via ALTER TABLE (not a bare CREATE UNIQUE INDEX) on
-- purpose: it is clearer to introspect AND it fires this project's PostgREST
-- schema-cache auto-reload event trigger (pgrst_ddl_watch reloads on ALTER TABLE
-- but NOT on CREATE INDEX), so the on_conflict arbiter becomes visible to the
-- Data API without a manual reload. Guarded with a DO block so this snapshot file
-- stays safely re-appliable (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`); the
-- constraint is added only if absent, and builds only if there are no duplicate
-- (workspace_id, as_of) rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'wodify_retention_aggregate_workspace_as_of_key'
      and conrelid = 'public.wodify_retention_aggregate'::regclass
  ) then
    alter table public.wodify_retention_aggregate
      add constraint wodify_retention_aggregate_workspace_as_of_key
      unique (workspace_id, as_of);
  end if;
end $$;

-- Refresh the PostgREST / Data API schema cache so on_conflict resolves
-- immediately. The ALTER TABLE above already fires pgrst_ddl_watch; this explicit
-- NOTIFY is harmless, idempotent belt-and-suspenders.
notify pgrst, 'reload schema';

-- Access model -------------------------------------------------------------
-- Security is enforced by the RLS policy below (no anon write policy → anon
-- cannot write via the Data API). The grant layer is the SECOND barrier.
-- IMPORTANT: Supabase's default privileges grant the FULL DML set to anon and
-- authenticated on every new public table, so `grant select to anon` alone does
-- NOT restrict writes — the broad defaults must be explicitly REVOKED (below).
-- After this file:
--   anon          → SELECT only
--   authenticated → SELECT only (no writes; the app uses the anon key)
--   service_role  → required write contract is SELECT + INSERT + UPDATE. The Edge
--                   Function writer UPSERTS (ON CONFLICT (workspace_id, as_of) DO
--                   UPDATE), which needs UPDATE in addition to INSERT; it also
--                   bypasses RLS, so the read policy is purely for the anon
--                   browser path. NOTE: the live service_role role may retain
--                   broader platform/default privileges (e.g. DELETE/TRUNCATE)
--                   that this file neither grants nor revokes — those are NOT part
--                   of the intended write contract, and any actual tightening of
--                   them is a SEPARATE concern, out of scope here. This file
--                   grants only the SELECT + INSERT + UPDATE the writer requires.
-- NEVER revoke SELECT/INSERT/UPDATE from service_role — it upserts to persist.
grant select on public.wodify_retention_aggregate to anon;
grant select, insert, update on public.wodify_retention_aggregate to service_role;

-- Strip the broad default-privilege DML grants from anon + authenticated so the
-- grant layer matches the intended read-only boundary (defense in depth atop RLS).
revoke insert, update, delete, truncate, references, trigger
  on public.wodify_retention_aggregate
  from anon, authenticated;

alter table public.wodify_retention_aggregate enable row level security;

-- anon read policy (scoped to the default workspace, matching the writer). There
-- is intentionally NO anon write policy — this RLS gap is the PRIMARY barrier
-- blocking anon writes, reinforced by the grant revoke above (two barriers,
-- defense in depth). The service-role writer bypasses RLS entirely and needs no
-- policy.
drop policy if exists "wodify_retention_aggregate_anon_read" on public.wodify_retention_aggregate;
create policy "wodify_retention_aggregate_anon_read"
on public.wodify_retention_aggregate
for select
to anon
using (workspace_id = 'default');
