# Bidstage

Bidstage is a production paid-discovery marketplace: open-source projects make one-time
contributions, verified settlement updates a public ranking, and every outbound
visit remains visible. It borrows the legibility of pay-to-rank boards without
copying their brand, presentation, or implementation.

## Product contract

- Only signed Creem or Dodo Payments webhook events can change rank.
- The same normalized destination accumulates one auditable total.
- Returning maintainers can start another placement from `/account`. Bidstage
  loads the active project record, locks its identity fields in the form, and
  rejects checkout metadata that differs from the current listing.
- Placement is labeled sponsored and never presented as editorial quality.
- No seeded listings or fabricated activity appear in the product. Outbound totals
  exclude known bots, prefetches, non-navigation requests, and repeat visits to
  the same product within 30 minutes.
- Raw card details stay with the payment provider; payer email is stored only as a salted hash.
- Costly writes pass through a Cloudflare per-location burst gate before any
  database lookup. Counter keys contain only deployment-salted hashes of the
  strongest available request credential; the PostgreSQL limiter remains the
  exact, durable per-account/window quota and the Docker fallback.
- A UTC hourly Cloudflare Cron Trigger runs authenticated maintenance through
  the Worker service binding. Each scheduled timestamp is idempotently claimed,
  expired short-lived records are removed in one transaction. Stale checkout
  counts remain warnings; stuck signed events, scans, or privacy responses
  produce structured error logs and a durable attention state.
- Private-network, credentialed, and non-HTTP destinations are rejected.
- Checkout resolves A and AAAA records through Cloudflare's DNS-over-HTTPS
  wire format, rejects any non-public or reserved address, and retains only a
  timestamp, address count, and SHA-256 address-set fingerprint as review evidence.
  Operator approval and restoration repeat the check and attach the new
  fingerprint to the immutable moderation audit event.
- The hourly maintenance job rechecks a bounded batch of active destinations.
  A new private, reserved, or unresolved DNS result pauses the listing for
  review. A temporary resolver failure creates an attention record for retry and
  does not suspend the listing. Rechecks retain only the time, result code,
  address count, and one-way address-set fingerprint for 400 days.
- Activation also requires completed DNS ownership proof and a Cloudflare URL
  Scanner report from the prior seven days. The report must be bound to the
  exact destination, finish on credential-free HTTPS with a public primary IP
  and successful status, contain an explicit verdict, and not be marked
  malicious. Scanner reports use public visibility; Bidstage retains only the
  scan ID/report link, final origin, redirect count, categories/tags, verdict,
  and one-way destination/redirect fingerprints—not screenshots, cookies,
  response bodies, or request logs.
- Public campaign pages provide cursor-paginated ledger history, a CSV export,
  and a 90-day rank trail built only from durable hourly observations. The job
  records changes immediately and one unchanged checkpoint per day.
- Receipt-linked support and placement appeals use a private fragment token and append-only messages;
  Bidstage does not require or store a support email address. Moderated listings
  may have one active receipt-authenticated appeal at a time, and every operator
  response remains in the audit ledger.
- Public receipts expose financial history but not founder controls. Checkout
  issues a receipt-scoped HttpOnly cookie required for DNS proof and support.
- GitHub sign-in creates a hashed founder session and `/account` record. User
  OAuth tokens are discarded after identity lookup; signed-in founders can
  recover controls across devices and submit versioned name/category edits for
  moderation without changing the paid destination.
- Signed-in users can open access, correction, deletion, or restriction requests
  from Account. Requests stay private, enforce one active request per type, and
  expose the operator response in the same account. The audited minimization
  command deletes the contributor profile and pending applications, clears the
  optional display name, and revokes sessions while preserving records governed
  by the published retention schedule.
- Open-source submissions require a public repository owned by the signed-in
  personal account or an explicitly authorized organization repository, plus a
  GitHub-recognized, OSI-approved SPDX license.
- Accepted contributor applications open a private, append-only correspondence
  thread for the recorded contributor and project maintainer; it does not create
  a bounty, employment relationship, or payment obligation.
- `/countries` and `/country/{ISO code}` connect active sponsored projects,
  maintainer-authored contribution work, and opt-in public contributors by their
  voluntarily selected community country. This label does not assert nationality,
  residence, incorporation, or repository ownership. Opportunity and contributor
  order remain independent of placement spend.
- `/bids` explains sponsored project bidding with current settled marketplace
  totals, the ranking formula, placement steps, and the live overall leaders.
- `/categories` and `/category/{slug}` publish real active-project category
  ledgers. Active listing pages have canonical metadata and structured source
  records; the database-backed sitemap omits account, API, receipt, redirect,
  and private-support routes.

## Local setup

1. Create PostgreSQL, configure `DATABASE_URL`, and run `bun run migrate`.
2. Copy `.env.example` to `.env.local` and replace every placeholder.
3. Set `PAYMENT_PROVIDER` to `creem` or `dodo`. Configure that provider's
   one-time placement product and signed webhook. Dodo requires a tax-inclusive
   USD Pay What You Want product because Bidstage supplies the exact amount.
4. Create a Turnstile widget. The example environment uses Cloudflare's published
   always-pass development keys; production must use hostname-restricted keys.
5. Create a GitHub OAuth app with callback
   `http://localhost:3000/api/auth/github/callback` and configure a server-only,
   read-only public-repository token.
6. Run `bun install --frozen-lockfile`, `bun run test`, `bun run typecheck`, then `bun run dev`.

Run the PostgreSQL transaction suite against a disposable database whose name
contains `test`:

```text
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/bidstage_test bun run test:integration
```

The command refuses other database names. It creates a random schema, applies
all migrations, tests concurrent settlement and reversals, then drops that
schema. Run it from the release machine against an isolated PostgreSQL database
before building the Worker. After deployment, point `SMOKE_BASE_URL` at the
release origin and run `bun run smoke:http` to check health, category rendering,
noindex metadata, security headers, crawler rules, and sitemap privacy boundaries
over HTTP.

## Cloudflare Worker build

`bun run build:worker` creates `.open-next/worker.js` without R2, Images,
Queues, Durable Objects, or Workers AI. `bun run cf-typegen` refreshes binding
types and `bunx wrangler deploy --dry-run` validates the upload. Follow
`DEPLOYMENT.md` to bind Neon through Hyperdrive and configure payments, Turnstile,
and GitHub without committing secrets. `EDGE_WRITE_RATE_LIMITER` provides a
20-request-per-minute route-scoped burst boundary; its namespace ID must remain
unique among rate-limit bindings in the Cloudflare account.
The custom Worker preserves OpenNext's fetch handler and dispatches the
`15 * * * *` maintenance trigger. Production requires a
`MAINTENANCE_SECRET` value of at least 32 random characters.

## Listing moderation

New paid destinations settle into a review queue and remain off the public board
until approved. Founders can publish the DNS TXT challenge shown on their receipt
to prove destination control before operator review. Operator mutations run
through audited database transactions:

```text
bun run operator -- queue
bun run operator -- inspect <listing-slug>
bun run operator -- scan <listing-slug>
# Re-run scan after Cloudflare's documented 10–30 second polling interval.
bun run operator -- scan <listing-slug>
bun run operator -- moderate <listing-slug> approve --reason destination_verified --note "Destination and product identity verified."
bun run operator -- moderate <listing-slug> suspend --reason safety_review --note "Placement paused while a safety report is reviewed."
bun run operator -- cases
bun run operator -- reply <case-reference> --status resolved --note "Your placement was restored after review."
bun run operator -- reconcile <receipt-reference>
bun run operator -- privacy
bun run operator -- privacy-case <privacy-reference>
bun run operator -- privacy-claim <privacy-reference>
bun run operator -- privacy-resolve <privacy-reference> --status completed --note "The requested account-data copy was supplied."
# Deletion requests use the scoped minimizer after the same operator claims them.
bun run operator -- privacy-minimize <privacy-reference>
```

Set `OPERATOR_ID` to the real person executing the command. Removal and restore
use the same command shape; every change creates a public moderation record and
an internal immutable operator audit event.

The scan command requires `CLOUDFLARE_ACCOUNT_ID` and a least-privilege
`CLOUDFLARE_URL_SCANNER_TOKEN` with URL Scanner Read and Write permissions in
the private operator environment. Do not upload that token to the
application Worker. The first invocation submits a public scan; later
invocations collect and persist the finished verdict. Use `--force` only when a
fresh passing review must be replaced.

Provider reconciliation is intentionally read-only: it retrieves the Creem or
Dodo checkout, compares provider, request, product, environment/business,
amount, currency, order/payment, and transaction references, and records the result. A completed remote checkout still requires a
signed webhook resend; the operator command cannot mint ranking value.

`bun run audit:release` is the read-only staging/production gate. With
`DATABASE_URL` set to the restricted runtime role and `RELEASE_BASE_URL` set to
the deployed origin, it verifies migration hashes, role privileges, ledger,
fulfillment, DNS-review, ownership, activation-scan, private correspondence,
privacy-request response/retention, fresh rank-observation and destination-recheck
coverage, crawler-route publication, queue invariants,
health/provider selection, the deployed edge-rate-limit binding, recent
scheduled-maintenance evidence, cache policy, and security headers without
printing credentials.

`infra/docker-compose.yml` provides a health-gated local/VM deployment. Apply
migrations as a release job before starting the restricted runtime container.

## Support mailbox

`email-worker/src/index.ts` is the dedicated Cloudflare Email Routing handler for
`support@bidstage.app`. It forwards to one verified destination stored as the
`SUPPORT_FORWARD_TO` Worker secret and rejects unexpected catch-all recipients.
See `DEPLOYMENT.md` for the dashboard rule and verification sequence.

## Production release gates

- Upgrade Next.js to the patched release scheduled for 26 August 2026 before a
  public deployment; 16.3.0 is used for development but is under a temporary
  security hold based on the framework vendor's advisory.
- Run migrations through a restricted deploy role; runtime credentials must not
  own schema objects.
- Configure managed PostgreSQL backups, point-in-time recovery, connection
  pooling, provider webhook retries, uptime checks on `/api/health`, error tracking,
  and an alert on webhook 5xx responses.
- Activate `support@bidstage.app`, insert the approved legal entity into the
  published policy set,
  test duplicate webhook delivery, and complete one real low-value
  payment before launch.

The dated public-page and architecture review that informed the crawl model is
in `COMPETITOR-RESEARCH.md`. It distinguishes direct observation from reported
or inferred implementation details.
