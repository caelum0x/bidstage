import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const founder = await authenticatedFounder(request);
    return NextResponse.json(
      { authenticated: Boolean(founder), founder: founder ?? null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "session_unavailable", message: "Sign-in status is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
