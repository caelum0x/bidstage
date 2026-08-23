import { createHash } from "node:crypto";

export function webhookIncidentId(eventId: string): string {
  return createHash("sha256").update(eventId).digest("hex").slice(0, 12);
}
