-- Shared persistence schema for wx-cfo-scorecard.
-- This schema assumes one logical workspace per `workspace_id`.
-- Do not treat this as production-ready until Row Level Security policies
-- and an explicit auth model are added for the anon client.
--
-- Data API access: as of the Supabase rollout on 2026-05-30 (new projects) /
-- 2026-10-30 (existing projects), tables in `public` are no longer exposed to
-- the Data API (PostgREST/GraphQL) automatically. The required table-level
-- GRANTs to the `anon` role live in first_test_policies.sql alongside the RLS
-- policies and must be applied after this DDL. Existing tables on the live
-- project keep their current grants; the explicit grants matter for fresh
-- replays of this snapshot and for any new table added here.

create table if not exists public.shared_imported_transactions (
  workspace_id text not null,
  fingerprint text not null,
  possible_duplicate_key text not null,
  import_id text not null,
  source_file_name text not null,
  imported_at_iso timestamptz not null,
  source_line_number integer not null,
  entered_date date null,
  posted_date date null,
  transfer_account text null,
  possible_duplicate boolean not null default false,
  txn jsonb not null,
  primary key (workspace_id, fingerprint)
);

create index if not exists shared_imported_transactions_workspace_imported_at_idx
  on public.shared_imported_transactions (workspace_id, imported_at_iso desc);

create index if not exists shared_imported_transactions_workspace_possible_duplicate_idx
  on public.shared_imported_transactions (workspace_id, possible_duplicate_key);

create table if not exists public.shared_import_batches (
  workspace_id text not null,
  import_id text not null,
  source_file_name text not null,
  imported_at_iso timestamptz not null,
  latest_txn_month text null,
  storage_scope text not null default 'shared',
  import_mode text not null default 'replace-all',
  new_imported integer not null,
  exact_duplicates_skipped integer not null,
  possible_duplicates_flagged integer not null,
  parse_failures integer not null,
  stored_transaction_count integer not null,
  possible_duplicate_examples jsonb not null default '[]'::jsonb,
  parse_failure_examples jsonb not null default '[]'::jsonb,
  primary key (workspace_id, import_id)
);

create index if not exists shared_import_batches_workspace_imported_at_idx
  on public.shared_import_batches (workspace_id, imported_at_iso desc);

create table if not exists public.shared_account_settings (
  workspace_id text not null,
  id text not null,
  discovered_account_name text not null,
  account_name text not null,
  account_type text not null,
  starting_balance numeric not null default 0,
  include_in_cash_forecast boolean not null default false,
  active boolean not null default true,
  is_user_configured boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists shared_account_settings_workspace_account_name_idx
  on public.shared_account_settings (workspace_id, account_name);

create or replace function public.replace_shared_imported_store(
  p_workspace_id text,
  p_records jsonb,
  p_summary jsonb
)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
begin
  delete from public.shared_imported_transactions
  where workspace_id = p_workspace_id;

  delete from public.shared_import_batches
  where workspace_id = p_workspace_id;

  insert into public.shared_imported_transactions (
    workspace_id,
    fingerprint,
    possible_duplicate_key,
    import_id,
    source_file_name,
    imported_at_iso,
    source_line_number,
    entered_date,
    posted_date,
    transfer_account,
    possible_duplicate,
    txn
  )
  select
    p_workspace_id,
    elem->>'fingerprint',
    elem->>'possible_duplicate_key',
    elem->>'import_id',
    elem->>'source_file_name',
    (elem->>'imported_at_iso')::timestamptz,
    (elem->>'source_line_number')::integer,
    (elem->>'entered_date')::date,
    (elem->>'posted_date')::date,
    elem->>'transfer_account',
    coalesce((elem->>'possible_duplicate')::boolean, false),
    elem->'txn'
  from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) as elem;

  insert into public.shared_import_batches (
    workspace_id,
    import_id,
    source_file_name,
    imported_at_iso,
    latest_txn_month,
    storage_scope,
    import_mode,
    new_imported,
    exact_duplicates_skipped,
    possible_duplicates_flagged,
    parse_failures,
    stored_transaction_count,
    possible_duplicate_examples,
    parse_failure_examples
  )
  values (
    p_workspace_id,
    p_summary->>'import_id',
    p_summary->>'source_file_name',
    (p_summary->>'imported_at_iso')::timestamptz,
    p_summary->>'latest_txn_month',
    'shared',
    'replace-all',
    (p_summary->>'new_imported')::integer,
    (p_summary->>'exact_duplicates_skipped')::integer,
    (p_summary->>'possible_duplicates_flagged')::integer,
    (p_summary->>'parse_failures')::integer,
    (p_summary->>'stored_transaction_count')::integer,
    coalesce(p_summary->'possible_duplicate_examples', '[]'::jsonb),
    coalesce(p_summary->'parse_failure_examples', '[]'::jsonb)
  );
end;
$$;

-- Recommended next step before production use:
-- alter table public.shared_imported_transactions enable row level security;
-- alter table public.shared_import_batches enable row level security;
-- alter table public.shared_account_settings enable row level security;

-- Forecast events: per-row collection keyed by (workspace_id, id),
-- mirrors shared_account_settings shape. Upserted on save with stale
-- rows removed. RLS policy lives in first_test_policies.sql and must
-- be applied after this DDL.

create table if not exists public.forecast_events (
  workspace_id text not null,
  id text not null,
  month text not null,
  type text not null,
  title text not null,
  note text null,
  status text not null,
  impact_mode text not null default 'fixed_amount',
  cash_in_impact numeric not null default 0,
  cash_out_impact numeric not null default 0,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  date date null,
  primary key (workspace_id, id)
);

create index if not exists forecast_events_workspace_month_idx
  on public.forecast_events (workspace_id, month);

-- Phase 5.1 — Renewal contracts. Source-of-truth for recurring revenue
-- agreements. Generated forecast_events rows link back via contract_id.
-- Operator-managed; no scheduler touches this table directly.

create table if not exists public.renewal_contracts (
  workspace_id text not null,
  id text not null,
  name text not null,
  status text not null default 'active',
  renewal_date date not null,
  renewal_cadence text not null,
  cash_in_amount numeric not null default 0,
  cash_out_amount numeric not null default 0,
  enabled boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists renewal_contracts_workspace_idx
  on public.renewal_contracts (workspace_id);

-- Phase 5.1 — Additive columns on forecast_events to support the renewal
-- generator. All new columns are nullable / defaulted so legacy rows
-- (operator-entered events) remain valid without backfill. `source`
-- distinguishes manual rows (null/'manual') from generator-created rows
-- ('renewal'). `contract_id` links generated rows back to their source
-- contract. `generated_*` capture the generator's original output so
-- operator overrides remain detectable. `is_override` flags rows the
-- operator has edited away from the generator's value.

alter table public.forecast_events
  add column if not exists source text null,
  add column if not exists contract_id text null,
  add column if not exists generated_date date null,
  add column if not exists generated_cash_in numeric null,
  add column if not exists generated_cash_out numeric null,
  add column if not exists is_override boolean not null default false;

create index if not exists forecast_events_workspace_source_contract_idx
  on public.forecast_events (workspace_id, source, contract_id);

-- Priority history — one row per fired CFO-assistant priority signal,
-- keyed by a surrogate uuid id (workspace_id is a soft scope, not part of
-- the key). Phase 2a added the commitment-loop columns (status,
-- committed_at, deadline_date), the status CHECK, and the partial unique
-- index that enforces at most one open commitment per workspace. Created
-- out-of-band via the Supabase dashboard; this is a hand-written snapshot
-- of the current live state. RLS policies live in first_test_policies.sql.

create table if not exists public.priority_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  fired_at timestamptz not null default now(),
  signal_type text not null,
  severity text not null,
  metric_value numeric null,
  target_value numeric null,
  category_flagged text null,
  gap_amount numeric null,
  recommended_action text null,
  ai_headline text null,
  committed_action text null,
  outcome_metric numeric null,
  resolved_at timestamptz null,
  status text null,
  committed_at timestamptz null,
  deadline_date timestamptz null,
  constraint priority_history_status_check
    check (status is null or status in ('open', 'kept', 'lapsed', 'replaced'))
);

create unique index if not exists priority_history_one_open_per_workspace
  on public.priority_history (workspace_id)
  where status = 'open';

-- Priority prose cache — memoizes AI-generated headline/body prose for a
-- fired signal, keyed by (workspace_id, cache_key, prompt_version) so a
-- prompt-template bump misses the cache cleanly. Upserted on that unique
-- triple via PostgREST merge-duplicates. Created out-of-band via the
-- Supabase dashboard; this is a hand-written snapshot of the current live
-- state. RLS policies live in first_test_policies.sql.

create table if not exists public.priority_prose_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  cache_key text not null,
  prompt_version text not null default 'v1',
  signal_type text not null,
  severity text not null,
  prose_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint priority_prose_cache_workspace_id_cache_key_prompt_version_key
    unique (workspace_id, cache_key, prompt_version)
);

create index if not exists priority_prose_cache_workspace_id_signal_type_idx
  on public.priority_prose_cache (workspace_id, signal_type);

-- Workspace settings — one row per workspace_id holding the operator's Rules
-- (profit target, operating-reserve goal, forecast posture/scenario assumptions,
-- and the Payroll Target). Created out-of-band via the Supabase dashboard; this
-- is a hand-written snapshot of the current (post-migration) live state. RLS
-- policies live in first_test_policies.sql.

create table if not exists public.shared_workspace_settings (
  workspace_id text not null,
  target_net_margin numeric null default 0.25,
  safety_reserve_method text null default 'monthly',
  safety_reserve_amount numeric null default 0,
  suppress_duplicate_warnings boolean null default false,
  acknowledged_noncash_accounts jsonb null default '[]'::jsonb,
  forecast_posture text not null default 'reality',
  payroll_target_percent numeric not null default 35,
  scenario_best_revenue_growth_pct numeric not null default 4,
  scenario_best_expense_change_pct numeric not null default -3,
  scenario_base_revenue_growth_pct numeric not null default 0,
  scenario_base_expense_change_pct numeric not null default 0,
  scenario_worst_revenue_growth_pct numeric not null default -5,
  scenario_worst_expense_change_pct numeric not null default 4,
  -- Business Valuation — SDE add-backs (NULL = blank; selector treats blank as $0).
  -- All four NULL triggers the "Add SDE add-backs in Settings for full accuracy" note.
  owner_w2_compensation numeric null,
  personal_expenses_through_business numeric null,
  one_time_expenses_to_add_back numeric null,
  one_time_gains_to_subtract numeric null,
  -- Business Valuation — Multiple range (always has a value; empty rejected by validator).
  valuation_multiple_lower numeric null default 2.0,
  valuation_multiple_upper numeric null default 2.5,
  -- Business Valuation — Replacement cost (NULL = "Needs input"; never silently $0).
  replacement_cost_lower numeric null,
  replacement_cost_upper numeric null,
  -- Business Valuation — Lease metadata (NULL = unset → Lease runway "Not tracked").
  lease_start_date date null,
  lease_end_date date null,
  lease_renewal_option boolean null,
  lease_renewal_years numeric null,
  -- Business Valuation — Owner-set driver grades (NULL = "Needs input";
  -- non-null values: 'weak' | 'mixed' | 'strong').
  driver_grade_recurring_revenue text null,
  driver_grade_financial_clarity text null,
  driver_grade_churn_tracking text null,
  driver_grade_coach_depth text null,
  driver_grade_owner_independence text null,
  driver_grade_brand_strength text null,
  primary key (workspace_id)
);
