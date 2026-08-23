import { NextResponse } from "next/server";

import { takeRateLimit, transaction } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { requestSubject } from "@/lib/market";
import { authorizedSupportCase, bearerToken, normalizeSupportMessage } from "@/lib/support";

export async function POST(
  request: Request,
  context: { params: Promise<{ reference: string }> },
) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const edgeLimit = await enforceEdgeWriteRateLimit(request, "support_reply");
  if (edgeLimit) return edgeLimit;
  if (!(await takeRateLimit("support-reply", requestSubject(request), 20, 3600))) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many replies. Try again later." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  const { reference } = await context.params;
  const token = bearerToken(request);
  const supportCase = token ? await authorizedSupportCase(reference, token) : undefined;
  if (!supportCase) return NextResponse.json({ error: "case_not_found" }, { status: 404 });
  if (!["open", "needs_customer"].includes(supportCase.state)) {
    return NextResponse.json(
      { error: "case_closed", message: "This case no longer accepts replies." },
      { status: 409 },
    );
  }
  let body: string;
  try {
    const payload = await request.json() as { message?: unknown };
    body = normalizeSupportMessage(payload.message, 3);
  } catch {
    return NextResponse.json(
      { error: "invalid_message", message: "Reply must be 3–1200 characters." },
      { status: 400 },
    );
  }
  try {
    await transaction(async (client) => {
      const locked = await client.query<{ state: string }>(
        "SELECT state FROM support_cases WHERE id = $1 FOR UPDATE",
        [supportCase.id],
      );
      if (!locked.rows[0] || !["open", "needs_customer"].includes(locked.rows[0].state)) {
        throw new Error("Support case closed during reply");
      }
      await client.query(
        `INSERT INTO support_case_messages (support_case_id, author_type, body)
         VALUES ($1, 'founder', $2)`,
        [supportCase.id, body],
      );
      await client.query(
        "UPDATE support_cases SET state = 'open', updated_at = now() WHERE id = $1",
        [supportCase.id],
      );
    });
  } catch {
    return NextResponse.json(
      { error: "case_changed", message: "The case changed while this reply was sent. Reload and try again." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ accepted: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
