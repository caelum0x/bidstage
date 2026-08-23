import { type NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { founderAccessMatches, founderCookieName } from "@/lib/founder-access";
import { authenticatedFounder } from "@/lib/auth";

type ReceiptRow = {
  public_reference: string;
  provider: "stripe" | "creem" | "dodo";
  state: string;
  title: string;
  destination: string;
  category: string;
  product_kind: "commercial" | "open_source";
  github_owner: string | null;
  github_name: string | null;
  github_url: string | null;
  github_stars: number | null;
  github_license_spdx: string | null;
  github_primary_language: string | null;
  country_code: string | null;
  funding_provider: "github_sponsors" | "open_collective" | null;
  funding_url: string | null;
  github_verification_method: "personal_owner" | "repository_file" | null;
  contribution_url: string | null;
  contribution_note: string | null;
  contribution_cents: number;
  quoted_category_rank: number;
  quoted_overall_rank: number;
  quoted_total_cents: string;
  quote_as_of: Date;
  created_at: Date;
  settled_at: Date | null;
  listing_slug: string | null;
  listing_status: "active" | "review" | "removed" | null;
  current_category_rank: string | null;
  current_overall_rank: string | null;
  ledger_entry_id: string | null;
  refunded_cents: number | null;
  adjustment_state: string | null;
  reversed_cents: string;
  reversal_entry_count: string;
  last_adjusted_at: Date | null;
  moderation_action: string | null;
  moderation_note: string | null;
  moderated_at: Date | null;
  founder_access_hash: string | null;
  founder_id: string | null;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reference: string }> },
) {
  const { reference } = await context.params;
  if (!/^[a-f0-9]{24}$/.test(reference)) {
    return NextResponse.json(
      { error: "invalid_receipt", message: "This receipt reference is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const rows = await query<ReceiptRow>(
      `WITH category_ranks AS (
         SELECT id,
                row_number() OVER (
                  PARTITION BY product_kind, category
                  ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
                )::text AS rank
         FROM listings
         WHERE status = 'active'
       ),
       overall_ranks AS (
         SELECT id,
                row_number() OVER (
                  PARTITION BY product_kind
                  ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
                )::text AS rank
         FROM listings
         WHERE status = 'active'
       )
       SELECT
         checkout.public_reference,
         checkout.provider,
         checkout.state,
         checkout.title,
         checkout.destination,
         checkout.category,
         checkout.product_kind,
         checkout.github_owner,
         checkout.github_name,
         checkout.github_url,
         checkout.github_stars,
         checkout.github_license_spdx,
         checkout.github_primary_language,
         checkout.country_code,
         checkout.funding_provider,
         checkout.funding_url,
         checkout.github_verification_method,
         checkout.contribution_url,
         checkout.contribution_note,
         checkout.contribution_cents,
         checkout.quoted_category_rank,
         checkout.quoted_overall_rank,
         checkout.quoted_total_cents::text,
         checkout.quote_as_of,
         checkout.created_at,
         checkout.settled_at,
         listing.slug AS listing_slug,
         listing.status AS listing_status,
         category_ranks.rank AS current_category_rank,
         overall_ranks.rank AS current_overall_rank,
         ledger.id::text AS ledger_entry_id,
         bids.refunded_cents,
         bids.adjustment_state,
         adjustments.reversed_cents,
         adjustments.reversal_entry_count,
         adjustments.last_adjusted_at,
         moderation.action AS moderation_action,
         moderation.public_note AS moderation_note,
         moderation.created_at AS moderated_at,
         checkout.founder_access_hash
         ,checkout.founder_id
       FROM payment_checkouts AS checkout
       LEFT JOIN bids ON bids.checkout_id = checkout.id
       LEFT JOIN listings AS listing ON listing.id = bids.listing_id
       LEFT JOIN category_ranks ON category_ranks.id = listing.id
       LEFT JOIN overall_ranks ON overall_ranks.id = listing.id
       LEFT JOIN rank_ledger AS ledger
         ON ledger.checkout_id = checkout.id AND ledger.entry_type = 'contribution'
       LEFT JOIN LATERAL (
         SELECT
           coalesce(-sum(amount_cents), 0)::text AS reversed_cents,
           count(*)::text AS reversal_entry_count,
           max(created_at) AS last_adjusted_at
         FROM rank_ledger
         WHERE checkout_id = checkout.id
           AND entry_type IN ('refund_reversal', 'dispute_reversal')
       ) AS adjustments ON true
       LEFT JOIN LATERAL (
         SELECT action, public_note, created_at
         FROM listing_moderation
         WHERE listing_id = listing.id
         ORDER BY created_at DESC
         LIMIT 1
       ) AS moderation ON true
       WHERE checkout.public_reference = $1
       LIMIT 1`,
      [reference],
    );
    const receipt = rows[0];
    if (!receipt) {
      return NextResponse.json(
        { error: "receipt_not_found", message: "This receipt was not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const capabilityMatches = founderAccessMatches(
      receipt.founder_access_hash,
      request.cookies.get(founderCookieName(reference))?.value,
    );
    const founder = capabilityMatches ? undefined : await authenticatedFounder(request);
    const canManage = capabilityMatches || Boolean(founder && founder.id === receipt.founder_id);

    return NextResponse.json(
      {
        reference: receipt.public_reference,
        paymentProvider: receipt.provider,
        canManage,
        state: receipt.state,
        product: {
          title: receipt.title,
          destination: receipt.destination,
          category: receipt.category,
          kind: receipt.product_kind,
          countryCode: receipt.country_code,
          fundingProvider: receipt.funding_provider,
          fundingUrl: receipt.funding_url,
          contributionUrl: receipt.contribution_url,
          contributionNote: receipt.contribution_note,
          repository: receipt.product_kind === "open_source"
            ? {
                owner: receipt.github_owner,
                name: receipt.github_name,
                url: receipt.github_url,
                stars: receipt.github_stars,
                licenseSpdx: receipt.github_license_spdx,
                primaryLanguage: receipt.github_primary_language,
                verificationMethod: receipt.github_verification_method,
              }
            : null,
          listingSlug: receipt.listing_slug,
          listingStatus: receipt.listing_status,
        },
        contributionCents: receipt.contribution_cents,
        quote: {
          categoryRank: receipt.quoted_category_rank,
          overallRank: receipt.quoted_overall_rank,
          projectedTotalCents: Number(receipt.quoted_total_cents),
          asOf: receipt.quote_as_of.toISOString(),
        },
        settlement: receipt.settled_at
          ? {
              settledAt: receipt.settled_at.toISOString(),
              categoryRank: receipt.current_category_rank
                ? Number(receipt.current_category_rank)
                : null,
              overallRank: receipt.current_overall_rank
                ? Number(receipt.current_overall_rank)
                : null,
              ledgerEntryId: receipt.ledger_entry_id,
            }
          : null,
        adjustment: receipt.refunded_cents
          ? {
              state: receipt.adjustment_state,
              reversedCents: Number(receipt.reversed_cents),
              netContributionCents: Math.max(
                0,
                receipt.contribution_cents - Number(receipt.reversed_cents),
              ),
              ledgerEntryCount: Number(receipt.reversal_entry_count),
              adjustedAt: receipt.last_adjusted_at?.toISOString() ?? null,
            }
          : null,
        moderation: receipt.moderation_action
          ? {
              action: receipt.moderation_action,
              publicNote: receipt.moderation_note,
              moderatedAt: receipt.moderated_at?.toISOString() ?? null,
            }
          : null,
        createdAt: receipt.created_at.toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      { error: "receipt_unavailable", message: "Receipt status is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
