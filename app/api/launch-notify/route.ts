import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import { query, takeRateLimit } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import {
  isLaunchNotifySource,
  normalizeLaunchNotifyEmail,
  normalizeLaunchNotifyRepositoryUrl,
} from "@/lib/launch-notify";
import { requestSubject } from "@/lib/market";
import { serverEnv } from "@/lib/env";

/**
 * Pre-launch demand capture: "email me when checkout opens."
 *
 * Anonymous by design (the buyer may not have signed in yet), so the endpoint
 * is defended by the same origin + rate-limit stack as the other public write
 * routes, and it responds identically for new and already-subscribed emails so
 * it cannot be used to probe who is on the list.
 */
export async function POST(request: NextRequest) {
  // Same policy as checkout: compare against the configured public origin, not
  // request.nextUrl, so a proxy-rewritten Host header cannot shift the check.
  if (request.headers.get("origin") !== serverEnv().appUrl) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const edgeLimit = await enforceEdgeWriteRateLimit(request, "launch_notify");
  if (edgeLimit) return edgeLimit;
  if (!(await takeRateLimit("launch-notify", requestSubject(request), 5, 3600))) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many signups from this connection. Try again later." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    let email: string;
    let repositoryUrl: string | null;
    try {
      email = normalizeLaunchNotifyEmail(body.email);
      repositoryUrl = normalizeLaunchNotifyRepositoryUrl(body.repositoryUrl);
    } catch (cause) {
      return NextResponse.json(
        {
          error: "invalid_input",
          message: cause instanceof Error ? cause.message : "Enter a valid email address.",
        },
        { status: 400 },
      );
    }
    const source = isLaunchNotifySource(body.source) ? body.source : "checkout_disabled";
    const founder = await authenticatedFounder(request);
    await query(
      `INSERT INTO launch_notifications (email, source, repository_url, founder_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [email, source, repositoryUrl, founder?.id ?? null],
    );
    return NextResponse.json(
      { status: "subscribed" },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "notify_unavailable", message: "Signup is temporarily unavailable. Try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
