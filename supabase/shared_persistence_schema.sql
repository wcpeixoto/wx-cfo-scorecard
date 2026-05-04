-- Shared persistence schema for wx-cfo-scorecard.
-- This schema assumes one logical workspace per `workspace_id`.
-- Do not treat this as production-ready until Row Level Security policies
-- and an explicit auth model are added for the anon client.

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
