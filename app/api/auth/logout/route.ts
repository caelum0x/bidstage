import { type NextRequest, NextResponse } from "next/server";

import { clearSessionCookie, revokeSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }
  await revokeSession(request);
  const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  clearSessionCookie(response);
  return response;
}
