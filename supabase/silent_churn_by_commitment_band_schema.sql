-- silent_churn_by_commitment_band — a point-in-time Silent-Churn breakdown by COMMITMENT BAND, one row per
-- (workspace_id, band). Each row carries the active-membership counts + the indicative silent rate for that
-- band as of a single snapshot day. This is a SNAPSHOT table (no period_month) — the gated build upserts the
-- whole 7-row set each refresh and stamps as_of / refreshed_at.
--
-- SILENT-CHURN × COMMITMENT-BAND pipeline (Slice 1). Substrate is two live Wodify pulls — /clients (attendance
-- recency → the LOCKED Silent-Churn classifier, src/lib/gym/silentChurn.ts) ⋈ /memberships (commitment length
-- via payment_plan; pack detection via the structured membership_type field). Built by
-- scripts/wodify/buildSilentChurnByCommitmentBand.ts, which REUSES the gated + live-validated probe
-- (scripts/wodify/silentChurnByCommitmentBandProbe.ts, #519) — no duplicated classification, no drift. The
-- data rows are written by the GATED import (Supabase MCP execute_sql, Reviewer PASS + owner GO), NEVER by an
-- anon browser path and NEVER by an in-script writer.
--
-- Assignment rule (LOCKED): active-membership-only with a most-recent tiebreak — a client is placed in the band
-- of its current active membership; multiple active memberships that disagree resolve to the most-recent one.
-- Active clients with NO current active membership are 'unassignable' and are DELIBERATELY NOT a row here (they
-- are not a commitment band); that population is reported build-side in the dry-run coverage block only.
--
-- Denominator doctrine (LOCKED — matches the shipped Attendance Health card / the excludeUnknownRecency
-- default): indicative_silent_rate = silent_count / attendance_known, where attendance_known = healthy + watch
-- + silent. Active clients with no usable attendance signal (unknown — parent/guardian, never-attended) are
-- EXCLUDED from attendance_known (and thus the rate) but ARE counted in total_active, so the two reconcile.
--
-- RATE-QUALITY GATE (LOCKED): indicative_silent_rate is NULL where attendance_known < 5 — an "indicative" rate
-- only, the card labels it so. Enforced here as a CHECK so a bad write can't store a rate on a thin base. The
-- COUNTS always populate (owner-dashboard "Retention page data policy", AGENTS.md — non-identity aggregate,
-- NO <5 masking): total_active / attendance_known / silent_count publish as-is incl. true 0 and counts < 5.
--
-- WHY ANON-READABLE: the SPA reads with the public anon key, safe ONLY because the row holds NO PII — every
-- column is a band LABEL, a count, a rate, an as-of day, or a timestamp. The member-level PII (names, Client
-- IDs, attendance dates, membership rows) is read build-side in memory and never leaves the local step; only
-- the per-band COUNTS land here. Access mirrors member_retention_by_belt / member_retention_by_cohort /
-- wodify_retention_aggregate (#440-hardened): anon SELECT only; NO anon write path. Deliberately TIGHTER than
-- member_retention_rates, whose anon-write relaxation does NOT extend here.
--
-- Self-contained (DDL + constraints + grants + RLS in one file) so the security boundary is auditable at a
-- glance. Apply in the Supabase SQL Editor / via the gated MCP run; order-independent (references no other
-- table).
--
-- Re-application note: `create table if not exists` does NOT backfill columns on an existing table. If a prior
-- version was applied, add new columns explicitly with `alter table ... add column if not exists`.

create table if not exists public.silent_churn_by_commitment_band (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',       -- soft scope, mirrors repo convention + the anon RLS policy
  band text not null,                                  -- commitment band LABEL (see allowlist below)
  -- Active-membership clients placed in this band, and the attendance-known subset (healthy+watch+silent) used
  -- as the rate denominator, and the silent subset. Always real, non-null counts incl. a true 0 — no <5 masking.
  total_active integer not null,
  attendance_known integer not null,                   -- healthy + watch + silent; unknown-attendance excluded
  silent_count integer not null,
  -- The indicative silent rate = silent_count / attendance_known, or NULL when attendance_known < 5 (the
  -- rate-quality gate) or the band is empty. Derived build-side; stored (not re-derived on read) so the card
  -- shows exactly what was gated. The gate is also enforced as a CHECK below.
  indicative_silent_rate numeric,
  as_of text not null,                                 -- 'YYYY-MM-DD' gym-local snapshot day the counts describe
  refreshed_at timestamptz not null default now(),     -- when the build ran; latest-write selector

  -- workspace_id sanity (non-empty); RLS scopes reads to 'default'.
  constraint silent_churn_by_commitment_band_workspace_chk check (length(workspace_id) > 0),
  -- band allowlist — the five commitment bands + non_commitment (packs, its own row, excluded from any
  -- commitment-band denominator) + unclassified (its own row). The build asserts this SAME set (CARD_BANDS) so
  -- the SQL and the build cannot drift. 'unassignable'/'conflicting' are intentionally NOT valid here.
  constraint silent_churn_by_commitment_band_band_chk check (
    band in (
      'month_to_month', 'three_month', 'six_month', 'twelve_month_annual', 'twenty_four_month',
      'non_commitment', 'unclassified'
    )
  ),
  -- strict 'YYYY-MM-DD' calendar-shaped snapshot day.
  constraint silent_churn_by_commitment_band_asof_chk check (
    as_of ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
  ),
  -- nonnegative counts.
  constraint silent_churn_by_commitment_band_total_nonneg_chk check (total_active >= 0),
  constraint silent_churn_by_commitment_band_known_nonneg_chk check (attendance_known >= 0),
  constraint silent_churn_by_commitment_band_silent_nonneg_chk check (silent_count >= 0),
  -- containment: the known base cannot exceed the active total; silent cannot exceed the known base.
  constraint silent_churn_by_commitment_band_known_le_total_chk check (attendance_known <= total_active),
  constraint silent_churn_by_commitment_band_silent_le_known_chk check (silent_count <= attendance_known),
  -- rate is a share in [0,1] when present.
  constraint silent_churn_by_commitment_band_rate_range_chk check (
    indicative_silent_rate is null or (indicative_silent_rate >= 0 and indicative_silent_rate <= 1)
  ),
  -- rate-quality gate: a rate may be present ONLY when the known base clears the minimum (5). Below it, the
  -- rate MUST be null (the counts still populate). This makes the locked "indicative" gate a hard invariant.
  constraint silent_churn_by_commitment_band_rate_gate_chk check (
    indicative_silent_rate is null or attendance_known >= 5
  )
);

-- Idempotency key: one row per (workspace_id, band). The gated import upserts on this key (ON CONFLICT DO
-- UPDATE) and NEVER deletes/truncates. A NAMED constraint via ALTER TABLE (not a bare CREATE UNIQUE INDEX) so
-- it is clear to introspect AND fires this project's pgrst_ddl_watch schema-cache reload (makes the on_conflict
-- arbiter visible to the Data API). Guarded with a DO block so this snapshot file stays re-appliable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'silent_churn_by_commitment_band_ws_band_key'
      and conrelid = 'public.silent_churn_by_commitment_band'::regclass
  ) then
    alter table public.silent_churn_by_commitment_band
      add constraint silent_churn_by_commitment_band_ws_band_key
      unique (workspace_id, band);
  end if;
end $$;

create index if not exists silent_churn_by_commitment_band_workspace_idx
  on public.silent_churn_by_commitment_band (workspace_id);

notify pgrst, 'reload schema';

-- Access model -------------------------------------------------------------
-- Mirrors member_retention_by_belt / member_retention_by_cohort / wodify_retention_aggregate (#440-hardened),
-- NOT member_retention_rates. After this file:
--   anon          → SELECT only (the browser reads with the anon key; no write path)
--   authenticated → SELECT only
--   service_role  → SELECT + INSERT + UPDATE (the gated import upserts to persist; bypasses RLS)
-- Supabase's default privileges grant the FULL DML set to anon + authenticated on every new public table, so
-- `grant select to anon` alone does NOT restrict writes — the broad defaults are REVOKED below (defense in
-- depth atop RLS). NEVER revoke SELECT/INSERT/UPDATE from service_role.
-- NOTE: the gated import may run as the platform SQL-editor role via Supabase MCP execute_sql (OUTSIDE the
-- Data API), governed by human authorization (Reviewer PASS + owner GO), not by these grants.
grant select on public.silent_churn_by_commitment_band to anon;
grant select, insert, update on public.silent_churn_by_commitment_band to service_role;

revoke insert, update, delete, truncate, references, trigger
  on public.silent_churn_by_commitment_band
  from anon, authenticated;

alter table public.silent_churn_by_commitment_band enable row level security;

-- anon read policy, scoped to the default workspace. There is intentionally NO anon write policy — this RLS gap
-- is the PRIMARY barrier blocking anon writes, reinforced by the grant revoke above (two barriers). The
-- service-role / gated writer bypasses RLS and needs no policy.
drop policy if exists "silent_churn_by_commitment_band_anon_read" on public.silent_churn_by_commitment_band;
create policy "silent_churn_by_commitment_band_anon_read"
  on public.silent_churn_by_commitment_band
  for select
  to anon
  using (workspace_id = 'default');
