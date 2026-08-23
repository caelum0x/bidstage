import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import {
  parseContributionApplicationAction,
  type ContributionApplicationState,
} from "@/lib/contribution-application";
import { query, takeRateLimit } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { serverEnv } from "@/lib/env";
import { MarketInputError } from "@/lib/market-error";

type UpdatedRow = { id: string; state: ContributionApplicationState; updated_at: Date };

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (request.headers.get("origin") !== serverEnv().appUrl) {
      return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
    }
    const edgeLimit = await enforceEdgeWriteRateLimit(request, "application_action");
    if (edgeLimit) return edgeLimit;
    const founder = await authenticatedFounder(request);
    if (!founder) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    if (!(await takeRateLimit("application_action", founder.id, 60, 3600))) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many application updates. Try again later." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new MarketInputError("Invalid application");
    const body = await request.json();
    const action = parseContributionApplicationAction(
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).action
        : undefined,
    );
    const nextState: ContributionApplicationState = action === "accept"
      ? "accepted"
      : action === "decline" ? "declined" : "withdrawn";
    const rows = await query<UpdatedRow>(
      `UPDATE contribution_applications AS application
       SET state = $3, updated_at = now(), responded_at = now()
       FROM listings AS listing
       WHERE application.id = $1
         AND listing.id = application.listing_id
         AND application.state = 'pending'
         AND (
           ($3 = 'withdrawn' AND application.contributor_id = $2)
           OR ($3 IN ('accepted', 'declined') AND listing.founder_id = $2)
         )
       RETURNING application.id, application.state, application.updated_at`,
      [id, founder.id, nextState],
    );
    const updated = rows[0];
    if (!updated) {
      return NextResponse.json(
        { error: "application_not_actionable", message: "This pending application is not available for that action." },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      { application: { id: updated.id, state: updated.state, updatedAt: updated.updated_at.toISOString() } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const clientError = error instanceof MarketInputError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: clientError ? "invalid_application_action" : "application_update_unavailable",
        message: error instanceof MarketInputError ? error.message : "Application could not be updated.",
      },
      { status: clientError ? 400 : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
