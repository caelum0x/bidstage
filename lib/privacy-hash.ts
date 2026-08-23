import { createHash } from "node:crypto";

import { serverEnv } from "./env";

export function privacyHash(value: string): string {
  return createHash("sha256")
    .update(serverEnv().rateLimitSalt)
    .update("\0")
    .update(value)
    .digest("hex");
}
