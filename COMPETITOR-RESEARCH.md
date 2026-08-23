# Bidstage competitor research

Research date: 24 August 2026

## Scope and evidence standard

This review covers the public, crawlable product surfaces of Outbid and Bidtree.
It separates direct observation from third-party reporting. It does not claim
access to private source code, private APIs, analytics accounts, payment
dashboards, or database infrastructure.

## Outbid

### Public product model

The [Outbid home page](https://outbid.lol/) is a paid URL leaderboard with two
views: an all-time ranking and a rolling 24-hour ranking labeled Today. The
public board shows position, product, total spend, category, and recent activity.
The observed board paginates at 50 entries per page.

The [published rules](https://outbid.lol/rules) state:

- the minimum bid is USD 5, bids use whole-dollar amounts, and the listed maximum
  is USD 999,999;
- taking first place requires at least USD 5 more than the current leader, while
  smaller payments receive the highest rank their total can reach;
- an owner can add spend to the same URL by paying the difference;
- equal totals favor the older bid;
- URL paths are distinct, query parameters are removed, and URL shorteners are
  resolved;
- group-chat and adult-content destinations are prohibited.

The [About page](https://outbid.lol/about) frames the service as a transparent
alternative to opaque advertising. The value proposition is attention through a
public paid order, not a quality score.

### Page and crawl architecture

Observed public routes include:

| Route | Purpose |
| --- | --- |
| `/` | all-time and rolling-day boards, recent activity, and bid entry |
| `/about` | product explanation |
| `/rules` | pricing, ordering, URL, and content rules |
| `/categories` | crawlable category directory |
| `/category/<slug>` | category-specific ranked board |
| `/product/<slug>` | individual paid-placement record |

The [category index](https://outbid.lol/categories) and a sampled
[category page](https://outbid.lol/category/ai-agents-infrastructure) create
stable topic paths. A sampled [product page](https://outbid.lol/product/see.io)
shows spend, category rank, overall rank, clicks, a current outbid amount, and a
share-link control. Category and product links create a useful internal-link
graph from broad topics to individual records.

This is a sound programmatic SEO shape because each public URL has a distinct
search intent and real marketplace data. It does not prove search quality by
itself. Useful parts are stable slugs, server-rendered records, descriptive page
titles, category hubs, product detail pages, and pagination. The review could not
verify Search Console data, backlinks, conversion data, `robots.txt`, or the XML
sitemap, so no traffic or indexing claim is made.

### API and implementation boundary

No public developer API or API documentation was discovered in the indexed
pages reviewed. That means only that no supported public API was found. The web
application can still use private route handlers or server actions.

The official pages do not publish a source repository or authoritative stack
diagram. Third-party case studies report a Next.js application built from a
Supastarter base, PostgreSQL persistence, Polar merchant-of-record payments,
signed webhooks, and transaction or lock-based bidding updates. Those details
are plausible but remain unverified secondary reporting:

- [Automatio case study](https://automatio.ai/apps/outbid-lol/)
- [Supastarter customer page](https://supastarter.dev/customers/outbid)

An independent community thread described the early product as having no public
API and no revenue sharing. That historical comment is not evidence of the
current private architecture or commercial terms.

### Likely request and data flow

The following is an inference from the public behavior, not confirmed source
code:

1. A buyer submits a URL, category, and amount.
2. Server-side validation normalizes the URL and calculates an attainable rank.
3. A hosted payment checkout collects the charge.
4. A signed provider event marks the payment settled.
5. One transactional update creates or increments the product total.
6. Public board, category, product, and activity queries read the new state.
7. Redirect or click routes count traffic before sending the visitor onward.

A production implementation needs idempotent webhook storage, a unique payment
claim, row locking or a serializable transaction around the total, deterministic
tie ordering, refund and dispute reversals, URL-safety checks, and bot-resistant
click counting. Public behavior alone cannot confirm which controls Outbid uses.

## Bidtree

`bidtree.lol` did not return an indexable result through the research tools, and
the environment could not establish a trusted page response. No page inventory,
rules, metadata, sitemap, API, framework, payment provider, or data model could
be verified. This is an evidence gap, not a claim that the service is offline.
A later review should start with a successful browser capture and response-header
record before drawing product or architecture conclusions.

## Decisions for Bidstage

### Adopted

- crawlable `/categories` and `/category/<slug>` pages backed by active project
  records;
- unique metadata and canonical URLs for each active project record;
- a database-backed XML sitemap with static fallbacks during storage outages;
- crawler rules that exclude APIs, account screens, redirects, receipts, and
  private support;
- category-to-project internal links and project-to-category breadcrumbs;
- paid position labeled as paid position on every ranking surface.

### Keep distinct

- Bidstage accepts owner-verified, OSI-licensed GitHub projects, not arbitrary
  URLs;
- signed settlement, refunds, and disputes feed an append-only public rank ledger;
- DNS ownership, destination scanning, moderation, and continuing DNS checks gate
  public visibility;
- direct GitHub Sponsors and Open Collective links remain separate from the
  placement charge and do not affect rank;
- country pages connect projects, repository-bound opportunities, and opt-in
  contributors without ranking people or work by spend;
- project records expose rank history and counted versus excluded traffic, not a
  single unexplained click number.

### Not adopted

- a rolling 24-hour board is deferred until Bidstage has enough real settlement
  volume to make the view useful;
- arbitrary URL submission would weaken the open-source ownership and license
  boundary;
- revenue claims, visitor claims, and live counters never appear without
  authoritative data;
- secondary reports about a competitor's stack or revenue are not product proof.

## Follow-up research

- capture Bidtree in a real browser if its hostname becomes reachable;
- inspect rendered metadata, canonical tags, structured data, response headers,
  pagination links, robots rules, and sitemaps for both competitors;
- record mobile and keyboard behavior for each checkout and ranking flow;
- repeat the public-route inventory quarterly because marketplace pages and
  commercial terms change.
