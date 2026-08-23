import { createHash, randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";

const OAUTH_SECONDS = 10 * 60;

function safeReturnTo(value: string | null): string {
  return value && /^\/(?!\/)[^\r\n]{0,200}$/.test(value) ? value : "/";
}

export async function GET(request: NextRequest) {
  const env = serverEnv();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callbackUrl = `${env.appUrl}/api/auth/github/callback`;
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.githubClientId);
  authorize.searchParams.set("redirect_uri", callbackUrl);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorize);
  const cookie = {
    httpOnly: true,
    secure: new URL(env.appUrl).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_SECONDS,
  };
  response.cookies.set({ name: "bidstage_oauth_state", value: state, ...cookie });
  response.cookies.set({ name: "bidstage_oauth_verifier", value: verifier, ...cookie });
  response.cookies.set({
    name: "bidstage_oauth_return",
    value: safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
    ...cookie,
  });
  return response;
}
