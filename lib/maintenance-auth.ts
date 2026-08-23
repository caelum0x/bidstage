import { createHash, timingSafeEqual } from "node:crypto";

export function authorizedMaintenanceRequest(request: Request, expectedSecret: string): boolean {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
  const supplied = createHash("sha256").update(token ?? "missing-maintenance-token").digest();
  const expected = createHash("sha256").update(expectedSecret).digest();
  return Boolean(token) && expectedSecret.length >= 32 && timingSafeEqual(supplied, expected);
}
