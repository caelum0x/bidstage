import { createHash, randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { takeRateLimit, transaction } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { founderCheckoutAccess } from "@/lib/founder-access";
import { requestSubject } from "@/lib/market";
import { isSupportCategory, normalizeSupportMessage } from "@/lib/support";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }
  const edgeLimit = await enforceEdgeWriteRateLimit(request, "support_case");
  if (edgeLimit) return edgeLimit;
  if (!(await takeRateLimit("support-case", requestSubject(request), 5, 3600))) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many support cases. Try again later." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const receiptReference = typeof body.receiptReference === "string" ? body.receiptReference : "";
    const category = typeof body.category === "string" ? body.category : "";
    let message = "";
    try {
      message = normalizeSupportMessage(body.message);
    } catch {
      return NextResponse.json({ error: "invalid_message", message: "Describe the issue in 20–1200 characters." }, { status: 400 });
    }
    if (!/^[a-f0-9]{24}$/.test(receiptReference)) {
      return NextResponse.json({ error: "invalid_receipt", message: "Enter a valid receipt reference." }, { status: 400 });
    }
    if (!isSupportCategory(category)) {
      return NextResponse.json({ error: "invalid_category", message: "Choose a support category." }, { status: 400 });
    }
    const checkout = await founderCheckoutAccess(request, receiptReference);
    if (!checkout) {
      return NextResponse.json(
        { error: "founder_access_required", message: "Founder access is required to open support for this receipt." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (category === "appeal" && !["review", "removed"].includes(checkout.listingStatus ?? "")) {
      return NextResponse.json(
        { error: "appeal_not_available", message: "An appeal is available only while a settled listing is under review or removed." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const publicReference = randomBytes(8).toString("hex");
    const accessToken = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(accessToken).digest("hex");
    await transaction(async (client) => {
      const supportCase = await client.query<{ id: string }>(
        `INSERT INTO support_cases
           (public_reference, access_token_hash, checkout_id, category, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [publicReference, tokenHash, checkout.checkoutId, category, message],
      );
      await client.query(
        `INSERT INTO support_case_messages
           (support_case_id, author_type, body)
         VALUES ($1, 'founder', $2)`,
        [supportCase.rows[0]!.id, message],
      );
    });
    return NextResponse.json(
      { caseReference: publicReference, caseUrl: `/support/${publicReference}#${accessToken}` },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error
      && error.code === "23505"
    ) {
      return NextResponse.json(
        { error: "appeal_already_open", message: "This receipt already has an open appeal. Add information to that case instead." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "support_unavailable", message: "Support intake is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
