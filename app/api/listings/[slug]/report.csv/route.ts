import { NextResponse } from "next/server";

import { query } from "@/lib/db";

type ListingReport = {
  id: string;
  slug: string;
  title: string;
  destination: string;
  category: string;
  product_kind: "commercial" | "open_source";
  github_url: string | null;
  github_license_spdx: string | null;
  github_stars: number | null;
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
  category_rank: string;
  overall_rank: string;
  created_at: Date;
  updated_at: Date;
};

type LedgerReport = {
  entry_type: string;
  amount_cents: number;
  created_at: Date;
  public_reference: string;
};

type ModerationReport = {
  action: string;
  previous_status: string;
  next_status: string;
  reason_code: string;
  public_note: string;
  created_at: Date;
};

type TrafficReport = {
  decision: string;
  count: string;
};

function csv(value: string | number): string {
  let output = String(value).replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(output)) output = `'${output}`;
  return `"${output.replace(/"/g, '""')}"`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) {
    return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  }
  const listings = await query<ListingReport>(
    `WITH category_ranks AS (
       SELECT id, row_number() OVER (PARTITION BY product_kind, category ORDER BY total_cents DESC, last_bid_at ASC, slug ASC)::text AS rank
       FROM listings WHERE status = 'active'
     ), overall_ranks AS (
       SELECT id, row_number() OVER (PARTITION BY product_kind ORDER BY total_cents DESC, last_bid_at ASC, slug ASC)::text AS rank
       FROM listings WHERE status = 'active'
     )
     SELECT listing.id, listing.slug, listing.title, listing.destination, listing.category,
            listing.product_kind, listing.github_url, listing.github_license_spdx,
            listing.github_stars, listing.github_primary_language,
            listing.country_code, listing.funding_provider, listing.funding_url,
            listing.github_verification_method,
            listing.contribution_url, listing.contribution_note,
            listing.total_cents::text, listing.bid_count, listing.outbound_clicks::text,
            category_ranks.rank AS category_rank, overall_ranks.rank AS overall_rank,
            listing.created_at, listing.updated_at
     FROM listings AS listing
     JOIN category_ranks ON category_ranks.id = listing.id
     JOIN overall_ranks ON overall_ranks.id = listing.id
     WHERE listing.slug = $1 AND listing.status = 'active'
     LIMIT 1`,
    [slug],
  );
  const listing = listings[0];
  if (!listing) return NextResponse.json({ error: "listing_not_found" }, { status: 404 });

  const [ledger, moderation, traffic] = await Promise.all([
    query<LedgerReport>(
      `SELECT ledger.entry_type, ledger.amount_cents, ledger.created_at,
              checkout.public_reference
       FROM rank_ledger AS ledger
       JOIN payment_checkouts AS checkout ON checkout.id = ledger.checkout_id
       WHERE ledger.listing_id = $1
       ORDER BY ledger.created_at ASC, ledger.id ASC
       LIMIT 5000`,
      [listing.id],
    ),
    query<ModerationReport>(
      `SELECT action, previous_status, next_status, reason_code, public_note, created_at
       FROM listing_moderation
       WHERE listing_id = $1
       ORDER BY created_at ASC, id ASC
       LIMIT 1000`,
      [listing.id],
    ),
    query<TrafficReport>(
      `SELECT decision, count(*)::text AS count
       FROM click_events
       WHERE listing_id = $1
       GROUP BY decision
       ORDER BY decision`,
      [listing.id],
    ),
  ]);

  const rows: Array<Array<string | number>> = [
    ["record_type", "timestamp", "label", "amount_usd", "value", "reference"],
    ["campaign", listing.updated_at.toISOString(), "product", "", listing.title, listing.slug],
    ["campaign", listing.updated_at.toISOString(), "destination", "", listing.destination, ""],
    ["campaign", listing.updated_at.toISOString(), "category", "", listing.category, ""],
    ["campaign", listing.updated_at.toISOString(), "product_kind", "", listing.product_kind, ""],
    ...(listing.github_url ? [
      ["source", listing.updated_at.toISOString(), "repository", "", listing.github_url, ""],
      ["source", listing.updated_at.toISOString(), "license_spdx", "", listing.github_license_spdx ?? "", ""],
      ["source", listing.updated_at.toISOString(), "github_stars", "", listing.github_stars ?? 0, ""],
      ["source", listing.updated_at.toISOString(), "primary_language", "", listing.github_primary_language ?? "", ""],
      ["source", listing.updated_at.toISOString(), "community_country", "", listing.country_code ?? "global", ""],
      ["source", listing.updated_at.toISOString(), "repository_verification", "", listing.github_verification_method ?? "legacy", ""],
      ...(listing.funding_url ? [["funding", listing.updated_at.toISOString(), listing.funding_provider ?? "external", "", listing.funding_url, ""]] : []),
      ...(listing.contribution_url ? [["opportunity", listing.updated_at.toISOString(), "contribution_request", "", listing.contribution_note ?? "", listing.contribution_url]] : []),
    ] : []),
    ["campaign", listing.updated_at.toISOString(), "net_settled_total", (Number(listing.total_cents) / 100).toFixed(2), "", ""],
    ["campaign", listing.updated_at.toISOString(), "category_rank", "", listing.category_rank, ""],
    ["campaign", listing.updated_at.toISOString(), "overall_rank", "", listing.overall_rank, ""],
    ["campaign", listing.updated_at.toISOString(), "verified_contributions", "", listing.bid_count, ""],
    ["campaign", listing.updated_at.toISOString(), "verified_outbound", "", listing.outbound_clicks, ""],
    ...ledger.map((entry) => ["ledger", entry.created_at.toISOString(), entry.entry_type, (entry.amount_cents / 100).toFixed(2), "", entry.public_reference]),
    ...moderation.map((entry) => ["moderation", entry.created_at.toISOString(), entry.action, "", `${entry.previous_status}->${entry.next_status}: ${entry.public_note}`, entry.reason_code]),
    ...traffic.map((entry) => ["traffic", listing.updated_at.toISOString(), entry.decision, "", entry.count, ""]),
  ];
  const body = rows.map((row) => row.map(csv).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bidstage-${listing.slug}-campaign.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
