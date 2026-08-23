import { NextResponse } from "next/server";

import { isCountryCode } from "@/lib/countries";
import { query } from "@/lib/db";
import type { Category } from "@/lib/market";

export const dynamic = "force-dynamic";

const PUBLIC_CACHE = "public, s-maxage=60, stale-while-revalidate=300";

type CountrySummaryRow = {
  country_code: string;
  project_count: string;
  contribution_cents: string;
  verified_visits: string;
  opportunity_count: string;
  contributor_count: string;
  available_contributor_count: string;
};

type ProjectRow = {
  country_rank: string;
  slug: string;
  title: string;
  category: Category;
  github_owner: string;
  github_name: string;
  github_url: string;
  github_primary_language: string | null;
  github_license_spdx: string;
  total_cents: string;
  bid_count: number;
  outbound_clicks: string;
  contribution_url: string | null;
  contribution_note: string | null;
};

type OpportunityRow = {
  slug: string;
  title: string;
  category: Category;
  github_owner: string;
  github_name: string;
  github_url: string;
  github_primary_language: string | null;
  github_license_spdx: string;
  contribution_url: string;
  contribution_note: string;
};

type ContributorRow = {
  github_login: string;
  display_name: string | null;
  profile_url: string;
  headline: string;
  bio: string | null;
  skills: string[];
  availability: "available" | "limited" | "unavailable";
};

type CountryDetailStatsRow = {
  project_count: string;
  contribution_cents: string;
  opportunity_count: string;
  contributor_count: string;
};

function publicResponse(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": PUBLIC_CACHE } });
}

async function countryIndex() {
  const countries = await query<CountrySummaryRow>(
    `WITH project_stats AS (
       SELECT country_code,
              count(*)::text AS project_count,
              coalesce(sum(total_cents), 0)::text AS contribution_cents,
              coalesce(sum(outbound_clicks), 0)::text AS verified_visits,
              count(*) FILTER (
                WHERE contribution_url IS NOT NULL AND contribution_note IS NOT NULL
              )::text AS opportunity_count
       FROM listings
       WHERE status = 'active'
         AND product_kind = 'open_source'
         AND country_code IS NOT NULL
       GROUP BY country_code
     ), contributor_stats AS (
       SELECT country_code,
              count(*)::text AS contributor_count,
              count(*) FILTER (WHERE availability = 'available')::text
                AS available_contributor_count
       FROM contributor_profiles
       WHERE is_public = true AND country_code IS NOT NULL
       GROUP BY country_code
     ), represented_countries AS (
       SELECT country_code FROM project_stats
       UNION
       SELECT country_code FROM contributor_stats
     )
     SELECT represented.country_code,
            coalesce(project.project_count, '0') AS project_count,
            coalesce(project.contribution_cents, '0') AS contribution_cents,
            coalesce(project.verified_visits, '0') AS verified_visits,
            coalesce(project.opportunity_count, '0') AS opportunity_count,
            coalesce(contributor.contributor_count, '0') AS contributor_count,
            coalesce(contributor.available_contributor_count, '0')
              AS available_contributor_count
     FROM represented_countries AS represented
     LEFT JOIN project_stats AS project USING (country_code)
     LEFT JOIN contributor_stats AS contributor USING (country_code)
     ORDER BY
       (coalesce(project.project_count, '0')::bigint
        + coalesce(contributor.contributor_count, '0')::bigint) DESC,
       represented.country_code ASC`,
  );

  return publicResponse({
    countries: countries.map((country) => ({
      countryCode: country.country_code,
      projectCount: Number(country.project_count),
      contributionCents: country.contribution_cents,
      verifiedVisits: country.verified_visits,
      opportunityCount: Number(country.opportunity_count),
      contributorCount: Number(country.contributor_count),
      availableContributorCount: Number(country.available_contributor_count),
    })),
  });
}

async function countryDetail(countryCode: string) {
  const [statsRows, projects, opportunities, contributors] = await Promise.all([
    query<CountryDetailStatsRow>(
      `SELECT count(*)::text AS project_count,
              coalesce(sum(total_cents), 0)::text AS contribution_cents,
              count(*) FILTER (
                WHERE contribution_url IS NOT NULL AND contribution_note IS NOT NULL
              )::text AS opportunity_count,
              (SELECT count(*)::text
               FROM contributor_profiles
               WHERE is_public = true AND country_code = $1) AS contributor_count
       FROM listings
       WHERE status = 'active'
         AND product_kind = 'open_source'
         AND country_code = $1`,
      [countryCode],
    ),
    query<ProjectRow>(
      `SELECT row_number() OVER (
                ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
              )::text AS country_rank,
              slug, title, category, github_owner, github_name, github_url,
              github_primary_language, github_license_spdx,
              total_cents::text, bid_count, outbound_clicks::text,
              contribution_url, contribution_note
       FROM listings
       WHERE status = 'active'
         AND product_kind = 'open_source'
         AND country_code = $1
       ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
       LIMIT 100`,
      [countryCode],
    ),
    query<OpportunityRow>(
      `SELECT slug, title, category, github_owner, github_name, github_url,
              github_primary_language, github_license_spdx,
              contribution_url, contribution_note
       FROM listings
       WHERE status = 'active'
         AND product_kind = 'open_source'
         AND country_code = $1
         AND contribution_url IS NOT NULL
         AND contribution_note IS NOT NULL
       ORDER BY updated_at DESC, slug ASC
       LIMIT 100`,
      [countryCode],
    ),
    query<ContributorRow>(
      `SELECT founder.github_login, founder.display_name, founder.profile_url,
              profile.headline, profile.bio, profile.skills, profile.availability
       FROM contributor_profiles AS profile
       JOIN founder_accounts AS founder ON founder.id = profile.founder_id
       WHERE profile.is_public = true AND profile.country_code = $1
       ORDER BY
         CASE profile.availability WHEN 'available' THEN 1 WHEN 'limited' THEN 2 ELSE 3 END,
         profile.updated_at DESC, founder.github_login ASC
       LIMIT 100`,
      [countryCode],
    ),
  ]);

  const stats = statsRows[0] ?? {
    project_count: "0",
    contribution_cents: "0",
    opportunity_count: "0",
    contributor_count: "0",
  };

  return publicResponse({
    countryCode,
    summary: {
      projectCount: Number(stats.project_count),
      contributionCents: stats.contribution_cents,
      opportunityCount: Number(stats.opportunity_count),
      contributorCount: Number(stats.contributor_count),
    },
    projects: projects.map((project) => ({
      countryRank: Number(project.country_rank),
      slug: project.slug,
      title: project.title,
      category: project.category,
      repository: `${project.github_owner}/${project.github_name}`,
      repositoryUrl: project.github_url,
      primaryLanguage: project.github_primary_language,
      licenseSpdx: project.github_license_spdx,
      contributionCents: project.total_cents,
      placementCount: project.bid_count,
      verifiedVisits: project.outbound_clicks,
      contributionUrl: project.contribution_url,
      contributionNote: project.contribution_note,
    })),
    opportunities: opportunities.map((opportunity) => ({
      slug: opportunity.slug,
      title: opportunity.title,
      category: opportunity.category,
      repository: `${opportunity.github_owner}/${opportunity.github_name}`,
      repositoryUrl: opportunity.github_url,
      primaryLanguage: opportunity.github_primary_language,
      licenseSpdx: opportunity.github_license_spdx,
      contributionUrl: opportunity.contribution_url,
      contributionNote: opportunity.contribution_note,
    })),
    contributors: contributors.map((contributor) => ({
      githubLogin: contributor.github_login,
      displayName: contributor.display_name,
      profileUrl: contributor.profile_url,
      headline: contributor.headline,
      bio: contributor.bio,
      skills: contributor.skills,
      availability: contributor.availability,
    })),
  });
}

export async function GET(request: Request) {
  try {
    const rawCountry = new URL(request.url).searchParams.get("country")?.trim();
    if (!rawCountry) return countryIndex();
    const countryCode = rawCountry.toUpperCase();
    if (!isCountryCode(countryCode)) {
      return NextResponse.json(
        { error: "invalid_country", message: "Choose a valid two-letter country code." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return countryDetail(countryCode);
  } catch {
    return NextResponse.json(
      { error: "countries_unavailable", message: "Country communities are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
