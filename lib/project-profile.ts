import { type CountryCode, isCountryCode } from "./countries";
import { MarketInputError } from "./market-error";

export type FundingProvider = "github_sponsors" | "open_collective";

export type ProjectProfile = {
  countryCode: CountryCode | null;
  fundingUrl: string | null;
  fundingProvider: FundingProvider | null;
};

export function normalizeCountryCode(value: unknown): CountryCode | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !isCountryCode(value.trim())) {
    throw new MarketInputError("Choose a valid project country or global scope");
  }
  return value.trim().toUpperCase() as CountryCode;
}

export function normalizeFunding(value: unknown): Pick<ProjectProfile, "fundingUrl" | "fundingProvider"> {
  if (value === null || value === undefined || value === "") {
    return { fundingUrl: null, fundingProvider: null };
  }
  if (typeof value !== "string") throw new MarketInputError("Enter a valid project funding URL");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new MarketInputError("Enter a valid GitHub Sponsors or Open Collective URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new MarketInputError("Funding links must be canonical HTTPS URLs without query parameters");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  let fundingProvider: FundingProvider;
  if (
    url.hostname === "github.com"
    && parts.length === 2
    && parts[0] === "sponsors"
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(parts[1]!)
  ) {
    fundingProvider = "github_sponsors";
  } else if (
    url.hostname === "opencollective.com"
    && parts.length === 1
    && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(parts[0]!)
  ) {
    fundingProvider = "open_collective";
  } else {
    throw new MarketInputError("Use a canonical GitHub Sponsors or Open Collective project URL");
  }
  url.hostname = url.hostname.toLowerCase();
  url.pathname = `/${parts.join("/")}`;
  return { fundingUrl: url.href, fundingProvider };
}

export function parseProjectProfile(countryCode: unknown, fundingUrl: unknown): ProjectProfile {
  return { countryCode: normalizeCountryCode(countryCode), ...normalizeFunding(fundingUrl) };
}

export function requireFundingPublisher(profile: ProjectProfile, githubLogins: string | readonly string[]): void {
  if (profile.fundingProvider !== "github_sponsors" || !profile.fundingUrl) return;
  const handle = new URL(profile.fundingUrl).pathname.split("/").filter(Boolean)[1];
  const allowed = (Array.isArray(githubLogins) ? githubLogins : [githubLogins])
    .map((login) => login.toLowerCase());
  if (!handle || !allowed.includes(handle.toLowerCase())) {
    throw new MarketInputError("The GitHub Sponsors link must belong to the signed-in maintainer or repository owner");
  }
}
