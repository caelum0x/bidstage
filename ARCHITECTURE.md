# Bidstage — Deep Enterprise Architecture

> **Status: PLANNING DOCUMENT.** This describes what Bidstage *is* today and a
> target enterprise shape it could grow into. It documents; it does not change code.
> Grounded in a full read of `README.md`, `PRODUCT-SPEC.md`, `app/`, `components/`,
> `lib/`, `db/migrations/`, and `scripts/` as of the current tree.

---

## 1. What it is + current state

### 1.1 One-line

Bidstage is **transparent sponsored discovery for open-source**: a verified
open-source maintainer buys **$5.00 upvote tokens** that, once a *signed payment
webhook* settles, add cents to a project's `total_cents` and move it up a public,
sponsored ranking. Every dollar, every reversal, and every outbound click is
publicly auditable, and no listing or activity is ever fabricated.

The paid product is explicitly modeled in `lib/market.ts`:

```
UPVOTE_PRICE_CENTS = 500      // $5.00 per upvote (== MIN_BID_CENTS)
MAX_UPVOTES        = 10,000   // MAX_BID_CENTS 5,000,000 == $50,000
PLATFORM_FEE_BPS   = 2000     // 20% Bidstage fee, INCLUSIVE in the $5 sticker
```

Bidstage is the **merchant of record and sole seller of upvotes**. Purchases are
100% Bidstage advertising revenue — no payout flows to project owners, no escrow,
no stored value, no bounty. That invariant is load-bearing for the legal/refund model.

### 1.2 Stack (grounded)

| Layer | Choice | Evidence |
|---|---|---|
| Framework | **Next.js 16.2.11** (App Router, RSC), React 19.2 | `package.json`; `AGENTS.md` warns this Next.js diverges from training data — read `node_modules/next/dist/docs/` |
| Runtime | **Cloudflare Workers** via `@opennextjs/cloudflare` (`.open-next/worker.js`) | `open-next.config.ts`, `custom-worker.ts`, `bootstrap-worker.ts` |
| Custom worker | Wraps OpenNext fetch handler + dispatches the `15 * * * *` cron to an internal maintenance route over a Worker self-service-binding | `wrangler.jsonc` (`triggers.crons`, `WORKER_SELF_REFERENCE`) |
| Database | **PostgreSQL (Neon)** through **Hyperdrive**, driver `pg` 8.16 | `wrangler.jsonc` `hyperdrive`, `lib/db.ts` |
| Payments | **Creem** or **Dodo** adapters, selected by `PAYMENT_PROVIDER` | `lib/creem.ts`, `lib/dodo.ts`, `lib/payments.ts` |
| Edge abuse gate | Cloudflare **rate-limit binding** `EDGE_WRITE_RATE_LIMITER` (20 req/min, route-scoped, salted-hash keys) | `wrangler.jsonc` `ratelimits`, `lib/edge-rate-limit.ts` |
| Bot gate | Cloudflare **Turnstile** on checkout | `lib/turnstile.ts` |
| Identity | **GitHub OAuth** (maintainer/contributor) + Google OAuth secret present; OAuth tokens discarded after identity lookup | `lib/auth.ts`, `lib/github.ts`, `lib/founder-access.ts` |
| Safety | Cloudflare **URL Scanner** + **DNS-over-HTTPS** A/AAAA private-IP rejection | `lib/cloudflare-url-scanner.ts`, `lib/destination-safety.ts` |
| Email | Dedicated **Cloudflare Email Routing** worker for `support@bidstage.app` | `email-worker/src/index.ts` |
| Storage note | **No R2, Images, Queues, Durable Objects, or Workers AI** in release one (cost discipline) | `README.md`, `PRODUCT-SPEC.md` |

### 1.3 Real routes and features (grounded inventory)

**Public pages** (`app/`): `/` (discovery board + checkout), `/categories` &
`/category/[category]`, `/bids` (bidding guide + live leaders), `/listing/[slug]`
(public campaign record: ledger, 90-day rank trail, click-decision summary),
`/receipt/[reference]` (settlement + recovery), `/support/[reference]` (fragment-token
thread), `/contributors`, `/opportunities`, `/countries` & `/country/[code]`,
`/account`, `/legal/[document]`, `/auth/error`, `not-found`, `error`, plus
`sitemap.ts`, `robots.ts`, `opengraph-image.tsx`, `twitter-image.tsx`.

**Redirect**: `GET|HEAD /go/[slug]` — the click-integrity gateway.

**API** (`app/api/`): `board`, `quote`, `checkout`, `health`, `contributors`,
`countries`, `opportunities`, `support` (+`[reference]`), `receipts/[reference]`,
`auth/session`, `auth/logout`, `account/products`, `account/privacy-requests`,
`account/applications`, `account/contributor-profile`, `webhooks/creem`,
`webhooks/dodo`, `internal/maintenance`. `PRODUCT-SPEC.md` also specifies
listing-scoped routes (`/api/listings/[slug]/placement|ledger|rank-history|report.csv`)
and receipt verification — the spec is ahead of the shipped route folders in places.

**The five real subsystems already implemented in `lib/`:**

1. **Ranking + quote engine** (`market.ts`, `rank-quote.ts`, `rank-history.ts`) —
   rank = `total_cents DESC, last_bid_at ASC` tiebreak; live category+overall quote
   in one SQL snapshot; hourly durable rank observations.
2. **Payment settlement + reversal ledger** (`payment-settlement.ts`, `creem.ts`,
   `dodo.ts`, `payments.ts`) — append-only `rank_ledger`, fulfillment idempotency,
   refund/dispute negative deltas.
3. **Moderation + destination safety** (`destination-safety.ts`,
   `cloudflare-url-scanner.ts`, `destination-rechecks.ts`, `listing-ownership.ts`,
   `osi.ts`) — review queue, DNS TXT ownership, URL-Scanner activation gate, hourly
   rechecks, operator-audited transitions.
4. **Click integrity / anti-fraud** (`app/go/[slug]/route.ts`, `edge-rate-limit.ts`) —
   bot/prefetch/non-navigation/30-min-repeat exclusion, salted per-listing session
   hashes, verified-only counting.
5. **Contributor economy + governance** (`contributor-profile.ts`,
   `contribution-opportunity.ts`, `contribution-application.ts`, `support.ts`,
   `privacy-request.ts`, `scheduled-maintenance.ts`) — opt-in directory, repository-bound
   opportunities, private applications/threads, GDPR-style privacy docket, hourly maintenance.

### 1.4 Data model (grounded, 23 migrations)

Tables actually created across `db/migrations/0001`→`0023`:

`listings`, `listing_versions`, `listing_moderation`, `operator_audit_events`,
`payment_checkouts`, `payment_events`, `payment_adjustments`, `payment_fulfillments`,
`bids`, `rank_ledger`, `click_events`, `click_sessions`, `request_rate_limits`,
`destination_verifications`, `destination_security_reviews`,
`listing_destination_rechecks`, `listing_rank_observations`, `support_cases`,
`support_case_messages`, `contributor_profiles`, `contribution_applications`,
`contribution_application_messages`, `founder_accounts`, `founder_sessions`,
`privacy_requests`, `maintenance_runs`.

> **Maturity signal / tech debt:** migration `0001` was born **Stripe-shaped**
> (`stripe_webhook_events`, `checkout_fulfillments`, `bids.stripe_checkout_session_id`
> as PK). Later migrations (`0002` receipts, `0014` Dodo) generalized to a
> provider-agnostic `payment_checkouts / payment_events / payment_adjustments /
> payment_fulfillments / rank_ledger` model. The Stripe-named legacy tables still
> exist alongside the generic ones — a normalization the enterprise plan should finish.

### 1.5 Honest maturity assessment

**Strong for a pre-launch product.** Financial correctness is taken seriously:
signed-webhook-only rank mutation, `FOR UPDATE` row locks in settlement, fulfillment
idempotency keyed on `(provider, provider_checkout_id)`, append-only ledger as the
single source of rank truth, refund/dispute as negative deltas, a
concurrent-settlement integration test suite (`test/integration/database.test.ts`),
and a read-only release-audit gate (`scripts/release-audit.ts`).

**Sizes:** `lib/` ~3.5K LOC across 33 files (largest `payment-settlement.ts` 358,
`scheduled-maintenance.ts` 335, `destination-safety.ts` 297), `app/` ~4.9K,
`components/` ~2.3K, `db/` ~0.8K, `scripts/` ~1.9K, `test/` ~1.2K. **~14.6K LOC total.**
Files are small and cohesive — consistent with the "many small files" discipline.

**Honest gaps (self-declared in `README.md` / `PRODUCT-SPEC.md`):**
- `CHECKOUT_ENABLED=false` in `wrangler.jsonc` — checkout is gated off.
- Next.js under a "temporary security hold" pending a patched 26 Aug 2026 release.
- "Code completion is not production evidence" — release needs live provider
  credentials, one real low-value payment, backup-restore + rollback drills.
- Operator tooling is a **CLI** (`scripts/operator.ts`), not an admin UI.
- Observability is Cloudflare-native only (logs/traces); no error-tracking,
  metrics dashboards, or alerting wired.
- Single Postgres; no read replicas, no queue/outbox, no formal settlement service.

**Verdict: a well-architected monolith with genuinely careful money handling,
sitting at "ready to earn its first real payment," not yet at enterprise scale.**

---

## 2. Target enterprise structure

The current single-Worker monolith is correct for launch. Enterprise scale means
**splitting the money path from the read path, promoting the operator CLI to a
governed admin plane, and hardening anti-fraud into its own scored pipeline** —
while preserving the invariant that *only a signed provider event mints rank*.

### 2.1 Bounded contexts (target)

| Context | Owns | Today lives in |
|---|---|---|
| **Identity & Access** | maintainer/contributor sessions, OAuth, capabilities, operator RBAC | `lib/auth.ts`, `founder-access.ts`, `github.ts` |
| **Catalog & Profiles** | listings, versions, project profiles, contributor profiles, categories, countries | `lib/market.ts`, `project-profile.ts`, `contributor-profile.ts`, `category-content.ts`, `countries.ts` |
| **Quote & Pricing** | rank quote, upvote pricing, fee math, leader thresholds | `lib/rank-quote.ts`, `market.ts` |
| **Payments & Settlement** | checkouts, provider adapters, webhook ingest, ledger, adjustments, receipts | `lib/payment-settlement.ts`, `creem.ts`, `dodo.ts`, `payments.ts` |
| **Ranking Engine** | rank computation, observations, rank trail, snapshots | `lib/rank-quote.ts`, `rank-history.ts`, maintenance rank job |
| **Trust & Safety / Moderation** | review queue, DNS proof, URL scan, rechecks, appeals, audit | `lib/destination-safety.ts`, `cloudflare-url-scanner.ts`, `destination-rechecks.ts`, `listing-ownership.ts` |
| **Anti-Fraud / Click Integrity** | click classification, session dedup, edge limiter, scoring | `app/go/[slug]/route.ts`, `lib/edge-rate-limit.ts` |
| **Contributor Marketplace** | opportunities, applications, correspondence | `lib/contribution-*.ts` |
| **Support & Correspondence** | receipt-linked cases, fragment tokens, messages | `lib/support.ts` |
| **Privacy & Compliance** | DSAR docket, retention, minimization, audit fingerprints | `lib/privacy-request.ts`, `privacy-hash.ts` |
| **Operations & Scheduling** | cron maintenance, cleanup, health, incidents | `lib/scheduled-maintenance.ts`, `webhook-incidents.ts`, `maintenance-auth.ts` |
| **Admin / Operator Plane** | moderation actions, reconciliation, DSAR resolution, audit | `scripts/operator.ts` |

### 2.2 Target directory / module / file tree (enterprise scale)

```
bidstage/
├── apps/
│   ├── web/                              # public Next.js app (RSC + route handlers)
│   │   ├── app/
│   │   │   ├── (discovery)/              # board, category, bids, listing, go-redirect
│   │   │   ├── (account)/                # founder + contributor account surfaces
│   │   │   ├── (receipt)/                # receipt, support-thread, DNS proof
│   │   │   ├── (directory)/              # contributors, opportunities, countries
│   │   │   ├── (legal)/                  # rules/terms/privacy/retention/processors/refunds
│   │   │   └── api/                       # thin handlers → application services
│   │   └── components/                    # paper-system UI (bid-board, rank-trail, ...)
│   ├── worker-edge/                       # custom Worker: fetch + cron dispatch + edge limiter
│   ├── admin/                             # NEW operator console (replaces CLI-only ops)
│   │   ├── app/(queue|cases|reconcile|privacy|audit|fraud)/
│   │   └── rbac/                          # operator roles, 4-eyes approval, session audit
│   ├── settlement-service/                # NEW isolated money path (see §2.3)
│   │   ├── ingest/                        # webhook receiver (Creem/Dodo/Mint)
│   │   ├── ledger/                        # append-only ledger + fulfillment idempotency
│   │   ├── reconcile/                     # provider ↔ ledger diff (read-only)
│   │   └── payout/                        # (reserved) merchant-of-record accounting
│   └── email-worker/                      # support@ mail routing (exists)
├── packages/
│   ├── domain-catalog/                    # listing/profile entities + invariants
│   ├── domain-payments/                   # provider-agnostic checkout/ledger types
│   ├── domain-ranking/                    # rank formula, quote, observation model
│   ├── domain-trust-safety/               # moderation state machine, DNS/URL evidence
│   ├── domain-fraud/                       # click classification + scoring rules
│   ├── domain-contributors/               # profiles, opportunities, applications
│   ├── domain-privacy/                    # DSAR state machine, retention schedule
│   ├── provider-creem/  provider-dodo/  provider-mint/   # payment adapters (Mint = §5)
│   ├── db/                                 # migrations, repositories, role grants
│   ├── contracts/                          # zod/JSON schemas at every boundary
│   ├── security/                           # hashing, salts, capability tokens, PII redaction
│   ├── observability/                      # structured logs, metrics, traces, incident refs
│   └── config/                             # env schema + secret presence validation
├── db/migrations/                          # 0001..NNNN (finish Stripe→generic normalization)
├── scripts/                                # migrate, operator, release-audit, preflights, smoke
├── infra/                                  # wrangler configs, docker-compose, terraform (target)
└── test/  (unit + integration + e2e + fraud-replay + settlement-property)
```

### 2.3 Rich decomposition of the hard modules

**Payments & Settlement (the crown jewel — keep it small, keep it isolated).**
```
domain-payments/
  checkout/          create-intent, quote-binding, idempotency-key, turnstile-gate
  intent/            economic-intent fingerprint (destination addr-set, expected amount)
  webhook/           raw-body verify (creem-signature | Standard-Webhooks HMAC+replay window)
  event-claim/       payment_events dedup (provider, event_id)
  fulfillment/       payment_fulfillments (provider, provider_checkout_id) — economic idempotency
  ledger/            rank_ledger append: contribution | refund_reversal | dispute_reversal
  adjustment/        partial/full refund + dispute cumulative-delta math
  receipt/           payer-free projection + capability cookie issuance
  reconcile/         read-only provider fetch vs ledger (CANNOT mint rank)
  incident/          webhook-incidents: durable attention state for failed processing
```

**Ranking Engine.**
```
domain-ranking/
  quote/             single-snapshot current+projected category & overall rank
  formula/           total_cents DESC, last_bid_at ASC, slug ASC deterministic tiebreak
  observation/       hourly durable snapshot (change + 1 daily checkpoint)
  trail/             ≤180 evenly-sampled points / 90 days, payer-free
  leaderboard/       category & overall leaders, minimum-to-lead
```

**Trust & Safety / Moderation.**
```
domain-trust-safety/
  queue/             review → active → review → removed → active
  ownership/         personal-owner | .bidstage.json org-authorization; OSI SPDX check
  dns-proof/         7-day TXT challenge create/rotate/verify (fixed public resolver)
  dns-resolve/       A/AAAA over DoH wire format; reject private/reserved/loopback/link-local
  url-scan/          Cloudflare URL Scanner submit→poll→verdict, fingerprint-only evidence
  recheck/           hourly bounded batch; new-private → pause; resolver-fail → attention
  appeal/            one active receipt-authenticated appeal per moderated listing
  audit/             immutable operator_audit_events + public listing_moderation
```

**Anti-Fraud / Click Integrity (target: promote to scored pipeline).**
```
domain-fraud/
  edge-gate/         20/min route-scoped burst; salted-hash of strongest credential
  classify/          bot | prefetch | non-navigation | repeat-30min | verified
  session/           salted per-listing session hash; dedup window; append-only click_events
  counter/           verified-only outbound_clicks increment (HEAD never counts)
  score/             NEW: velocity, referrer-diversity, ASN/UA-cluster risk scoring
  challenge/         NEW: step-up (Turnstile) on suspicious redirect bursts
```

### 2.4 OSS Foundations — what to fork/build-on vs. write

The `development-workflow.md` mandate is "research & reuse before net-new code."
Bidstage's own code is already lean and correct; the leverage is in **not
hand-rolling** the payment-webhook, ranking, anti-fraud, and moderation
infrastructure the enterprise plan calls for. Below, each candidate is scored on
**license** (permissive only — GPL/AGPL flagged), **fit**, and **reuse-vs-build**.

**Licensing rule for this codebase:** Bidstage ships as a proprietary Cloudflare
Worker. **MIT / Apache-2.0 / BSD / ISC only.** Apache-2.0 is preferred where a
project touches payments/crypto because of its explicit patent grant. **AGPL-3.0
is disqualifying** for any code linked into the Worker (it would force source
disclosure of the whole service); **GPL-3.0** is disqualifying for linked libraries
and only tolerable for *standalone CLI tools* run out-of-process. Every candidate
below is permissive; the AGPL/GPL alternatives people reach for are called out so
they are consciously *avoided*, not accidentally vendored.

| Concern | Adopt (license) | Fit | Reuse vs. build |
|---|---|---|---|
| **Framework / edge runtime** | **Next.js** (MIT) + **@opennextjs/cloudflare** (MIT) | Already the stack. | **Reuse** — keep. Track the security-hold patch. |
| **Schema validation at boundaries** | **Zod** (MIT), or **Valibot** (MIT) for smaller bundles | Replaces hand-written `parse*` guards in `lib/market.ts` etc. | **Adopt** — thin, proven, tree-shakeable; do not hand-roll validators. |
| **Webhook signature verification** | **standardwebhooks** (MIT) for Dodo; provider SDK HMAC for Creem | Dodo already uses Standard Webhooks (HMAC + 5-min replay). | **Adopt the spec lib**, keep Bidstage's event-claim/fulfillment idempotency (domain-specific — build). |
| **Payment provider adapters** | provider SDKs (Creem/Dodo — MIT/permissive); **Stripe SDK** (MIT) if a card acquirer is added | Adapters behind the `PaymentProvider` union. | **Reuse SDKs** for API/verification; **build** the settlement/ledger logic (it *is* the moat). |
| **Settlement ledger** | **Railyard Mint** (Apache-2.0) — double-entry, Ed25519 receipts, reserve conservation | §5 — verifiable ledger behind cards, or AITP-402 agent rail. | **Adopt as a rail** (Apache patent grant is ideal for money code); keep `rank_ledger` as rank source of truth. |
| **Ranking / leaderboard** | **Postgres window functions** (already used) + **Redis `ZSET`**-style ranking only if hot | Rank = `Σ ledger`, `total_cents DESC` — SQL is exact and cheap. | **Build/keep in SQL.** A leaderboard library adds a cache-coherency bug against the ledger's exact total; do **not** adopt. If read-hot, add a derived cache, not a source of truth. |
| **Anti-fraud / bot detection** | **isbot** (MIT) for UA classification; **@fingerprintjs/fingerprintjs** OSS core (**MIT**) for client signals | Hardens `classifyRequest()` in `/go/[slug]` beyond a hand-kept regex. | **Adopt isbot** (a maintained UA list beats a frozen regex); **build** the session-dedup + verified-only counting (domain rules). ⚠️ FingerprintJS *Pro* is commercial SaaS — use only the MIT core, and mind privacy/consent. |
| **Click-integrity / rate limiting** | Cloudflare **rate-limit binding** (platform) + **Turnstile** (platform) | Already the two-boundary edge gate. | **Reuse platform.** For the exact per-window quota, keep the Postgres limiter (build). Avoid pulling a Node rate-limiter into the Worker. |
| **Moderation / content safety** | **Cloudflare URL Scanner** (platform API) — already integrated; **Google Safe Browsing** / **URLhaus** (permissive/free feeds) as add-ons | Destination safety + activation gate. | **Reuse** the platform scanner; **add** free reputation feeds; **build** the review-queue state machine + audit (domain). |
| **Admin console (L2)** | **Refine** (MIT) or **React-Admin** (MIT) for the operator plane; or App-Router-native pages | Replaces `scripts/operator.ts` CLI. | **Adopt a framework** for CRUD/audit views; **build** the 4-eyes approval + operator RBAC. ⚠️ Some admin kits are dual-licensed — confirm the OSS tier is MIT. |
| **DSAR / privacy tooling** | build on Bidstage's existing docket; no heavy OSS needed | Retention + minimization are domain-specific. | **Build** — the state machine (`open→in_progress→completed`) is small and bespoke. |
| **Observability** | **OpenTelemetry JS** (Apache-2.0) + **Sentry SDK** (MIT/BSL-exempt SDK) | L2 "operable" gap. | **Adopt** OTel for traces/metrics; wire to Cloudflare + a backend. **Build** only the incident-reference glue. |
| **Testing** | **Playwright** (Apache-2.0) e2e; **@cloudflare/vitest-pool-workers** (MIT) | Fills the fraud-replay + settlement-property test gap. | **Adopt** the harnesses; **write** the property tests (concurrent settlement, refund math). |

**Explicit GPL/AGPL avoid-list (do not vendor into the Worker):**
- **Plausible / Matomo analytics** — **AGPL-3.0.** Tempting for click analytics; would
  contaminate the service. Use Cloudflare Web Analytics or build the click aggregation
  in-house (Bidstage already does — `click_events`). 
- **GrowthBook / some feature-flag stacks** — MIT core exists but verify; several
  analytics/experimentation tools ship AGPL server components.
- **Ghost, Rocket.Chat, and many "moderation dashboard" projects** — GPL/AGPL; do not
  fork for the admin console. Use MIT Refine/React-Admin instead.
- **Any GPL-3.0 library** linked in-process — disqualified. GPL CLI *tools* run
  out-of-process (e.g. as a `scripts/` step) are acceptable but avoided by default.

**Net recommendation:** the reuse wins are **Zod/Valibot** (validation), **isbot**
(bot classification), **standardwebhooks** (Dodo verification), **OpenTelemetry**
(observability), **Playwright + vitest-pool-workers** (tests), and a **Refine/React-Admin**
admin console. The things to **keep building in-house** are exactly Bidstage's moat:
the settlement ledger, the fusion-by-destination rule, the rank formula, and the
click-integrity session logic. **Railyard Mint (Apache-2.0)** is the one substantial
*fork/build-on* candidate — a ready settlement ledger whose license, money model
(integer microdollars, success-only), and receipt integrity (Ed25519, reserve
conservation) line up with Bidstage's invariants far better than anything hand-rolled.

---

## 3. Graph engineering

Applying `~/.claude/skills/graph-engineering`: a **domain knowledge graph**
(what Bidstage *knows*) and **task graphs** (how work *flows*). Property-graph
representation (typed nodes/edges + time + provenance) is the right choice here —
Bidstage is a single product under ~50K core entities early on, and every edge is
already backed by a Postgres row with `created_at` and a provenance source
(a signed `provider_event_id`, an `operator_audit_event`, or a DNS/scan fingerprint).

### 3.1 Competency questions (the ontology's spec + test suite)

1. What is a listing's rank right now, and which signed events produced its total?
2. Which upvote purchases funded a given listing, and were any reversed?
3. Who is the maintainer of record for a listing, and how was ownership proven?
4. Which listings share a normalized destination (must be exactly one)?
5. Why is a listing in `review` / `removed` — which moderation event and evidence?
6. Which verified outbound clicks count toward a listing, and which were excluded and why?
7. Which contributors published availability for which repository-bound opportunities?
8. What is the 90-day rank trail of a listing from durable observations only?
9. Which privacy request touched which records, and what did the operator respond?
10. Which provider event mutated rank, when, and under which fulfillment key?

### 3.2 Domain knowledge graph (entities → edges, with time + provenance)

**Entity types** (canonical-form rule in parentheses):

- **Maintainer/FounderAccount** (GitHub user id) — signed-in owner of listings.
- **Contributor** (GitHub user id) — opt-in directory identity; may equal a Maintainer.
- **Listing/Project** (normalized `destination` URL — the unique key) — the ranked unit.
- **ListingVersion** (listing_id + version_number) — immutable name/category edits.
- **Category** (enum: ai|developer|design|commerce|consumer|other).
- **Country** (ISO code — voluntary community label, asserts nothing legal).
- **Repository** (github_repository_id) — verified source of a Listing.
- **License** (SPDX id, OSI-approved) — attribute-heavy entity gating checkout.
- **UpvotePurchase/Checkout** (payment_checkouts.id) — one buy intent, $5×quantity.
- **PaymentEvent** (provider, event_id) — signed provider webhook (the ONLY rank minter).
- **Fulfillment** (provider, provider_checkout_id) — economic idempotency boundary.
- **Bid** (provider_order_id) — a settled contribution, carries salted payer-email hash.
- **LedgerEntry** (rank_ledger row) — ±cents; entry_type ∈ {contribution, refund_reversal, dispute_reversal}.
- **Adjustment** (payment_adjustments row) — refund/dispute with cumulative delta.
- **Receipt** (reference) — public payer-free settlement record.
- **RankObservation** (listing_id + captured_at) — durable hourly rank snapshot.
- **ClickEvent** (id) — one redirect decision; **ClickSession** (listing_id + session_hash).
- **ModerationEvent / OperatorAuditEvent** — public + immutable-internal pair.
- **DestinationVerification** (DNS TXT), **SecurityReview** (URL scan), **DestinationRecheck**.
- **Opportunity** (repo-bound URL), **Application**, **CorrespondenceMessage**.
- **PrivacyRequest** (reference), **Operator** (OPERATOR_ID), **MaintenanceRun** (scheduled_at).

**Relation types** (precise verbs; domain → range; every edge carries `{since, source, confidence}`):

```
Maintainer      -OWNS->                Listing            {since: settlement, source: github_ownership_proof}
Maintainer      -PROVED_OWNERSHIP_VIA-> DestinationVerification {source: dns_txt}
Listing         -HAS_VERSION->         ListingVersion     {source: settlement|owner_edit}
Listing         -IN_CATEGORY->         Category
Listing         -SITES_IN->            Country            {provenance: voluntary_label}
Listing         -SOURCED_FROM->        Repository         {source: github_api}
Repository      -LICENSED_UNDER->      License            {source: osi_api + github_spdx}
Checkout        -QUOTED_AS->           RankQuote          {at: quote_timestamp}
PaymentEvent    -SETTLES->             Checkout           {source: SIGNED_WEBHOOK}   # rank-minting edge
Fulfillment     -IDEMPOTENCY_FOR->     Checkout
Checkout        -PRODUCED->            Bid                {at: settled_at}
Bid             -CONTRIBUTES->         LedgerEntry(+)     {provenance: provider_event_id}
Adjustment      -REVERSES->            Bid                {kind: refund|dispute}
Adjustment      -PRODUCED->            LedgerEntry(-)
LedgerEntry     -SUMS_INTO->           Listing.total_cents            # rank = Σ ledger, never the state label
Listing         -OBSERVED_AS->         RankObservation    {at: captured_at, hourly}
ClickSession    -DEDUPES->             ClickEvent         {window: 30min}
ClickEvent      -COUNTS_TOWARD->       Listing            {only if decision=verified}
OperatorAuditEvent -MODERATED->        Listing            {source: operator_cli, immutable}
ModerationEvent -CITES_EVIDENCE->      SecurityReview|DestinationRecheck {fingerprint-only}
Contributor     -PUBLISHED->           ContributorProfile {visibility: public|hidden}
Maintainer      -AUTHORED->            Opportunity        {bound_to: Repository}
Contributor     -APPLIED_TO->          Opportunity        {creates: private Application}
Application     -OPENS->               CorrespondenceThread {only when accepted}
PrivacyRequest  -TARGETS->             Maintainer         {audited: counts+fingerprint, not body}
MaintenanceRun  -CAPTURED->            RankObservation
```

**Provenance discipline (matches `modeling.md`):** the highest-trust edge in the
whole graph is `PaymentEvent -SETTLES-> Checkout` — its provenance is a
cryptographically signed webhook, and it is the *only* edge type allowed to create
positive `LedgerEntry` nodes. Moderation edges carry immutable operator provenance;
safety edges carry **fingerprint-only** provenance (SHA-256 of address sets / redirect
chains — never screenshots, bodies, or cookies). This is exactly the course's rule:
decide time + provenance at modeling time; retrofitting it after the fact is impossible.

**Fusion rule (the one that matters):** two Checkouts to the same normalized
`destination` must **fuse into one Listing** (`ON CONFLICT (destination) DO UPDATE`
accumulates `total_cents`), *unless* `product_kind` or `github_repository_id`
differs — then the settlement is rejected as an identity conflict. This is the
blocking+matching+merge pipeline from `fusion-and-llm.md`, enforced in SQL: an
erroneous merge would fuse two projects' entire financial histories, so the guard
is a hard `WHERE` clause, not a heuristic.

### 3.3 Task graphs

**A) Buy-upvote → settle → rank → verify (with the payment-settlement diamond + gates).**

The `and then` audit (fake-edge deletion per `task-graphs.md`): quote calculation,
ownership proof, OSI license check, and DNS A/AAAA resolution **do not read each
other's results** — they all feed checkout creation. They are a parallel fan-out,
not a chain.

```
                 ┌────────── ownership proof (GitHub personal|org .bidstage.json)
 maintainer      ├────────── OSI/SPDX license verification
   intent ──────►├────────── rank quote (recompute, bind to intent) ──┐
 (checkout)      ├────────── DNS A/AAAA over DoH (reject private/reserved)
                 └────────── Turnstile + edge burst gate                │
                                                                        ▼
                                              [create exact-price provider checkout]
                                                 (sets receipt-scoped HttpOnly cookie)
                                                        │  NO RANK CHANGE HERE
                                                        ▼
                          ══════════ HUMAN/PROVIDER GATE: money leaves the payer ══════════
                                                        ▼
                                          signed provider webhook arrives
                                                        │
                        ┌───────────────── SETTLEMENT DIAMOND ─────────────────┐
                        │  verify signature (creem-sig | Std-Webhooks HMAC)     │
                        │           ├─ claim event_id (payment_events)          │  ← dedup
                        │           ├─ claim fulfillment (provider,checkout_id) │  ← economic idempotency
                        │           └─ match intent (amount, currency, checkout)│  ← VERIFIER (separate check)
                        │                        ▼                              │
                        │        [one txn]  upsert Listing (fuse by destination)│
                        │                   append Bid + rank_ledger(+)         │
                        │                   checkout → settled                  │
                        └───────────────────────┬──────────────────────────────┘
                                                 ▼
                          ══════════ MODERATION GATE (human) ══════════
                    listing enters `review`; operator inspects + scans + DNS-proof
                                                 ▼
                          approve → `active`  (rank now public)
                                                 ▼
                          hourly RankObservation captures durable trail
                                                 ▼
                          /go/[slug] verified clicks accrue (fraud-gated)
```

**Diamond correctness (per `task-graphs.md`):** the three claim/match steps are
**diverse verifiers in a separate context** — signature (is it authentic?), event
dedup (is it new?), fulfillment idempotency (did we already pay out rank for this
checkout?), and intent match (does the money equal what was quoted?). A single check
would miss replays and amount mismatches; four skeptics catch what one cannot. The
`FOR UPDATE` lock makes the merge single-owner — no two webhook retries mutate the
same listing concurrently.

**Human gates are placed only on irreversible edges** (money leaving the payer;
a listing becoming publicly `active`; a removal/restore; a DSAR deletion) — not on
every step. That is the exact "gate where a mistake is expensive to undo" rule.

**B) Reversal task graph (refund / dispute).**
```
provider refund/dispute webhook ─► verify+claim ─► match settled Bid (FOR UPDATE)
   ─► compute cumulative delta ─► append rank_ledger(-) ─► total_cents := max(0, total-delta)
   ─► IF total hits 0 AND status=active ─► listing back to `review`  (auto de-list gate)
```

**C) Hourly maintenance task graph (cron `15 * * * *`).** DNS rechecks run
*before* the cleanup transaction so a slow resolver never holds financial/retention
locks (a deliberate fake-edge deletion, visible in `scheduled-maintenance.ts`):
```
idempotent-claim(scheduled_at) ─► [DNS rechecks, outside txn]
   ─► [one txn] capture RankObservations → cleanup (clicks/sessions/limits/sessions/DSAR/runs)
              → health scan (stuck events/scans, overdue DSAR) → state: completed|attention
```
Guardrails from `task-graphs.md` are already honored: one writer per run
(`ON CONFLICT (scheduled_at) DO NOTHING`), bounded recheck batch, no unbounded loops,
and health backlog surfaces as a durable `attention` state rather than a silent retry.

---

## 4. Scale reality

### 4.1 Per-module estimated files / LOC (target enterprise scale)

| Module (target) | Files | Est. LOC | Basis / today |
|---|---:|---:|---|
| domain-payments (settlement, adapters, ledger, reconcile, receipts) | ~40 | ~4,500 | today ~1,100 across `payment-settlement/creem/dodo/payments` |
| provider adapters (creem, dodo, **mint**) | ~18 | ~2,000 | today `creem.ts`+`dodo.ts` ~350 |
| domain-trust-safety (queue, DNS, URL scan, recheck, appeal, audit) | ~35 | ~4,000 | today ~1,000 (`destination-*`, `url-scanner`, `ownership`) |
| domain-fraud (classify, session, edge-gate, score, challenge) | ~22 | ~2,600 | today `go/route.ts`+`edge-rate-limit` ~270 |
| domain-ranking (quote, formula, observation, trail, leaderboard) | ~18 | ~2,000 | today `rank-quote`+`rank-history` ~200 |
| domain-catalog (listings, versions, profiles, categories, countries) | ~30 | ~3,200 | today ~600 |
| domain-contributors (profiles, opportunities, applications, messages) | ~24 | ~2,400 | today ~250 |
| domain-privacy (DSAR, retention, minimization) | ~14 | ~1,400 | today ~110 |
| identity & access (OAuth, capabilities, operator RBAC) | ~20 | ~2,200 | today `auth`+`founder-access`+`github` ~330 |
| ops & scheduling (maintenance, incidents, health) | ~16 | ~1,800 | today ~360 |
| **admin console** (new) | ~45 | ~5,000 | today = `scripts/operator.ts` CLI only |
| **settlement-service** (new, isolated worker) | ~30 | ~3,500 | today = inline route handlers |
| web app (RSC pages + route handlers) | ~90 | ~7,000 | today `app/` ~4,900 |
| components (paper design system) | ~55 | ~4,000 | today `components/` ~2,289 |
| packages/contracts + security + observability + config | ~40 | ~3,000 | today scattered in `lib/` |
| db (migrations + repositories + role grants) | ~60 | ~4,000 | today `db/` ~800 |
| scripts (migrate/operator/audit/preflight/smoke) | ~25 | ~2,500 | today ~1,900 |
| tests (unit + integration + e2e + fraud-replay + settlement-property) | ~120 | ~9,000 | today ~1,200 |
| **Total (target)** | **~700** | **~64,000** | **today ≈ 14,600 LOC / ~110 source files** |

So enterprise scale is roughly a **4–5× LOC expansion**, concentrated in three
places that barely exist yet: the **admin console**, the **isolated settlement
service**, and the **test corpus** (settlement property tests + fraud replay).

### 4.2 Done-ladder

- **L0 — Prototype (past).** Board, quote, single-provider checkout, in-app settlement.
- **L1 — Launch-ready (≈ where it is now).** Signed-webhook-only settlement, append-only
  ledger, moderation queue + DNS/URL safety, click integrity, contributor economy,
  DSAR docket, hourly maintenance, release-audit gate. **Blocked on:** `CHECKOUT_ENABLED=true`,
  Next.js patch, live provider creds, one real payment, backup/rollback drills.
- **L2 — Operable.** Admin console replaces operator CLI; error tracking + metrics +
  alerting on webhook 5xx and maintenance `attention`; finish Stripe→generic table
  normalization; settlement property tests in CI.
- **L3 — Isolated money path.** Settlement extracted to its own Worker/service with an
  outbox; provider reconciliation on a schedule; fraud scoring pipeline with step-up.
- **L4 — Multi-rail + scale.** Postgres read replicas for the board; Mint as a settlement
  rail alongside Creem/Dodo (§5); regional edge caching for public reads; SLOs + on-call.
- **L5 — Platform.** Public API + webhooks for partners; multi-currency; formal
  merchant-of-record accounting; anchored/audited financial receipts.

---

## 5. Interop — settling on Railyard's Mint

**Railyard's Mint** (`../railyard/apps/mint`) is a fiat-backed, gasless,
success-only microdollar settlement ledger: double-entry, Ed25519 hash-linked
receipts, reserve conservation, integer-microdollar money (ADR-0001), success-only
billing (ADR-0002), spoken over **AITP-402**. Bidstage and Mint are a strong
conceptual match — both already treat **cents/microdollars as the durable source of
truth** and both build **append-only, receipt-backed ledgers**.

### 5.1 Could Bidstage settle on Mint instead of / alongside Creem?

**Alongside — yes, cleanly. Instead — partially.** The key distinction:

- **Creem/Dodo are card acquirers / merchant-of-record on-ramps.** They take a
  real credit card from a maintainer and produce a signed `checkout.completed`
  webhook. Mint is **not** a card acquirer — it is a settlement *ledger* that
  moves already-funded microdollar balances between accounts. So Mint cannot, by
  itself, replace the *card-acquiring* step; it replaces the *ledger* step.

- The natural fit is to add **`provider-mint`** as a third payment adapter behind
  the existing `PaymentProvider` union (`"creem" | "dodo"` → `| "mint"` in
  `lib/payment-settlement.ts`). Bidstage already generalized its schema off Stripe
  into `payment_checkouts / payment_events / payment_fulfillments / payment_adjustments`,
  so a third provider is an adapter, not a migration.

**Two concrete integration modes:**

1. **Mint as the internal ledger, cards on top (recommended).** Keep Creem/Dodo
   for the card charge, but on settlement, *also* post the contribution into Mint
   as a double-entry transfer (`payer_account → bidstage_revenue`) and store Mint's
   **Ed25519 hash-linked receipt reference** alongside Bidstage's own `rank_ledger`
   entry. Bidstage gains a cryptographically verifiable, reserve-conserving audit
   trail — a strict upgrade over the current SHA-256-fingerprint receipts — while
   `rank_ledger` stays the rank source of truth. The two receipts cross-reference.

2. **Mint as the pay-rail for agent/prepaid buyers.** For maintainers or agents who
   already hold a Mint balance (AIT tokens), expose an **AITP-402 402-challenge** on
   `/api/checkout`: the buyer presents a signed AITP-402 payment over their Mint
   balance, Mint returns a signed settlement receipt, and Bidstage treats that
   receipt exactly like a provider webhook — *the only rank-minting edge*. This is
   a genuine "instead of Creem" path for the subset of buyers funded in Mint, and it
   inverts nicely: **success-only billing** (ADR-0002) means the upvote settles only
   when the transfer succeeds, matching Bidstage's "signed event or nothing" invariant.

**Why the invariant holds either way:** Bidstage's core rule is *only a signed
settlement event mints rank*. A Creem/Dodo webhook and a Mint Ed25519 receipt are
both signed settlement events. The settlement diamond (§3.3) already verifies
signature + idempotency + intent match; a Mint receipt slots into the same verifier
with a different signature check (Ed25519 against Mint's payer-key registry instead
of HMAC/creem-signature). Fulfillment idempotency (`provider='mint', provider_checkout_id`)
and event claiming carry over unchanged.

**What does NOT transfer:** Bidstage is merchant-of-record and takes a 20% inclusive
fee with **no payout to project owners** — there is no downstream settlement to a
maintainer, so Mint's *transfer/redeem/on-ramp-to-fiat* surfaces are not needed for
the core upvote product. Mint is valuable to Bidstage as a **verifiable ledger and
an agent-native pay-rail**, not as a payout system. (If Bidstage ever added a
funding/tip feature that *does* pay maintainers, Mint's transfer + redeem becomes
directly relevant — but that would break the current "never project funding" invariant
and is out of scope.)

### 5.2 What Bidstage exposes (integration surface)

Bidstage is today mostly a closed product; the enterprise plan should publish:

- **Public read API** (already partly present): `GET /api/board`, `/api/quote`,
  `/api/listings/[slug]/{ledger,rank-history,report.csv}`, `/api/contributors`,
  `/api/opportunities` — all payer-free, CSV + cursor-paginated ledger, 90-day rank
  trail. This is the "transparent" half and is safe to expose to partners/aggregators.
- **Signed-webhook ingress** (`/api/webhooks/{creem,dodo}` → add `/mint`) — the only
  rank-mutating surface; each provider is a verifier plug-in.
- **Public verifiable receipts** (`/receipt/[reference]`) — today payer-free +
  SHA-256 fingerprints; with Mint, upgrade to Ed25519 hash-linked receipts that a
  third party can independently verify against Mint's public keys.
- **Health/readiness** (`/api/health`) — DB, edge limiter, maintenance, provider
  selection — suitable as a partner status probe.
- **AITP-402 challenge (new, via Mint)** — the agent-payable checkout entry point.

---

## Key owner decisions (require a human call)

1. **Launch gating.** Flip `CHECKOUT_ENABLED=true` and clear the Next.js security
   hold — or stay dark until the patched release ships. This blocks L1→earning.
2. **Operator CLI vs admin console.** Ship the L2 admin console, or keep operating
   moderation/reconciliation/DSAR through `scripts/operator.ts` at launch scale?
3. **Split the money path?** Extract settlement into its own Worker/service (L3), or
   keep it as in-app route handlers until volume demands it? (Argues for isolation as
   soon as real money flows, given the invariant's importance.)
4. **Finish the Stripe→generic normalization** now (drop legacy `stripe_webhook_events`
   / `checkout_fulfillments` / `bids.stripe_checkout_session_id`) or defer as tech debt.
5. **Mint interop scope.** Adopt Mint as (a) internal verifiable ledger behind cards,
   (b) an AITP-402 agent pay-rail alongside Creem/Dodo, (c) both, or (d) not yet.
   Recommendation: **(a) first** (pure upgrade to receipt integrity, no UX change),
   then **(b)** when an agent/prepaid buyer segment appears.
6. **Fraud posture.** Keep the current rule-based click exclusion, or invest in the
   scored `domain-fraud` pipeline (velocity/ASN/step-up)? Depends on observed abuse.
7. **Observability spend.** Cloudflare-native logs/traces only, or add error tracking +
   metrics + alerting (webhook 5xx, maintenance `attention`)? Required for L2 "operable."
8. **Read-scale strategy.** When board/category read load grows: Postgres read
   replicas vs. short edge-cache on the (currently uncached) `/api/board`.
```
