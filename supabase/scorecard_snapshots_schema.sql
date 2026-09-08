-- scorecard_snapshots — the last successfully computed monthly source snapshot per workspace/month.
--
-- One row per (workspace_id, period_month). The browser upserts the SAME payload the manual
-- "Export monthly source JSON" button downloads: aggregates only, no transaction rows, payees,
-- memos, account names, member identities, or source filenames (the pure builder in
-- src/lib/export/buildMonthlySourceExport.ts enforces that boundary; this table only stores its
-- output verbatim).
--
-- SNAPSHOT CONVENTION: this file is a single create-table at full state, replayable onto a fresh
-- project. No trailing ALTER ADD COLUMN — edit the create-table body instead.
--
-- ACCESS MODEL — anon SELECT + INSERT + UPDATE, RLS-scoped to the default workspace. anon has NO
-- delete: blocked at BOTH layers (no grant AND no policy). Modeled on
-- member_retention_rates_schema.sql, with one deliberate tightening: that table's narrow
-- `revoke delete, truncate, references, trigger` left `authenticated` holding SELECT on the live
-- database (verified: relacl `authenticated=rm`). The `revoke all` below removes every inherited
-- and default privilege first, so the grants that follow are the complete privilege set.
--
-- NOTHING here relies on Supabase default grants. Since the 2026 Data API change, new tables are
-- not exposed automatically and privileges are explicit and separate from RLS — so every role
-- this table serves is granted below by name:
--   anon          select, insert, update   — the browser (the only key that exists in the SPA)
--   service_role  full CRUD                — server-side/operator path only: Edge Functions and
--                                            the cleanup delete the negative RLS tests may need.
--                                            service_role bypasses RLS by design; no service-role
--                                            key exists in the SPA and none may be added.
--   authenticated (none)                   — the app has no authenticated client.

create table if not exists public.scorecard_snapshots (
  workspace_id text not null,
  period_month text not null,                 -- 'YYYY-MM' — payload.scorecard_month, never today's date
  computed_at timestamptz not null,           -- set explicitly on every upsert; never a DB default
  export_version text not null,               -- payload.schema_version, carried through verbatim
  source_hash text not null,                  -- SHA-256 over canonical JSON, generated_at omitted
  import_id text null,                        -- newest financial import; null before any import
  payload jsonb not null,
  primary key (workspace_id, period_month),
  constraint scorecard_snapshots_period_chk
    check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

-- Remove inherited/default privileges BEFORE granting, so the grant below is the whole story.
revoke all on public.scorecard_snapshots
  from public, anon, authenticated;

grant select, insert, update
  on public.scorecard_snapshots
  to anon;

grant select, insert, update, delete
  on public.scorecard_snapshots
  to service_role;

alter table public.scorecard_snapshots enable row level security;

-- Separate SELECT / INSERT / UPDATE policies rather than one `for all`, so anon-DELETE stays
-- blocked by a missing policy even if a future `grant all` ever re-adds the delete privilege.
-- INSERT needs only WITH CHECK; UPDATE needs USING (to see the conflicting row) plus WITH CHECK
-- (to keep it in-workspace). Together they satisfy the PostgREST merge-duplicates upsert
-- (INSERT ... ON CONFLICT DO UPDATE) while granting strictly less than `for all`.
drop policy if exists "scorecard_snapshots_anon_read" on public.scorecard_snapshots;
create policy "scorecard_snapshots_anon_read"
  on public.scorecard_snapshots
  for select
  to anon
  using (workspace_id = 'default');

drop policy if exists "scorecard_snapshots_anon_insert" on public.scorecard_snapshots;
create policy "scorecard_snapshots_anon_insert"
  on public.scorecard_snapshots
  for insert
  to anon
  with check (workspace_id = 'default');

drop policy if exists "scorecard_snapshots_anon_update" on public.scorecard_snapshots;
create policy "scorecard_snapshots_anon_update"
  on public.scorecard_snapshots
  for update
  to anon
  using (workspace_id = 'default')
  with check (workspace_id = 'default');

-- No DELETE policy and no DELETE grant, by design.

notify pgrst, 'reload schema';
