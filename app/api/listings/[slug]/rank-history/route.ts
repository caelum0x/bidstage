import { NextResponse } from "next/server";

import {
  publicListingRankHistory,
  RANK_HISTORY_MAX_POINTS,
  RANK_HISTORY_WINDOW_DAYS,
} from "@/lib/rank-history";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) {
    return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  }
  const points = await publicListingRankHistory(slug);
  if (!points) {
    return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  }
  return NextResponse.json(
    {
      slug,
      windowDays: RANK_HISTORY_WINDOW_DAYS,
      maximumPoints: RANK_HISTORY_MAX_POINTS,
      observationPolicy: "rank changes plus one daily unchanged checkpoint",
      points,
    },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" } },
  );
}
