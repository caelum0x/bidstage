import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import { parseContributionApplicationMessage } from "@/lib/contribution-application";
import { query, takeRateLimit } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { serverEnv } from "@/lib/env";
import { MarketInputError } from "@/lib/market-error";

type ApplicationRow = { id: string; state: "pending" };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const env = serverEnv();
    if (request.headers.get("origin") !== env.appUrl) {
      return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
    }
    const edgeLimit = await enforceEdgeWriteRateLimit(request, "opportunity_application");
    if (edgeLimit) return edgeLimit;
    const founder = await authenticatedFounder(request);
    if (!founder) {
      return NextResponse.json(
        { error: "authentication_required", message: "Sign in with GitHub to apply." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (!(await takeRateLimit("opportunity_application", founder.id, 20, 86_400))) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many applications today. Try again later." },
        { status: 429, headers: { "Retry-After": "86400", "Cache-Control": "private, no-store" } },
      );
    }
    const { slug } = await context.params;
    if (!/^[a-z0-9-]{3,100}$/.test(slug)) throw new MarketInputError("Invalid opportunity");
    const body = await request.json();
    const message = parseContributionApplicationMessage(
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).message
        : undefined,
    );
    const rows = await query<ApplicationRow>(
      `INSERT INTO contribution_applications (listing_id, contributor_id, message)
       SELECT listing.id, $2, $3
       FROM listings AS listing
       JOIN contributor_profiles AS profile ON profile.founder_id = $2
       WHERE listing.slug = $1
         AND listing.status = 'active'
         AND listing.product_kind = 'open_source'
         AND listing.contribution_url IS NOT NULL
         AND listing.founder_id IS NOT NULL
         AND listing.founder_id <> $2::uuid
         AND profile.is_public = true
         AND profile.availability IN ('available', 'limited')
       ON CONFLICT (listing_id, contributor_id) DO NOTHING
       RETURNING id, state`,
      [slug, founder.id, message],
    );
    const application = rows[0];
    if (!application) {
      return NextResponse.json(
        {
          error: "application_unavailable",
          message: "Publish an available contributor profile first, or check that you have not already applied.",
        },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      { application: { id: application.id, state: application.state } },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const clientError = error instanceof MarketInputError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: clientError ? "invalid_application" : "application_unavailable",
        message: error instanceof MarketInputError ? error.message : "Application could not be submitted.",
      },
      { status: clientError ? 400 : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
