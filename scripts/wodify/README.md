# Wodify probes (local / server-side only — never bundled, never run in CI)

Diagnostic probes for confirming what the Wodify API actually exposes, ahead of any live
Retention wiring. See `RETENTION_FINISH_PLAN.md` §4 (architecture) and §5 (probe + safe output
contract).

**Not part of the app build or test suite.** `scripts/` is excluded from `tsconfig.app.json`
(`include: ["src"]`) and `tsconfig.node.json` (`include: ["vite.config.ts"]`), so `tsc -b`,
`vite build`, and `vitest` ignore everything here. These are run ad-hoc with `tsx`, the same way
`scripts/assistant-replay/` is.

## `classSigninProbe.ts` — Class / Client Sign-ins dated check-in history

Determines whether Wodify exposes **dated** check-in history (per-event sign-in dates), which
gates Silent Churn Recovery and supplies the `lastCheckIn` the first live slice needs.

### Safety (enforced by the script)

- Reads the rotated key **only** from `process.env.WODIFY_API_KEY`. Never `VITE_*`, never
  hardcoded, never logged, never echoed in errors. If the key is unset, the script exits without
  making any request.
- Local / server-side only — never imported by the SPA, never bundled.
- Emits **only** the aggregate contract (counts, booleans, status enums, optional calendar
  years). Never names, IDs, exact dates/timestamps, dues, raw rows, or raw API responses.
- Treats `1900-01-01` as a null sentinel — counted separately as `sentinelDateCount`, never a
  real date.
- Does **not** import `silentChurn.ts` / `classifyMember`.

### Run (local only — provide the key via a gitignored env path; never commit or paste it)

```bash
# PREFERRED — gitignored env file (Node 20.6+ / recent tsx support --env-file).
#   .env.local is ignored by the repo .gitignore (.env*.local), so this holds on any clone — not
#   just a machine with a global gitignore. A NON-VITE_ var there is NOT exposed to the browser
#   bundle (Vite only bundles VITE_*). Add the line `WODIFY_API_KEY=<rotated key>` to .env.local
#   (never to the committed .env.example, never with a VITE_ prefix), then:
npx tsx --env-file=.env.local scripts/wodify/classSigninProbe.ts

# ALLOWED but NOT preferred — inline. The key lands in your shell history (a leak vector); use
# only for a one-off, and clear the history afterwards.
WODIFY_API_KEY='<rotated key>' npx tsx scripts/wodify/classSigninProbe.ts
```

Do **not** set the key via `supabase secrets` for this *local* probe — that is the server-side
path for the future Edge Function, not for a local `tsx` run.

### Before trusting the output (live run)

The endpoint **path**, response **shape**, pagination **mechanism**, and **field names** are not
repo-verified — `RETENTION_FINISH_PLAN.md` §5 records them as "leads to re-confirm". Confirm and
adjust the `CONFIG` block at the top of the script on the first live run. In particular, if the
sign-ins endpoint requires a per-client ID path param, the probe will surface a 403
"Missing Authentication Token" (a missing-ID signal, **not** an auth failure) and must be adapted
to iterate clients.

### Output shape (the only thing printed)

```ts
{
  endpointReached: boolean,
  httpStatusClass: "2xx" | "4xx" | "5xx" | "network_error",
  pagesFetched: number,
  totalRecordsInspected: number,
  fieldPresenceCounts: { clientRef: number, checkInDate: number },
  missingDateCount: number,
  invalidDateCount: number,
  sentinelDateCount: number,            // count of 1900-01-01 sentinels (treated as missing)
  datedCheckInHistoryAvailable: boolean, // ≥1 client with ≥2 distinct valid dates
  distinctClientsWithAnyCheckIn: number,
  earliestYear?: number,                // optional, calendar-year granularity only
  latestYear?: number
}
```
