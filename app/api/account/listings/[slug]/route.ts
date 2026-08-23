import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import { takeRateLimit, transaction } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { CATEGORIES, type Category } from "@/lib/market";
import { MarketInputError } from "@/lib/market-error";
import { parseProjectProfile, requireFundingPublisher, type FundingProvider } from "@/lib/project-profile";
import { parseContributionOpportunity, requireOpportunityRepository } from "@/lib/contribution-opportunity";

type ListingRow = {
  id: string;
  title: string;
  destination: string;
  category: Category;
  country_code: string | null;
  funding_provider: FundingProvider | null;
  funding_url: string | null;
  github_owner: string | null;
  github_name: string | null;
  contribution_url: string | null;
  contribution_note: string | null;
  status: "active" | "review" | "removed";
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  const edgeLimit = await enforceEdgeWriteRateLimit(request, "listing_edit");
  if (edgeLimit) return edgeLimit;
  const founder = await authenticatedFounder(request);
  if (!founder) {
    return NextResponse.json(
      { error: "authentication_required", message: "Sign in to edit this product." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (!(await takeRateLimit("founder-listing-edit", founder.id, 20, 3600))) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many listing edits. Try again later." },
      { status: 429, headers: { "Retry-After": "3600", "Cache-Control": "private, no-store" } },
    );
  }
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) {
    return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
    const category = typeof body.category === "string" ? body.category : "";
    const profile = parseProjectProfile(body.countryCode, body.fundingUrl);
    const opportunity = parseContributionOpportunity(body.contributionUrl, body.contributionNote);
    if (title.length < 2 || title.length > 64) {
      return NextResponse.json(
        { error: "invalid_title", message: "Product name must be 2–64 characters." },
        { status: 400 },
      );
    }
    if (!CATEGORIES.includes(category as Category)) {
      return NextResponse.json(
        { error: "invalid_category", message: "Choose a valid category." },
        { status: 400 },
      );
    }

    const result = await transaction(async (client) => {
      const found = await client.query<ListingRow>(
        `SELECT id, title, destination, category, country_code, funding_provider, funding_url,
                github_owner, github_name, contribution_url, contribution_note, status
         FROM listings
         WHERE slug = $1 AND founder_id = $2
         FOR UPDATE`,
        [slug, founder.id],
      );
      const listing = found.rows[0];
      if (!listing) return { outcome: "not_found" as const };
      if (listing.status === "removed") return { outcome: "removed" as const };
      requireFundingPublisher(profile, [founder.githubLogin, ...(listing.github_owner ? [listing.github_owner] : [])]);
      if (listing.github_owner && listing.github_name) {
        requireOpportunityRepository(opportunity, listing.github_owner, listing.github_name);
      } else if (opportunity) {
        throw new MarketInputError("This legacy listing cannot publish an opportunity until its repository is reverified");
      }
      if (
        listing.title === title
        && listing.category === category
        && listing.country_code === profile.countryCode
        && listing.funding_provider === profile.fundingProvider
        && listing.funding_url === profile.fundingUrl
        && listing.contribution_url === (opportunity?.contributionUrl ?? null)
        && listing.contribution_note === (opportunity?.contributionNote ?? null)
      ) {
        return { outcome: "unchanged" as const, status: listing.status, title, category, ...profile, contributionOpportunity: opportunity };
      }
      const version = await client.query<{ version_number: number }>(
        `SELECT coalesce(max(version_number), 0) + 1 AS version_number
         FROM listing_versions
         WHERE listing_id = $1`,
        [listing.id],
      );
      const nextVersion = Number(version.rows[0]?.version_number);
      if (!Number.isSafeInteger(nextVersion) || nextVersion < 1) {
        throw new Error("Listing version could not be allocated");
      }
      await client.query(
        `INSERT INTO listing_versions
           (listing_id, version_number, title, destination, category, country_code,
            funding_provider, funding_url, contribution_url, contribution_note,
            actor_type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'owner', 'founder_metadata_edit')`,
        [listing.id, nextVersion, title, listing.destination, category, profile.countryCode, profile.fundingProvider, profile.fundingUrl, opportunity?.contributionUrl ?? null, opportunity?.contributionNote ?? null],
      );
      await client.query(
        `UPDATE listings
         SET title = $2, category = $3, country_code = $4,
             funding_provider = $5, funding_url = $6,
             contribution_url = $7, contribution_note = $8,
             status = 'review', updated_at = now()
         WHERE id = $1`,
        [listing.id, title, category, profile.countryCode, profile.fundingProvider, profile.fundingUrl, opportunity?.contributionUrl ?? null, opportunity?.contributionNote ?? null],
      );
      return {
        outcome: "updated" as const,
        status: "review" as const,
        title,
        category: category as Category,
        ...profile,
        contributionOpportunity: opportunity,
      };
    });

    if (result.outcome === "not_found") {
      return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
    }
    if (result.outcome === "removed") {
      return NextResponse.json(
        { error: "listing_removed", message: "Removed listings must be handled through receipt support." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        updated: result.outcome === "updated",
        listing: { slug, title: result.title, category: result.category, status: result.status, countryCode: result.countryCode, fundingUrl: result.fundingUrl, fundingProvider: result.fundingProvider, contributionUrl: result.contributionOpportunity?.contributionUrl ?? null, contributionNote: result.contributionOpportunity?.contributionNote ?? null },
        message: result.outcome === "updated"
          ? "Changes saved. The listing returned to review before it can reappear publicly."
          : "No listing changes were needed.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const syntax = error instanceof SyntaxError;
    const input = error instanceof MarketInputError;
    return NextResponse.json(
      {
        error: syntax ? "invalid_request" : input ? "invalid_listing" : "listing_update_unavailable",
        message: syntax ? "Send a valid listing update." : input ? error.message : "The listing could not be updated right now.",
      },
      { status: syntax || input ? 400 : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
