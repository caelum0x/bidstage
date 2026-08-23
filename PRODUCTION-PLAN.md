# Bidstage Production Architecture and Gap Plan

Last revised: 24 August 2026

## Product decision

Bidstage sells transparent sponsored placement on a public open-source discovery
board. A maintainer submits an owned public GitHub repository with an
OSI-approved license and a one-time placement budget. The payment event increases
that project's cumulative placement total. The board ranks active projects by
settled placement spend and labels the ranking as sponsored.

The first market covers English-language open-source software projects. The
product does not sell editorial endorsement, SEO ranking, investment exposure,
guaranteed traffic, or fabricated social proof.

## Reference boundary and differentiation

The screenshot reference shows a broad pay-to-rank board where a URL or social
handle can outbid the current leader. Bidstage keeps the understandable paid
placement mechanic, but it is not a reskin of that product.

| Reference mechanic | Bidstage production decision |
|---|---|
| One global leaderboard driven by the displayed bid | Software-only discovery with separate category boards and a clearly labeled overall sponsored board |
| A bid changes rank | A server quote previews the exact rank effect before checkout; settlement, reversals, and later rank changes are recorded in a public ledger |
| Raw click counter | Privacy-limited verified redirects with bot, prefetch, and rapid-repeat filtering; no conversion claim without customer evidence |
| URL or handle is enough to enter | Destination control proof, product metadata review, malware/phishing checks, takedown, and appeal |
| Snapshot of current price and rank | Versioned rank history, public payment receipt, category tenure, and a downloadable campaign report |
| Large visitor or online counters | No fabricated activity counters; only measured traffic with method and update time |

The customer advantage is accountable distribution. Before paying, a founder
sees the expected position and the rules that can change it. After paying, the
founder can prove settlement, view verified traffic, export results, request
support, and see any moderation or financial reversal without the platform
rewriting history.

Release one does not add an opaque recommendation score, token, resale market,
gambling mechanic, or traffic guarantee. Paid rank and editorial discovery stay
separate. A later editorial surface cannot accept payment.

## Domain decision

- Do not buy `bidstage.com`; an existing construction business uses that name.
- Primary launch candidate: `bidstage.app`.
- Standard-price `.com` fallbacks: `usebidstage.com` and `joinbidstage.com`.
- Immediately before purchase, run the registrar's real-time availability and
  price check. Proceed only when the result is registrable, standard tier, and
  both registration and annual renewal are at most USD 20.
- Domain status does not clear the brand. Trademark, company-name, social-handle,
  and product-confusion checks remain required.

## Current implementation audit

The directory contains a functional Next.js implementation, PostgreSQL schema,
payment checkout, signed provider fulfillment, destination normalization, a public
board, click redirect, legal pages, Docker deployment, and unit tests. It is more
than a frontend mock.

| Area | Current evidence | Production gap |
|---|---|---|
| Ranking | `listings.total_cents`, deterministic total/time/slug order, product-type and category filters, type-aware live rank quotes, immutable contribution/reversal ledger, public receipts, public moderation history, cursor-paginated campaign ledger, CSV export, compact hourly rank observations, bounded public history API, and an accessible 90-day campaign rank trail | Live staging evidence must prove the scheduled observation matches the authoritative rank |
| Checkout | Provider-neutral exact-price checkout with Creem and Dodo adapters, an internal idempotent intent, and public receipt reference | Selected-provider sandbox/live evidence remains |
| Fulfillment | Signed Creem and Dodo settlement/refund/dispute webhooks, provider-scoped event and checkout idempotency, immutable reversals, SQL transactions, persisted failure incidents, and provider-signed resend guidance | Sandbox reconciliation and signed-resend evidence remain |
| Listings and people | Open-source-only submission enforcement, GitHub-authenticated personal ownership or organization authorization through a committed user-bound proof file, SPDX detection and OSI-approved license checks, destination normalization, pre-checkout and pre-activation A/AAAA resolution with non-public/reserved network rejection and privacy-minimized audit fingerprints, bounded hourly DNS rechecks that pause newly unsafe destinations without suspending on resolver outages, activation-gated DNS ownership proof, public Cloudflare URL Scanner redirect/final-origin analysis and non-malicious verdict evidence, cumulative totals, country/language discovery, country community boards connecting sponsored projects, maintainer-authored work, and opt-in contributors without changing their independent ordering, direct GitHub Sponsors/Open Collective links outside ranking, opt-in contributor profiles, repository-bound contribution opportunities ordered independently of spend, private one-application-per-project introductions with maintainer accept/decline and contributor withdrawal, participant-only follow-up correspondence after acceptance, receipt-authenticated placement appeals, review-before-publication, version history, public campaign record, audited approve/suspend/remove/restore commands | Live scanner credential and staging evidence, continuous threat-reputation monitoring, and domain-age intelligence remain |
| Clicks | Privacy-salted per-listing sessions and append-only decisions exclude bots, prefetches, non-navigation requests, and 30-minute repeats; hourly scheduled and manual audited retention cleanup are available | Deeper anomaly review and live traffic evidence remain |
| Abuse | Cloudflare per-location burst limiting gates costly writes before database work with route-scoped, deployment-salted credential keys; exact PostgreSQL limits use validated proxy IPs or privacy-hashed coarse client hints, with audited stale-row cleanup | Destination submission abuse review beyond checkout Turnstile and live traffic evidence remain |
| Security | Input validation, DNS wire-format destination resolution with globally routable address enforcement, bounded continuing DNS checks with privacy-minimized evidence and audited suspension, remote Cloudflare URL Scanner redirect-chain/final-origin review with explicit verdict enforcement, CSP, HSTS, clickjacking/content-type/referrer/permissions headers, same-origin checkout policy, Cloudflare Turnstile with server-side action/hostname validation, receipt-scoped HttpOnly founder capabilities, privacy-hashed edge and database rate limits, raw-body webhook signatures, global keyboard focus treatment, skip navigation, AA paper-surface contrast, and disclosure/live-region semantics | Threat-reputation feeds, dependency remediation, authenticated operator web access, and real browser/screen-reader evidence remain |
| Privacy/legal | Rules, terms, privacy notice, service-provider register, retention schedule, operational refund procedure, hashed payer email, authenticated privacy-request docket, user cancellation, assigned operator resolution, scoped account-data minimization, and audited retention cleanup | Approved legal entity/controller details, counsel review, and live support address evidence remain |
| Operations | Health endpoint with provider, edge-limiter, and maintenance readiness; Docker health checks; migration job; audited moderation, support, privacy, and asynchronous URL-scan commands; an idempotent hourly maintenance ledger; append-only private support; read-only Creem/Dodo reconciliation; a fail-closed release auditor for migration hashes, runtime-role privileges, ledger, fulfillment, application, activation, privacy, maintenance, deployed policy, provider, binding, cache, and security-header evidence; a least-privilege GitHub verification workflow with ephemeral PostgreSQL; OpenNext Worker build, binding type generation, sampled structured Worker logs, and a validated upload artifact | First hosted CI evidence, external alert destinations, backup restore proof, rollback evidence, Neon/Hyperdrive binding, and public staging evidence remain |
| Tests | Thirty-four passing unit and structural checks cover URL handling, input, payment signatures, DNS rechecks, crawl boundaries, CI contracts, keyboard behavior, reduced motion, landmarks, and contrast. A separate fail-closed PostgreSQL suite applies all migrations and covers concurrent settlement, duplicate fulfillment, amount mismatch, concurrent cumulative refund, full refund, dispute, and ledger equality in CI. | The current sandbox cannot execute PostgreSQL or open a listening socket, so hosted CI must supply the first database and HTTP smoke results. Provider-signed webhook E2E, browser/axe, manual screen-reader, restore, and production smoke tests remain. |

## Approved production architecture

### Runtime

- Deploy the Next.js App Router through the current Cloudflare OpenNext adapter
  after a preview proof runs checkout, webhook raw-body verification, redirects,
  and PostgreSQL transactions in the Workers runtime.
- Set `nodejs_compat`, a current compatibility date, explicit CPU and subrequest
  limits, observability, and static asset bindings in `wrangler.jsonc`.
- Use the native `EDGE_WRITE_RATE_LIMITER` binding as a permissive, per-location
  burst gate before costly writes. Use route-specific keys derived from a
  deployment-salted credential hash; never send a raw cookie, token, or IP as a
  counter key. Keep PostgreSQL as the authoritative exact quota because edge
  counters are cached and eventually consistent.
- Keep a Docker deployment as a tested escape path until the Worker release
  passes two production upgrades and one rollback.

### Database

- Use Neon PostgreSQL as the source of truth.
- Connect `pg@8.16.3` through a Cloudflare Hyperdrive binding. Hyperdrive owns
  the global connection pool; the application caps its local pool at five so a
  request retains one outbound slot for payment or DNS work. Local scripts and the
  Docker escape path fall back to `DATABASE_URL`.
- Use separate migration and runtime roles. The runtime role cannot create,
  alter, or drop schema objects.
- Add point-in-time recovery or the approved Neon backup equivalent, a daily
  logical backup during launch, and a quarterly restore drill.

### Payments

- Select Creem or Dodo Payments with `PAYMENT_PROVIDER`; both use the same
  provider-neutral one-time placement boundary. Dodo requires a tax-inclusive
  USD Pay What You Want product, disables discounts and currency selection, and
  cannot be selected for production until its sandbox path passes. Neither provider may hold project funding,
  contributor bounties, escrow, or stored value.
- Keep the payment-provider boundary isolated from ranking logic. The domain receives
  normalized checkout, paid, refund, and dispute events without provider objects
  crossing into ranking logic.
- Verify the provider's raw webhook signature, claim the provider-scoped event
  ID, validate business/mode, product, amount, currency, and checkout/reference
  IDs, then settle in one database transaction.
- Store provider checkout, order/payment, transaction, refund, and dispute references.
  Handle retries and manual resends idempotently.
- The success redirect displays pending status until the signed webhook settles.
  It never increases rank from query parameters or client polling.

### Storage

Bidstage does not use R2 in the first release. Product logos use remote URLs only
after proxy/security review or ship as reviewed static assets. PostgreSQL holds
small receipts and audit events. This avoids storage operations and public-file
abuse within the shared Cloudflare budget.

## Required data changes

Add migrations for:

- `payment_checkouts`: provider, checkout ID, request ID, expected amount,
  currency, normalized destination, state, expiry, and timestamps;
- `payment_events`: provider event ID, event type, object ID, verified mode,
  processing state, attempt count, incident ID, and timestamps;
- `payment_adjustments`: refund/dispute IDs, amount, reason, state, and provider
  timestamps;
- `listing_versions`: title, category, destination display state, actor, reason,
  and effective time;
- `listing_moderation`: state, rule, evidence reference, operator, appeal state,
  and timestamps;
- `rank_ledger`: immutable settled contribution and reversal entries linked to
  payment objects;
- `click_sessions`: privacy-preserving deduplication key, bot/risk decision,
  listing, referrer origin, and retention expiry;
- `operator_audit_events`, `support_cases`, and `outbox_jobs`.
- `destination_security_reviews`: minimal public Cloudflare URL Scanner evidence,
  verdict state, final origin, redirect count, expiry, and privacy-safe fingerprints.
- `privacy_requests`: authenticated request type, private details, assigned
  operator state, response, and retention timestamps.
- `listing_rank_observations`: compact public overall/category position evidence
  recorded on change plus one unchanged daily checkpoint.

The public total comes from the immutable rank ledger. A refund or successful
dispute creates a reversal entry. Code does not rewrite payment history.

## Customer workflow

1. The maintainer signs in with GitHub and enters a project name, public
   destination, owned repository, category, and placement budget. The server
   verifies the public repository and its OSI-approved license.
2. Turnstile and server rate limits evaluate the submission. The server creates
   an internal checkout intent and a configured-provider checkout with a signed reference.
3. The configured provider collects payment. The return page shows pending settlement.
4. The signed webhook validates and settles the contribution. A new destination
   enters review or active state according to risk rules; an existing active
   destination receives the contribution.
5. The maintainer receives a public receipt with placement spend, listing, settlement
   time, rank effect, and support reference. The receipt excludes payer details.
6. Operators handle destination safety, takedown, appeal, refund, dispute, and
   failed webhook cases from a protected surface.

## Moderation and click integrity

- New destinations enter automated review for protocol, DNS/IP class, ownership,
  public Cloudflare URL Scanner redirect/final-origin and malware verdict, domain
  age/risk signal where lawful, and content-policy category. An operator decides
  ambiguous cases; an automated pass is not an endorsement or safety guarantee.
- Operators can suspend the redirect without deleting the financial receipt or
  rank ledger. Public pages explain removals without exposing private evidence.
- Click metrics exclude known bots, repeated rapid requests, prefetchers, and
  the listing owner test path. The board labels the number as verified outbound
  redirects, not unique humans or conversions.
- Raw click events expire on schedule. Aggregate counts remain. Bidstage does not
  create cross-site advertising profiles.

## Operator surface

The first operator interface can be a protected CLI plus an authenticated web
view. It must support:

- failed/unprocessed webhook lookup and safe replay;
- checkout-to-payment reconciliation;
- refund and dispute state;
- listing approve, suspend, remove, and restore with reason;
- destination history, appeal, and support lookup;
- click anomaly review;
- database backup and restore evidence;
- audit export and incident notes.
- privacy-request queue, claim, response, scoped account minimization, and
  retention evidence.

Operator access requires phishing-resistant MFA, least privilege, session
expiry, and immutable audit events. Direct production SQL is break-glass access.

## Cloudflare budget controls

- Share the account's $5 Workers Paid base. Bidstage receives no dedicated paid
  add-on.
- Cache static assets and short public board snapshots. Payment status and
  operator routes remain uncached.
- Set conservative CPU and subrequest limits. Payment webhooks, security events,
  and support paths retain capacity when optional analytics stop.
- Use the Workers rate-limit binding or an equivalent edge control before the
  PostgreSQL limiter. Turnstile protects anonymous checkout creation.
- Avoid R2, Queues, Workflows, Workers AI, Images, Stream, Vectorize, and Durable
  Objects in release one.
- Keep scheduled maintenance bounded and idempotent in PostgreSQL. Route
  `maintenance.attention` Worker logs to the launch alert destination; provider
  reconciliation remains read-only and requires signed webhook resend.

## Test and release gates

### Architecture proof

- Build and preview through OpenNext in the Workers runtime.
- Run Neon board reads, serializable settlement, duplicate event, and connection
  failure tests.
- Run the selected provider's test checkout, signed webhook, invalid signature, duplicate event,
  delayed event, refund, dispute, and manual resend tests.

### Production release

Bidstage launches after:

1. an outside founder completes a low-value live payment;
2. the signed event updates the ledger and board once;
3. the receipt, redirect, and verified click appear;
4. an operator suspends and restores the destination;
5. a refund creates a reversal without corrupting rank;
6. backup restore and deployment rollback pass;
7. accessibility, mobile browser, security, load, and dependency gates pass;
8. support, rules, terms, privacy, processor list, and refund policy contain the
   real entity and contact details;
9. monitoring detects a forced webhook failure and a stuck outbox job;
10. projected Cloudflare usage stays within its account allocation.

## Implementation order

1. Freeze provider-neutral payment and immutable rank-ledger specifications.
2. Complete Creem and Dodo sandbox checkout, signed settlement, refund, and dispute handling
   for differential tests.
3. Add moderation, operator audit, support, refund, dispute, and reconciliation
   schemas and protected operations.
4. Replace click counting with privacy-limited verification.
5. Bind Neon through Hyperdrive, deploy the already validated OpenNext artifact,
   and run the founder golden path on public staging.
6. Run complete sandbox, recovery, security, and external-user gates.
7. Switch production checkout to the selected provider and retain rollback until live evidence
   passes.

## Next-phase execution roadmap

### Phase 1 — Domain and customer support activation

**Deliverables**

- Wait for `bidstage.app` registration to become active and verify authoritative
  DNS plus HTTPS issuance.
- Onboard Email Routing, verify one private destination inbox, deploy
  `bidstage-support-mail`, and route only `support@bidstage.app` to it.
- Send a real inbound message from an unrelated mailbox and reply manually from
  the configured support identity.
- Revoke every Cloudflare credential previously pasted into chat and create new,
  task-scoped deployment credentials outside source control.

**Exit gate:** domain resolves, HTTPS is valid, support mail reaches a human, and
the legal pages contain a working contact channel.

### Phase 2 — Production data foundation

**Deliverables**

- Create separate Neon staging and production projects on the free plan while
  usage remains within its published limits.
- Create distinct migration and runtime roles. The runtime role receives only
  the table and sequence permissions required by the application.
- Apply all twenty-three migrations, connect the Worker through Hyperdrive, and confirm
  the direct database URL is not present in the application Worker.
- Document the accepted launch recovery point. Perform a restore drill before
  accepting money; keep a recoverable export outside the primary project.
- Configure spend notifications before enabling any paid database capacity.

**Exit gate:** health, read, transactional write, duplicate settlement, and
restore checks pass against staging with the restricted runtime role, and
`bun run audit:release` reports no failures.

### Phase 3 — Identity, abuse, and payment golden paths

**Deliverables**

- Register exact-callback GitHub OAuth applications for staging and production,
  keep OAuth scopes empty, configure the public-repository metadata token, and
  test personal-owner plus committed organization-authorization paths.
- Create hostname-restricted Turnstile widgets and confirm invalid hostname,
  missing token, and replay attempts fail closed.
- Configure the selected provider's sandbox product and signed webhook events.
  For Dodo, use a tax-inclusive USD Pay What You Want product and subscribe to
  `payment.succeeded`, `refund.succeeded`, and `dispute.opened`.
- Complete the open-source checkout flow, including repository ownership and
  OSI-license rejection, receipt recovery, DNS proof, public Cloudflare URL scan,
  moderation, and maintainer
  metadata editing.
- Exercise duplicate webhook, delayed settlement, partial refund, full refund,
  dispute, and read-only reconciliation paths.

**Exit gate:** every financial state produces exactly one correct ledger effect;
browser redirects and client payloads never create rank.

### Phase 4 — Public staging acceptance

**Deliverables**

- Deploy the OpenNext Worker to a staging hostname after freeing enough local
  disk for the standalone adapter artifact.
- Run the complete founder journey from an unrelated account and network on
  desktop and a real phone.
- Confirm empty, loading, payment failure, review, active, removed, refunded,
  disputed, and support states use real backend data.
- Perform keyboard, screen-reader, responsive-layout, destination-abuse, and
  privacy checks. Validate that public exports contain no payer or session data.
- Submit, cancel, claim, resolve, and minimize privacy requests; verify the
  30-day response and three-year closed-request retention gates.
- Force one application failure, one webhook failure, and one rollback while
  recording recovery evidence.

**Exit gate:** an external founder can pay, prove ownership, pass moderation,
receive verified traffic, inspect the ledger, export a report, and obtain support
without operator database edits.

### Phase 5 — Controlled production launch

**Deliverables**

- Switch only the production Worker to the selected provider's live credentials and mode.
- Complete one low-value payment by an external payer, then verify settlement,
  review, activation, redirect measurement, support, and refund reversal.
- Publish the board only after that evidence passes. Start with manual review of
  every new listing and no catch-all email address.
- Monitor Workers requests/CPU, Hyperdrive queries, Neon compute/storage, payment
  failure rate, stuck pending checkouts, and support response time daily during
  launch week.

**Exit gate:** the first external economic event reconciles end to end and the
monthly infrastructure projection remains below USD 12.

### Phase 6 — Retention from measured usage

Build these only after observing real founder behavior:

1. Rank-change and moderation email notifications with explicit transactional
   purpose and delivery preferences.
2. Owner-triggered GitHub metadata refresh with repository/license revalidation.
3. Campaign periods and comparison reports so repeat contributions have a clear
   historical outcome.
4. Founder analytics for verified outbound traffic, referring origins, and time
   windows without cross-site visitor profiles.
5. Optional founder-supplied conversion evidence, clearly separated from
   Bidstage-verified payment and click facts.

### Phase 7 — Revenue-funded operations

- Upgrade Neon retention/capacity only when revenue or measured load requires it.
- Add a phishing-resistant operator web console while keeping audited CLI
  recovery operations.
- Add automated destination reputation checks; keep appeal decisions in the existing receipt-authenticated support ledger.
- Add encrypted object-storage backups or evidence files only when retention
  requirements exceed the launch recovery process.
- Introduce editorial discovery only as a separate, non-purchasable surface.

### Cost envelope

- Cloudflare Workers Paid currently has a USD 5 monthly account minimum and
  includes its base request/CPU allocation. Static assets remain free. See the
  [official Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- Email Routing inbound traffic is unlimited, and forwarding to verified
  destination addresses is free. See the
  [official Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/).
- Neon Free is the launch database tier; its current limits and short restore
  window are documented on the [official Neon pricing page](https://neon.com/pricing).
- Do not enable Cloudflare Images, Stream, Workers AI, Vectorize, Queues,
  Workflows, Durable Objects, Analytics Engine, or product R2 storage in the
  launch phases.
- Set a USD 8 internal warning and a USD 12 monthly stop/review threshold. A
  projected breach pauses optional traffic/analytics work before payment,
  receipt, support, or security paths are degraded.
