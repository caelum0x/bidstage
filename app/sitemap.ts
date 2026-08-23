import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { CATEGORIES } from "@/lib/market";
import { query } from "@/lib/db";

const SITE_URL = "https://bidstage.app";

type PublicListingRow = { slug: string; updated_at: Date };
type PublicCountryRow = { country_code: string; updated_at: Date };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const routes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/bids`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/categories`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/countries`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/opportunities`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE_URL}/contributors`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/legal/rules`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/legal/terms`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/legal/privacy`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/legal/refunds`, changeFrequency: "monthly", priority: 0.4 },
    ...CATEGORIES.map((category) => ({
      url: `${SITE_URL}/category/${category}`,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
  ];
  try {
    const [listings, countries] = await Promise.all([
      query<PublicListingRow>(
        `SELECT slug, updated_at
         FROM listings
         WHERE status = 'active' AND product_kind = 'open_source'
         ORDER BY updated_at DESC
         LIMIT 49000`,
      ),
      query<PublicCountryRow>(
        `SELECT country_code, max(updated_at) AS updated_at
         FROM listings
         WHERE status = 'active' AND product_kind = 'open_source' AND country_code IS NOT NULL
         GROUP BY country_code
         ORDER BY country_code ASC`,
      ),
    ]);
    routes.push(
      ...listings.map((listing) => ({
        url: `${SITE_URL}/listing/${listing.slug}`,
        lastModified: listing.updated_at,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...countries.map((country) => ({
        url: `${SITE_URL}/country/${country.country_code}`,
        lastModified: country.updated_at,
        changeFrequency: "daily" as const,
        priority: 0.6,
      })),
    );
  } catch {
    // Static public routes still form a valid sitemap during a database outage.
  }
  return routes;
}
