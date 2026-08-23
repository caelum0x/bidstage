import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { createFounderSession, setSessionCookie } from "@/lib/auth";
import { query } from "@/lib/db";
import { serverEnv } from "@/lib/env";

type TokenResponse = { access_token?: string; token_type?: string; error?: string };
type GitHubUser = {
  id?: number;
  login?: string;
  name?: string | null;
  avatar_url?: string;
  html_url?: string;
};

function equalState(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clearOAuthCookies(response: NextResponse, secure: boolean): void {
  for (const name of ["bidstage_oauth_state", "bidstage_oauth_verifier", "bidstage_oauth_return"]) {
    response.cookies.set({ name, value: "", path: "/", httpOnly: true, secure, sameSite: "lax", maxAge: 0 });
  }
}

function failure(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/auth/error", request.url));
  clearOAuthCookies(response, request.nextUrl.protocol === "https:");
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expectedState = request.cookies.get("bidstage_oauth_state")?.value ?? "";
  const verifier = request.cookies.get("bidstage_oauth_verifier")?.value ?? "";
  const returnTo = request.cookies.get("bidstage_oauth_return")?.value ?? "/";
  if (
    !/^[A-Za-z0-9_-]{20,200}$/.test(code)
    || !/^[A-Za-z0-9_-]{43}$/.test(state)
    || !/^[A-Za-z0-9_-]{43}$/.test(expectedState)
    || !/^[A-Za-z0-9_-]{43}$/.test(verifier)
    || !equalState(state, expectedState)
  ) return failure(request);

  try {
    const env = serverEnv();
    const callbackUrl = `${env.appUrl}/api/auth/github/callback`;
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.githubClientId,
        client_secret: env.githubClientSecret,
        code,
        redirect_uri: callbackUrl,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!tokenResponse.ok) return failure(request);
    const tokenBody = await tokenResponse.json() as TokenResponse;
    if (!tokenBody.access_token || tokenBody.token_type?.toLowerCase() !== "bearer" || tokenBody.error) {
      return failure(request);
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenBody.access_token}`,
        "User-Agent": "Bidstage",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!userResponse.ok) return failure(request);
    const user = await userResponse.json() as GitHubUser;
    if (
      !Number.isSafeInteger(user.id)
      || !user.login
      || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user.login)
      || !user.avatar_url
      || !user.html_url
    ) return failure(request);

    const founders = await query<{ id: string }>(
      `INSERT INTO founder_accounts
         (github_user_id, github_login, display_name, avatar_url, profile_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (github_user_id) DO UPDATE SET
         github_login = EXCLUDED.github_login,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         profile_url = EXCLUDED.profile_url,
         updated_at = now(),
         last_login_at = now()
       RETURNING id`,
      [user.id, user.login, user.name?.trim().slice(0, 120) || null, user.avatar_url, user.html_url],
    );
    const founderId = founders[0]?.id;
    if (!founderId) return failure(request);
    const sessionToken = await createFounderSession(founderId);
    const safeReturnTo = /^\/(?!\/)[^\r\n]{0,200}$/.test(returnTo) ? returnTo : "/";
    const response = NextResponse.redirect(new URL(safeReturnTo, env.appUrl));
    setSessionCookie(response, sessionToken);
    clearOAuthCookies(response, new URL(env.appUrl).protocol === "https:");
    return response;
  } catch {
    return failure(request);
  }
}
