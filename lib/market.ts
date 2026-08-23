import { createHash } from "node:crypto";
import type { CountryCode } from "./countries";
import { MarketInputError } from "./market-error";
import { parseProjectProfile, type FundingProvider } from "./project-profile";
import { parseContributionOpportunity, type ContributionOpportunity } from "./contribution-opportunity";

export { MarketInputError } from "./market-error";

export const CATEGORIES = ["ai", "developer", "design", "commerce", "consumer", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const PRODUCT_KINDS = ["commercial", "open_source"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const MIN_BID_CENTS = 500;
export const MAX_BID_CENTS = 5_000_000;

export type CheckoutInput = {
  title: string;
  destination: string;
  category: Category;
  amountCents: number;
  acceptedRules: true;
  productKind: "open_source";
  repositoryUrl: string;
  countryCode: CountryCode | null;
  fundingUrl: string | null;
  fundingProvider: FundingProvider | null;
  contributionOpportunity: ContributionOpportunity | null;
};

export type RankQuoteInput = {
  destination: string;
  category: Category;
  amountCents: number;
  productKind: "open_source";
};

function publicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  return host.includes(".");
}

export function normalizeDestination(raw: string): string {
  const input = raw.trim();
  if (/^@[A-Za-z0-9_]{1,15}$/.test(input)) return `https://x.com/${input.slice(1).toLowerCase()}`;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new MarketInputError("Enter a valid public URL or X handle");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !publicHostname(url.hostname)) {
    throw new MarketInputError("Only public HTTP(S) destinations without credentials are allowed");
  }
  url.protocol = "https:";
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.href;
}

export function listingSlug(destination: string): string {
  const url = new URL(destination);
  const base = url.hostname.replace(/^www\./, "").split(".")[0]!.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "listing";
  const suffix = createHash("sha256").update(destination).digest("hex").slice(0, 8);
  return `${base}-${suffix}`;
}

export function parseCheckoutInput(value: unknown): CheckoutInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MarketInputError("Invalid checkout request");
  const body = value as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
  if (title.length < 2 || title.length > 64) throw new MarketInputError("Product name must be 2–64 characters");
  const destination = normalizeDestination(typeof body.destination === "string" ? body.destination : "");
  if (!CATEGORIES.includes(body.category as Category)) throw new MarketInputError("Choose a valid category");
  const amountCents = body.amountCents;
  if (!Number.isSafeInteger(amountCents) || Number(amountCents) < MIN_BID_CENTS || Number(amountCents) > MAX_BID_CENTS) {
    throw new MarketInputError(`Bid must be between $${MIN_BID_CENTS / 100} and $${MAX_BID_CENTS / 100}`);
  }
  if (body.acceptedRules !== true) throw new MarketInputError("Accept the marketplace rules before checkout");
  if (body.productKind !== "open_source") {
    throw new MarketInputError("Bidstage accepts verified open-source projects only");
  }
  const productKind = "open_source" as const;
  const repositoryUrl = typeof body.repositoryUrl === "string" && body.repositoryUrl.trim()
    ? body.repositoryUrl.trim()
    : "";
  if (!repositoryUrl) {
    throw new MarketInputError("Add the public GitHub repository for this open-source product");
  }
  const profile = parseProjectProfile(body.countryCode, body.fundingUrl);
  const contributionOpportunity = parseContributionOpportunity(body.contributionUrl, body.contributionNote);
  return { title, destination, category: body.category as Category, amountCents: Number(amountCents), acceptedRules: true, productKind, repositoryUrl, ...profile, contributionOpportunity };
}

export function parseRankQuoteInput(value: unknown): RankQuoteInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketInputError("Invalid rank quote request");
  }
  const body = value as Record<string, unknown>;
  const destination = normalizeDestination(
    typeof body.destination === "string" ? body.destination : "",
  );
  if (!CATEGORIES.includes(body.category as Category)) {
    throw new MarketInputError("Choose a valid category");
  }
  if (body.productKind !== "open_source") {
    throw new MarketInputError("Bidstage accepts verified open-source projects only");
  }
  if (
    !Number.isSafeInteger(body.amountCents) ||
    Number(body.amountCents) < MIN_BID_CENTS ||
    Number(body.amountCents) > MAX_BID_CENTS
  ) {
    throw new MarketInputError(
      `Contribution must be between $${MIN_BID_CENTS / 100} and $${MAX_BID_CENTS / 100}`,
    );
  }
  return {
    destination,
    category: body.category as Category,
    amountCents: Number(body.amountCents),
    productKind: "open_source",
  };
}

function validIpAddress(value: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  if (!value.includes(":") || !/^[0-9a-f:]+$/i.test(value)) return false;
  try {
    // WHATWG URL parsing provides standards-compliant IPv6 validation without
    // importing a Node-only module into this shared server/client module.
    void new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

export function requestIp(request: Request): string | undefined {
  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    request.headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && validIpAddress(value)) return value;
  }
  return undefined;
}

export function requestSubject(request: Request): string {
  const ip = requestIp(request);
  if (ip) return `ip:${ip}`;

  // Local previews and non-Cloudflare deployments may not expose a client IP.
  // Partition those callers by coarse, already-public browser hints so one
  // missing proxy header cannot put every visitor into a shared global bucket.
  // takeRateLimit applies the deployment's privacy salt before persistence.
  const hints = [
    request.headers.get("user-agent") ?? "",
    request.headers.get("accept-language") ?? "",
    request.headers.get("sec-ch-ua") ?? "",
    request.headers.get("sec-ch-ua-platform") ?? "",
  ].join("\0");
  return `client:${createHash("sha256").update(hints || "no-client-hints").digest("hex")}`;
}
