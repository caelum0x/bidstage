import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedFounder } from "@/lib/auth";
import { query, takeRateLimit } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { serverEnv } from "@/lib/env";
import {
  createFounderAccessToken,
  founderAccessHash,
  setFounderAccessCookie,
} from "@/lib/founder-access";
import { MarketInputError, parseCheckoutInput, requestIp, requestSubject } from "@/lib/market";
import { verifyAuthorizedPublicRepository } from "@/lib/github";
import { calculateRankQuote } from "@/lib/rank-quote";
import { HumanVerificationError, verifyCheckoutHuman } from "@/lib/turnstile";
import { requireFundingPublisher } from "@/lib/project-profile";
import { requireOpportunityRepository } from "@/lib/contribution-opportunity";
import { createPlacementCheckout } from "@/lib/payments";
import type { PaymentProvider } from "@/lib/payment-settlement";
import { reviewDestinationResolution } from "@/lib/destination-safety";
import { existingPlacementMatches, type ExistingPlacementIdentity } from "@/lib/listing-ownership";

type CheckoutRow = {
  id: string;
  provider: string;
  public_reference: string;
  request_fingerprint: string;
  provider_checkout_id: string | null;
  checkout_url: string | null;
  founder_access_hash: string | null;
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    const env = serverEnv();
    // Explicit, fail-fast off-switch. Checkout stays gated off (CHECKOUT_ENABLED
    // defaults to false) independently of the Turnstile path, so no provider
    // checkout can ever be created while the product is dark. This is the single
    // authoritative gate; downstream steps assume checkout is open.
    if (!env.checkoutEnabled) {
      return NextResponse.json(
        { error: "checkout_disabled", message: "Checkout is not open yet." },
        { status: 503, headers: { "Retry-After": "3600" } },
      );
    }
    const origin = request.headers.get("origin");
    if (origin !== env.appUrl) {
      return NextResponse.json(
        { error: "forbidden_origin", message: "Checkout must be started from Bidstage." },
        { status: 403 },
      );
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
    }
    const edgeLimit = await enforceEdgeWriteRateLimit(request, "checkout");
    if (edgeLimit) return edgeLimit;
    if (!(await takeRateLimit("checkout", requestSubject(request), 10, 3600))) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many checkout attempts. Try again later." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || !/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) {
      return NextResponse.json({ error: "invalid_idempotency_key" }, { status: 400 });
    }
    const body = await request.json();
    const token = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).turnstileToken
      : undefined;
    await verifyCheckoutHuman(token, requestIp(request));
    const input = parseCheckoutInput(body);
    const founder = await authenticatedFounder(request);
    if (!founder) {
      throw new MarketInputError("Sign in with GitHub before submitting an open-source project");
    }
    const repository = await verifyAuthorizedPublicRepository(input.repositoryUrl, founder.githubUserId);
    requireFundingPublisher(input, [founder.githubLogin, repository.owner]);
    requireOpportunityRepository(input.contributionOpportunity, repository.owner, repository.name);
    const conflicts = await query<ExistingPlacementIdentity>(
      `SELECT title, destination, category, product_kind, github_repository_id::text,
              country_code, funding_provider, funding_url, contribution_url, contribution_note
       FROM listings
       WHERE destination = $1 OR github_repository_id = $2
       LIMIT 1`,
      [input.destination, repository.id],
    );
    const conflict = conflicts[0];
    if (conflict && !existingPlacementMatches(conflict, input, String(repository.id))) {
      throw new MarketInputError(
        conflict.destination === input.destination && conflict.github_repository_id === String(repository.id)
          ? "Use the active project record for another placement. Edit project details from your account first."
          : "This destination or repository is already attached to another listing",
      );
    }
    const destinationReview = await reviewDestinationResolution(input.destination);
    const destinationDnsFingerprint = digest(destinationReview.addresses.join("\0"));
    const quote = await calculateRankQuote(input);
    const requestFingerprint = digest(JSON.stringify(input));
    const idempotencyHash = digest(`checkout:${idempotencyKey}`);
    const publicReference = digest(`receipt:${idempotencyKey}`).slice(0, 24);
    const founderToken = createFounderAccessToken(idempotencyKey, publicReference);
    const expectedFounderHash = founderAccessHash(founderToken);
    const checkoutRows = await query<CheckoutRow>(
      `INSERT INTO payment_checkouts (
         public_reference, provider, idempotency_hash, request_fingerprint, founder_access_hash,
         founder_id, product_kind, github_repository_id, github_owner, github_name,
         github_url, github_description, github_stars, github_license_spdx, github_primary_language,
         title, destination, category, contribution_cents,
         quoted_category_rank, quoted_overall_rank, quoted_total_cents, quote_as_of,
         country_code, funding_provider, funding_url, github_verification_method,
         contribution_url, contribution_note,
         destination_dns_checked_at, destination_dns_address_count, destination_dns_fingerprint
       ) VALUES (
         $1, $31, $2, $3, $4,
         $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22,
         $23, $24, $25, $26, $27, $28, now(), $29, $30
       )
       ON CONFLICT (idempotency_hash) DO UPDATE SET
         founder_access_hash = coalesce(payment_checkouts.founder_access_hash, EXCLUDED.founder_access_hash),
         destination_dns_checked_at = EXCLUDED.destination_dns_checked_at,
         destination_dns_address_count = EXCLUDED.destination_dns_address_count,
         destination_dns_fingerprint = EXCLUDED.destination_dns_fingerprint,
         updated_at = now()
       RETURNING id, provider, public_reference, request_fingerprint,
                 provider_checkout_id, checkout_url, founder_access_hash`,
      [
        publicReference,
        idempotencyHash,
        requestFingerprint,
        expectedFounderHash,
        founder?.id ?? null,
        input.productKind,
        repository.id,
        repository.owner,
        repository.name,
        repository.url,
        repository.description,
        repository.stars,
        repository.licenseSpdx,
        repository.primaryLanguage,
        input.title,
        input.destination,
        input.category,
        input.amountCents,
        quote.projectedCategoryRank,
        quote.projectedOverallRank,
        quote.projectedTotalCents,
        quote.asOf,
        input.countryCode,
        input.fundingProvider,
        input.fundingUrl,
        repository.verificationMethod,
        input.contributionOpportunity?.contributionUrl ?? null,
        input.contributionOpportunity?.contributionNote ?? null,
        destinationReview.addresses.length,
        destinationDnsFingerprint,
        env.paymentProvider,
      ],
    );
    const checkout = checkoutRows[0];
    if (!checkout) throw new Error("Checkout intent could not be created");
    if (checkout.provider !== "creem" && checkout.provider !== "dodo") {
      return NextResponse.json(
        { error: "legacy_checkout", message: "This legacy checkout cannot be resumed. Start a new quote." },
        { status: 409 },
      );
    }
    if (checkout.request_fingerprint !== requestFingerprint) {
      return NextResponse.json(
        {
          error: "idempotency_conflict",
          message: "This checkout retry key was already used for different details.",
        },
        { status: 409 },
      );
    }
    if (checkout.founder_access_hash !== expectedFounderHash) {
      return NextResponse.json(
        {
          error: "founder_access_conflict",
          message: "This checkout cannot restore founder access. Start a new quote.",
        },
        { status: 409 },
      );
    }
    if (checkout.provider_checkout_id && checkout.checkout_url) {
      const response = NextResponse.json(
        {
          checkoutUrl: checkout.checkout_url,
          receiptUrl: `${env.appUrl}/receipt/${checkout.public_reference}`,
        },
        { status: 200 },
      );
      setFounderAccessCookie(response, checkout.public_reference, founderToken);
      return response;
    }

    try {
      const session = await createPlacementCheckout(checkout.provider as PaymentProvider, {
        requestId: checkout.id,
        amountCents: input.amountCents,
        successUrl: `${env.appUrl}/receipt/${checkout.public_reference}`,
        metadata: {
          product: "bidstage",
          checkout_id: checkout.id,
          receipt_ref: checkout.public_reference,
          quoted_category_rank: quote.projectedCategoryRank,
          quoted_overall_rank: quote.projectedOverallRank,
          quoted_total_cents: quote.projectedTotalCents,
          product_kind: input.productKind,
          github_repository_id: repository.id,
        },
      });
      await query(
        `UPDATE payment_checkouts
         SET provider_checkout_id = $2, checkout_url = $3, state = 'pending',
             failure_code = NULL, updated_at = now()
         WHERE id = $1`,
        [checkout.id, session.id, session.checkoutUrl],
      );
      const response = NextResponse.json(
        {
          checkoutUrl: session.checkoutUrl,
          receiptUrl: `${env.appUrl}/receipt/${checkout.public_reference}`,
        },
        { status: 201 },
      );
      setFounderAccessCookie(response, checkout.public_reference, founderToken);
      return response;
    } catch (error) {
      await query(
        `UPDATE payment_checkouts
         SET state = 'failed', failure_code = 'provider_checkout_failed', updated_at = now()
         WHERE id = $1 AND state <> 'settled'`,
        [checkout.id],
      ).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const humanError = error instanceof HumanVerificationError;
    const clientError = error instanceof MarketInputError || error instanceof SyntaxError || humanError;
    const message = error instanceof MarketInputError || humanError
      ? error.message
      : "Checkout is temporarily unavailable.";
    return NextResponse.json(
      { error: humanError ? "human_verification_failed" : clientError ? "invalid_checkout" : "checkout_unavailable", message },
      { status: humanError ? 403 : clientError ? 400 : 503 },
    );
  }
}
