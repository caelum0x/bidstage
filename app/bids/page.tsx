import { connection } from "next/server";

import { query } from "@/lib/db";
import { MAX_BID_CENTS, MAX_UPVOTES, PLATFORM_FEE_BPS, UPVOTE_PRICE_CENTS } from "@/lib/market";

const UPVOTE_DOLLARS = UPVOTE_PRICE_CENTS / 100;
const PLATFORM_FEE_PERCENT = PLATFORM_FEE_BPS / 100;

export const metadata = {
  title: "Pricing — $5 per upvote",
  description: "Upvotes cost $5.00 each. Buy any quantity to boost a verified open-source project up Bidstage's public, settled ledger. One-time purchase, not a subscription.",
  alternates: { canonical: "/bids" },
};

type BidTotalsRow = {
  active_projects: string;
  placement_cents: string;
  placement_count: string;
};

type LeadingProjectRow = {
  rank: string;
  slug: string;
  title: string;
  category: string;
  total_cents: string;
  bid_count: number;
};

type BidGuideData = {
  totals: BidTotalsRow;
  leaders: LeadingProjectRow[];
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

async function bidGuideData(): Promise<BidGuideData> {
  const [totals, leaders] = await Promise.all([
    query<BidTotalsRow>(
      `SELECT count(*)::text AS active_projects,
              coalesce(sum(total_cents), 0)::text AS placement_cents,
              coalesce(sum(bid_count), 0)::text AS placement_count
       FROM listings
       WHERE status = 'active' AND product_kind = 'open_source'`,
    ),
    query<LeadingProjectRow>(
      `SELECT row_number() OVER (
                ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
              )::text AS rank,
              slug, title, category, total_cents::text, bid_count
       FROM listings
       WHERE status = 'active' AND product_kind = 'open_source'
       ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
       LIMIT 5`,
    ),
  ]);
  return {
    totals: totals[0] ?? { active_projects: "0", placement_cents: "0", placement_count: "0" },
    leaders,
  };
}

export default async function BidsPage() {
  await connection();
  let data: BidGuideData | null = null;
  try {
    data = await bidGuideData();
  } catch {
    // The guide remains useful during a database outage; live evidence stays blank.
  }

  return (
    <main className="bids-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation">
        <a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a>
        <div><a href="/#board">Projects</a><a href="/countries">Countries</a><a href="/opportunities">Opportunities</a><a href="/contributors">Contributors</a><a href="/account">Account</a></div>
      </nav>

      <header className="bid-guide-hero shell">
        <div className="bid-guide-heading">
          <span>Sponsored ranking for verified open source</span>
          <h1>${UPVOTE_DOLLARS} per upvote.<br /><em>Buy any amount.</em></h1>
          <p>Upvotes cost ${UPVOTE_DOLLARS}.00 each. Buy any quantity — 1 for ${UPVOTE_DOLLARS}, 20 for $100, 200 for $1,000, up to {money.format(MAX_BID_CENTS / 100)} ({MAX_UPVOTES.toLocaleString("en-US")} upvotes). Each upvote adds ${UPVOTE_DOLLARS} to the project only after the payment provider sends a valid signed settlement event. The public board ranks active projects by net settled total. It&rsquo;s a one-time purchase, not a subscription.</p>
          <div className="bid-guide-actions"><a href="/#top">Buy upvotes</a><a href="/account">Add to an existing project</a></div>
        </div>
        <aside className="bid-boundary-note">
          <strong>Upvotes are advertising.</strong>
          <p>Each ${UPVOTE_DOLLARS} upvote buys a labeled position on Bidstage and is Bidstage revenue — including a {PLATFORM_FEE_PERCENT}% platform fee. It does not fund the project, guarantee traffic, or affect contributor ordering.</p>
        </aside>
      </header>

      <section className="bid-live-proof" aria-labelledby="bid-live-heading">
        <div className="shell">
          <div className="bid-live-heading"><div><span>Current public ledger</span><h2 id="bid-live-heading">The board uses settled records.</h2></div>{data ? null : <p role="status">Live totals are unavailable.</p>}</div>
          <dl className="bid-guide-metrics">
            <div><dt>Active projects</dt><dd>{data?.totals.active_projects ?? "—"}</dd></div>
            <div><dt>Net upvote volume</dt><dd>{data ? money.format(Number(data.totals.placement_cents) / 100) : "—"}</dd></div>
            <div><dt>Verified purchases</dt><dd>{data?.totals.placement_count ?? "—"}</dd></div>
            <div><dt>Price per upvote</dt><dd>{money.format(UPVOTE_PRICE_CENTS / 100)}</dd></div>
          </dl>

          <div className="bid-formula-slip" aria-label="Bidstage ranking formula">
            <span>Project accounting rule</span>
            <div><strong>current net total</strong><i>+</i><strong>upvotes × ${UPVOTE_DOLLARS}</strong><i>=</i><strong>projected total</strong></div>
            <p>Refund and dispute reversals subtract from the same public ledger. Bidstage uses net settled totals for rank.</p>
          </div>

          <ol className="bid-mechanics">
            <li><span>01</span><h3>Verify ownership</h3><p>Sign in with GitHub. Bidstage checks repository ownership or the committed organization authorization file, then confirms an OSI-approved license.</p></li>
            <li><span>02</span><h3>Choose upvotes</h3><p>Pick how many upvotes to buy at ${UPVOTE_DOLLARS} each. The server calculates projected category and overall positions from the settled ledger.</p></li>
            <li><span>03</span><h3>Complete payment</h3><p>The configured provider collects the exact amount — a one-time charge, not a subscription. Returning from checkout does not change rank.</p></li>
            <li><span>04</span><h3>Publish the entry</h3><p>A signed webhook settles the payment. New projects enter review; active projects receive another ledger entry.</p></li>
          </ol>
        </div>
      </section>

      <section className="bid-leaders shell" aria-labelledby="bid-leaders-heading">
        <div className="bid-leaders-heading"><div><span>Live position</span><h2 id="bid-leaders-heading">Current overall leaders</h2></div><a href="/#board">Open the full board</a></div>
        {data?.leaders.length ? (
          <ol>{data.leaders.map((project) => (
            <li key={project.slug}>
              <span>#{project.rank.padStart(2, "0")}</span>
              <div><small>Open source · {project.category}</small><h3><a href={`/listing/${project.slug}`}>{project.title}</a></h3></div>
              <dl><div><dt>Net total</dt><dd>{money.format(Number(project.total_cents) / 100)}</dd></div><div><dt>Placements</dt><dd>{project.bid_count}</dd></div></dl>
            </li>
          ))}</ol>
        ) : (
          <div className="bid-leaders-empty"><strong>No active projects yet.</strong><p>The first project appears after signed payment settlement and review.</p><a href="/#top">Start a placement</a></div>
        )}
      </section>

      <aside className="bid-rules-strip shell"><strong>Rank can move after your quote.</strong><p>Another settlement, refund, dispute, or moderation decision can change board position. Your receipt keeps the quoted position, final settlement, and later adjustments.</p><a href="/legal/rules">Read the placement rules</a></aside>
      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Transparent sponsored discovery for open-source projects.</p><div><a href="/legal/rules">Rules</a><a href="/legal/refunds">Refunds</a><a href="/account">Account</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}
