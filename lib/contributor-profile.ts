import { normalizeCountryCode } from "./project-profile";
import { MarketInputError } from "./market-error";

export const CONTRIBUTOR_AVAILABILITY = ["available", "limited", "unavailable"] as const;
export type ContributorAvailability = (typeof CONTRIBUTOR_AVAILABILITY)[number];

export type ContributorProfileInput = {
  headline: string;
  bio: string | null;
  countryCode: ReturnType<typeof normalizeCountryCode>;
  skills: string[];
  availability: ContributorAvailability;
  isPublic: boolean;
};

function normalizedText(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (text.length < minimum || text.length > maximum) {
    throw new MarketInputError(`${label} must be ${minimum}–${maximum} characters`);
  }
  return text;
}

export function normalizeContributorSkills(value: unknown): string[] {
  if (!Array.isArray(value)) throw new MarketInputError("Add between 1 and 8 contributor skills");
  const unique = new Map<string, string>();
  for (const item of value) {
    const skill = typeof item === "string" ? item.trim().replace(/\s+/g, " ") : "";
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .+#/_-]{0,31}$/u.test(skill)) {
      throw new MarketInputError("Each contributor skill must be 1–32 readable characters");
    }
    const key = skill.toLowerCase();
    if (!unique.has(key)) unique.set(key, skill);
  }
  const skills = [...unique.values()];
  if (skills.length < 1 || skills.length > 8) {
    throw new MarketInputError("Add between 1 and 8 unique contributor skills");
  }
  return skills;
}

export function parseContributorProfile(value: unknown): ContributorProfileInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketInputError("Send a valid contributor profile");
  }
  const body = value as Record<string, unknown>;
  const bio = typeof body.bio === "string" && body.bio.trim()
    ? normalizedText(body.bio, "Bio", 3, 500)
    : null;
  if (!CONTRIBUTOR_AVAILABILITY.includes(body.availability as ContributorAvailability)) {
    throw new MarketInputError("Choose a valid availability status");
  }
  if (typeof body.isPublic !== "boolean") {
    throw new MarketInputError("Choose whether this contributor profile is public");
  }
  return {
    headline: normalizedText(body.headline, "Headline", 3, 100),
    bio,
    countryCode: normalizeCountryCode(body.countryCode),
    skills: normalizeContributorSkills(body.skills),
    availability: body.availability as ContributorAvailability,
    isPublic: body.isPublic,
  };
}
