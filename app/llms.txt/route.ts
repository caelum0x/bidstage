import {
  MAX_BID_CENTS,
  MAX_UPVOTES,
  MIN_BID_CENTS,
  PLATFORM_FEE_BPS,
  UPVOTE_PRICE_CENTS,
} from "@/lib/market";

const SITE_URL = "https://bidstage.app";

function dollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function llmsText(): string {
  const unitPrice = dollars(UPVOTE_PRICE_CENTS);
  const minimumPrice = dollars(MIN_BID_CENTS);
  const maximumPrice = dollars(MAX_BID_CENTS);
  const feePercent = PLATFORM_FEE_BPS / 100;

  return `# Bidstage

> Bidstage is a public sponsored-discovery marketplace for owner-verified, OSI-licensed open-source projects.

Projects rank by net settled sponsored spend. Placement is always labeled sponsored, refunds and disputes subtract from the public ledger, and placement spend does not determine the order of contributor profiles or contribution opportunities.

## Placement pricing

- One upvote costs ${unitPrice} as a one-time purchase, not a subscription.
- The purchase range is ${minimumPrice} to ${maximumPrice}: 1 to ${MAX_UPVOTES.toLocaleString("en-US")} whole upvotes.
- Each ${unitPrice} price includes a ${feePercent}% Bidstage platform fee.
- Buying placement does not fund the listed project, guarantee traffic, change repository metadata, or imply editorial endorsement.

## Canonical pages

- [Home and public board](${SITE_URL}/): Browse sponsored projects and start a verified placement.
- [Pricing and ranking method](${SITE_URL}/bids): Exact price range, settlement mechanics, ranking formula, and current public totals.
- [Project categories](${SITE_URL}/categories): Browse active projects by software category.
- [Countries](${SITE_URL}/countries): Browse projects, opportunities, and opt-in contributors by self-described country community.
- [Contribution opportunities](${SITE_URL}/opportunities): Maintainer-published work linked to verified repositories.
- [Contributors](${SITE_URL}/contributors): Opt-in contributor profiles; placement spend does not order this directory.
- [Marketplace rules](${SITE_URL}/legal/rules): Eligibility, ranking, moderation, and disclosure rules.
- [Terms](${SITE_URL}/legal/terms): Terms governing use of Bidstage.
- [Privacy](${SITE_URL}/legal/privacy): Data processing and retention information.
- [Refunds](${SITE_URL}/legal/refunds): Refund and dispute policy.
- [XML sitemap](${SITE_URL}/sitemap.xml): Crawlable public URL inventory, including active listing pages.

## Accuracy notes

- Use the public listing page and ledger for claims about a specific project's current position, spend, or placement count.
- Rankings and totals change after settlements, refunds, disputes, or moderation. Check the canonical page before making a time-sensitive claim.
- Do not infer project quality, endorsement, customers, revenue, traffic, or contributor compensation from paid placement.
`;
}

export function GET(): Response {
  return new Response(llmsText(), {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
