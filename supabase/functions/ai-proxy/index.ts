// V1 AI proxy. Thin forwarder to api.anthropic.com/v1/messages.
//
// Architecture (May 9, 2026 locked decisions):
//   request in -> Anthropic call -> validated JSON out
// Model is pinned server-side. Any `model` field in the incoming
// request body is silently discarded. CORS allowlist is the only
// auth boundary; deploy with --no-verify-jwt.

const ALLOWED_ORIGINS = [
  "https://wcpeixoto.github.io",
  "http://localhost:5173",
];

const ALLOWED_METHODS = "POST, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";
const PREFLIGHT_MAX_AGE = "86400";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// dated snapshot at deploy time: claude-haiku-4-5-20251001
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_TIMEOUT_MS = 8000;

function corsHeadersFor(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": PREFLIGHT_MAX_AGE,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function isAllowedOrigin(origin: string | null): origin is string {
  return origin !== null && ALLOWED_ORIGINS.includes(origin);
}

interface ValidatedBody {
  system: string;
  messages: unknown[];
  temperature: number;
  max_tokens: number;
}

function validateRequestBody(body: unknown): ValidatedBody | null {
  if (body === null || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const { system, messages, temperature, max_tokens } = obj;
  if (typeof system !== "string" || system.length === 0) return null;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  if (typeof temperature !== "number") return null;
  if (typeof max_tokens !== "number") return null;
  // Any `model` field on `obj` is silently discarded — model is pinned server-side.
  return { system, messages, temperature, max_tokens };
}

async function forwardToAnthropic(
  apiKey: string,
  validated: ValidatedBody,
): Promise<{ status: number; body: unknown }> {
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      system: validated.system,
      messages: validated.messages,
      temperature: validated.temperature,
      max_tokens: validated.max_tokens,
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  const parsed = await upstream.json();
  return { status: upstream.status, body: parsed };
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const origin = req.headers.get("origin");
    const method = req.method.toUpperCase();

    if (method === "OPTIONS") {
      if (!isAllowedOrigin(origin)) {
        return jsonResponse(403, { error: "origin_not_allowed" });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeadersFor(origin),
      });
    }

    if (method === "POST") {
      if (!isAllowedOrigin(origin)) {
        return jsonResponse(403, { error: "origin_not_allowed" });
      }
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (typeof apiKey !== "string" || apiKey.length === 0) {
        return jsonResponse(500, { error: "internal_error" });
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonResponse(
          400,
          { error: "invalid_request_body" },
          corsHeadersFor(origin),
        );
      }

      const validated = validateRequestBody(body);
      if (!validated) {
        return jsonResponse(
          400,
          { error: "invalid_request_body" },
          corsHeadersFor(origin),
        );
      }

      try {
        const { status, body: upstreamBody } = await forwardToAnthropic(
          apiKey,
          validated,
        );
        return jsonResponse(status, upstreamBody, corsHeadersFor(origin));
      } catch {
        return jsonResponse(
          502,
          { error: "upstream_unavailable" },
          corsHeadersFor(origin),
        );
      }
    }

    // GET, PUT, DELETE, PATCH, etc.
    if (isAllowedOrigin(origin)) {
      return jsonResponse(
        405,
        { error: "method_not_allowed" },
        corsHeadersFor(origin),
      );
    }
    return jsonResponse(405, { error: "method_not_allowed" });
  } catch (err) {
    console.error("ai-proxy internal error", err);
    return jsonResponse(500, { error: "internal_error" });
  }
});
