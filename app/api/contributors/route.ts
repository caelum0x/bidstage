import { NextResponse } from "next/server";

import { isCountryCode } from "@/lib/countries";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type ContributorRow = {
  github_login: string;
  display_name: string | null;
  profile_url: string;
  headline: string;
  bio: string | null;
  country_code: string | null;
  skills: string[];
  availability: "available" | "limited" | "unavailable";
  updated_at: Date;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const country = url.searchParams.get("country")?.trim().toUpperCase() || null;
    const skill = url.searchParams.get("skill")?.trim().replace(/\s+/g, " ") || null;
    if (country && !isCountryCode(country)) {
      return NextResponse.json({ error: "invalid_country" }, { status: 400 });
    }
    if (skill && !/^[\p{L}\p{N}][\p{L}\p{N} .+#/_-]{0,31}$/u.test(skill)) {
      return NextResponse.json({ error: "invalid_skill" }, { status: 400 });
    }
    const [contributors, skills, countries] = await Promise.all([
      query<ContributorRow>(
        `SELECT founder.github_login, founder.display_name, founder.profile_url,
                profile.headline, profile.bio, profile.country_code, profile.skills,
                profile.availability, profile.updated_at
         FROM contributor_profiles AS profile
         JOIN founder_accounts AS founder ON founder.id = profile.founder_id
         WHERE profile.is_public = true
           AND ($1::text IS NULL OR profile.country_code = $1)
           AND ($2::text IS NULL OR EXISTS (
             SELECT 1 FROM unnest(profile.skills) AS listed_skill
             WHERE lower(listed_skill) = lower($2)
           ))
         ORDER BY
           CASE profile.availability WHEN 'available' THEN 1 WHEN 'limited' THEN 2 ELSE 3 END,
           profile.updated_at DESC, founder.github_login ASC
         LIMIT 100`,
        [country, skill],
      ),
      query<{ skill: string }>(
        `SELECT DISTINCT listed_skill AS skill
         FROM contributor_profiles AS profile,
              unnest(profile.skills) AS listed_skill
         WHERE profile.is_public = true
         ORDER BY skill ASC`,
      ),
      query<{ country_code: string }>(
        `SELECT DISTINCT country_code
         FROM contributor_profiles
         WHERE is_public = true AND country_code IS NOT NULL
         ORDER BY country_code ASC`,
      ),
    ]);
    return NextResponse.json(
      {
        contributors: contributors.map((contributor) => ({
          githubLogin: contributor.github_login,
          displayName: contributor.display_name,
          profileUrl: contributor.profile_url,
          headline: contributor.headline,
          bio: contributor.bio,
          countryCode: contributor.country_code,
          skills: contributor.skills,
          availability: contributor.availability,
          updatedAt: contributor.updated_at.toISOString(),
        })),
        facets: { skills: skills.map((row) => row.skill), countries: countries.map((row) => row.country_code) },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "contributors_unavailable", message: "The contributor directory is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
