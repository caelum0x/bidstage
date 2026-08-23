import { NextResponse } from "next/server";

import type { CountryCode } from "@/lib/countries";
import { query } from "@/lib/db";
import type { Category } from "@/lib/market";

type PlacementProjectRow = {
  slug: string;
  title: string;
  destination: string;
  category: Category;
  github_url: string;
  country_code: CountryCode | null;
  funding_url: string | null;
  contribution_url: string | null;
  contribution_note: string | null;
  total_cents: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) {
    return NextResponse.json(
      { error: "listing_not_found", message: "This project is not available for another placement." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const rows = await query<PlacementProjectRow>(
      `SELECT slug, title, destination, category, github_url, country_code,
              funding_url, contribution_url, contribution_note, total_cents::text
       FROM listings
       WHERE slug = $1
         AND status = 'active'
         AND product_kind = 'open_source'
         AND github_url IS NOT NULL
       LIMIT 1`,
      [slug],
    );
    const project = rows[0];
    if (!project) {
      return NextResponse.json(
        { error: "listing_not_found", message: "This project is not available for another placement." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({
      project: {
        slug: project.slug,
        title: project.title,
        destination: project.destination,
        category: project.category,
        repositoryUrl: project.github_url,
        countryCode: project.country_code,
        fundingUrl: project.funding_url,
        contributionUrl: project.contribution_url,
        contributionNote: project.contribution_note,
        currentTotalCents: Number(project.total_cents),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "placement_project_unavailable", message: "The project record could not be loaded." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
