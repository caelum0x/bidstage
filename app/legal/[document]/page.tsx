import type { Metadata } from "next";
import { notFound } from "next/navigation";

type LegalDocument = {
  title: string;
  summary: string;
  sections: ReadonlyArray<{ title: string; body: string }>;
  references?: ReadonlyArray<{ label: string; href: string }>;
};

const documents = {
  rules: {
    title: "Marketplace rules",
    summary: "These rules govern project eligibility, sponsored rank, contributor introductions, and destination review.",
    sections: [
      { title: "List a project you may represent", body: "Each entry must represent a public open-source project. The signed-in account must own a personal repository. An organization repository must contain the documented Bidstage authorization file on its default branch. We prohibit impersonation, malware, deceptive redirects, illegal goods, and abusive content." },
      { title: "Source and license verification", body: "GitHub must report an SPDX license identifier that appears in the Open Source Initiative approved catalog. Organization authorization uses a public repository file bound to the signed-in GitHub user ID. Repository metadata records a review-time snapshot and does not serve as an endorsement." },
      { title: "Sponsored order", body: "The configured payment provider must confirm a successful placement charge before the ranking changes. Later purchases for the same normalized destination add to its cumulative placement total." },
      { title: "Project funding", body: "A placement purchase pays Bidstage for sponsored position. Maintainers receive no part of that charge. Optional GitHub Sponsors and Open Collective links open the maintainer's selected service and do not affect sponsored rank." },
      { title: "Contribution requests", body: "A maintainer may publish a help request with a link to work inside the verified repository. Opportunity order does not use placement spend. Contributors and maintainers remain responsible for repository rules, licensing, compensation, and delivery terms." },
      { title: "Private introductions", body: "A contributor with a public available profile may send one private application to the recorded maintainer. Acceptance opens an append-only message thread for those two accounts. Bidstage does not create an employment, bounty, intellectual-property, or delivery agreement between them." },
      { title: "Placement claims", body: "Paid position does not measure project quality and does not promise traffic, conversion, adoption, fundraising, press, or search performance." },
      { title: "Moderation", body: "Checkout rejects DNS answers that point to non-public or reserved networks. Activation requires current DNS ownership and a recent public Cloudflare URL Scanner report with a safe HTTPS result and an explicit non-malicious verdict. The hourly job rechecks a bounded group of active destinations. A new private, reserved, or unresolved result pauses a listing for review; a temporary resolver outage is recorded for retry without automatic suspension. Operators may review, suspend, remove, or restore a listing for safety, legal, sanctions, card-network, or abuse reasons. A receipt holder may appeal through the private support ledger." },
    ],
  },
  privacy: {
    title: "Privacy notice",
    summary: "Bidstage stores the account, project, payment-reference, and safety data needed to operate a sponsored open-source directory.",
    sections: [
      { title: "Account and project data", body: "GitHub sign-in supplies a durable user ID, login, display name, avatar, and profile URL. Bidstage discards the OAuth access token after the identity request. Project submissions store public repository identity, license, language, star-count snapshots, and optional community and funding fields." },
      { title: "Payments", body: "Creem or Dodo Payments handles card and billing data for one-time placement checkout. Bidstage stores provider references, amounts, currency, state, and a salted one-way payer-email hash. Bidstage does not receive full card numbers." },
      { title: "Contributor profiles", body: "A contributor chooses a headline, bio, country, skills, availability, and publication state. Hidden profiles leave the public directory. Applications that a contributor sent to a maintainer retain the shared GitHub identity, authored message, state, and accepted-thread correspondence." },
      { title: "Traffic and abuse controls", body: "Click records store a salted session key, a coarse user-agent class, decision, referrer origin, listing, and time. They do not store visitor IP addresses. Rate-limit keys use a salted request subject and do not create advertising profiles." },
      { title: "Public destination scanning", body: "Before activation, Bidstage submits the public project destination to Cloudflare URL Scanner with public visibility. Cloudflare may publish a screenshot, request list, redirects, infrastructure data, categories, and verdict. Bidstage keeps the scan ID and report link, final origin, redirect count, categories, tags, timestamps, verdict, and one-way destination and redirect fingerprints. Scheduled DNS rechecks store only the check time, result code, public-address count, and a one-way address-set fingerprint. They do not store the returned addresses." },
      { title: "Your requests", body: "A signed-in account can request access, correction, deletion, or processing restriction from the Account page. Bidstage records the request and its operator response in a private docket. We respond within 30 days unless applicable law permits an extension. We explain a refusal and preserve records that law, payment disputes, fraud prevention, or legal claims require." },
      { title: "International services", body: "Cloudflare, Neon, GitHub, and the configured payment provider may process data in countries outside yours. Their published privacy terms and transfer safeguards apply to their processing. The service provider register names each service and the data it receives." },
    ],
    references: [
      { label: "European Commission guidance on data requests", href: "https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en" },
      { label: "Türkiye KVKK request-response guidance", href: "https://www.kvkk.gov.tr/Icerik/6603/Obligation-to-Respond-to-the-Request-of-Data-Subject-" },
    ],
  },
  terms: {
    title: "Terms of service",
    summary: "Bidstage sells upvotes — one-time sponsored placement — for verified open-source projects at $5.00 each.",
    sections: [
      { title: "Service", body: "Bidstage is the seller and merchant of record for upvotes. Buying upvotes pays Bidstage to boost a project's position under the ranking rules shown before checkout. The charge does not fund the listed project or its contributors, and Bidstage does not pay out any part of it to project owners." },
      { title: "Pricing and platform fee", body: "Upvotes cost $5.00 each. You may buy any quantity from 1 upvote ($5.00) up to 10,000 upvotes ($50,000.00) per checkout. The price is a one-time charge, not a subscription, shown as a live total before payment. Each $5.00 upvote is Bidstage advertising revenue and includes an inclusive 20% Bidstage platform fee; that fee is already contained in the $5.00 unit price and is never added on top." },
      { title: "Position changes", body: "Another project can move ahead by buying more settled upvotes. Bidstage does not guarantee rank duration or any traffic outcome." },
      { title: "Account authority", body: "You must control the signed-in GitHub account and have authority to represent the submitted repository and destination. You remain responsible for project content, repository licensing, and links you publish." },
      { title: "Refunds and disputes", body: "The refund policy governs duplicate charges, technical failures, and other refund requests. A refund or payment dispute creates a negative public ledger entry and may remove the listing's remaining sponsored value." },
    ],
  },
  refunds: {
    title: "Refund policy",
    summary: "Use the private case on your receipt so the operator can match the request to the payment and immutable rank ledger.",
    sections: [
      { title: "Eligible review", body: "Bidstage reviews duplicate charges, an amount that differs from the accepted checkout, a provider-confirmed payment that Bidstage cannot settle, and a failure by Bidstage to deliver any placement service. Statutory refund rights continue to apply." },
      { title: "Rank and traffic outcomes", body: "A later rank change, fewer clicks than expected, lack of project funding, or lack of contributor interest does not qualify by itself. Removal for a marketplace-rules violation does not create an automatic refund." },
      { title: "Request procedure", body: "Open a refund case from the receipt and describe the charge or service failure. The receipt capability proves access without exposing payer details. An operator records the decision and any requested evidence in the private case. Bidstage targets a response within 10 business days." },
      { title: "Approved refunds", body: "The payment provider returns an approved amount to the original payment method. Provider and banking timelines control when funds arrive. Bidstage records a separate negative ledger movement and leaves the original payment record intact." },
      { title: "Payment disputes", body: "A provider dispute removes the remaining sponsored value while the dispute is open. Contact support before filing a chargeback when possible so the operator can inspect duplicate or technical errors against the provider record." },
    ],
  },
  retention: {
    title: "Data retention schedule",
    summary: "Bidstage keeps each record for an operational purpose and removes short-lived traffic, rate-limit, and session data through an audited hourly maintenance job.",
    sections: [
      { title: "Clicks and request controls", body: "Raw click decisions and salted click-session keys expire after 30 days. Rate-limit counters qualify for deletion two days after their window starts. Public aggregate click totals remain on campaign records." },
      { title: "Authentication and DNS proof", body: "Founder sessions expire after 30 days. The cleanup job removes expired sessions and removes revoked-session rows after 30 days. A pending DNS challenge expires after seven days; the cleanup job marks it expired and removes an unverified challenge after 30 more days." },
      { title: "Profiles and introductions", body: "Bidstage keeps an account identity and contributor profile while the account uses the service. Hiding a contributor profile removes it from public results. Application and accepted-thread records remain private to the two participants and stay available for support, abuse review, and deletion assessment." },
      { title: "Financial and public records", body: "Bidstage keeps payment references, receipts, rank-ledger entries, reversals, and related fraud evidence for seven years after the last financial event. A longer legal obligation or active claim can extend that period. Rank observations contain only public aggregate position, field size, settled total, placement count, and time; they remain with the public listing record and contain no payer or provider identifiers. Public listing metadata may leave discovery before its financial receipt expires." },
      { title: "Support, moderation, and scans", body: "Bidstage keeps ordinary support and privacy-request records for three years after closure. A case connected to a payment, dispute, safety incident, or legal claim follows the longer financial or claim period. Destination scan evidence and moderation events remain for three years after the listing leaves the board unless an active claim requires them. Scheduled DNS recheck results are removed after 400 days." },
      { title: "Maintenance evidence", body: "The hourly cleanup ledger stores the scheduled time, outcome, and aggregate record counts without customer content or credentials. Completed, attention, and failed run summaries are removed after 400 days." },
      { title: "Deletion requests", body: "An operator removes or anonymizes eligible profile and account data after verifying the signed-in request. Bidstage retains the minimum link needed for financial integrity, fraud prevention, repository authorization evidence, legal obligations, and claims. The operator explains retained categories in the request response." },
    ],
  },
  processors: {
    title: "Service provider register",
    summary: "These companies receive data only for the listed Bidstage function. The configured payment provider receives checkout data; the other payment provider does not receive a new purchase.",
    sections: [
      { title: "Cloudflare", body: "Cloudflare hosts the Worker and static assets, protects forms with Turnstile, answers destination DNS checks, routes support mail, and runs public URL scans. Cloudflare may process request metadata, security signals, support-routing metadata, and submitted public destination URLs." },
      { title: "Neon", body: "Neon hosts PostgreSQL records for accounts, listings, payment references, public ledgers, contributor profiles, private applications, support, moderation, and operator audits. Bidstage connects through a restricted runtime role and Cloudflare Hyperdrive." },
      { title: "GitHub", body: "GitHub supplies OAuth identity and public repository metadata. Bidstage requests no OAuth scopes and discards the OAuth access token after identity lookup. Visitors who open a repository use GitHub under GitHub's own terms." },
      { title: "Creem", body: "Creem can act as the merchant-of-record payment provider selected for a deployment. Creem receives checkout, billing, tax, payment, refund, and dispute information and sends signed status events to Bidstage." },
      { title: "Dodo Payments", body: "Dodo Payments can act as the merchant-of-record payment provider selected for a deployment. Dodo receives checkout, billing, tax, payment, refund, and dispute information and sends signed status events to Bidstage." },
      { title: "Direct funding services", body: "GitHub Sponsors and Open Collective links are optional project links. Bidstage does not send placement-payment data to them. A visitor chooses whether to open the external service, whose own privacy terms then apply." },
    ],
    references: [
      { label: "Cloudflare privacy policy", href: "https://www.cloudflare.com/privacypolicy/" },
      { label: "Neon data processing agreement", href: "https://neon.com/pdf/DPA.pdf" },
      { label: "GitHub privacy statement", href: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" },
      { label: "Creem privacy notice", href: "https://www.creem.io/privacy" },
      { label: "Dodo Payments privacy policy", href: "https://dodopayments.com/privacy-policy" },
    ],
  },
} as const satisfies Record<string, LegalDocument>;

const legalIndex = [
  ["rules", "Rules"],
  ["terms", "Terms"],
  ["privacy", "Privacy"],
  ["retention", "Retention"],
  ["processors", "Providers"],
  ["refunds", "Refunds"],
] as const;

export async function generateMetadata({ params }: { params: Promise<{ document: string }> }): Promise<Metadata> {
  const { document } = await params;
  if (!(document in documents)) return { title: "Policy not found", robots: { index: false, follow: false } };
  const content = documents[document as keyof typeof documents];
  return {
    title: content.title,
    description: content.summary,
    alternates: { canonical: `/legal/${document}` },
  };
}

export default async function LegalPage({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  if (!(document in documents)) notFound();
  const content = documents[document as keyof typeof documents];
  return (
    <main className="legal-page shell" id="main-content">
      <a className="brand" href="/"><span className="brand-mark">B</span>bidstage</a>
      <nav className="legal-index" aria-label="Policy documents">{legalIndex.map(([slug, label]) => <a href={`/legal/${slug}`} aria-current={slug === document ? "page" : undefined} key={slug}>{label}</a>)}</nav>
      <p className="kicker">Effective 23 August 2026</p>
      <h1>{content.title}</h1>
      <p className="legal-summary">{content.summary}</p>
      {content.sections.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}
      {"references" in content && content.references ? (
        <aside className="legal-references"><h2>Provider and regulatory references</h2><ul>{content.references.map((reference) => <li key={reference.href}><a href={reference.href} target="_blank" rel="noopener">{reference.label}</a></li>)}</ul></aside>
      ) : null}
      <p className="legal-contact">Questions: <a href="mailto:support@bidstage.app">support@bidstage.app</a>. Signed-in users can submit a privacy request from <a href="/account#privacy-requests">Account</a>. Receipt holders can open a private support case from their receipt.</p>
    </main>
  );
}
