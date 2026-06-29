-- member_retention_by_belt — monthly Class-Plan MEMBERSHIP retention by BELT BAND, one row per
-- (workspace_id, period_month, segment, belt_band). Active-panel + Lost counts per band per month.
--
-- CHURN-BY-BELT pipeline (Phase A). Substrate is Wodify's Progressions exports (Report 68 Current
-- Levels — carries Client ID; Report 69 Previous Levels — Client Name only, bridged through 68/the
-- client-grain retention export) ⋈ the client-grain "Member Retention" export (#501 source). Each
-- member's dated belt timeline = {68 current level by Client ID} ∪ {69 previous levels resolved by a
-- UNIQUE Client-Name bridge}; belt as-of month = the latest Date Achieved month <= the period. The
-- feasibility gate is CLOSED: 217/221 churn (98.2%) + 461/465 all (99.1%) have a known belt; the
-- Report-69 name bridge resolved 264/264 unique (0 collisions); reconstruction coverage >=97.7%/month
-- (100% in recent months); and the LOCKED belt-color banding has ZERO active band×month cells <5
-- (min 5, median 26). Built by scripts/wodify/buildMemberRetentionByBelt.ts under the two-AI gate;
-- the data rows are written by the GATED import (Supabase MCP), NEVER by an anon browser path.
--
-- THIS IS CLASS-PLAN MEMBERSHIP RETENTION (the #495/#501 metric: of members active at the start of a
-- month, who lapsed) partitioned by belt band — NOT attendance-based classifyMember / Silent-Churn.
--
-- BELT BANDING IS BUILD-LOCAL, decoupled from cohortBands.ts (untouched), exactly like #501's 3-band
-- allowlist. Locked Tier-2 belt-color banding (stripes collapsed) from the closed feasibility gate:
--   segment 'adults' (Adults BJJ): White / Blue / Purple / Brown+Black  (Brown+Black = advanced catch-all)
--   segment 'kids'   (Kids BJJ):   White / Grey-family / Yellow+Orange
--   segment 'unknown': belt_band 'unknown' — members whose belt could not be determined for the month.
--     UNKNOWN is its OWN row (own segment), NEVER folded into a band.
--
-- NO <5 MASKING: per the owner-dashboard "Retention page data policy" (AGENTS.md, 2026-06-27, #500/#501)
-- these aggregate band counts — active AND lost, including small counts and counts of 1 — are published
-- as-is. There is structurally no member-level column. Churn's small-monthly-count noisiness is handled
-- at the SPA layer (rate over the active denominator and/or rolling-3mo/quarterly smoothing), NOT by
-- suppression — so there is intentionally NO suppressed column here (unlike member_retention_by_cohort,
-- which retained one for a possible future public/export mode).
--
-- WHY ANON-READABLE: the SPA reads with the public anon key, safe ONLY because the row holds NO PII —
-- every column is a period label, a segment/belt-band LABEL, a count, or a timestamp. The member-level
-- PII join (names + Client IDs + dated belt history + the name bridge) happens build-side and never
-- leaves the local step; only the per-band COUNTS land here. Access mirrors member_retention_by_cohort
-- / wodify_retention_aggregate (#440-hardened): anon SELECT only; NO anon write path. Deliberately
-- TIGHTER than member_retention_rates, whose anon-write relaxation does NOT extend here.
--
-- Self-contained (DDL + constraints + grants + RLS in one file) so the security boundary is auditable
-- at a glance. Apply in the Supabase SQL Editor; order-independent (references no other table).
--
-- Re-application note: `create table if not exists` does NOT backfill columns on an existing table. If a
-- prior version was applied, add new columns explicitly with `alter table ... add column if not exists`.

create table if not exists public.member_retention_by_belt (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',     -- soft scope, mirrors repo convention + the anon RLS policy
  period_month text not null,                        -- 'YYYY-MM' aggregate period = client-grain First-Of-Month + 1 month
  segment text not null,                              -- 'adults' | 'kids' | 'unknown' (see allowlist below)
  belt_band text not null,                            -- belt-color band within the segment (see allowlist below)
  -- Active-panel members (New/Returning mapped to this period) and Lost members for this (period, band),
  -- counted by Change Type LABEL (a Lost ROW = one member). Always real, non-null counts incl. a true 0 —
  -- there is no suppression on the owner-dashboard rows (no <5 masking).
  active_count integer not null,
  lost_count integer not null,
  fetched_at timestamptz not null default now(),     -- when the build ran; latest-write selector

  -- retention_rate / churn_rate are DELIBERATELY NOT columns. They are derived on read from the counts
  -- (lost / active, guarding active = 0 → null, never 0/0). Persisting a rounded rate is the #495 drift
  -- bug Gate 2 caught: a stored rate can disagree with the counts. Counts are the source of truth.

  -- workspace_id sanity (non-empty); RLS scopes reads to 'default'.
  constraint member_retention_by_belt_workspace_chk check (length(workspace_id) > 0),
  -- strict 'YYYY-MM' (months 01..12 only) — rejects a stray day-level date or a malformed period.
  constraint member_retention_by_belt_period_chk check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- segment + belt_band allowlist — the build-LOCAL locked banding, decoupled from cohortBands.ts. The
  -- build asserts this SAME set (SCHEMA_SEGMENT_BAND_ALLOWLIST) so the SQL and the build cannot drift.
  -- 'White' is intentionally valid in BOTH adults and kids; the (segment, belt_band) pair is what is keyed.
  constraint member_retention_by_belt_band_chk check (
    (segment = 'adults'  and belt_band in ('White', 'Blue', 'Purple', 'Brown+Black'))
    or (segment = 'kids'    and belt_band in ('White', 'Grey-family', 'Yellow+Orange'))
    or (segment = 'unknown' and belt_band = 'unknown')
  ),
  -- nonnegative counts.
  constraint member_retention_by_belt_active_nonneg_chk check (active_count >= 0),
  constraint member_retention_by_belt_lost_nonneg_chk check (lost_count >= 0)
);

-- Idempotency key: one row per (workspace_id, period_month, segment, belt_band). The gated import upserts
-- on this key (ON CONFLICT DO UPDATE) and NEVER deletes/truncates, so re-running a later month PRESERVES
-- earlier months. A NAMED constraint via ALTER TABLE (not a bare CREATE UNIQUE INDEX) so it is clear to
-- introspect AND fires this project's pgrst_ddl_watch schema-cache reload (makes the on_conflict arbiter
-- visible to the Data API). Guarded with a DO block so this snapshot file stays re-appliable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_retention_by_belt_ws_period_segment_band_key'
      and conrelid = 'public.member_retention_by_belt'::regclass
  ) then
    alter table public.member_retention_by_belt
      add constraint member_retention_by_belt_ws_period_segment_band_key
      unique (workspace_id, period_month, segment, belt_band);
  end if;
end $$;

create index if not exists member_retention_by_belt_workspace_period_idx
  on public.member_retention_by_belt (workspace_id, period_month);

notify pgrst, 'reload schema';

-- Access model -------------------------------------------------------------
-- Mirrors member_retention_by_cohort / wodify_retention_aggregate (#440-hardened), NOT
-- member_retention_rates. After this file:
--   anon          → SELECT only (the browser reads with the anon key; no write path)
--   authenticated → SELECT only
--   service_role  → SELECT + INSERT + UPDATE (the gated import upserts to persist; bypasses RLS)
-- Supabase's default privileges grant the FULL DML set to anon + authenticated on every new public
-- table, so `grant select to anon` alone does NOT restrict writes — the broad defaults are REVOKED below
-- (defense in depth atop RLS). NEVER revoke SELECT/INSERT/UPDATE from service_role.
-- NOTE: the gated import may run as the platform SQL-editor role via Supabase MCP execute_sql (OUTSIDE
-- the Data API), governed by human authorization (Reviewer PASS + owner GO), not by these grants.
grant select on public.member_retention_by_belt to anon;
grant select, insert, update on public.member_retention_by_belt to service_role;

revoke insert, update, delete, truncate, references, trigger
  on public.member_retention_by_belt
  from anon, authenticated;

alter table public.member_retention_by_belt enable row level security;

-- anon read policy, scoped to the default workspace. There is intentionally NO anon write policy — this
-- RLS gap is the PRIMARY barrier blocking anon writes, reinforced by the grant revoke above (two
-- barriers). The service-role / gated writer bypasses RLS and needs no policy.
drop policy if exists "member_retention_by_belt_anon_read" on public.member_retention_by_belt;
create policy "member_retention_by_belt_anon_read"
  on public.member_retention_by_belt
  for select
  to anon
  using (workspace_id = 'default');
