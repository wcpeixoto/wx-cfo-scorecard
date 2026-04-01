# Supabase shared persistence rollout

This branch adds a first safe foundation for shared persistence, but it is not production-ready yet.

## What this branch expects

Environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SHARED_WORKSPACE_ID`

Schema:

- apply `/Users/wesley/Code/wx-cfo-scorecard/supabase/shared_persistence_schema.sql`
- for the first local/staging test, apply `/Users/wesley/Code/wx-cfo-scorecard/supabase/first_test_policies.sql`

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

## Required local/staging setup

1. Create a dedicated non-production Supabase project for this branch.
2. In Supabase SQL Editor, run:
   - `/Users/wesley/Code/wx-cfo-scorecard/supabase/shared_persistence_schema.sql`
   - `/Users/wesley/Code/wx-cfo-scorecard/supabase/first_test_policies.sql`
3. Create a local `.env.local` from `/Users/wesley/Code/wx-cfo-scorecard/.env.example`.
4. Set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SHARED_WORKSPACE_ID`
5. Make sure the `workspace_id` in `.env.local` matches the policy SQL. The default first-test value is `default`.

## First test assumptions

- This first test uses the browser-exposed anon key with temporary RLS policies.
- That is acceptable only for:
  - a dedicated local/staging Supabase project
  - non-sensitive data
  - a single agreed shared workspace id
- This is not a production security model.

## Recommended first test setup

1. Create a separate Supabase project for this feature branch.
2. Apply the schema SQL.
3. Apply the temporary first-test policy SQL.
4. Set local env vars in a private `.env.local`.
5. Run the app locally and confirm:
   - no shared data -> Google Sheets fallback is active
   - importing a CSV creates one shared dataset
   - refreshing in a second browser sees the same imported dataset
   - account setting edits appear in the second browser
   - clearing imported data reverts both browsers to Google Sheets fallback

## Browser A / Browser B checklist

1. Browser A
   - open the app with shared env configured
   - confirm Settings says Google Sheets fallback is active when the shared store is empty
2. Browser A
   - import one Quicken CSV
   - confirm Settings now shows:
     - shared imported dataset active
     - source storage is shared
     - import mode is replace-all
3. Browser B
   - open the same app/environment
   - confirm the same imported dataset is active without re-importing
   - confirm imported transaction count matches Browser A
4. Browser A
   - edit one or more account settings
   - for example account type, starting balance, or forecast inclusion
5. Browser B
   - refresh
   - confirm the same account setting edits are present
6. Browser A
   - clear imported data
7. Browser B
   - refresh
   - confirm both browsers have reverted to Google Sheets fallback
   - confirm no shared imported dataset remains

## Minimum policy intent

For a first controlled test, policies should ensure:

- reads are limited to the intended authenticated tester(s)
- writes are limited to the intended authenticated tester(s)
- access is constrained to the expected `workspace_id`

Avoid broad anonymous read/write policies in production.

For this branch's first real test, the provided policy file is intentionally narrower than fully-open anon access, but it is still only a temporary staging policy because it allows anon access inside one workspace.
