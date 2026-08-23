import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import { query, takeRateLimit } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { serverEnv } from "@/lib/env";
import { MarketInputError } from "@/lib/market-error";
import { parsePrivacyRequest, type PrivacyRequestState, type PrivacyRequestType } from "@/lib/privacy-request";

type PrivacyRequestRow = {
  public_reference: string;
  request_type: PrivacyRequestType;
  details: string;
  state: PrivacyRequestState;
  operator_response: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

function responseRequest(row: PrivacyRequestRow) {
  return {
    reference: row.public_reference,
    requestType: row.request_type,
    details: row.details,
    state: row.state,
    operatorResponse: row.operator_response,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const founder = await authenticatedFounder(request);
    if (!founder) {
      return NextResponse.json(
        { error: "authentication_required", message: "Sign in with GitHub to manage privacy requests." },
        { status: 401, headers: privateHeaders },
      );
    }
    const rows = await query<PrivacyRequestRow>(
      `SELECT public_reference, request_type, details, state, operator_response,
              created_at, updated_at, completed_at
       FROM privacy_requests
       WHERE founder_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      [founder.id],
    );
    return NextResponse.json(
      { requests: rows.map(responseRequest) },
      { headers: privateHeaders },
    );
  } catch {
    return NextResponse.json(
      { error: "privacy_requests_unavailable", message: "Your privacy requests are unavailable." },
      { status: 503, headers: privateHeaders },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== serverEnv().appUrl) {
      return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers: privateHeaders });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "invalid_content_type" }, { status: 415, headers: privateHeaders });
    }
    const edgeLimit = await enforceEdgeWriteRateLimit(request, "privacy_request");
    if (edgeLimit) return edgeLimit;
    const founder = await authenticatedFounder(request);
    if (!founder) {
      return NextResponse.json(
        { error: "authentication_required", message: "Sign in with GitHub to make a privacy request." },
        { status: 401, headers: privateHeaders },
      );
    }
    if (!(await takeRateLimit("privacy_request", founder.id, 5, 86_400))) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many privacy requests. Try again tomorrow." },
        { status: 429, headers: { ...privateHeaders, "Retry-After": "86400" } },
      );
    }
    const input = parsePrivacyRequest(await request.json());
    const rows = await query<PrivacyRequestRow>(
      `INSERT INTO privacy_requests (founder_id, request_type, details)
       VALUES ($1, $2, $3)
       ON CONFLICT (founder_id, request_type)
         WHERE state IN ('open', 'in_progress')
       DO NOTHING
       RETURNING public_reference, request_type, details, state, operator_response,
                 created_at, updated_at, completed_at`,
      [founder.id, input.requestType, input.details],
    );
    if (!rows[0]) {
      return NextResponse.json(
        { error: "privacy_request_already_open", message: "You already have an active request of this type." },
        { status: 409, headers: privateHeaders },
      );
    }
    return NextResponse.json(
      { request: responseRequest(rows[0]), message: "Your privacy request is in the operator queue." },
      { status: 201, headers: privateHeaders },
    );
  } catch (error) {
    const clientError = error instanceof MarketInputError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: clientError ? "invalid_privacy_request" : "privacy_request_unavailable",
        message: error instanceof MarketInputError
          ? error.message
          : error instanceof SyntaxError ? "Send a valid privacy request." : "Your privacy request could not be saved.",
      },
      { status: clientError ? 400 : 503, headers: privateHeaders },
    );
  }
}
