import { isCountryCode, type CountryCode } from "@/lib/countries";
import { query } from "@/lib/db";
import type { Category } from "@/lib/market";

export type PublicOpportunity = {
  slug: string;
  title: string;
  category: Category;
  repository: string;
  repositoryUrl: string;
  primaryLanguage: string | null;
  licenseSpdx: string;
  countryCode: CountryCode | null;
  contributionUrl: string;
  contributionNote: string;
  updatedAt: string;
};

export type PublicOpportunityData = {
  opportunities: PublicOpportunity[];
  facets: { languages: string[]; countries: CountryCode[] };
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
  country_code: string | null;
  contribution_url: string;
  contribution_note: string;
  updated_at: Date;
};

export async function readPublicOpportunities(filters: {
  category?: Category | null;
  language?: string | null;
  country?: CountryCode | null;
} = {}): Promise<PublicOpportunityData> {
  const category = filters.category ?? null;
  const language = filters.language ?? null;
  const country = filters.country ?? null;
  const [opportunities, languages, countries] = await Promise.all([
    query<OpportunityRow>(
      `SELECT slug, title, category, github_owner, github_name, github_url,
              github_primary_language, github_license_spdx, country_code,
              contribution_url, contribution_note, updated_at
       FROM listings
       WHERE status = 'active'
         AND product_kind = 'open_source'
         AND contribution_url IS NOT NULL
         AND contribution_note IS NOT NULL
         AND ($1::text IS NULL OR category = $1)
         AND ($2::text IS NULL OR lower(github_primary_language) = lower($2))
         AND ($3::text IS NULL OR country_code = $3)
       ORDER BY updated_at DESC, slug ASC
       LIMIT 100`,
      [category, language, country],
    ),
    query<{ github_primary_language: string }>(
      `SELECT DISTINCT github_primary_language
       FROM listings
       WHERE status = 'active' AND product_kind = 'open_source'
         AND contribution_url IS NOT NULL AND github_primary_language IS NOT NULL
       ORDER BY github_primary_language ASC`,
    ),
    query<{ country_code: string }>(
      `SELECT DISTINCT country_code
       FROM listings
       WHERE status = 'active' AND product_kind = 'open_source'
         AND contribution_url IS NOT NULL AND country_code IS NOT NULL
       ORDER BY country_code ASC`,
    ),
  ]);

  return {
    opportunities: opportunities.map((opportunity) => ({
      slug: opportunity.slug,
      title: opportunity.title,
      category: opportunity.category,
      repository: `${opportunity.github_owner}/${opportunity.github_name}`,
      repositoryUrl: opportunity.github_url,
      primaryLanguage: opportunity.github_primary_language,
      licenseSpdx: opportunity.github_license_spdx,
      countryCode: isCountryCode(opportunity.country_code ?? "") ? opportunity.country_code as CountryCode : null,
      contributionUrl: opportunity.contribution_url,
      contributionNote: opportunity.contribution_note,
      updatedAt: opportunity.updated_at.toISOString(),
    })),
    facets: {
      languages: languages.map((row) => row.github_primary_language),
      countries: countries.map((row) => row.country_code).filter(isCountryCode),
    },
  };
}
