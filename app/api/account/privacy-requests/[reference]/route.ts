import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import { query, takeRateLimit } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { serverEnv } from "@/lib/env";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ reference: string }> },
) {
  try {
    if (request.headers.get("origin") !== serverEnv().appUrl) {
      return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers: privateHeaders });
    }
    const edgeLimit = await enforceEdgeWriteRateLimit(request, "privacy_request_action");
    if (edgeLimit) return edgeLimit;
    const founder = await authenticatedFounder(request);
    if (!founder) {
      return NextResponse.json(
        { error: "authentication_required", message: "Sign in with GitHub to cancel a privacy request." },
        { status: 401, headers: privateHeaders },
      );
    }
    if (!(await takeRateLimit("privacy_request_action", founder.id, 10, 3600))) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many privacy-request updates. Try again later." },
        { status: 429, headers: { ...privateHeaders, "Retry-After": "3600" } },
      );
    }
    const { reference } = await context.params;
    if (!/^[a-f0-9]{16}$/.test(reference)) {
      return NextResponse.json({ error: "invalid_privacy_request" }, { status: 400, headers: privateHeaders });
    }
    const rows = await query<{ public_reference: string; updated_at: Date; completed_at: Date }>(
      `UPDATE privacy_requests
       SET state = 'cancelled', updated_at = now(), completed_at = now()
       WHERE public_reference = $1
         AND founder_id = $2
         AND state IN ('open', 'in_progress')
       RETURNING public_reference, updated_at, completed_at`,
      [reference, founder.id],
    );
    if (!rows[0]) {
      return NextResponse.json(
        { error: "privacy_request_not_cancellable", message: "This request is no longer available to cancel." },
        { status: 409, headers: privateHeaders },
      );
    }
    return NextResponse.json(
      {
        request: {
          reference: rows[0].public_reference,
          state: "cancelled",
          updatedAt: rows[0].updated_at.toISOString(),
          completedAt: rows[0].completed_at.toISOString(),
        },
      },
      { headers: privateHeaders },
    );
  } catch {
    return NextResponse.json(
      { error: "privacy_request_unavailable", message: "The privacy request could not be cancelled." },
      { status: 503, headers: privateHeaders },
    );
  }
}
