import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { query } from "@/lib/db";
import { PublicLedger, type PublicLedgerEntry } from "@/components/public-ledger";
import { RankTrail } from "@/components/rank-trail";
import { countryName, type CountryCode } from "@/lib/countries";
import { listingRankHistory } from "@/lib/rank-history";

export const dynamic = "force-dynamic";

type ListingRow = {
  id: string;
  slug: string;
  title: string;
  destination: string;
  category: string;
  product_kind: "commercial" | "open_source";
  github_owner: string | null;
  github_name: string | null;
  github_url: string | null;
  github_description: string | null;
  github_stars: number | null;
  github_license_spdx: string | null;
  github_primary_language: string | null;
  github_metadata_updated_at: Date | null;
  country_code: CountryCode | null;
  funding_provider: "github_sponsors" | "open_collective" | null;
  funding_url: string | null;
  github_verification_method: "personal_owner" | "repository_file" | null;
  contribution_url: string | null;
  contribution_note: string | null;
  total_cents: string;
  bid_count: number;
  outbound_clicks: string;
  last_bid_at: Date;
  category_rank: string;
  category_entries: string;
  overall_rank: string;
  overall_entries: string;
};

type LedgerRow = {
  id: string;
  entry_type: "contribution" | "refund_reversal" | "dispute_reversal";
  amount_cents: number;
  created_at: Date;
  public_reference: string;
};

type TrafficRow = {
  verified: string;
  excluded_bot: string;
  excluded_prefetch: string;
  excluded_repeat: string;
  excluded_non_navigation: string;
};

type ModerationRow = {
  action: "approve" | "restore";
  public_note: string;
  created_at: Date;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US");

type ListingMetadataRow = {
  title: string;
  github_description: string | null;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) return { robots: { index: false, follow: false } };
  try {
    const rows = await query<ListingMetadataRow>(
      `SELECT title, github_description
       FROM listings
       WHERE slug = $1 AND status = 'active' AND product_kind = 'open_source'
       LIMIT 1`,
      [slug],
    );
    const listing = rows[0];
    if (!listing) return { title: "Project not found", robots: { index: false, follow: false } };
    const description = metadataDescription(listing.title, listing.github_description);
    return {
      title: listing.title,
      description,
      alternates: { canonical: `/listing/${slug}` },
      openGraph: {
        type: "website",
        title: listing.title,
        description,
        url: `/listing/${slug}`,
      },
      twitter: { card: "summary", title: listing.title, description },
    };
  } catch {
    return { title: "Open-source project", robots: { index: false, follow: false } };
  }
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) notFound();

  const listings = await query<ListingRow>(
    `WITH category_ranks AS (
       SELECT id,
              row_number() OVER (PARTITION BY product_kind, category ORDER BY total_cents DESC, last_bid_at ASC, slug ASC)::text AS rank,
              count(*) OVER (PARTITION BY product_kind, category)::text AS entries
       FROM listings
       WHERE status = 'active'
     ),
     overall_ranks AS (
       SELECT id,
              row_number() OVER (PARTITION BY product_kind ORDER BY total_cents DESC, last_bid_at ASC, slug ASC)::text AS rank,
              count(*) OVER (PARTITION BY product_kind)::text AS entries
       FROM listings
       WHERE status = 'active'
     )
     SELECT listing.id, listing.slug, listing.title, listing.destination, listing.category,
            listing.product_kind, listing.github_owner, listing.github_name, listing.github_url,
            listing.github_description, listing.github_stars, listing.github_license_spdx,
            listing.github_primary_language, listing.github_metadata_updated_at,
            listing.country_code, listing.funding_provider, listing.funding_url,
            listing.github_verification_method,
            listing.contribution_url, listing.contribution_note,
            listing.total_cents::text, listing.bid_count, listing.outbound_clicks::text,
            listing.last_bid_at, category_ranks.rank AS category_rank,
            category_ranks.entries AS category_entries, overall_ranks.rank AS overall_rank,
            overall_ranks.entries AS overall_entries
     FROM listings AS listing
     JOIN category_ranks ON category_ranks.id = listing.id
     JOIN overall_ranks ON overall_ranks.id = listing.id
     WHERE listing.slug = $1 AND listing.status = 'active'
     LIMIT 1`,
    [slug],
  );
  const listing = listings[0];
  if (!listing) notFound();

  const [ledger, traffic, moderation, rankHistory] = await Promise.all([
    query<LedgerRow>(
      `SELECT ledger.id::text, ledger.entry_type, ledger.amount_cents,
              ledger.created_at, checkout.public_reference
       FROM rank_ledger AS ledger
       JOIN payment_checkouts AS checkout ON checkout.id = ledger.checkout_id
       WHERE ledger.listing_id = $1
       ORDER BY ledger.created_at DESC, ledger.id DESC
       LIMIT 26`,
      [listing.id],
    ),
    query<TrafficRow>(
      `SELECT
         count(*) FILTER (WHERE decision = 'verified')::text AS verified,
         count(*) FILTER (WHERE decision = 'excluded_bot')::text AS excluded_bot,
         count(*) FILTER (WHERE decision = 'excluded_prefetch')::text AS excluded_prefetch,
         count(*) FILTER (WHERE decision = 'excluded_repeat')::text AS excluded_repeat,
         count(*) FILTER (WHERE decision = 'excluded_non_navigation')::text AS excluded_non_navigation
       FROM click_events
       WHERE listing_id = $1 AND clicked_at >= now() - interval '30 days'`,
      [listing.id],
    ),
    query<ModerationRow>(
      `SELECT action, public_note, created_at
       FROM listing_moderation
       WHERE listing_id = $1 AND next_status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [listing.id],
    ),
    listingRankHistory(listing.id),
  ]);
  const trafficSummary = traffic[0] ?? {
    verified: "0",
    excluded_bot: "0",
    excluded_prefetch: "0",
    excluded_repeat: "0",
    excluded_non_navigation: "0",
  };
  const hostname = new URL(listing.destination).hostname.replace(/^www\./, "");
  const initialLedger = ledger.slice(0, 25).map<PublicLedgerEntry>((entry) => ({
    id: entry.id,
    entryType: entry.entry_type,
    amountCents: entry.amount_cents,
    createdAt: entry.created_at.toISOString(),
    receiptReference: entry.public_reference,
  }));
  const lastInitialLedger = initialLedger.at(-1);
  const initialCursor = ledger.length > 25 && lastInitialLedger
    ? Buffer.from(JSON.stringify({ at: lastInitialLedger.createdAt, id: lastInitialLedger.id })).toString("base64url")
    : null;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareSourceCode",
        name: listing.title,
        description: metadataDescription(listing.title, listing.github_description),
        url: `https://bidstage.app/listing/${listing.slug}`,
        codeRepository: listing.github_url,
        license: listing.github_license_spdx
          ? `https://spdx.org/licenses/${encodeURIComponent(listing.github_license_spdx)}.html`
          : undefined,
        programmingLanguage: listing.github_primary_language ?? undefined,
        dateModified: listing.github_metadata_updated_at?.toISOString() ?? listing.last_bid_at.toISOString(),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Projects", item: "https://bidstage.app/#board" },
          { "@type": "ListItem", position: 2, name: listing.category, item: `https://bidstage.app/category/${listing.category}` },
          { "@type": "ListItem", position: 3, name: listing.title, item: `https://bidstage.app/listing/${listing.slug}` },
        ],
      },
    ],
  };

  return (
    <main className="listing-page" id="main-content">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <nav className="receipt-nav shell" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="Bidstage home">
          <span className="brand-mark">B</span>bidstage
        </a>
        <a href="/#board">Return to board</a>
      </nav>

      <section className="listing-hero shell">
        <div className="receipt-index">Campaign record / {listing.slug}</div>
        <div className="listing-heading">
          <div>
            <span className="sponsored">Sponsored · {listing.product_kind === "open_source" ? "Open source" : "Commercial"} · <a href={`/category/${listing.category}`}>{listing.category}</a></span>
            <h1>{listing.title}</h1>
            <a href={`/go/${listing.slug}`} target="_blank" rel="sponsored noopener">
              {hostname}
            </a>
          </div>
          <div className="listing-total">
            <span>Net settled total</span>
            <strong>{money.format(Number(listing.total_cents) / 100)}</strong>
            <small>Last movement {formatDate(listing.last_bid_at)}</small>
            <a className="report-download" href={`/api/listings/${listing.slug}/report.csv`} download>Download campaign CSV</a>
          </div>
        </div>

        <div className="listing-metrics">
          <article><span>Category rank</span><strong>#{pad(listing.category_rank)}</strong><small>of {number.format(Number(listing.category_entries))} in {listing.category}</small></article>
          <article><span>{listing.product_kind === "open_source" ? "Open-source" : "Commercial"} rank</span><strong>#{pad(listing.overall_rank)}</strong><small>of {number.format(Number(listing.overall_entries))} active {listing.product_kind === "open_source" ? "open-source" : "commercial"} projects</small></article>
          <article><span>Verified placements</span><strong>{number.format(listing.bid_count)}</strong><small>net of fully reversed payments</small></article>
          <article><span>Verified outbound</span><strong>{number.format(Number(listing.outbound_clicks))}</strong><small>all-time filtered redirects</small></article>
        </div>
        {listing.product_kind === "open_source" && listing.github_url ? (
          <section className="source-proof">
            <div><span>Verified public source</span><strong>{listing.github_owner}/{listing.github_name}</strong><p>{listing.github_description ?? "No repository description provided."}</p><small className="source-verification">{listing.github_verification_method === "repository_file" ? "Organization repository authorized by committed .bidstage.json proof" : listing.github_verification_method === "personal_owner" ? "Personal repository owner matched to the signed-in GitHub account" : "Legacy source verification predates stored verification-method records"}</small></div>
            <dl><div><dt>License</dt><dd>{listing.github_license_spdx}</dd></div><div><dt>GitHub stars</dt><dd>{number.format(listing.github_stars ?? 0)}</dd></div><div><dt>Language</dt><dd>{listing.github_primary_language ?? "Not reported"}</dd></div><div><dt>Community</dt><dd>{listing.country_code ? <a href={`/country/${listing.country_code}`}>{countryName(listing.country_code)}</a> : "Global"}</dd></div></dl>
            <div className="source-actions"><a href={listing.github_url} target="_blank" rel="noopener">Contribute on GitHub</a>{listing.funding_url ? <a className="direct-funding" href={listing.funding_url} target="_blank" rel="noopener">Fund via {listing.funding_provider === "github_sponsors" ? "GitHub Sponsors" : "Open Collective"}</a> : null}</div>
          </section>
        ) : null}
        {listing.contribution_url && listing.contribution_note ? (
          <section className="project-opportunity"><span>Contribution opportunity</span><strong>{listing.contribution_note}</strong><p>This link points inside the verified GitHub repository and does not affect sponsored rank.</p><a href={listing.contribution_url} target="_blank" rel="noopener">Open contribution opportunity</a></section>
        ) : null}
        {moderation[0] ? (
          <p className="moderation-proof"><strong>Operator {moderation[0].action === "approve" ? "approved" : "restored"}</strong><span>{moderation[0].public_note}</span><time dateTime={moderation[0].created_at.toISOString()}>{formatDate(moderation[0].created_at)}</time></p>
        ) : null}
      </section>

      <section className="listing-ledger shell">
        <div className="ledger-heading">
          <div><span className="kicker">01 / money trail</span><h2>Rank ledger.</h2></div>
          <p>Positive entries increase sponsored rank. Refunds and disputes remain visible as negative entries. Payer identity is never public.</p>
        </div>
        <PublicLedger slug={listing.slug} initialEntries={initialLedger} initialCursor={initialCursor} />
      </section>

      {listing.product_kind === "open_source" ? (
        <RankTrail category={listing.category} points={rankHistory} slug={listing.slug} />
      ) : null}

      <section className="traffic-proof shell">
        <div><span className="kicker">03 / traffic method</span><h2>Clicks with a filter.</h2></div>
        <div className="traffic-copy">
          <p>The public total counts document navigations after excluding known automation, browser prefetches, non-navigation requests, and repeat visits to this product within 30 minutes.</p>
          <dl>
            <div><dt>Verified / 30 days</dt><dd>{number.format(Number(trafficSummary.verified))}</dd></div>
            <div><dt>Repeat excluded</dt><dd>{number.format(Number(trafficSummary.excluded_repeat))}</dd></div>
            <div><dt>Automation excluded</dt><dd>{number.format(Number(trafficSummary.excluded_bot) + Number(trafficSummary.excluded_prefetch) + Number(trafficSummary.excluded_non_navigation))}</dd></div>
          </dl>
        </div>
      </section>

      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Public sponsored placement, with receipts.</p><div><a href="/#top">Add a project</a><a href="/legal/rules">Rules</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}

function pad(value: string): string {
  return value.padStart(2, "0");
}

function formatDate(value: Date): string {
  return value.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

function metadataDescription(title: string, description: string | null): string {
  const value = description?.trim() || `${title} is an owner-verified, OSI-licensed open-source project ranked by net settled sponsored placement on Bidstage.`;
  return value.length <= 160 ? value : `${value.slice(0, 157).trimEnd()}…`;
}
