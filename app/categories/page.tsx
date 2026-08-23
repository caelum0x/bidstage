import type { Metadata } from "next";
import { connection } from "next/server";

import { query } from "@/lib/db";
import { CATEGORIES, type Category } from "@/lib/market";
import { categoryContent } from "@/lib/category-content";

export const metadata: Metadata = {
  title: "Open-source project categories",
  description: "Browse Bidstage's owner-verified, OSI-licensed open-source project rankings by software category.",
  alternates: { canonical: "/categories" },
};

type CategoryCountRow = { category: Category; projects: string; placement_cents: string };

export default async function CategoriesPage() {
  await connection();
  let rows: CategoryCountRow[] | null = null;
  try {
    rows = await query<CategoryCountRow>(
      `SELECT category, count(*)::text AS projects,
              coalesce(sum(total_cents), 0)::text AS placement_cents
       FROM listings
       WHERE status = 'active' AND product_kind = 'open_source'
       GROUP BY category`,
    );
  } catch {
    // Category definitions remain indexable while live totals stay unavailable.
  }
  const byCategory = new Map(rows?.map((row) => [row.category, row]));

  return (
    <main className="categories-page" id="main-content">
      <nav className="receipt-nav shell" aria-label="Primary navigation"><a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a><div><a href="/#board">Projects</a><a href="/bids">How bidding works</a><a href="/countries">Countries</a><a href="/contributors">Contributors</a></div></nav>
      <header className="category-index-hero shell"><span>Verified open-source discovery</span><h1>Project categories.</h1><p>Each category uses the same public rule: active projects rank by net settled placement total, with older totals winning ties.</p></header>
      <section className="category-index-grid shell" aria-label="Open-source project categories">
        {CATEGORIES.map((category, index) => {
          const item = categoryContent(category);
          const totals = byCategory.get(category);
          return <article key={category}><span>{String(index + 1).padStart(2, "0")}</span><h2><a href={`/category/${category}`}>{item.label}</a></h2><p>{item.description}</p><dl><div><dt>Active projects</dt><dd>{totals?.projects ?? "—"}</dd></div><div><dt>Net placement</dt><dd>{totals ? money(totals.placement_cents) : "—"}</dd></div></dl></article>;
        })}
      </section>
      <footer className="shell"><div className="brand"><span className="brand-mark">B</span>bidstage</div><p>Owner-verified open-source discovery.</p><div><a href="/#top">List a project</a><a href="/legal/rules">Rules</a></div></footer>
      <div className="noise" aria-hidden="true" />
    </main>
  );
}

function money(cents: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(cents) / 100);
}
