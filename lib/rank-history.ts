import { query } from "./db";

export const RANK_HISTORY_WINDOW_DAYS = 90;
export const RANK_HISTORY_MAX_POINTS = 180;
const RANK_HISTORY_QUERY_LIMIT = RANK_HISTORY_WINDOW_DAYS * 24 + 1;

export type RankHistoryPoint = {
  capturedAt: string;
  overallRank: number;
  overallEntries: number;
  categoryRank: number;
  categoryEntries: number;
  totalCents: number;
  bidCount: number;
};

type RankObservationRow = {
  captured_at: Date;
  overall_rank: number;
  overall_entries: number;
  category_rank: number;
  category_entries: number;
  total_cents: string;
  bid_count: number;
};

function publicPoint(row: RankObservationRow): RankHistoryPoint {
  return {
    capturedAt: row.captured_at.toISOString(),
    overallRank: row.overall_rank,
    overallEntries: row.overall_entries,
    categoryRank: row.category_rank,
    categoryEntries: row.category_entries,
    totalCents: Number(row.total_cents),
    bidCount: row.bid_count,
  };
}

export function sampleRankHistory(
  points: RankHistoryPoint[],
  maximum = RANK_HISTORY_MAX_POINTS,
): RankHistoryPoint[] {
  if (!Number.isInteger(maximum) || maximum < 2) throw new Error("Rank history sample size must be at least two");
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round((index * (points.length - 1)) / (maximum - 1));
    return points[sourceIndex]!;
  });
}

async function rankHistory(where: string, value: string): Promise<RankHistoryPoint[]> {
  const rows = await query<RankObservationRow>(
    `SELECT recent.captured_at, recent.overall_rank, recent.overall_entries,
            recent.category_rank, recent.category_entries,
            recent.total_cents::text, recent.bid_count
     FROM (
       SELECT observation.captured_at, observation.overall_rank, observation.overall_entries,
              observation.category_rank, observation.category_entries,
              observation.total_cents, observation.bid_count
       FROM listing_rank_observations AS observation
       JOIN listings AS listing ON listing.id = observation.listing_id
       WHERE ${where}
         AND listing.status = 'active'
         AND listing.product_kind = 'open_source'
         AND observation.captured_at >= now() - interval '${RANK_HISTORY_WINDOW_DAYS} days'
       ORDER BY observation.captured_at DESC
       LIMIT ${RANK_HISTORY_QUERY_LIMIT}
     ) AS recent
     ORDER BY recent.captured_at ASC`,
    [value],
  );
  return sampleRankHistory(rows.map(publicPoint));
}

export function listingRankHistory(listingId: string): Promise<RankHistoryPoint[]> {
  return rankHistory("listing.id = $1::uuid", listingId);
}

export async function publicListingRankHistory(slug: string): Promise<RankHistoryPoint[] | null> {
  const listings = await query<{ id: string }>(
    `SELECT id::text
     FROM listings
     WHERE slug = $1 AND status = 'active' AND product_kind = 'open_source'
     LIMIT 1`,
    [slug],
  );
  const listing = listings[0];
  return listing ? listingRankHistory(listing.id) : null;
}
