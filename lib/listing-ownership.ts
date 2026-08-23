import type { CheckoutInput } from "./market";

export type FounderEditableListingStatus = "review" | "active" | "removed";

export type ExistingPlacementIdentity = {
  title: string;
  destination: string;
  category: CheckoutInput["category"];
  product_kind: "commercial" | "open_source";
  github_repository_id: string | null;
  country_code: CheckoutInput["countryCode"];
  funding_provider: CheckoutInput["fundingProvider"];
  funding_url: string | null;
  contribution_url: string | null;
  contribution_note: string | null;
};

export function founderCanEditListing(
  founderId: string,
  listingFounderId: string | null,
  status: FounderEditableListingStatus | null,
): boolean {
  return Boolean(status && status !== "removed" && listingFounderId === founderId);
}

export function existingPlacementMatches(
  listing: ExistingPlacementIdentity,
  input: CheckoutInput,
  repositoryId: string,
): boolean {
  return listing.title === input.title
    && listing.destination === input.destination
    && listing.category === input.category
    && listing.product_kind === "open_source"
    && listing.github_repository_id === repositoryId
    && listing.country_code === input.countryCode
    && listing.funding_provider === input.fundingProvider
    && listing.funding_url === input.fundingUrl
    && listing.contribution_url === (input.contributionOpportunity?.contributionUrl ?? null)
    && listing.contribution_note === (input.contributionOpportunity?.contributionNote ?? null);
}
