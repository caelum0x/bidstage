import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import { query } from "@/lib/db";
import { founderCanEditListing } from "@/lib/listing-ownership";

type ProductRecord = {
  reference: string;
  title: string;
  destination: string;
  category: string;
  product_kind: "commercial" | "open_source";
  github_url: string | null;
  country_code: string | null;
  funding_provider: "github_sponsors" | "open_collective" | null;
  funding_url: string | null;
  github_verification_method: "personal_owner" | "repository_file" | null;
  contribution_url: string | null;
  contribution_note: string | null;
  contribution_cents: number;
  checkout_state: string;
  created_at: Date;
  settled_at: Date | null;
  listing_slug: string | null;
  listing_status: "review" | "active" | "removed" | null;
  listing_founder_id: string | null;
  listing_total_cents: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const founder = await authenticatedFounder(request);
    if (!founder) {
      return NextResponse.json(
        { error: "authentication_required", message: "Sign in with GitHub to view your products." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const products = await query<ProductRecord>(
      `SELECT checkout.public_reference AS reference,
              coalesce(listing.title, checkout.title) AS title, checkout.destination,
              coalesce(listing.category, checkout.category) AS category,
              checkout.product_kind, checkout.github_url,
              coalesce(listing.country_code, checkout.country_code) AS country_code,
              coalesce(listing.funding_provider, checkout.funding_provider) AS funding_provider,
              coalesce(listing.funding_url, checkout.funding_url) AS funding_url,
              coalesce(listing.github_verification_method, checkout.github_verification_method) AS github_verification_method,
              coalesce(listing.contribution_url, checkout.contribution_url) AS contribution_url,
              coalesce(listing.contribution_note, checkout.contribution_note) AS contribution_note,
              checkout.contribution_cents, checkout.state AS checkout_state,
              checkout.created_at, checkout.settled_at,
              listing.slug AS listing_slug, listing.status AS listing_status,
              listing.founder_id AS listing_founder_id,
              listing.total_cents::text AS listing_total_cents
       FROM payment_checkouts AS checkout
       LEFT JOIN bids ON bids.checkout_id = checkout.id
       LEFT JOIN listings AS listing ON listing.id = bids.listing_id
       WHERE checkout.founder_id = $1
       ORDER BY checkout.created_at DESC, checkout.id DESC
       LIMIT 100`,
      [founder.id],
    );
    return NextResponse.json(
      {
        founder,
        records: products.map((product) => ({
          reference: product.reference,
          title: product.title,
          destination: product.destination,
          category: product.category,
          productKind: product.product_kind,
          repositoryUrl: product.github_url,
          countryCode: product.country_code,
          fundingProvider: product.funding_provider,
          fundingUrl: product.funding_url,
          repositoryVerificationMethod: product.github_verification_method,
          contributionUrl: product.contribution_url,
          contributionNote: product.contribution_note,
          contributionCents: product.contribution_cents,
          checkoutState: product.checkout_state,
          createdAt: product.created_at.toISOString(),
          settledAt: product.settled_at?.toISOString() ?? null,
          listingSlug: product.listing_slug,
          listingStatus: product.listing_status,
          canEdit: founderCanEditListing(
            founder.id,
            product.listing_founder_id,
            product.listing_status,
          ),
          listingTotalCents: product.listing_total_cents === null
            ? null
            : Number(product.listing_total_cents),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "account_unavailable", message: "Your product records are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
