import { createHash, timingSafeEqual } from "node:crypto";

import { query } from "./db";

export const SUPPORT_CATEGORIES = [
  "payment",
  "refund",
  "placement",
  "appeal",
  "destination",
  "technical",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === "string" && SUPPORT_CATEGORIES.includes(value as SupportCategory);
}

export function normalizeSupportMessage(value: unknown, minimum = 20): string {
  const message = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (message.length < minimum || message.length > 1200) {
    throw new Error(`Support message must be ${minimum}–1200 characters`);
  }
  return message;
}

export type AuthorizedSupportCase = {
  id: string;
  public_reference: string;
  category: SupportCategory;
  state: "open" | "needs_customer" | "resolved" | "closed";
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  receipt_reference: string;
};

export async function authorizedSupportCase(
  reference: string,
  token: string,
): Promise<AuthorizedSupportCase | undefined> {
  if (!/^[a-f0-9]{16}$/.test(reference) || !/^[A-Za-z0-9_-]{20,80}$/.test(token)) {
    return undefined;
  }
  const rows = await query<AuthorizedSupportCase & { access_token_hash: string }>(
    `SELECT support.id, support.public_reference, support.category, support.state,
            support.created_at, support.updated_at, support.resolved_at,
            checkout.public_reference AS receipt_reference, support.access_token_hash
     FROM support_cases AS support
     JOIN payment_checkouts AS checkout ON checkout.id = support.checkout_id
     WHERE support.public_reference = $1
     LIMIT 1`,
    [reference],
  );
  const supportCase = rows[0];
  const suppliedHash = createHash("sha256").update(token).digest();
  const expectedHash = supportCase
    ? Buffer.from(supportCase.access_token_hash, "hex")
    : createHash("sha256").update("missing-support-case").digest();
  if (
    !supportCase ||
    expectedHash.length !== suppliedHash.length ||
    !timingSafeEqual(expectedHash, suppliedHash)
  ) {
    return undefined;
  }
  return supportCase;
}

export function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{20,80})$/)?.[1];
}
