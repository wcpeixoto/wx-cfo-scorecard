// Hello-world scaffold for the AI proxy described in
// wx_cfo_scorecard_context_v2_6.md May 9 entry. Verifies CORS allowlist
// and ANTHROPIC_API_KEY secret loading. No Anthropic integration.
//
// Architecture: thin proxy. request in -> Anthropic call -> validated JSON out.
// V0 (this file): no Anthropic call. Proves CORS + secret loading work.

const ALLOWED_ORIGINS = [
  "https://wcpeixoto.github.io",
  "http://localhost:5173",
];

const ALLOWED_METHODS = "POST, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";
const PREFLIGHT_MAX_AGE = "86400";

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

Deno.serve((req: Request): Response => {
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
      const secret_loaded = typeof apiKey === "string" && apiKey.length > 0;
      return jsonResponse(
        200,
        {
          status: "ok",
          function: "ai-proxy",
          version: "v0-helloworld",
          secret_loaded,
        },
        corsHeadersFor(origin),
      );
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
