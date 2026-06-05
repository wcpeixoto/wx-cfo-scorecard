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

## `clientSigninsProbe.ts` — per-client / per-ID sign-ins probe (§5 step 2)

Confirms (or fails to confirm) a `/clients/{id}/signins`-style **per-client** path and the dated
check-in **field mapping** — the step that follows the shape discovery's finding that the list-style
sign-ins paths return error envelopes and the bare paths return a missing-ID `403`. A per-client path
can't be probed without a real client ID, so this script fetches **one page of `/clients`**, extracts
a **small deterministic sample** of IDs **into memory only**, and uses them solely to build the
per-client request URL.

### Safety (enforced by the script — same posture as the sibling probes)

- Reads the rotated key **only** from `process.env.WODIFY_API_KEY`. Never `VITE_*`, never hardcoded,
  never logged, never echoed in errors. If unset, it exits without making any request.
- Local / server-side only — never imported by the SPA, never bundled.
- Emits **only** the aggregate contract: counts, booleans, HTTP status classes, path **templates**
  (with a literal `{id}`), and SAFE field **names** (schema). Never names, IDs, exact dates,
  timestamps, dues, raw rows, raw API responses, or — critically — the **request URL** (which
  contains a real client ID). Only the `{id}` template is ever emitted.
- ID-like field **names** are redacted (the shape-discovery guard), `1900-01-01` is a null sentinel
  counted separately, and the Wodify **error envelope** is detected with the in-body `HTTPCode`
  reduced to a status **class** only.
- Does **not** import `silentChurn.ts` / `classifyMember`.
- **Call budget:** 1 `/clients` page + a small per-client sample (default 3 clients, hard cap
  `MAX_PER_CLIENT_CALLS = 8`); finds the working path on the first client, stops early once dated
  history is confirmed, and never broadly iterates all clients.

### Run (local only — worktree-safe absolute `--env-file`; never commit or paste the key)

```bash
# Network-free safe-output self-test FIRST (makes NO request, needs NO key):
npx tsx scripts/wodify/clientSigninsProbe.ts --selftest

# Live run (point --env-file at the primary clone's gitignored env by ABSOLUTE path):
npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
  scripts/wodify/clientSigninsProbe.ts
```

### First run outcome (2026-06-05) — UNPROVEN, blocked at the `/clients` prerequisite

The live run returned a clean, contract-safe result but **never reached the per-client endpoint**:
`/clients` was transport-`2xx` with `errorEnvelopeDetected: false`, yet `recordsOnFirstPage: 0` and
`clientIdsExtractedForSample: 0`, so no ID could be sampled (`conclusionReasonCode:
"could_not_obtain_client_id"`). Because the body was **not** an error envelope, the current
`RECORD_ARRAY_KEYS` / `CLIENT_ID_FIELDS` simply did not match the `/clients` response shape (these are
lowercase; Wodify is PascalCase-heavy). Given the §5 chat-reported ~912-client audit, a **response-shape
mismatch** is the likely cause — not a genuinely empty client list — but that is not proven from the
safe output. **Mapping is UNPROVEN (not disproven): the per-client path was never tested.** Next
(separately approved): a structure-only `/clients` **shape-discovery** pass to confirm the real
records-array key + client-ID field, then re-run this probe.

### Re-run (2026-06-05) — `/clients` prerequisite solved (#428 patch); per-client sign-ins path NOT found

After #428 proved `/clients` records live under the key `clients` (client-ID field `id`), this probe's
`RECORD_ARRAY_KEYS` was patched with one entry (`clients`, appended) and re-run. `/clients` now yields
records (`recordsOnFirstPage: 100`, `clientIdsExtractedForSample: 3`) — the prerequisite is solved. But
all four candidate per-client templates (`/clients/{id}/signins`, `/clients/{id}/sign-ins`,
`/signins/{id}`, `/sign-ins/{id}`) returned `4xx` (missing-ID signal), so `workingPathTemplate: null`
and `conclusionReasonCode: "no_working_path_found"`. **Dated check-in history is UNPROVEN and the
mapping is UNPROVEN (not disproven)** — the real per-client sign-ins path is not among these four
guesses. Note: `/clients` itself exposes recency (`last_attendance` / `last_class_sign_in` /
`days_since_last_attendance`), which may supply `lastCheckIn` for the first slice without a sign-ins
endpoint; that endpoint is still needed only for dated **history**. Next (separately approved): discover
the real per-client sign-ins path (Wodify API docs or a structure-only path probe), then re-run.

### Output shape (the only thing printed)

```ts
{
  probe: "clientSigninsProbe",
  clientsListEndpoint: {
    pathTemplate: "/clients",            // PATH only
    endpointReached: boolean,
    httpStatusClass: "2xx" | "4xx" | "5xx" | "network_error",
    errorEnvelopeDetected: boolean,
    embeddedHttpStatusClass: "2xx" | "4xx" | "5xx" | "network_error" | null,
    recordsOnFirstPage: number,          // count only
    clientIdsExtractedForSample: number, // count only — IDs are NEVER emitted
    clientRecordFieldNames: string[],    // SAFE field-NAME union (schema; ID-like redacted)
    redactedClientFieldNameCount: number
  },
  perClientSignins: {
    candidatePathTemplatesTried: string[],  // templates (with `{id}`) only
    workingPathTemplate: string | null,
    clientsSampled: number,
    perClientCallsMade: number,
    anyEndpointReached: boolean,
    httpStatusClassesSeen: string[],
    anyErrorEnvelopeDetected: boolean,
    embeddedHttpStatusClassesSeen: string[],
    anyMissingIdSignal: boolean,
    totalRecordsInspected: number,
    fieldPresenceCounts: { clientRef: number, checkInDate: number },
    recordFieldNames: string[],             // SAFE field-NAME union of sign-in records
    redactedRecordFieldNameCount: number,
    missingDateCount: number,
    invalidDateCount: number,
    sentinelDateCount: number,
    sampledClientsWithAnyCheckIn: number,
    sampledClientsWithMultipleDistinctDates: number,
    datedCheckInHistoryAvailable: boolean,  // >= 1 sampled client with >= 2 distinct valid dates
    earliestYear?: number,                  // optional, calendar-year granularity only
    latestYear?: number
  },
  conclusion: "proven" | "unproven",
  conclusionReasonCode:
    "records_with_checkin_date" | "could_not_obtain_client_id" | "no_working_path_found" |
    "working_path_no_records" | "working_path_records_without_checkin_date"
}
```

## `clientsShapeDiscovery.ts` — `/clients` response-shape discovery (§5)

`clientSigninsProbe.ts` (§5 step 2, #427) was blocked at its `/clients` prerequisite: `/clients`
returned 2xx (**not** an error envelope) but 0 records, so no client ID could be sampled. This script
settles whether `/clients` is genuinely **empty** or whether the records are nested under a key/shape
that probe's extractor missed — with **one** `/clients` call, structure only. It reproduces
`clientSigninsProbe`'s exact request and also reports whether the discovered records-array key + ID
field would have matched that probe's config (so we know if #427 needs a small patch).

### Safety (enforced by the script — same posture as `signinsShapeDiscovery.ts`, whose helpers it reuses)

- Reads the key only from `process.env.WODIFY_API_KEY`; never `VITE_*`, hardcoded, logged, or echoed;
  exits without a request if unset. Local / server-side only; never bundled.
- Emits **only** structural metadata: the endpoint **path** (never the query string / substituted URL),
  booleans, HTTP status classes, **key names**, array **lengths**, and per-field **type categories**
  (string / number / boolean / object / array / null). Never values — no names, IDs, dates, dues,
  pagination values, raw rows, or raw responses.
- ID-like field **names** are redacted; reads **one** sample record's field names + type categories
  only; detects the Wodify error envelope (in-body `HTTPCode` → status class only).
- **One `/clients` call**; makes no per-client calls; does not iterate clients; does not import
  `silentChurn.ts` / `classifyMember`.

### Run

```bash
npx tsx scripts/wodify/clientsShapeDiscovery.ts --selftest   # network-free, no key
npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
  scripts/wodify/clientsShapeDiscovery.ts
```

### Result (2026-06-05) — SHAPE MISMATCH, not empty

`/clients` returned `{ clients: [...100...], pagination: {...} }` — a full page of 100 records under
the key **`clients`**, which is **not** in `clientSigninsProbe.ts`'s `RECORD_ARRAY_KEYS`
(`recordArrayKeyMatchesClientProbeConfig: false`). That is why #427 read 0 records. The client-ID field
is **`id`** (already in #427's `CLIENT_ID_FIELDS`). `client_status` carries status; recency is on
`/clients` directly (`last_attendance`, `last_class_sign_in`, `days_since_last_attendance`); no dues
field is present. Next: add `clients` to #427's `RECORD_ARRAY_KEYS` and re-run the per-client probe.

### Output shape (the only thing printed — structure only)

```ts
{
  probe: "clientsShapeDiscovery",
  path: "/clients",
  endpointReached, httpStatusClass, errorEnvelopeDetected, embeddedHttpStatusClass,
  perClientIdLikelyRequired, jsonParseable, contentTypeIsJson,
  topLevelType, topLevelKeyNames, topLevelKeyCount, looksLikeIdKeyedMap, redactedKeyNameCount,
  arraysFound: Array<{ keyPath, length, elementsAreObjects }>,
  paginationKeyNamesFound,
  recordArrayKeyGuess, recordCountInGuessedArray,
  sampleRecordFieldNames, sampleRecordFieldTypes,   // field NAMES + TYPE CATEGORIES (never values)
  redactedSampleFieldNameCount,
  clientIdFieldGuess, checkInDateFieldGuess, duesFieldGuess, statusFieldGuess,
  recordArrayKeyMatchesClientProbeConfig, clientIdFieldMatchesClientProbeConfig,
  conclusion: "empty" | "shape_mismatch" | "records_under_known_key" | "error_envelope" |
              "non_2xx" | "non_json" | "inconclusive"
}
```

## `clientsRecencyProbe.ts` — `/clients` direct-recency suitability for the first-slice `lastCheckIn` (§5)

Evaluates whether `/clients`'s **direct** recency fields (`last_attendance` / `last_class_sign_in` /
`days_since_last_attendance`, plus `is_at_risk` / `total_class_sign_ins` — surfaced by #428) are
**sufficient** to source the first live Silent Churn slice's `lastCheckIn` **without** the per-client
sign-ins endpoint (#427 confirmed that endpoint is still unfound; it is needed only for dated *history*
/ recovery, not a single latest value). The target is `silentChurn.ts`'s `classifyMember`, which parses
`lastCheckIn` as a strict `YYYY-MM-DD` (`parseYmdLocal`) and computes `daysAbsent` against a today
(`asOf`) anchor — so the question is whether the `/clients` recency dates are date-like and
well-populated enough (after the `1900-01-01` sentinel guard) to feed `lastCheckIn` and let the **locked
classifier do the day math itself** (preserving the today-anchor), rather than trusting Wodify's
precomputed `days_since_last_attendance`.

### Safety (enforced by the script — same posture as the sibling probes; read-only Reviewer APPROVE)

- Reads the key **only** from `process.env.WODIFY_API_KEY`; never `VITE_*`, hardcoded, logged, or
  echoed; exits without a request if unset. Local / server-side only; never bundled.
- Reads recency VALUES in memory **only** to derive aggregates. Emits **only** counts, booleans, HTTP
  status classes, an ALLOWLISTED status-category breakdown (bucket names defined in the script — never a
  raw `client_status` value), the records-array KEY NAME (ID-like-guarded), the endpoint PATH, and
  verdict enums. Never values — no names, IDs, exact dates/timestamps, dues, pagination values, raw
  rows, raw bodies, the substituted URL, or secrets.
- `1900-01-01` is a null sentinel — counted separately as `sentinelCount`, never folded into
  `usableDateCount`. Detects the Wodify error envelope (in-body `HTTPCode` → status class only).
- **ONE `/clients` call** (page 1, the same request the sibling probes make); makes no per-client calls;
  does not iterate clients; does not import `silentChurn.ts` / `classifyMember`.

### Run

```bash
npx tsx scripts/wodify/clientsRecencyProbe.ts --selftest   # network-free, no key
npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
  scripts/wodify/clientsRecencyProbe.ts
```

### Result (2026-06-05) — SUFFICIENT on the sampled page; a date-slice is needed before `parseYmdLocal`

Run once (1 `/clients` page = 100 records; `morePagesAvailable: true`, so this is **page-1-only, not
global** — a broader run needs separate approval). Output stayed fully within the §5 safe contract.

- **Verdict: `suitability: "sufficient"`, `firstSliceLastCheckInDerivable: "yes"`.** Of the **26 active**
  records on the page (`client_status` → `active`; the rest, 74, bucketed `inactive` and are excluded by
  `classifyMember`), **23 (≈88%) have a usable, non-sentinel recency date** on `last_attendance` **and**
  on `last_class_sign_in` (`activeWithUsableEitherDate: 23`). The other ~3 active members have only the
  `1900-01-01` sentinel → they correctly land in the classifier's **`unknown`** bucket, never silently
  Healthy.
- **A date-slice IS required (`lastCheckInNormalizationNeeded: "date_slice"`).** Every usable value was
  `datedWithTime` (44/44 for each date field; `strictYmdCount: 0`) — i.e. ISO timestamps, **not** bare
  `YYYY-MM-DD`. `parseYmdLocal` rejects a timestamp, so the **server-side normalizer must slice the
  leading `YYYY-MM-DD`** before reusing the locked parser.
- **The `1900-01-01` sentinel is real and common** — 56/100 records overall (concentrated in inactive
  members; only ~3 of the 26 active). It must be stripped to `null` **before** the classifier, or
  `parseYmdLocal` would accept it and mis-classify the member as `silent` with a huge `daysAbsent` (the
  §5/§8 real-data guard).
- **`days_since_last_attendance` is NOT a clean substitute.** It is `numeric` for **100/100** records —
  *including* the 56 sentinel ones (where it is a meaningless ~46k-day count off `1900-01-01`, with no
  clean null signal). Sourcing `lastCheckIn` from `last_attendance` (where the sentinel is detectable)
  and letting `classifyMember` compute `daysAbsent` from **our** today-anchor is the sentinel-safe path
  and keeps the §4 anchor; trusting Wodify's precomputed count would inherit the sentinel as live data.
- **`is_at_risk` is far more conservative than our rule** (`true` for **1/100**) — a useful *secondary*
  Wodify-provided cross-check, not a replacement for the deterministic threshold classifier.
- **Still blocked without the per-client sign-ins endpoint:** dated check-in **history** (multiple events
  per member) for Silent Churn **Recovery**. `/clients` exposes only the *latest* recency value, which is
  exactly what the first-slice `lastCheckIn` needs — but not the multi-event history (#427/#428: that
  endpoint remains unfound; separate path-discovery task).

### Output shape (the only thing printed)

```ts
{
  probe: "clientsRecencyProbe",
  path: "/clients",                       // PATH only — never the query string / substituted URL
  endpointReached, httpStatusClass, errorEnvelopeDetected, embeddedHttpStatusClass,
  perClientIdLikelyRequired, jsonParseable,
  recordArrayKey,                         // SAFE key name (ID-like redacted)
  sampledPageRecordCount,                 // <= 100; PAGE-1 sample, NOT a global total
  pagesFetched,                           // always 1 (call budget)
  morePagesAvailable: boolean | null,     // a pagination has_more BOOLEAN (never a count value)
  statusCategoryCounts,                   // { <allowlisted bucket name>: count } — never raw status values
  activeRecordCount,
  lastAttendance:   { presentCount, missingCount, sentinelCount, strictYmdCount, datedWithTimeCount, unparseableCount, usableDateCount },
  lastClassSignIn:  { /* same DateFieldStats shape */ },
  daysSinceLastAttendance: { presentCount, missingCount, numericCount, negativeCount, nonNumericCount },
  totalClassSignIns:       { /* same NumericFieldStats shape */ },
  isAtRisk:         { presentCount, missingCount, trueCount, falseCount, nonBooleanCount },
  activeWithUsableLastAttendance, activeWithUsableLastClassSignIn, activeWithUsableEitherDate,
  activeWithDaysSinceNumeric, activeWithUsableDateAndDaysSince,
  firstSliceLastCheckInDerivable: "yes" | "partial" | "no",
  lastCheckInNormalizationNeeded: "none" | "date_slice" | "unknown",
  suitability: "sufficient" | "insufficient" | "unproven"
}
```
