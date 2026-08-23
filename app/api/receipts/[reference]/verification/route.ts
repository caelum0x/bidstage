import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { query, takeRateLimit, transaction } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { founderCheckoutAccess } from "@/lib/founder-access";
import { requestSubject } from "@/lib/market";
import { resolveDnsTxtRecords } from "@/lib/destination-safety";

export const runtime = "nodejs";

type VerificationRow = {
  hostname: string;
  record_name: string;
  challenge_token: string;
  state: "pending" | "verified" | "expired";
  attempt_count: number;
  expires_at: Date;
  verified_at: Date | null;
};

type ReceiptListing = {
  checkout_id: string;
  listing_id: string;
  destination: string;
};

function response(row: VerificationRow) {
  return {
    available: true,
    method: "dns_txt",
    hostname: row.hostname,
    recordName: row.record_name,
    recordValue: row.challenge_token,
    state: row.state,
    attemptCount: row.attempt_count,
    expiresAt: row.expires_at.toISOString(),
    verifiedAt: row.verified_at?.toISOString() ?? null,
  };
}

async function receiptListing(reference: string): Promise<ReceiptListing | undefined> {
  const rows = await query<ReceiptListing>(
    `SELECT checkout.id AS checkout_id, listing.id AS listing_id, listing.destination
     FROM payment_checkouts AS checkout
     JOIN bids ON bids.checkout_id = checkout.id
     JOIN listings AS listing ON listing.id = bids.listing_id
     WHERE checkout.public_reference = $1
       AND checkout.state IN ('settled', 'partially_refunded')
     LIMIT 1`,
    [reference],
  );
  return rows[0];
}

async function createVerification(reference: string) {
  const listing = await receiptListing(reference);
  if (!listing) {
    return NextResponse.json(
      { error: "verification_unavailable", message: "Ownership proof becomes available after payment settlement." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const hostname = new URL(listing.destination).hostname.toLowerCase();
  if (hostname === "x.com" || hostname.endsWith(".x.com")) {
    return NextResponse.json(
      { available: false, message: "Social handles require manual verification during review." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const recordName = `_bidstage-challenge.${hostname}`;
  const challenge = `bidstage-verification=${randomBytes(16).toString("hex")}`;
  const verification = await transaction(async (client) => {
    await client.query(
      `INSERT INTO destination_verifications
         (listing_id, checkout_id, method, hostname, record_name, challenge_token)
       VALUES ($1, $2, 'dns_txt', $3, $4, $5)
       ON CONFLICT (listing_id) DO UPDATE SET
         checkout_id = EXCLUDED.checkout_id,
         challenge_token = EXCLUDED.challenge_token,
         state = 'pending',
         attempt_count = 0,
         last_error = NULL,
         created_at = now(),
         expires_at = now() + interval '7 days',
         verified_at = NULL
       WHERE destination_verifications.state = 'expired'`,
      [listing.listing_id, listing.checkout_id, hostname, recordName, challenge],
    );
    const result = await client.query<VerificationRow>(
      `SELECT hostname, record_name, challenge_token, state, attempt_count,
              expires_at, verified_at
       FROM destination_verifications
       WHERE listing_id = $1
       FOR UPDATE`,
      [listing.listing_id],
    );
    return result.rows[0];
  });
  if (!verification) throw new Error("Verification challenge could not be created");
  return NextResponse.json(response(verification), {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}

async function verifyDns(reference: string) {
  const rows = await query<VerificationRow>(
    `UPDATE destination_verifications AS verification
     SET attempt_count = attempt_count + 1,
         state = CASE WHEN expires_at <= now() THEN 'expired' ELSE state END,
         last_error = NULL
     FROM payment_checkouts AS checkout
     WHERE checkout.id = verification.checkout_id
       AND checkout.public_reference = $1
     RETURNING verification.hostname, verification.record_name,
               verification.challenge_token, verification.state,
               verification.attempt_count, verification.expires_at,
               verification.verified_at`,
    [reference],
  );
  const verification = rows[0];
  if (!verification) {
    return NextResponse.json(
      { error: "challenge_missing", message: "Create the DNS challenge before checking it." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (verification.state === "verified") {
    return NextResponse.json(response(verification), { headers: { "Cache-Control": "no-store" } });
  }
  if (verification.state === "expired") {
    return NextResponse.json(
      { ...response(verification), message: "This verification challenge has expired." },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const values = await resolveDnsTxtRecords(verification.record_name);
    const found = values.includes(verification.challenge_token);
    if (!found) {
      await query(
        `UPDATE destination_verifications AS verification
         SET last_error = 'record_not_found'
         FROM payment_checkouts AS checkout
         WHERE checkout.id = verification.checkout_id
           AND checkout.public_reference = $1`,
        [reference],
      );
      return NextResponse.json(
        {
          ...response(verification),
          error: "record_not_found",
          message: "The exact TXT value is not visible in public DNS yet. DNS changes can take time to propagate.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const verified = await query<VerificationRow>(
      `UPDATE destination_verifications AS verification
       SET state = 'verified', verified_at = now(), last_error = NULL
       FROM payment_checkouts AS checkout
       WHERE checkout.id = verification.checkout_id
         AND checkout.public_reference = $1
       RETURNING verification.hostname, verification.record_name,
                 verification.challenge_token, verification.state,
                 verification.attempt_count, verification.expires_at,
                 verification.verified_at`,
      [reference],
    );
    return NextResponse.json(response(verified[0]!), { headers: { "Cache-Control": "no-store" } });
  } catch {
    await query(
      `UPDATE destination_verifications AS verification
       SET last_error = 'dns_unavailable'
       FROM payment_checkouts AS checkout
       WHERE checkout.id = verification.checkout_id
         AND checkout.public_reference = $1`,
      [reference],
    ).catch(() => undefined);
    return NextResponse.json(
      { error: "dns_unavailable", message: "Public DNS could not be checked right now. Try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ reference: string }> },
) {
  const { reference } = await context.params;
  if (!/^[a-f0-9]{24}$/.test(reference)) {
    return NextResponse.json({ error: "invalid_receipt" }, { status: 400 });
  }
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  const edgeLimit = await enforceEdgeWriteRateLimit(request, "ownership_verification");
  if (edgeLimit) return edgeLimit;
  if (!(await takeRateLimit("ownership-verification", requestSubject(request), 20, 3600))) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many verification attempts. Try again later." },
      { status: 429, headers: { "Retry-After": "3600", "Cache-Control": "no-store" } },
    );
  }
  if (!(await founderCheckoutAccess(request, reference))) {
    return NextResponse.json(
      { error: "founder_access_required", message: "Founder access is required to manage ownership proof." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  let action: unknown;
  try {
    action = (await request.json() as { action?: unknown }).action;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    if (action === "create") return await createVerification(reference);
    if (action === "verify") return await verifyDns(reference);
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  } catch {
    return NextResponse.json(
      { error: "verification_unavailable", message: "Ownership verification is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
