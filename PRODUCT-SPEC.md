# Bidstage Product, Page, API, and Design Specification

Last revised: 24 August 2026

## Release goal

Bidstage is complete when an outside maintainer can submit an owner- or repository-verified,
OSI-licensed public GitHub project, see an authoritative sponsored-rank quote,
pay the exact placement budget through the configured provider, pass moderation,
appear on the public board,
receive privacy-filtered outbound traffic, inspect financial and moderation
history, download a campaign report, and resolve payment or placement problems
without direct database intervention.

The product has four actors:

- **Visitor:** explores sponsored open-source projects and follows verified redirects.
- **Maintainer:** signs in with GitHub, buys placement, receives a receipt-scoped
  HttpOnly fallback capability, verifies ownership, keeps the receipt, and opens
  private support cases. Personal ownership or committed organization-repository
  authorization and an OSI-approved license are required.
- **Contributor:** signs in with GitHub and may explicitly publish a directory
  profile containing authored skills, availability, country, headline, and bio.
  Hidden profiles never enter the public directory.
- **Operator:** reviews destinations, handles support, reconciles provider records,
  and changes listing visibility through audited commands.

## Product principles

1. Only a signed payment-provider webhook changes paid ranking value.
2. Moderation state and payment state are separate and visible.
3. Financial history is append-only; refunds and disputes add negative entries.
4. No payer identity appears on public receipts or campaign pages.
5. Public traffic counts exclude known bots, prefetches, non-navigation requests,
   and repeats inside the published measurement window.
6. No screen displays seeded listings, fake users, fabricated totals, or invented
   operational telemetry.
7. Placement spend paid to Bidstage is never represented as project funding,
   maintainer support, contributor bounty, escrow, or stored value.

## Page plan

### `/` — discovery board and contribution flow

**User:** visitor and founder.

**Purpose:** explain the product, show the live sponsored board, calculate rank
impact, and start an exact-price checkout.

**Real data:** active project count, net settled placement volume, verified
outbound redirects, category/language/country-filtered open-source listings,
current totals, rank quote, leader threshold, GitHub source metadata, optional
maintainer-published funding links, and quote timestamp.

**Primary states:** board loading, database unavailable, empty board, quote idle,
quote loading, invalid destination, destination in review, destination removed,
fresh quote, stale quote, checkout creating, checkout failure.

**Primary actions:** filter by category or primary repository language, open a
verified repository to contribute, open a direct project-funding link, refresh
the board, enter project/repository/community details, calculate a quote, set
placement budget to the current category-lead threshold, accept rules, and
continue to the configured checkout provider.

**Design:** oversized paper headline plus a hard-offset contribution card. The
price ladder is the signature element; it must make current total, projected
total, rank, and approval requirement legible before money leaves the founder.

### `/categories` and `/category/[category]` — public category ledgers

**User:** visitors comparing open-source projects by software category.

**Purpose:** create stable topic pages that explain each category and expose its
real active sponsored order without pretending paid position measures quality.

**Real data:** active project count, net settled placement volume, deterministic
category rank, repository owner/name, SPDX license, language, placement count,
verified visits, and public project record.

**Primary states:** current ranking, empty category, or category explanation with
live values blank while storage is unavailable.

**Primary actions:** inspect a project record, move between categories, read the
ranking rules, or start an owner-verified placement.

**Design:** a paper archive with a numbered rank spine. Paper yellow, black ink,
cyan and pink registration marks, Times headlines, Helvetica labels, and Courier
figures keep the category pages inside the existing Bidstage visual system.

### `/account` — founder product records

**User:** GitHub-authenticated founder.

**Purpose:** show the founder's checkout, settlement, moderation, receipt, public
listing, and source-repository records across devices without exposing payer
identity.

**Primary actions:** open receipts and campaign records, inspect source, and edit
the current project name, category, optional community country, or direct funding
link. An active listing also offers an Add placement action that loads its current
identity into the checkout form. The paid destination and repository identity are immutable. Every edit
creates a listing version and returns an active listing to review before public
display.

The account also owns the contributor-profile editor. Profile data is saved
independently from project/payment records and becomes public only when the
signed-in user checks the publication control.

The account includes a private privacy-request docket. A signed-in user can ask
for access, correction, deletion, or processing restriction, cancel an active
request, read its assigned operator response, and open the published retention,
provider, and privacy documents.

### `/contributors` — opt-in contributor directory

**User:** visitors and GitHub-authenticated contributors.

**Purpose:** find real people who have explicitly published their availability
for open-source contribution without scraping or inventing identities.

**Real data:** public GitHub identity, authored headline and bio, normalized skill
list, optional country, availability, and live skill/country facets.

**Primary actions:** filter by exact skill or country, open the contributor's
public GitHub profile, or return to the account page to publish/hide a profile.

**Design:** a black directory field holding deliberately misregistered,
paper-yellow contributor cards. Cards contain only real opt-in profile data.

### `/opportunities` — repository-bound contribution requests

**User:** contributors and maintainers.

**Purpose:** connect opt-in contributors to concrete work instead of sending them
only to a generic repository homepage.

**Real data:** maintainer-authored request, canonical URL inside the verified
repository, project/category, repository language, OSI-approved SPDX license,
optional community country, and current active listing state.

**Primary actions:** filter by category, language, or country; inspect the public
project record; open the exact GitHub issue, discussion, or contribution
document; or send one private application from a published available contributor
profile. The page includes only active sponsored project records but orders by
recent project update, never placement spend.

**Design:** pink/yellow misregistered paper requests on a black field, separate
from the paid leaderboard's visual and ordering semantics.

### `/bids` — project bidding guide

**User:** open-source maintainers deciding whether to buy placement and visitors
checking how the sponsored board works.

**Purpose:** explain ownership verification, rank quotes, provider settlement,
review, reversals, and repeat placements in one public page.

**Real data:** active open-source project count, net settled placement volume,
placement count, minimum placement, and the current five overall leaders. The
page leaves live values blank when storage is unavailable.

**Primary actions:** start a new placement, add to an owned active project, open
the full board, inspect a leading project, and read the placement rules.

**Design:** a paper placement desk over a black halftone ledger, with a torn
formula slip that shows how signed placement changes the current net total.

### `/receipt/[reference]` — settlement and recovery record

**User:** founder; URL is public but contains no payer data.

**Purpose:** show the authoritative state after returning from the configured
placement-payment provider.

**Real data:** checkout state, contribution, quoted ranks, current ranks,
settlement time, listing status, ledger entry, cumulative reversal, moderation
note, DNS ownership proof, and receipt-linked support intake.

**Primary states:** creating, pending signed event, settled and under review,
settled and active, partially refunded, refunded, disputed, removed, expired,
failed, and temporarily unavailable.

**Primary actions:** refresh automatically while pending, create/check DNS TXT
proof, open destination when active, view board, read rules, and create a private
support case. DNS and support actions appear only in the browser holding the
founder capability; the payment and rank record remains public everywhere.

**Design:** a settlement stamp and before/after rank panel. DNS proof is rendered
as a rotated paper-yellow tear-off slip containing the exact public record.

### `/listing/[slug]` — public campaign record

**User:** visitor and founder.

**Purpose:** prove what the sponsored placement received and why it has its
current rank.

**Real data:** net total, category/overall rank, verified contribution count,
verified outbound total, moderation approval note, complete contribution and
reversal ledger, a 90-day overall/category rank trail from durable observations,
and a 30-day click decision summary.

**Primary states:** active listing with observations, active listing awaiting its
first hourly observation, or not found. Review and removed listings do not expose
a public campaign page; their financial receipt remains available.

**Primary actions:** visit sponsored destination, open individual receipts,
return to board, and download the campaign report.

**Design:** product name as the dominant typographic object, followed by a
four-cell evidence grid, chronological ledger, and ruled-paper rank trail. The
SVG chart has a text alternative and a readable latest-observation table.
Negative financial entries use a materially different paper treatment.
Each active record also publishes a canonical URL, source-code metadata, and a
breadcrumb back to its category.

### `/support/[reference]#token` — private support thread

**User:** founder holding the private fragment token.

**Purpose:** read and reply to a receipt-linked support case without an account or
stored email address.

**Real data:** category, founder messages, operator messages, case state, receipt
reference, and timestamps.

**Primary states:** missing token, invalid token, loading, open, awaiting founder,
resolved, closed, reply submitting, and temporarily unavailable.

**Primary actions:** return to receipt and add a reply when requested.

**Design:** a private correspondence record. The token stays in the URL fragment
and is sent only in the Authorization header.

### `/legal/rules`, `/legal/terms`, `/legal/privacy`, `/legal/retention`, `/legal/processors`, `/legal/refunds`

**User:** all users.

**Purpose:** define placement rules, financial expectations, data handling,
moderation, and refund boundaries before checkout.

**Primary actions:** return home and contact the real support address after it is
configured.

**Design:** typeset document pages with strong section rules; no decorative data.

### `GET|POST /api/account/privacy-requests`

Requires the hashed founder session and returns only that account's latest 20
requests with `private, no-store`. `POST` requires same-origin JSON, rate
limiting, one of four explicit request types, and 20–1200 characters of authored
detail. A partial unique index permits one open or in-progress request per type.

### `PATCH /api/account/privacy-requests/[reference]`

Allows the signed-in request owner to cancel an open or in-progress request.
The route requires same-origin authentication and never accepts an operator
response or another account's reference.

### `/not-found` and global error surface

**User:** all users.

**Purpose:** recover from invalid listing, receipt, support, or route references
without exposing framework errors.

**Primary actions:** return to board, open a known receipt, or retry a failed
request.

**Design:** a visibly void ledger row, using the same paper system rather than a
generic framework template.

## API plan

### `GET /api/board?category=&language=&country=`

Returns at most 100 active open-source listings, available primary repository
languages/countries, and open-source totals. Category and country are enums and
language input is bounded. Commercial kind requests are rejected rather than
exposed as a hidden second market.
Response is uncached until a short edge-cache policy is proven safe. Database
failure returns `503 board_unavailable`; no fallback listings are invented.

Costly customer mutations use two abuse boundaries. The Cloudflare Worker first
applies a 20-per-minute, route-scoped burst counter keyed by a deployment-salted
hash of the strongest available request credential. PostgreSQL then enforces
the exact endpoint-specific user/window quota. Raw authorization headers,
cookies, and IP addresses are never used as edge keys. Signed payment webhooks
are excluded so provider retries cannot be dropped; signature verification,
event claiming, and idempotent settlement are their boundary.

### `POST /api/quote`

Accepts normalized destination, category, the required `open_source` kind, and
integer cents. Commercial or omitted product kinds are rejected.
Returns current and
projected totals/ranks, entry counts, category leader, minimum amount to lead,
review requirement, and snapshot time. Review/removed destinations are rejected.

### `POST /api/checkout`

Same-origin JSON request with an idempotency key and a fresh Cloudflare Turnstile
token. The server validates the token, action, and hostname, recalculates the
quote, resolves both A and AAAA records through DNS-over-HTTPS wire format,
rejects the destination if any answer is private, loopback, link-local,
documentation, multicast, or reserved, stores a privacy-minimized fingerprint
of the accepted address set with the expected economic intent, creates an exact-price hosted checkout
through the configured Creem or Dodo adapter, sets a receipt-scoped HttpOnly founder cookie, and returns checkout plus
receipt URLs. It never changes listing rank.
Every new checkout requires a GitHub maintainer session and verifies the public
personal repository owner or a committed `.bidstage.json` organization
authorization bound to the signed-in GitHub user ID, GitHub SPDX detection, an
exact match in OSI's canonical approved-license API, optional ISO country code,
and canonical GitHub Sponsors or Open Collective funding URL before payment is
created. Funding is profile data, never part of the checkout amount or rank
ledger. The GitHub OAuth token is still discarded after identity lookup.

### `GET /api/account/products`

Requires the hashed founder session and returns at most 100 checkout and listing
records owned by that founder. Always `private, no-store`.

### `GET /api/listings/[slug]/placement`

Returns the public identity and current placement total for one active,
open-source listing. The repeat-placement form locks those fields. Checkout
compares the submitted name, category, repository, profile, and contribution
opportunity with the current listing before it requests payment.

### `PATCH /api/account/listings/[slug]`

Requires the founder session, same-origin request, ownership of the listing, and
a per-founder edit rate limit. It can change only validated title and category.
The transaction locks the listing, appends an owner version, and moves it to
review. Removed listings require receipt support.

Paying into an existing listing never grants or transfers founder ownership.
The account response exposes editability only when the authenticated founder is
already the recorded owner of a non-removed listing.

### `GET|PUT /api/account/contributor-profile`

Requires the hashed founder session and always returns `private, no-store`.
`PUT` additionally requires same-origin JSON and rate limiting. It validates an
authored headline, optional bio/country, 1–8 normalized skills, availability,
and an explicit public/private boolean before an idempotent upsert.

### `GET /api/contributors?skill=&country=`

Returns at most 100 explicitly public contributor profiles plus unfiltered live
skill and country facets. It exposes public GitHub profile data and authored
directory fields only—never database IDs, sessions, payer data, or hidden
profiles. Invalid filters fail with `400`; database failure fails closed with
`503` and no invented profiles.

### `GET /api/opportunities?category=&language=&country=`

Returns at most 100 active, maintainer-authored contribution requests plus live
language and country facets. Each URL is normalized and verified to point to
concrete work inside the listing's immutable repository identity before storage.
Results use recent project-update order, not rank or placement value.

### `POST /api/opportunities/[slug]/applications`

Requires a GitHub session, same-origin JSON, rate limiting, and a public
contributor profile whose availability is `available` or `limited`. It creates
one private plain-text application per contributor/project only when the listing
is active, has repository-bound work, has a recorded maintainer, and is not
owned by the applicant. It never creates a bounty, payment, or public activity.

### `GET /api/account/applications` and `PATCH /api/account/applications/[id]`

The private uncached account projection returns outgoing applications to the
contributor and incoming applications only for listings owned by the maintainer.
Contributors may withdraw a pending application; the project maintainer may
accept or decline it. Transitions are one-way from `pending`. Hiding a profile
removes its headline/skills from future maintainer reads but preserves the
explicitly shared GitHub identity, message, and audit state.

### `GET|POST /api/account/applications/[id]/messages`

Requires the hashed founder session and an accepted application. Only the
recorded contributor and the project maintainer may read or append plain-text
messages. Pending, declined, and withdrawn applications cannot open a thread.
Messages are private, append-only, rate-limited, and always `private, no-store`.

### `POST /api/webhooks/creem`

Reads the raw body, verifies `creem-signature`, claims provider event ID, and
processes `checkout.completed`, `refund.created`, and `dispute.created` inside a
database transaction. Settlement adds one positive ledger entry. Refund/dispute
events add only the new negative delta. Unknown events are explicitly ignored.
Failed processing is recorded outside the rolled-back fulfillment transaction
with a stable incident reference so operators can request a provider-signed
resend without introducing a local rank-minting replay path.

### `POST /api/webhooks/dodo`

Reads the exact raw body and verifies the Standard Webhooks ID, timestamp, and
HMAC signature with a five-minute replay window. It validates the configured
business, one-time tax-inclusive USD product, checkout session, immutable
checkout metadata, amount, currency, and Dodo-processed payment before passing a
normalized settlement into the shared ledger transaction. `refund.succeeded`
adds only its new reversal delta and `dispute.opened` conservatively removes the
remaining rank value. Event and checkout idempotency are provider-scoped.

### `GET /api/receipts/[reference]`

Returns a payer-free receipt projection: payment state, product, quote,
settlement, current ranks, adjustment, latest moderation result, and a boolean
indicating whether this browser holds founder access. It never returns the
capability or its hash. Always `no-store`.

### `POST /api/receipts/[reference]/verification`

Actions: `create` and `verify`. Creates or rotates a seven-day DNS TXT challenge,
then checks the exact value through a fixed public DNS resolver. Attempts are
rate-limited and require the receipt-scoped founder cookie. Verification proves
destination control but does not bypass safety moderation.

### `POST /api/support`

Requires the receipt-scoped founder cookie and creates a receipt-linked private
case. Stores no email. Returns a case reference and a URL whose fragment contains
the only read token. The token is stored only as a SHA-256 hash.

### `GET /api/support/[reference]`

Requires the fragment token as a Bearer value. Returns the support thread and
case state with `private, no-store` caching.

### `POST /api/support/[reference]/messages`

Requires the same Bearer token. Appends a founder message only when the case is
open or awaiting the founder, changes `needs_customer` back to `open`, and never
overwrites earlier correspondence.

### `GET /api/listings/[slug]/report.csv`

Returns a CSV campaign report for an active listing: current rank and totals,
ledger movements, moderation record, and aggregate verified traffic. It contains
no payer identity, visitor identifiers, raw IP addresses, or private support.

### `GET /api/listings/[slug]/ledger?cursor=`

Returns 25 public ledger movements at a time using a stable timestamp/UUID cursor.
The endpoint exposes only movement type, amount, time, and public receipt
reference. Short public caching is permitted because the payload contains no
payer data.

### `GET /api/listings/[slug]/rank-history`

Returns at most 180 evenly sampled observations from the prior 90 days for an
active open-source listing. Each point contains only observation time, overall
and category position/field size, aggregate settled cents, and placement count.
The hourly job persists changes in those values plus one daily unchanged
checkpoint; it never stores payer or provider identifiers in this table.

### `GET|HEAD /go/[slug]`

Redirects active listings only. `HEAD` never counts. `GET` records an append-only
decision and increments the public counter only for verified navigation.

### `GET /api/health`

Checks database, edge limiter, maintenance, and selected
payment-provider readiness for infrastructure monitoring. It returns no secrets,
build identifiers, or internal connection details.

## State machines

### Payment checkout

`creating → pending → settled → partially_refunded → refunded`

Any settled state may become `disputed`. Creation may become `failed`; an unpaid
provider checkout may become `expired`. Rank value is the sum of ledger entries,
not an inference from the state label.

### Listing visibility

`review → active → review → removed → active`

The transitions correspond to approve, suspend, remove, and restore. A financial
reversal that reduces the total to zero returns an active listing to review.

### Support case

`open ↔ needs_customer → resolved → closed`

Messages are append-only. Operator actions and state changes are audited.

### Privacy request

`open → in_progress → completed | declined`

The account owner may move `open` or `in_progress` to `cancelled`. An operator
must claim a request before resolving it, and the same operator identity must
complete it. The deletion minimizer removes eligible profile/session data in one
transaction while preserving records covered by the retention schedule.

## Data and privacy boundaries

- PostgreSQL stores payment/provider references, public product data, salted
  payer-email hashes, rank ledger, moderation history, click decisions, DNS proof,
  support threads, and operator audit events.
- The configured placement processor (Creem or Dodo Payments) stores card and
  billing information. Bidstage never receives card data.
- Click session hashes are salted, scoped to a listing, retained for deduplication,
  and not exposed publicly.
- Support access tokens are returned once and stored only as hashes.
- GitHub OAuth access tokens are discarded after identity lookup. PostgreSQL
  stores durable public GitHub identity and hashed random founder sessions.
- Contributor profiles remain private by default. Public directory fields are
  published or hidden through the authenticated account control; no GitHub users
  are scraped into the directory.
- Privacy requests remain private to the signed-in account and operators. Audit
  events store request state, record counts, response length, and a response
  fingerprint rather than copying the authored request or response body.
- Hourly maintenance runs retain only scheduled time, state, and aggregate
  cleanup/activity/health counts. Public rank observations retain aggregate
  listing position and settled value while that listing remains in the public
  record; they contain no payer or provider identifiers. The internal route requires a dedicated service
  credential, accepts only the configured UTC cron expression and a bounded
  timestamp, and never stores or logs the credential. Completed run summaries
  expire after 400 days.
- Contribution applications and accepted-application correspondence are private
  to the applicant and recorded project maintainer. They contain no email address
  and create no payment or employment promise; every follow-up is authored plain
  text attached to the verified GitHub identities.
- Founder capabilities are scoped to one receipt, stored in an HttpOnly,
  SameSite cookie, and represented in PostgreSQL only by a SHA-256 hash.
- R2 is not required for release one, keeping the shared Cloudflare bill low.

## Release boundary

Code completion is not production evidence. Release still requires migrations on
Neon, configured provider sandbox and live credentials, signed webhook delivery,
one external low-value payment, moderation and DNS proof, verified redirect,
refund reversal, support exchange, backup restore, and deployment rollback.
