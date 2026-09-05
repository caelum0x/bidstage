/**
 * Validation for the launch-notification capture path.
 *
 * While CHECKOUT_ENABLED=false (pre Creem approval) a founder who tries to pay
 * hits a dead end; this module backs the "email me when checkout opens" capture
 * so that pre-launch demand is recorded instead of lost. Inputs arrive from an
 * unauthenticated public endpoint, so everything is validated strictly here and
 * the route only ever stores normalized values.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_REPOSITORY_URL_LENGTH = 500;

export const LAUNCH_NOTIFY_SOURCES = ["checkout_disabled", "landing"] as const;
export type LaunchNotifySource = (typeof LAUNCH_NOTIFY_SOURCES)[number];

export function isLaunchNotifySource(value: unknown): value is LaunchNotifySource {
  return typeof value === "string"
    && (LAUNCH_NOTIFY_SOURCES as readonly string[]).includes(value);
}

export function normalizeLaunchNotifyEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("A valid email address is required");
  }
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new Error("A valid email address is required");
  }
  return email;
}

export function normalizeLaunchNotifyRepositoryUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("The repository URL must be a web address");
  }
  const url = value.trim();
  if (url.length === 0) return null;
  if (url.length > MAX_REPOSITORY_URL_LENGTH) {
    throw new Error("The repository URL is too long");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The repository URL must be a web address");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("The repository URL must be a web address");
  }
  // Store the WHATWG-normalized form (lowercased scheme/host, canonical
  // encoding) so later comparisons never depend on how the founder typed it.
  return parsed.href;
}
