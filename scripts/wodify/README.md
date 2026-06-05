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
- Detects a Wodify **error envelope** returned at transport-2xx (`DeveloperMessage` / `ErrorCode` /
  `HTTPCode` / `UserMessage`) and reports it as a failure (`errorEnvelopeDetected` +
  `embeddedHttpStatusClass`) instead of a misleading "0 records". The embedded `HTTPCode` is
  authoritative and is reduced to a status **class** only — its raw value is never read into output,
  logs, or errors, and the message / error-code text is never read at all. Real rows are never
  discarded: a non-empty records array is always read, and a 2xx embedded code with an empty array
  is treated as a real empty dataset, not an error.
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

The first run's transport-2xx with **0 records** turned out to be a Wodify **error envelope** (shape
discovery, #423), not an empty dataset. `errorEnvelopeDetected` now surfaces that case instead of
masking it: a `2xx` `httpStatusClass` **with** `errorEnvelopeDetected: true` means the call failed at
the application layer (read `embeddedHttpStatusClass` for the in-body status class), and
`totalRecordsInspected: 0` there is **not** evidence that dated history is unavailable.

### Output shape (the only thing printed)

```ts
{
  endpointReached: boolean,
  httpStatusClass: "2xx" | "4xx" | "5xx" | "network_error",     // TRANSPORT status class
  errorEnvelopeDetected: boolean,        // transport-2xx body was a Wodify error envelope (not data)
  embeddedHttpStatusClass:               // status CLASS from the in-body HTTPCode; never the raw value
    "2xx" | "4xx" | "5xx" | "network_error" | null,
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

## `signinsShapeDiscovery.ts` — response-shape discovery (why `classSigninProbe` saw 0 records)

`classSigninProbe.ts` returned a 2xx but inspected **0 records** on its first run (2026-06-04), so
its field **mapping is unproven** (`RETENTION_FINISH_PLAN.md` §5). This script discovers *why* by
reporting the response **structure** for a small allowlist of Class / Client Sign-ins endpoint
candidates — it does **not** fix the mapping, wire live data, or do §6 work. It is structure
discovery, not data collection: one page per candidate, structural metadata only out.

### Safety (enforced by the script — same posture as `classSigninProbe.ts`)

- Reads the rotated key **only** from `process.env.WODIFY_API_KEY`. Never `VITE_*`, never hardcoded,
  never logged, never echoed in errors. If unset, it exits without making any request.
- Local / server-side only — never imported by the SPA, never bundled.
- Emits **only** structural metadata: endpoint **paths** (never query strings), booleans, HTTP
  status classes, **key names**, and array **lengths / counts**. Never values of any kind — no
  names, IDs (even hashed), dates/timestamps, dues, raw rows, raw/echoed API responses, or upstream
  error bodies (status class only).
- **ID-like-key guard.** Any key *name* that looks like an identifier/value (pure digits, UUID, long
  hex, suspiciously long) is redacted and only **counted** — so even an object keyed by client ID
  cannot leak an ID through a "key name". A high-cardinality ID-keyed map is reported as a count +
  boolean, never as a key list.
- Makes **no per-client / per-ID calls.** If a candidate signals a required ID path param (a 403
  "Missing Authentication Token"), that is reported as a boolean and the probe moves on — iterating
  clients needs separate approval.
- Does **not** import `silentChurn.ts` / `classifyMember`.

### Run (local only — provide the key via a gitignored env path; never commit or paste it)

```bash
# PREFERRED — gitignored env file, loaded with --env-file. From a git WORKTREE (where .env*.local
# does not propagate), point --env-file at the primary clone's gitignored env by ABSOLUTE path so
# the key is never copied or duplicated:
npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
  scripts/wodify/signinsShapeDiscovery.ts

# From the primary clone, the relative form works:
npx tsx --env-file=.env.local scripts/wodify/signinsShapeDiscovery.ts
```

Never use the inline `WODIFY_API_KEY='…' npx tsx …` form (the key lands in shell history).

### Output shape (the only thing printed — structure only)

```ts
{
  probe: "signinsShapeDiscovery",
  candidatesTested: number,
  summary: {
    anyEndpointReturned2xx: boolean,
    anyEndpointYieldedRecords: boolean,
    anyEndpointSignalsPerClientIdRequired: boolean
  },
  candidates: Array<{
    label: string,
    path: string,                       // PATH only — never a query string
    endpointReached: boolean,
    httpStatusClass: "2xx" | "4xx" | "5xx" | "network_error",
    jsonParseable: boolean | null,
    contentTypeIsJson: boolean | null,
    topLevelType: "array" | "object" | "other" | null,
    topLevelKeyNames: string[],         // SAFE names only (ID-like redacted)
    topLevelKeyCount: number,
    looksLikeIdKeyedMap: boolean,
    redactedKeyNameCount: number,
    arraysFound: Array<{ keyPath: string, length: number, elementsAreObjects: boolean }>,
    recordArrayKeyGuess: string | null,
    recordCountInGuessedArray: number,
    recordFieldNames: string[],         // SAFE field-NAME union (schema, not values)
    paginationKeyNamesFound: string[],  // pagination key NAMES present
    perClientIdLikelyRequired: boolean
  }>
}
```
