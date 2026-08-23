import { MarketInputError } from "./market-error";

export const PRIVACY_REQUEST_TYPES = [
  "access",
  "correction",
  "deletion",
  "restriction",
] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];
export type PrivacyRequestState = "open" | "in_progress" | "completed" | "declined" | "cancelled";

export type PrivacyRequestInput = {
  requestType: PrivacyRequestType;
  details: string;
};

export function isPrivacyRequestType(value: unknown): value is PrivacyRequestType {
  return typeof value === "string" && PRIVACY_REQUEST_TYPES.includes(value as PrivacyRequestType);
}

export function normalizePrivacyRequestDetails(value: unknown): string {
  const details = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (details.length < 20 || details.length > 1200) {
    throw new MarketInputError("Privacy request details must be 20–1200 characters");
  }
  return details;
}

export function parsePrivacyRequest(value: unknown): PrivacyRequestInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketInputError("Send a valid privacy request");
  }
  const body = value as Record<string, unknown>;
  if (!isPrivacyRequestType(body.requestType)) {
    throw new MarketInputError("Choose access, correction, deletion, or restriction");
  }
  return {
    requestType: body.requestType,
    details: normalizePrivacyRequestDetails(body.details),
  };
}

export function privacyRequestLabel(type: PrivacyRequestType): string {
  if (type === "access") return "Copy of account data";
  if (type === "correction") return "Correct account data";
  if (type === "deletion") return "Delete eligible account data";
  return "Restrict account-data processing";
}
