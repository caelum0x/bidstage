import { MarketInputError } from "./market-error";

export const APPLICATION_STATES = ["pending", "accepted", "declined", "withdrawn"] as const;
export type ContributionApplicationState = (typeof APPLICATION_STATES)[number];
export type ContributionApplicationAction = "accept" | "decline" | "withdraw";

export function parseContributionApplicationMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (message.length < 20 || message.length > 800) {
    throw new MarketInputError("Application message must be 20–800 characters");
  }
  if (/[<>]/.test(message)) {
    throw new MarketInputError("Application message cannot contain angle brackets");
  }
  return message;
}

export function parseContributionFollowupMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (message.length < 3 || message.length > 1200) {
    throw new MarketInputError("Message must be 3–1200 characters");
  }
  if (/[<>]/.test(message)) {
    throw new MarketInputError("Message must be plain text");
  }
  return message;
}

export function parseContributionApplicationAction(value: unknown): ContributionApplicationAction {
  if (value !== "accept" && value !== "decline" && value !== "withdraw") {
    throw new MarketInputError("Choose a valid application action");
  }
  return value;
}
