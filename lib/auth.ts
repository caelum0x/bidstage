import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { query } from "./db";
import { serverEnv } from "./env";

const SESSION_COOKIE = "bidstage_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type FounderSession = {
  id: string;
  githubUserId: number;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string;
  profileUrl: string;
};

type FounderRow = {
  id: string;
  github_user_id: string;
  github_login: string;
  display_name: string | null;
  avatar_url: string;
  profile_url: string;
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function founder(row: FounderRow): FounderSession {
  return {
    id: row.id,
    githubUserId: Number(row.github_user_id),
    githubLogin: row.github_login,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileUrl: row.profile_url,
  };
}

export async function authenticatedFounder(request: NextRequest): Promise<FounderSession | undefined> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return undefined;
  const rows = await query<FounderRow>(
    `SELECT founder.id, founder.github_user_id::text, founder.github_login,
            founder.display_name, founder.avatar_url, founder.profile_url
     FROM founder_sessions AS session
     JOIN founder_accounts AS founder ON founder.id = session.founder_id
     WHERE session.token_hash = $1
       AND session.revoked_at IS NULL
       AND session.expires_at > now()
     LIMIT 1`,
    [tokenHash(token)],
  );
  return rows[0] ? founder(rows[0]) : undefined;
}

export async function createFounderSession(founderId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query(
    `INSERT INTO founder_sessions (founder_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '30 days')`,
    [founderId, tokenHash(token)],
  );
  return token;
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: new URL(serverEnv().appUrl).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function revokeSession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return;
  await query(
    "UPDATE founder_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [tokenHash(token)],
  );
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: new URL(serverEnv().appUrl).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
