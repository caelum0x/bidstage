import { MarketInputError } from "./market-error";

export type ContributionOpportunity = {
  contributionUrl: string;
  contributionNote: string;
};

export function parseContributionOpportunity(urlValue: unknown, noteValue: unknown): ContributionOpportunity | null {
  const rawUrl = typeof urlValue === "string" ? urlValue.trim() : "";
  const note = typeof noteValue === "string" ? noteValue.trim().replace(/\s+/g, " ") : "";
  if (!rawUrl && !note) return null;
  if (!rawUrl || !note) {
    throw new MarketInputError("Contribution opportunities need both a GitHub URL and a short request");
  }
  if (note.length < 10 || note.length > 180) {
    throw new MarketInputError("Contribution request must be 10–180 characters");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MarketInputError("Enter a valid GitHub contribution URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.hash) {
    throw new MarketInputError("Contribution opportunities must use a public HTTPS GitHub URL");
  }
  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.some((key) => key !== "q") || queryKeys.filter((key) => key === "q").length > 1) {
    throw new MarketInputError("Contribution URLs may use only GitHub's issue-search query");
  }
  url.hostname = "github.com";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return { contributionUrl: url.href, contributionNote: note };
}

export function requireOpportunityRepository(
  opportunity: ContributionOpportunity | null,
  owner: string,
  name: string,
): void {
  if (!opportunity) return;
  const url = new URL(opportunity.contributionUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length < 3
    || parts[0]!.toLowerCase() !== owner.toLowerCase()
    || parts[1]!.replace(/\.git$/i, "").toLowerCase() !== name.toLowerCase()
  ) {
    throw new MarketInputError("The contribution opportunity must point to concrete work inside the verified repository");
  }
}
