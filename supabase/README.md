# Supabase shared persistence rollout

This branch adds a first safe foundation for shared persistence, but it is not production-ready yet.

## What this branch expects

Environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SHARED_WORKSPACE_ID`

Schema:

- apply `/Users/wesley/Code/wx-cfo-scorecard/supabase/shared_persistence_schema.sql`

Shared tables:

- `public.shared_imported_transactions`
- `public.shared_import_batches`
- `public.shared_account_settings`

## Current operating model

- One logical workspace per `workspace_id`
- Shared imported CSV data is `replace-all`
- Source precedence is:
  - shared imported dataset when configured and present
  - Google Sheets fallback otherwise
- Browser-local imported data is only used when shared persistence is not configured

## What still blocks production rollout

1. Authentication
   - The app currently uses the Supabase anon key directly from the browser.
   - That is acceptable for local testing only if the project is tightly restricted.

2. Row Level Security
   - RLS must be enabled on all three shared tables.
   - Do not rely on the schema alone.

3. Policy model
   - Pick one of these before rollout:
   - authenticated internal users only
   - a backend proxy/service-role write path
   - another explicit auth gate

4. Replace-all write safety
   - Shared imports currently use clear-then-write REST calls from the client.
   - That is deterministic, but not transactional.
   - Production rollout should move the replace-all operation into a single RPC or server-side transaction.

## Recommended first test setup

1. Create a separate Supabase project for this feature branch.
2. Apply the schema SQL.
3. Enable RLS on all shared tables.
4. Add temporary policies only for a small trusted test surface.
5. Set local env vars in a private `.env.local`.
6. Run the app locally and confirm:
   - no shared data -> Google Sheets fallback is active
   - importing a CSV creates one shared dataset
   - refreshing in a second browser sees the same imported dataset
   - account setting edits appear in the second browser
   - clearing imported data reverts both browsers to Google Sheets fallback

## Minimum policy intent

For a first controlled test, policies should ensure:

- reads are limited to the intended authenticated tester(s)
- writes are limited to the intended authenticated tester(s)
- access is constrained to the expected `workspace_id`

Avoid broad anonymous read/write policies in production.
