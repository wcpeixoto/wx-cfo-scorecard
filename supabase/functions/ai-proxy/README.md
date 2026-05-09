# ai-proxy Edge Function

Hello-world scaffold for the AI proxy. Verifies CORS allowlist and
`ANTHROPIC_API_KEY` secret loading via `Deno.env`. **No Anthropic
integration.** No browser-side wiring.

See the May 9, 2026 entry in `wx_cfo_scorecard_context_v2_6.md` at the
repo root for the locked V1 architecture, six locked decisions, and
why the proxy is intentionally thin.

## Purpose

This V0 scaffold proves four things end-to-end:

1. The function deploys cleanly via `supabase functions deploy`.
2. CORS allowlist works — only `https://wcpeixoto.github.io` and
   `http://localhost:5173` are accepted. Disallowed origins receive
   `403` with no CORS headers (fail closed).
3. The `ANTHROPIC_API_KEY` secret loads correctly via
   `Deno.env.get()`. The function reports presence only — never the
   value.
4. A browser at an allowed origin can reach the function.

The Anthropic integration is a follow-up session.

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

- Anthropic API integration (next session)
- Browser-side wiring of `callAIProvider` (deferred — proxy must
  ship and verify before any browser code references it)
- Automated deploy via GitHub Actions
- JWT verification, signed requests, or any auth beyond CORS
  allowlist (V1 threat model: cost protection and secret isolation,
  not access control)
- Caching (browser-side, separate Notion item, blocked on this proxy
  shipping)

See the "May 9, 2026 — AI proxy V1 architecture locked" entry in
`wx_cfo_scorecard_context_v2_6.md` for the full architecture and
the six locked decisions.
