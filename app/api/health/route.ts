import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { edgeRateLimitMode } from "@/lib/edge-rate-limit";
import { serverEnv } from "@/lib/env";
import { maintenanceReadiness } from "@/lib/scheduled-maintenance";
import { assertPlacementPaymentConfigured } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const env = serverEnv();
    if (env.checkoutEnabled) assertPlacementPaymentConfigured(env.paymentProvider);
    const edgeRateLimit = edgeRateLimitMode();
    if (edgeRateLimit === "missing") throw new Error("Worker rate-limit binding is missing");
    await query("SELECT 1");
    const maintenance = await maintenanceReadiness();
    return NextResponse.json(
      {
        ok: true,
        service: "bidstage",
        database: "ready",
        edge_rate_limit: edgeRateLimit,
        maintenance,
        checkout: env.checkoutEnabled ? "ready" : "disabled",
        payment_provider: env.paymentProvider,
        latency_ms: Date.now() - started,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, service: "bidstage", readiness: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
