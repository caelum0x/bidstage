import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requestSubject } from "./market";
import { privacyHash } from "./privacy-hash";

const BUCKET_PATTERN = /^[a-z0-9_-]{3,48}$/;
const EDGE_WINDOW_SECONDS = 60;

export type EdgeRateLimitMode = "configured" | "database_only" | "missing";

function cloudflareEnvironment(): CloudflareEnv | undefined {
  try {
    return getCloudflareContext().env;
  } catch {
    // Next builds, scripts, tests, and Node/Docker deployments have no Worker
    // execution context. The durable PostgreSQL limiter remains authoritative.
    return undefined;
  }
}

function coarseClientHints(request: Request): string {
  return [
    request.headers.get("user-agent") ?? "",
    request.headers.get("accept-language") ?? "",
    request.headers.get("sec-ch-ua") ?? "",
    request.headers.get("sec-ch-ua-platform") ?? "",
  ].join("\0");
}

function privateActor(request: Request): string {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization) return `authorization:${authorization}`;

  const cookie = request.headers.get("cookie")?.trim();
  if (cookie) return `cookie:${cookie}`;

  return `request:${requestSubject(request)}:${coarseClientHints(request)}`;
}

export function edgeRateLimitKey(
  request: Request,
  bucket: string,
  hash: (value: string) => string = privacyHash,
): string {
  if (!BUCKET_PATTERN.test(bucket)) {
    throw new Error(`Invalid edge rate-limit bucket: ${bucket}`);
  }
  return `${bucket}:${hash(`edge:${privateActor(request)}`)}`;
}

export function edgeRateLimitMode(): EdgeRateLimitMode {
  const env = cloudflareEnvironment();
  if (!env) return "database_only";
  return env.EDGE_WRITE_RATE_LIMITER ? "configured" : "missing";
}

function unavailableResponse(): Response {
  return Response.json(
    {
      error: "edge_rate_limit_unavailable",
      message: "Request protection is temporarily unavailable. Try again shortly.",
    },
    {
      status: 503,
      headers: { "Cache-Control": "private, no-store", "Retry-After": "10" },
    },
  );
}

export async function enforceEdgeWriteRateLimit(
  request: Request,
  bucket: string,
): Promise<Response | undefined> {
  const env = cloudflareEnvironment();
  if (!env) return undefined;

  const binding = env.EDGE_WRITE_RATE_LIMITER;
  if (!binding) return unavailableResponse();

  try {
    const result = await binding.limit({ key: edgeRateLimitKey(request, bucket) });
    if (result.success) return undefined;
    return Response.json(
      { error: "rate_limited", message: "Too many requests. Try again shortly." },
      {
        status: 429,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(EDGE_WINDOW_SECONDS),
        },
      },
    );
  } catch {
    // Inside a Worker, silently bypassing a broken binding would remove the
    // pre-database abuse boundary. Fail closed while allowing a quick retry.
    return unavailableResponse();
  }
}
