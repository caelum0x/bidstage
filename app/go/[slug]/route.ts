import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { query, transaction } from "@/lib/db";
import { requestSubject } from "@/lib/market";
import { privacyHash } from "@/lib/privacy-hash";

const VISITOR_COOKIE = "bidstage_visit";
const REPEAT_WINDOW_MINUTES = 30;

type ClickDecision =
  | "verified"
  | "excluded_bot"
  | "excluded_prefetch"
  | "excluded_repeat"
  | "excluded_non_navigation";

type Listing = { id: string; destination: string };

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function referrerOrigin(request: Request): string | null {
  const referrer = request.headers.get("referer");
  try {
    return referrer ? new URL(referrer).origin : null;
  } catch {
    return null;
  }
}

function classifyRequest(request: Request): {
  decision: ClickDecision;
  reason: string | null;
  userAgentClass: "browser" | "bot" | "unknown";
} {
  const userAgent = request.headers.get("user-agent")?.trim() ?? "";
  const purpose = `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`.toLowerCase();
  const fetchMode = request.headers.get("sec-fetch-mode");
  const fetchDestination = request.headers.get("sec-fetch-dest");

  if (/prefetch|prerender/.test(purpose) || request.headers.has("x-moz")) {
    return { decision: "excluded_prefetch", reason: "browser_prefetch", userAgentClass: "browser" };
  }
  if (
    !userAgent ||
    /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|telegrambot|discordbot|linkedinbot|preview|headless|lighthouse|curl|wget|python-requests|postmanruntime/i.test(userAgent)
  ) {
    return {
      decision: "excluded_bot",
      reason: userAgent ? "automated_user_agent" : "missing_user_agent",
      userAgentClass: userAgent ? "bot" : "unknown",
    };
  }
  if ((fetchMode && fetchMode !== "navigate") || (fetchDestination && fetchDestination !== "document")) {
    return {
      decision: "excluded_non_navigation",
      reason: "not_a_document_navigation",
      userAgentClass: "browser",
    };
  }
  return { decision: "verified", reason: null, userAgentClass: "browser" };
}

async function activeDestination(slug: string): Promise<Listing | undefined> {
  const listings = await query<Listing>(
    "SELECT id, destination FROM listings WHERE slug = $1 AND status = 'active' LIMIT 1",
    [slug],
  );
  return listings[0];
}

export async function HEAD(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const listing = await activeDestination(slug);
  if (!listing) return NextResponse.redirect(new URL("/?missing=listing", request.url), 303);
  const response = NextResponse.redirect(listing.destination, 302);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const existingVisitor = cookieValue(request, VISITOR_COOKIE);
  const visitorId =
    existingVisitor && /^[a-f0-9-]{36}$/i.test(existingVisitor)
      ? existingVisitor
      : randomUUID();
  const requestClass = classifyRequest(request);

  const destination = await transaction(async (client) => {
    const listingResult = await client.query<Listing>(
      "SELECT id, destination FROM listings WHERE slug = $1 AND status = 'active' LIMIT 1",
      [slug],
    );
    const listing = listingResult.rows[0];
    if (!listing) return undefined;

    const userAgent = request.headers.get("user-agent") ?? "unknown";
    const sessionHash = privacyHash(
      `click:${listing.id}:${visitorId}:${requestSubject(request)}:${userAgent}`,
    );
    let decision = requestClass.decision;
    let reason = requestClass.reason;

    if (decision === "verified") {
      const session = await client.query<{ verified: boolean }>(
        `INSERT INTO click_sessions
           (listing_id, session_hash, last_verified_at)
         VALUES ($1, $2, now())
         ON CONFLICT (listing_id, session_hash) DO UPDATE SET
           request_count = click_sessions.request_count + 1,
           last_seen_at = now(),
           expires_at = now() + interval '30 days',
           last_verified_at = CASE
             WHEN click_sessions.last_verified_at IS NULL
               OR click_sessions.last_verified_at <= now() - ($3 * interval '1 minute')
             THEN now()
             ELSE click_sessions.last_verified_at
           END
         RETURNING last_verified_at = now() AS verified`,
        [listing.id, sessionHash, REPEAT_WINDOW_MINUTES],
      );
      if (session.rows[0]?.verified !== true) {
        decision = "excluded_repeat";
        reason = `repeat_within_${REPEAT_WINDOW_MINUTES}_minutes`;
      }
    }

    await client.query(
      `INSERT INTO click_events
         (listing_id, referrer_origin, session_hash, user_agent_class,
          decision, exclusion_reason, retention_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + interval '30 days')`,
      [
        listing.id,
        referrerOrigin(request),
        sessionHash,
        requestClass.userAgentClass,
        decision,
        reason,
      ],
    );
    if (decision === "verified") {
      await client.query(
        "UPDATE listings SET outbound_clicks = outbound_clicks + 1, updated_at = now() WHERE id = $1",
        [listing.id],
      );
    }
    return listing.destination;
  });

  if (!destination) return NextResponse.redirect(new URL("/?missing=listing", request.url), 303);
  const response = NextResponse.redirect(destination, 302);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/go/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}
