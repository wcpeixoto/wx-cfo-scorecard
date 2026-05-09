# ai-proxy Edge Function

V1 thin forwarder to `api.anthropic.com/v1/messages`. Holds the
`ANTHROPIC_API_KEY` secret server-side, pins the model, validates
request shape, and forwards Anthropic's status and JSON body verbatim
with CORS headers added.

See the May 9, 2026 entry in `wx_cfo_scorecard_context_v2_6.md` at the
repo root for the locked V1 architecture, six locked decisions, and
why the proxy is intentionally thin.

## Behavior

- Accepts POST from allowlisted origins only (`https://wcpeixoto.github.io`,
  `http://localhost:5173`). Disallowed origins receive `403` with no
  CORS headers (fail closed).
- Validates request body shape: `system` (string), `messages`
  (non-empty array), `temperature` (number), `max_tokens` (number).
  Bad shape returns `400 { "error": "invalid_request_body" }`.
- Server-pinned model: `claude-haiku-4-5` (dated snapshot at deploy
  time: `claude-haiku-4-5-20251001`). Any `model` field in the
  incoming body is silently discarded.
- Calls Anthropic with `anthropic-version: 2023-06-01` and an 8s
  timeout. Forwards Anthropic's status and JSON body verbatim
  (re-serialized) with CORS headers added.
- Network failure or upstream timeout returns
  `502 { "error": "upstream_unavailable" }` with CORS headers. No
  exception detail leaks.
- Missing or empty `ANTHROPIC_API_KEY` returns generic
  `500 { "error": "internal_error" }` with no CORS headers.
- Never logs request bodies, response bodies, headers, or the secret.

## Manual deploy

The deploy is manual for V1 — there is no GitHub Actions step for
`supabase functions deploy` and adding one is out of scope for the
hello-world.

```bash
# One-time, if not already done:
supabase login
supabase link --project-ref <your-project-ref>

# Deploy:
supabase functions deploy ai-proxy --no-verify-jwt
```

`--no-verify-jwt` is required: V1 threat model is CORS allowlist only
(no JWT check in source). Without the flag, the platform's default JWT
verification 401s every request before it reaches `index.ts`.

`supabase link` writes the project ref into `supabase/.temp/` which is
gitignored — the link is per-developer-machine, not committed.

## Setting the secret

```bash
supabase secrets set ANTHROPIC_API_KEY=<value>
```

The secret value must never be committed to the repo. For
hello-world testing, any non-empty placeholder string is acceptable —
the V0 endpoint reports `secret_loaded: true` for any non-empty value
and does not call Anthropic.

## Local verification

```bash
supabase functions serve ai-proxy --env-file ./supabase/.env.local
```

`supabase functions serve` runs the Edge Runtime in a Docker
container, so Docker Desktop must be installed and running. Verify
`./supabase/.env.local` is gitignored before adding any secret to it.

Four-scenario smoke test (curl):

```bash
# 1. OPTIONS from allowed origin -> 204, CORS headers present
curl -i -X OPTIONS \
  -H "Origin: http://localhost:5173" \
  http://localhost:54321/functions/v1/ai-proxy

# 2. OPTIONS from disallowed origin -> 403, no CORS headers
curl -i -X OPTIONS \
  -H "Origin: https://evil.example.com" \
  http://localhost:54321/functions/v1/ai-proxy

# 3. POST from allowed origin without secret set -> 200, secret_loaded: false
curl -i -X POST \
  -H "Origin: http://localhost:5173" \
  -H "Content-Type: application/json" \
  http://localhost:54321/functions/v1/ai-proxy

# 4. POST from allowed origin with secret set -> 200, secret_loaded: true
ANTHROPIC_API_KEY=placeholder \
  supabase functions serve ai-proxy
# (then re-run scenario 3's curl)
```

## CORS allowlist

Locked to two origins:

- `https://wcpeixoto.github.io` — production GitHub Pages origin.
  Note that the path component (`/wx-cfo-scorecard/`) is not part of
  the origin and does not appear in `Origin` headers.
- `http://localhost:5173` — Vite dev server default.

Adding origins requires editing `index.ts` and redeploying. There is
no wildcard, no permissive fallback, and no environment-variable
override.

## Out of scope for V1

- Browser-side wiring of `callAIProvider` (next prompt)
- Automated deploy via GitHub Actions
- JWT verification, signed requests, or any auth beyond CORS
  allowlist (V1 threat model: cost protection and secret isolation,
  not access control)
- Caching (browser-side, separate Notion item)
- Retry logic (one upstream attempt; failures forwarded)

See the "May 9, 2026 — AI proxy V1 architecture locked" entry in
`wx_cfo_scorecard_context_v2_6.md` for the full architecture and
the six locked decisions.
