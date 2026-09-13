import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  categoryContent,
  categoryPageDescription,
  categoryPageTitle,
  isCategory,
} from "@/lib/category-content";
import { query } from "@/lib/db";
import { DirectoryExplainer } from "@/components/directory-explainer";

type CategoryPageProps = { params: Promise<{ category: string }> };

type CategoryProjectRow = {
  rank: string;
  slug: string;
  title: string;
  github_owner: string;
  github_name: string;
  github_description: string | null;
  github_primary_language: string | null;
  github_license_spdx: string;
  total_cents: string;
  bid_count: number;
  outbound_clicks: string;
};

function checkedCategory(value: string) {
  if (!isCategory(value)) notFound();
  return value;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const category = checkedCategory((await params).category);
  return {
    title: categoryPageTitle(category),
    description: categoryPageDescription(category),
    alternates: { canonical: `/category/${category}` },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  await connection();
  const category = checkedCategory((await params).category);
  const content = categoryContent(category);
  let projects: CategoryProjectRow[] | null = null;
  try {
    projects = await query<CategoryProjectRow>(
      `SELECT row_number() OVER (
                ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
              )::text AS rank,
              slug, title, github_owner, github_name, github_description,
              github_primary_language, github_license_spdx,
              total_cents::text, bid_count, outbound_clicks::text
       FROM listings
       WHERE status = 'active' AND product_kind = 'open_source' AND category = $1
       ORDER BY total_cents DESC, last_bid_at ASC, slug ASC
       LIMIT 100`,
      [category],
    );
  } catch {
    // The category explanation remains available during a database outage.
  }

  return (
    <main className="category-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a><div><a href="/categories">All categories</a><a href="/#board">Projects</a><a href="/bids">How bidding works</a><a href="/account">Account</a></div></nav>
      <header className="category-ledger-hero shell"><span>Open-source category ledger</span><h1>{content.label}.</h1><p>{content.description}</p><aside><strong>{projects?.length ?? "—"}</strong><span>active projects shown</span></aside></header>
      <DirectoryExplainer
        eyebrow={content.label + " board guide"}
        id="category-board-guide"
        title={"How to read the " + content.label + " ranking."}
      >
        <p>
          This board includes active, owner-verified repositories filed under{" "}
          {content.label.toLowerCase()}. Each row identifies the GitHub
          repository, detected open-source license, primary language, disclosed
          net placement, placement count, and verified outbound visits. Open the
          project record before following its destination.
        </p>
        <p>
          Net settled sponsored spend determines position inside this category;
          an older total wins when two projects have the same amount. A refund
          or successful dispute reverses the affected contribution in the public
          ledger. Payment cannot change GitHub metadata or hide the sponsored
          label.
        </p>
        <p>
          Use rank to understand purchased visibility, not software merit.
          Evaluate the repository activity, documentation, license, security
          posture, and fit for your use case yourself. Contribution requests and
          contributor profiles follow separate, non-paid ordering rules.
        </p>
      </DirectoryExplainer>
      <section className="category-ledger" aria-labelledby="category-ranking-heading"><div className="shell"><div className="category-ledger-heading"><div><span>Net settled order</span><h2 id="category-ranking-heading">Current category ranking</h2></div><a href="/#top">Place a project</a></div>
        {projects?.length ? <ol>{projects.map((project) => <li key={project.slug}><span>#{project.rank.padStart(2, "0")}</span><div><small>{project.github_owner}/{project.github_name} · {project.github_license_spdx}</small><h3><a href={`/listing/${project.slug}`}>{project.title}</a></h3><p>{project.github_description ?? "The repository has no public description."}</p></div><dl><div><dt>Net placement</dt><dd>{money(project.total_cents)}</dd></div><div><dt>Placements</dt><dd>{project.bid_count}</dd></div><div><dt>Verified visits</dt><dd>{project.outbound_clicks}</dd></div><div><dt>Language</dt><dd>{project.github_primary_language ?? "Not reported"}</dd></div></dl></li>)}</ol> : <div className="category-ledger-empty"><strong>{projects ? "No active projects in this category." : "Live ranking unavailable."}</strong><p>{projects ? "An owner-verified project appears here after signed payment settlement and moderation." : "The public ranking will return when storage is available."}</p><a href="/#top">List an open-source project</a></div>}
      </div></section>
      <aside className="bid-rules-strip shell"><strong>Paid rank stays labeled.</strong><p>Placement total controls this category order. It does not measure code quality, maintainer activity, security, or contributor fit.</p><a href="/legal/rules">Read the rules</a></aside>
      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Public category rank, with receipts.</p><div><a href="/categories">Categories</a><a href="/contributors">Contributors</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}

function money(cents: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(cents) / 100);
}
