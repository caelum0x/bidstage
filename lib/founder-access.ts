import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { query } from "./db";
import { serverEnv } from "./env";
import { authenticatedFounder } from "./auth";

const COOKIE_PREFIX = "bidstage_founder_";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180;

export function founderCookieName(reference: string): string {
  return `${COOKIE_PREFIX}${reference}`;
}

export function createFounderAccessToken(idempotencyKey: string, reference: string): string {
  return createHmac("sha256", serverEnv().founderAccessSecret)
    .update("bidstage-founder\0")
    .update(idempotencyKey)
    .update("\0")
    .update(reference)
    .digest("base64url");
}

export function founderAccessHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function founderAccessMatches(storedHash: string | null, token: string | undefined): boolean {
  if (!storedHash || !token || !TOKEN_PATTERN.test(token)) return false;
  const actual = Buffer.from(founderAccessHash(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function setFounderAccessCookie(
  response: NextResponse,
  reference: string,
  token: string,
): void {
  response.cookies.set({
    name: founderCookieName(reference),
    value: token,
    httpOnly: true,
    secure: new URL(serverEnv().appUrl).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SIX_MONTHS_SECONDS,
  });
}

export async function founderCheckoutAccess(
  request: NextRequest,
  reference: string,
): Promise<{ checkoutId: string; listingStatus: "active" | "review" | "removed" | null } | undefined> {
  const token = request.cookies.get(founderCookieName(reference))?.value;
  const rows = await query<{
    id: string;
    founder_id: string | null;
    founder_access_hash: string | null;
    listing_status: "active" | "review" | "removed" | null;
  }>(
    `SELECT checkout.id, checkout.founder_id, checkout.founder_access_hash,
            listing.status AS listing_status
     FROM payment_checkouts AS checkout
     LEFT JOIN bids AS bid ON bid.checkout_id = checkout.id
     LEFT JOIN listings AS listing ON listing.id = bid.listing_id
     WHERE checkout.public_reference = $1
     LIMIT 1`,
    [reference],
  );
  const checkout = rows[0];
  if (!checkout) return undefined;
  if (token && TOKEN_PATTERN.test(token) && founderAccessMatches(checkout.founder_access_hash, token)) {
    return { checkoutId: checkout.id, listingStatus: checkout.listing_status };
  }
  const founder = await authenticatedFounder(request);
  return founder && checkout.founder_id === founder.id
    ? { checkoutId: checkout.id, listingStatus: checkout.listing_status }
    : undefined;
}
