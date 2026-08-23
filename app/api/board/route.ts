import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isCountryCode } from "@/lib/countries";
import { CATEGORIES, type ProductKind } from "@/lib/market";

export const dynamic = "force-dynamic";

type ListingRow = {
  rank: string;
  slug: string;
  title: string;
  destination: string;
  category: string;
  product_kind: ProductKind;
  github_owner: string | null;
  github_name: string | null;
  github_url: string | null;
  github_stars: number | null;
  github_license_spdx: string | null;
  github_primary_language: string | null;
  country_code: string | null;
  funding_provider: "github_sponsors" | "open_collective" | null;
  funding_url: string | null;
  github_verification_method: "personal_owner" | "repository_file" | null;
  contribution_url: string | null;
  contribution_note: string | null;
  total_cents: string;
  bid_count: number;
  outbound_clicks: string;
  last_bid_at: Date;
};

type LanguageRow = { github_primary_language: string };
type CountryRow = { country_code: string };

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get("category");
    const kind = url.searchParams.get("kind");
    const language = url.searchParams.get("language")?.trim() || null;
    const country = url.searchParams.get("country")?.trim().toUpperCase() || null;
    if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return NextResponse.json({ error: "invalid_category" }, { status: 400 });
    }
    if (kind && kind !== "open_source") {
      return NextResponse.json({ error: "invalid_product_kind" }, { status: 400 });
    }
    if (language && (language.length > 80 || !/^[\p{L}\p{N} .+#_-]+$/u.test(language))) {
      return NextResponse.json({ error: "invalid_language" }, { status: 400 });
    }
    if (country && !isCountryCode(country)) {
      return NextResponse.json({ error: "invalid_country" }, { status: 400 });
    }
    const rows = await query<ListingRow>(
      `SELECT row_number() OVER (ORDER BY total_cents DESC, last_bid_at ASC, slug ASC)::text AS rank,
              slug, title, destination, category, product_kind,
              github_owner, github_name, github_url, github_stars,
              github_license_spdx, github_primary_language, country_code,
              funding_provider, funding_url, github_verification_method,
              contribution_url, contribution_note,
              total_cents::text, bid_count,
              outbound_clicks::text, last_bid_at
       FROM listings
       WHERE status = 'active'
         AND product_kind = 'open_source'
         AND ($1::text IS NULL OR category = $1)
         AND ($2::text IS NULL OR lower(github_primary_language) = lower($2))
         AND ($3::text IS NULL OR country_code = $3)
       ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
       LIMIT 100`,
      [category, language, country],
    );
    const totals = await query<{ entries: string; volume_cents: string; clicks: string }>(
      `SELECT count(*)::text AS entries,
              coalesce(sum(total_cents), 0)::text AS volume_cents,
              coalesce(sum(outbound_clicks), 0)::text AS clicks
       FROM listings WHERE status = 'active' AND product_kind = 'open_source'`,
    );
    const languages = await query<LanguageRow>(
      `SELECT DISTINCT github_primary_language
       FROM listings
       WHERE status = 'active'
         AND product_kind = 'open_source'
         AND github_primary_language IS NOT NULL
       ORDER BY github_primary_language ASC`,
    );
    const countries = await query<CountryRow>(
      `SELECT DISTINCT country_code
       FROM listings
       WHERE status = 'active'
         AND product_kind = 'open_source'
         AND country_code IS NOT NULL
       ORDER BY country_code ASC`,
    );
    return NextResponse.json(
      {
        listings: rows,
        totals: totals[0] ?? { entries: "0", volume_cents: "0", clicks: "0" },
        languages: languages.map((row) => row.github_primary_language),
        countries: countries.map((row) => row.country_code),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "board_unavailable", message: "The live board is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
