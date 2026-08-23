import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import { parseContributionFollowupMessage } from "@/lib/contribution-application";
import { query, takeRateLimit, transaction } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { serverEnv } from "@/lib/env";
import { MarketInputError } from "@/lib/market-error";

type ParticipantRow = {
  id: string;
  state: "pending" | "accepted" | "declined" | "withdrawn";
  contributor_id: string;
  maintainer_id: string | null;
};

type MessageRow = {
  id: string;
  author_id: string;
  body: string;
  created_at: Date;
};

function validApplicationId(id: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(id);
}

async function participant(applicationId: string, actorId: string): Promise<ParticipantRow | undefined> {
  const rows = await query<ParticipantRow>(
    `SELECT application.id, application.state, application.contributor_id,
            listing.founder_id AS maintainer_id
     FROM contribution_applications AS application
     JOIN listings AS listing ON listing.id = application.listing_id
     WHERE application.id = $1
       AND (application.contributor_id = $2 OR listing.founder_id = $2)
     LIMIT 1`,
    [applicationId, actorId],
  );
  return rows[0];
}

function messageJson(row: MessageRow, actorId: string, application: ParticipantRow) {
  return {
    id: row.id,
    author: row.author_id === actorId
      ? "you"
      : row.author_id === application.contributor_id ? "contributor" : "maintainer",
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const founder = await authenticatedFounder(request);
  if (!founder) {
    return NextResponse.json(
      { error: "authentication_required" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const { id } = await context.params;
  if (!validApplicationId(id)) return NextResponse.json({ error: "application_not_found" }, { status: 404 });
  try {
    const application = await participant(id, founder.id);
    if (!application) return NextResponse.json({ error: "application_not_found" }, { status: 404 });
    if (application.state !== "accepted") {
      return NextResponse.json(
        { error: "correspondence_unavailable", message: "Correspondence opens after an application is accepted." },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const messages = await query<MessageRow>(
      `SELECT id, author_id, body, created_at
       FROM contribution_application_messages
       WHERE application_id = $1
       ORDER BY created_at ASC, id ASC
       LIMIT 200`,
      [id],
    );
    return NextResponse.json(
      { applicationId: id, messages: messages.map((row) => messageJson(row, founder.id, application)) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "correspondence_unavailable", message: "Correspondence is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export async function POST(
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
    const edgeLimit = await enforceEdgeWriteRateLimit(request, "application_message");
    if (edgeLimit) return edgeLimit;
    const founder = await authenticatedFounder(request);
    if (!founder) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    if (!(await takeRateLimit("application_message", founder.id, 60, 3600))) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many messages. Try again later." },
        { status: 429, headers: { "Retry-After": "3600", "Cache-Control": "private, no-store" } },
      );
    }
    const { id } = await context.params;
    if (!validApplicationId(id)) throw new MarketInputError("Invalid application");
    const payload = await request.json() as { message?: unknown };
    const body = parseContributionFollowupMessage(payload.message);
    const result = await transaction(async (client) => {
      const applications = await client.query<ParticipantRow>(
        `SELECT application.id, application.state, application.contributor_id,
                listing.founder_id AS maintainer_id
         FROM contribution_applications AS application
         JOIN listings AS listing ON listing.id = application.listing_id
         WHERE application.id = $1
           AND (application.contributor_id = $2 OR listing.founder_id = $2)
         FOR UPDATE OF application`,
        [id, founder.id],
      );
      const application = applications.rows[0];
      if (!application || application.state !== "accepted") return undefined;
      const inserted = await client.query<MessageRow>(
        `INSERT INTO contribution_application_messages (application_id, author_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, author_id, body, created_at`,
        [id, founder.id, body],
      );
      return { application, message: inserted.rows[0]! };
    });
    if (!result) {
      return NextResponse.json(
        { error: "correspondence_unavailable", message: "Correspondence is available only to both parties after acceptance." },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      { message: messageJson(result.message, founder.id, result.application) },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const clientError = error instanceof MarketInputError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: clientError ? "invalid_message" : "correspondence_unavailable",
        message: error instanceof MarketInputError ? error.message : "Message could not be sent.",
      },
      { status: clientError ? 400 : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
