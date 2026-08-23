import { query } from "./db";
import { MarketInputError, MIN_BID_CENTS, type RankQuoteInput } from "./market";

type QuoteRow = {
  current_total_cents: string;
  projected_total_cents: string;
  category_rank: string;
  category_entries: string;
  overall_rank: string;
  overall_entries: string;
  category_leader_cents: string;
  minimum_to_lead_cents: string;
  as_of: Date;
  listing_status: "new" | "active" | "review" | "removed";
  existing_product_kind: RankQuoteInput["productKind"] | null;
};

export type RankQuote = {
  normalizedDestination: string;
  category: RankQuoteInput["category"];
  productKind: RankQuoteInput["productKind"];
  contributionCents: number;
  currentTotalCents: number;
  projectedTotalCents: number;
  projectedCategoryRank: number;
  projectedCategoryEntries: number;
  projectedOverallRank: number;
  projectedOverallEntries: number;
  categoryLeaderCents: number;
  minimumContributionToLeadCents: number;
  asOf: string;
  requiresReview: boolean;
};

/**
 * Calculate rank impact from one PostgreSQL snapshot. The destination is
 * excluded from competitors because another contribution adds to its existing
 * total instead of creating a second listing. Existing ties stay ahead because
 * settlement gives this contribution the newest `last_bid_at`.
 */
export async function calculateRankQuote(
  input: Readonly<RankQuoteInput>,
): Promise<RankQuote> {
  const rows = await query<QuoteRow>(
    `WITH own AS (
       SELECT total_cents, status, product_kind
       FROM listings
       WHERE destination = $1
       LIMIT 1
     ),
     amounts AS (
       SELECT
         coalesce((SELECT total_cents FROM own), 0)::bigint AS current_total,
         (coalesce((SELECT total_cents FROM own), 0) + $3::bigint)::bigint AS projected_total
     ),
     category_competitors AS (
       SELECT total_cents
       FROM listings
       WHERE status = 'active' AND category = $2 AND product_kind = $4 AND destination <> $1
     ),
     overall_competitors AS (
       SELECT total_cents
       FROM listings
       WHERE status = 'active' AND product_kind = $4 AND destination <> $1
     )
     SELECT
       amounts.current_total::text AS current_total_cents,
       amounts.projected_total::text AS projected_total_cents,
       (1 + (SELECT count(*) FROM category_competitors WHERE total_cents >= amounts.projected_total))::text AS category_rank,
       (1 + (SELECT count(*) FROM category_competitors))::text AS category_entries,
       (1 + (SELECT count(*) FROM overall_competitors WHERE total_cents >= amounts.projected_total))::text AS overall_rank,
       (1 + (SELECT count(*) FROM overall_competitors))::text AS overall_entries,
       coalesce((SELECT max(total_cents) FROM listings WHERE status = 'active' AND category = $2 AND product_kind = $4), 0)::text AS category_leader_cents,
       greatest(
         $5::bigint,
         coalesce((SELECT max(total_cents) FROM category_competitors), 0) - amounts.current_total + 1
       )::text AS minimum_to_lead_cents,
       clock_timestamp() AS as_of
       ,coalesce((SELECT status FROM own), 'new') AS listing_status,
       (SELECT product_kind FROM own) AS existing_product_kind
     FROM amounts`,
    [input.destination, input.category, input.amountCents, input.productKind, MIN_BID_CENTS],
  );
  const row = rows[0];
  if (!row) throw new Error("Rank quote returned no result");
  if (row.existing_product_kind && row.existing_product_kind !== input.productKind) {
    throw new MarketInputError("This destination already exists in the other product leaderboard");
  }
  if (row.listing_status === "review") {
    throw new MarketInputError("This destination already has a contribution under review. Wait for moderation before adding another.");
  }
  if (row.listing_status === "removed") {
    throw new MarketInputError("This destination is not eligible for a new contribution. Contact support with the existing receipt.");
  }

  return {
    normalizedDestination: input.destination,
    category: input.category,
    productKind: input.productKind,
    contributionCents: input.amountCents,
    currentTotalCents: Number(row.current_total_cents),
    projectedTotalCents: Number(row.projected_total_cents),
    projectedCategoryRank: Number(row.category_rank),
    projectedCategoryEntries: Number(row.category_entries),
    projectedOverallRank: Number(row.overall_rank),
    projectedOverallEntries: Number(row.overall_entries),
    categoryLeaderCents: Number(row.category_leader_cents),
    minimumContributionToLeadCents: Number(row.minimum_to_lead_cents),
    asOf: row.as_of.toISOString(),
    requiresReview: row.listing_status === "new",
  };
}
