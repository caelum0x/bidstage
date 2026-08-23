import { type NextRequest, NextResponse } from "next/server";

import { authenticatedFounder } from "@/lib/auth";
import { parseContributorProfile } from "@/lib/contributor-profile";
import { query, takeRateLimit } from "@/lib/db";
import { enforceEdgeWriteRateLimit } from "@/lib/edge-rate-limit";
import { serverEnv } from "@/lib/env";
import { MarketInputError } from "@/lib/market-error";

type ContributorProfileRow = {
  headline: string;
  bio: string | null;
  country_code: string | null;
  skills: string[];
  availability: "available" | "limited" | "unavailable";
  is_public: boolean;
  created_at: Date;
  updated_at: Date;
};

function responseProfile(row: ContributorProfileRow | undefined) {
  return row ? {
    headline: row.headline,
    bio: row.bio,
    countryCode: row.country_code,
    skills: row.skills,
    availability: row.availability,
    isPublic: row.is_public,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  } : null;
}

export async function GET(request: NextRequest) {
  try {
    const founder = await authenticatedFounder(request);
    if (!founder) {
      return NextResponse.json(
        { error: "authentication_required", message: "Sign in with GitHub to manage a contributor profile." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const rows = await query<ContributorProfileRow>(
      `SELECT headline, bio, country_code, skills, availability, is_public, created_at, updated_at
       FROM contributor_profiles
       WHERE founder_id = $1
       LIMIT 1`,
      [founder.id],
    );
    return NextResponse.json(
      { founder: { githubLogin: founder.githubLogin, profileUrl: founder.profileUrl }, profile: responseProfile(rows[0]) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "profile_unavailable", message: "Your contributor profile is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== serverEnv().appUrl) {
      return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
    }
    const edgeLimit = await enforceEdgeWriteRateLimit(request, "contributor_profile");
    if (edgeLimit) return edgeLimit;
    const founder = await authenticatedFounder(request);
    if (!founder) {
      return NextResponse.json(
        { error: "authentication_required", message: "Sign in with GitHub to manage a contributor profile." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (!(await takeRateLimit("contributor-profile-edit", founder.id, 20, 3600))) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many profile edits. Try again later." },
        { status: 429, headers: { "Retry-After": "3600", "Cache-Control": "private, no-store" } },
      );
    }
    const input = parseContributorProfile(await request.json());
    const rows = await query<ContributorProfileRow>(
      `INSERT INTO contributor_profiles
         (founder_id, headline, bio, country_code, skills, availability, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (founder_id) DO UPDATE SET
         headline = EXCLUDED.headline,
         bio = EXCLUDED.bio,
         country_code = EXCLUDED.country_code,
         skills = EXCLUDED.skills,
         availability = EXCLUDED.availability,
         is_public = EXCLUDED.is_public,
         updated_at = now()
       RETURNING headline, bio, country_code, skills, availability, is_public, created_at, updated_at`,
      [founder.id, input.headline, input.bio, input.countryCode, input.skills, input.availability, input.isPublic],
    );
    return NextResponse.json(
      { profile: responseProfile(rows[0]), message: input.isPublic ? "Your contributor profile is public." : "Your contributor profile is saved but hidden." },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const clientError = error instanceof MarketInputError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: clientError ? "invalid_profile" : "profile_update_unavailable",
        message: error instanceof MarketInputError ? error.message : error instanceof SyntaxError ? "Send a valid contributor profile." : "Your contributor profile could not be saved.",
      },
      { status: clientError ? 400 : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
