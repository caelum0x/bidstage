import { randomUUID } from "node:crypto";
import { serverEnv } from "./env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type SiteverifyResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export class HumanVerificationError extends Error {
  readonly name = "HumanVerificationError";
}

export async function verifyCheckoutHuman(token: unknown, remoteIp?: string): Promise<void> {
  if (typeof token !== "string" || token.length < 1 || token.length > 2_048) {
    throw new HumanVerificationError("Complete the human verification before checkout.");
  }

  const env = serverEnv();
  if (!env.checkoutEnabled || !env.turnstileSecretKey) {
    throw new HumanVerificationError("Checkout verification is not available yet.");
  }
  const form = new FormData();
  form.set("secret", env.turnstileSecretKey);
  form.set("response", token);
  form.set("idempotency_key", randomUUID());
  if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Turnstile validation service failed");

  const result = (await response.json()) as SiteverifyResult;
  const expectedHostname = new URL(env.appUrl).hostname;
  if (!result.success || result.action !== "checkout" || result.hostname !== expectedHostname) {
    throw new HumanVerificationError(
      result["error-codes"]?.includes("timeout-or-duplicate")
        ? "Human verification expired. Complete it again and retry."
        : "Human verification failed. Complete it again and retry.",
    );
  }
}
