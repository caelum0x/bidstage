# Bidstage release runbook

Last revised: 24 August 2026

This runbook produces one low-cost Cloudflare Worker backed by Neon and either
Creem or Dodo Payments for one-time sponsored placement.
It intentionally provisions no R2 bucket, Queue, Durable Object, Images binding,
Workers AI model, or paid analytics product.

## 1. Required external values

Obtain these before release:

- a Neon PostgreSQL connection string for the migration role;
- a separate Neon runtime role that cannot create, alter, or drop schema;
- either a Creem custom-price USD product or a Dodo tax-inclusive USD Pay What
  You Want product, plus that provider's sandbox API and webhook credentials;
- the final `bidstage.app` registration and DNS zone, or an approved standard-
  price fallback from `PRODUCTION-PLAN.md`;
- a free Cloudflare Turnstile widget restricted to the final hostname;
- a GitHub OAuth app with callback `https://bidstage.app/api/auth/github/callback`;
- a least-privilege GitHub token used only for public repository metadata;
- the Cloudflare account ID and a task-scoped API token with URL Scanner Read
  and Write permissions for the operator environment;
- an active `support@bidstage.app` mailbox or Cloudflare Email Routing rule;
- a random `RATE_LIMIT_SALT` of at least 32 bytes;
- an independent random `MAINTENANCE_SECRET` of at least 32 bytes.

Never place any of these values in a committed file or a command literal. The
Cloudflare token previously pasted into chat must be revoked and replaced with a
least-privilege deployment token.

## 2. Create the database

Using the migration-role connection string in a private shell environment:

```text
bun install --frozen-lockfile
bun run migrate
```

Confirm all twenty-three files in `db/migrations` appear in `schema_migrations`, then
switch the application to the restricted runtime-role connection string.

Before staging, run the transaction suite against an isolated database. The
database name must contain `test`:

```text
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/bidstage_test bun run test:integration
```

Do not deploy if this command fails. This is a manual release gate, so the
release operator must preserve the terminal output with the release record.

## 3. Create Hyperdrive

Authenticate Wrangler through its browser login or an unexposed environment
token. Create one Hyperdrive configuration from the restricted Neon runtime URL:

```text
read -s BIDSTAGE_NEON_RUNTIME_URL
bunx wrangler hyperdrive create bidstage-neon --connection-string="$BIDSTAGE_NEON_RUNTIME_URL" --caching-disabled
unset BIDSTAGE_NEON_RUNTIME_URL
```

The shell history records only the variable name, not the secret value. Copy the
returned configuration ID, then add this top-level block to `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "the-returned-configuration-id"
  }
]
```

Run `bun run cf-typegen` after adding the binding. Do not also upload
`DATABASE_URL`; `lib/db.ts` automatically prefers Hyperdrive in Workers and uses
the direct URL only for migration, operator, local, and Docker processes.

The committed `EDGE_WRITE_RATE_LIMITER` binding uses namespace `284712001` and
a 20-request, 60-second policy. Confirm that namespace is not used by another
rate-limit binding in this Cloudflare account before the first deployment;
bindings that reuse a namespace share counters. If it collides, choose another
stable positive integer string, update `wrangler.jsonc`, and rerun
`bun run cf-typegen`. Cloudflare evaluates these counters per location and with
eventual consistency, so they are only the early burst boundary. PostgreSQL
continues to enforce the exact per-user and per-window limits.

## 4. Configure Worker secrets

Wrangler prompts for each value without writing it to source:

```text
bunx wrangler secret put CREEM_API_KEY
bunx wrangler secret put CREEM_WEBHOOK_SECRET
bunx wrangler secret put CREEM_PRODUCT_ID
bunx wrangler secret put TURNSTILE_SITE_KEY
bunx wrangler secret put TURNSTILE_SECRET_KEY
bunx wrangler secret put FOUNDER_ACCESS_SECRET
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put GITHUB_API_TOKEN
bunx wrangler secret put RATE_LIMIT_SALT
bunx wrangler secret put MAINTENANCE_SECRET
```

When `PAYMENT_PROVIDER=dodo`, set `DODO_PAYMENTS_API_KEY`,
`DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_PRODUCT_ID`, and
`DODO_PAYMENTS_BUSINESS_ID` instead. Keep the previous provider's webhook secret
available during migration so late refunds and disputes can still be processed.

`TURNSTILE_SITE_KEY` is public in the browser but is managed with the same
release prompts so one command works across environments. For sandbox staging,
set `CREEM_TEST_MODE=true` and use a staging `APP_URL`.
Production uses the `APP_URL` and `CREEM_TEST_MODE=false` values committed in
`wrangler.jsonc`. Secrets must be set separately for every named Wrangler
environment.

`FOUNDER_ACCESS_SECRET` must be independent from the rate-limit salt. Rotating it
invalidates founder cookies for unsettled and existing receipts, so rotation is
an incident procedure rather than a routine deployment step.

`MAINTENANCE_SECRET` authenticates only the service-binding request made by the
Worker's hourly UTC Cron Trigger. Keep it independent from founder, payment,
GitHub, and rate-limit secrets. The public route returns `404` for an invalid
credential, compares fixed-size hashes in constant time, and never logs the
credential.

The GitHub OAuth app must have no requested OAuth scopes and must not use a
wildcard callback. `GITHUB_API_TOKEN` is server-only and requires no write
permission. Bidstage discards each user OAuth access token after the `/user`
identity lookup; founder sessions contain a random token whose hash is stored in
PostgreSQL.

Keep `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_URL_SCANNER_TOKEN` in the private
operator environment. They are not application runtime secrets and must not
be added with `wrangler secret put`. Use a custom account token limited to URL
Scanner Read and Write; never use the Global API Key. Bidstage submits public
scans because project destinations and receipts are public and the free/Radar
scanner allowance does not include unlisted scans.

## 5. Build and deploy

```text
bun run typecheck
bun run test
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/bidstage_test bun run test:integration
bun run build:worker
bunx wrangler deploy --dry-run
bun run deploy:worker
SMOKE_BASE_URL=https://bidstage.app bun run smoke:http
```

Run these commands in order from a clean `main` checkout. Stop at the first
failure. The final smoke test must run against the deployed origin, not a local
development server.

The accepted artifact contains `.open-next/worker.js` plus immutable assets in
`.open-next/assets`. The current dry run is approximately 5.9 MiB before gzip
and 1.2 MiB after gzip.

The deployment installs one UTC Cron Trigger from `wrangler.jsonc`:
`15 * * * *` for maintenance.
The current Cloudflare Free limit permits five Cron Triggers per account.
Trigger changes can take several minutes to propagate. After the first scheduled
run, `/api/health` must report `maintenance=ready`; inspect structured Worker
logs for `maintenance.completed` or `maintenance.attention`. A completed run is
recorded in `maintenance_runs`, while the request body and secret are not. Its
`activityCounts.rank_observations` value reports how many active projects wrote
a changed or daily rank checkpoint; each active open-source listing must have a
fresh row in `listing_rank_observations` after the first run.
`activityCounts.destination_rechecks` and `destination_suspensions` report the
continuing DNS check and pause counts. The job checks at most 20 projects with
two concurrent destinations, so it stays below the Workers Free external
subrequest limit and covers at most 480 active projects in 24 hours. The release
audit fails above that launch capacity. Move rechecks to a paid Worker limit or a
partitioned queue before crossing it; do not weaken the 24-hour freshness gate.
See the [current Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
before changing the batch or concurrency.
Custom logs are retained at 100% sampling so the hourly result is not randomly
discarded; automatic per-request invocation logs are disabled and traces remain
sampled at 5% to control volume.

### Read-only release audit

After deployment, point `DATABASE_URL` at the restricted runtime role—not the
migration owner—and set `RELEASE_BASE_URL` to the exact staging or production
origin. Then run:

```text
bun run audit:release
```

The command does not mutate the database. It fails the release on missing or
modified migrations, schema-changing role privileges, financial-ledger drift,
checkout/fulfillment inconsistencies, missing post-migration DNS-review or
activation-scan evidence, missing or invalid public rank observations, invalid application-message authors, overdue privacy
requests, expired privacy-request retention, stuck payment events or destination
scans, stale or rejected active-destination DNS evidence, unpublished policy and
crawler pages, an unhealthy deployment, a provider mismatch,
or missing security headers. A non-local release also fails unless `/api/health`
reports the Cloudflare edge limiter as configured. Pending checkouts older than one hour are warnings that require
read-only provider reconciliation before launch. Use `--skip-http` or `--skip-db`
only to isolate a failure; neither partial run is launch evidence.

## 6. Configure payment webhooks

Register this exact webhook URL in Creem:

```text
https://bidstage.app/api/webhooks/creem
```

Enable `checkout.completed`, `refund.created`, and `dispute.created`. The return
URL is generated by the server as `/receipt/<public-reference>`; a browser return
never settles a contribution.

For Dodo Payments, register `/api/webhooks/dodo` and enable
`payment.succeeded`, `refund.succeeded`, and `dispute.opened`. Set
`DODO_PAYMENTS_TEST_MODE=true` for sandbox, and confirm the dashboard product is
one-time, USD, tax-inclusive, Pay What You Want, with a minimum no greater than
Bidstage's USD 5 minimum. Bidstage sends an exact amount and disables discounts,
add-on editing, and currency selection.

## 7. Founder golden path

Use a new destination and the smallest allowed sandbox contribution:

1. Sign in with GitHub, load `/`, obtain a live quote, accept the
   sponsored-placement rules, and
   continue to the configured provider.
2. Complete payment and confirm the receipt remains pending until the signed
   webhook arrives.
3. Confirm exactly one positive ledger movement exists and the destination is in
   review, not active.
4. Publish the receipt's DNS TXT record and verify it. Run
   `bun run operator -- scan <listing-slug>`, wait 10–30 seconds, and rerun the
   same command to persist the public Cloudflare verdict. Approve only after the
   scan passes; the approval command enforces both pieces of evidence.
5. Confirm the board, `/listing/<slug>`, `/go/<slug>`, CSV report, public
   rank-history endpoint, and private support thread all work from an unrelated
   browser/network. After the next hourly job, the campaign page must show a
   real rank observation matching its active position.
6. Issue a partial sandbox refund and confirm a single negative ledger movement,
   reduced total, unchanged historical receipt, and correct rank.

Repeat once with a low-value live payment before public launch. Never use a
self-payment as the only release evidence.

Repeat the sandbox path for an open-source entry owned by the signed-in personal
GitHub account. Confirm a recognized SPDX license is required, the repository
appears on the receipt and campaign record, and `/account` shows the checkout.

Submit one access request and one deletion request from `/account#privacy-requests`.
For each, confirm the operator must claim it before resolution. Run
`privacy-minimize` only for the deletion request and confirm the contributor
profile, pending applications, optional display name, and active sessions are
removed while financial and accepted-correspondence records remain.

## 8. Rollback and recovery

- Keep the Docker image path until two Worker upgrades and one rollback pass.
- Use Cloudflare deployment versions to roll back code; never reverse ranking by
  editing totals.
- Restore a Neon backup into an isolated project, run `/api/health`, compare
  ledger sums against listing totals, and record the drill before launch.
- If provider delivery fails, use `bun run operator -- reconcile <reference>` for
  a read-only Creem or Dodo comparison, then resend the signed provider event. The operator tool
  cannot mint rank.

## 9. Configure support email

Do not use the Allowlist or Blocklist dashboard starter. Bidstage support must
accept messages from customers who have never contacted the business before.

1. Wait until `bidstage.app` registration and DNS are active, then onboard the
   domain under **Email Service → Email Routing**. Allow Cloudflare to create the
   required MX and TXT records.
2. Under **Destination Addresses**, add the private inbox that will receive
   support mail and complete the verification message sent to it.
3. Deploy the dedicated mail Worker:

   ```text
   bun run deploy:email
   cd email-worker
   ../node_modules/.bin/wrangler secret put SUPPORT_FORWARD_TO
   cd ..
   ```

   Enter the verified private destination inbox only at the secret prompt.
   If the Worker does not exist yet, set the secret first, then run
   `bun run deploy:email` again. The email Worker has its own package metadata
   and Wrangler config, and the deploy script changes into that isolated project
   so Wrangler cannot redirect it into the adjacent OpenNext app.
4. Create one routing rule: pattern `support` on `bidstage.app`, action **Send to
   a Worker**, destination `bidstage-support-mail`. Do not enable catch-all.
5. Send a real message from an unrelated mailbox to `support@bidstage.app` and
   confirm the forwarded message arrives with its original subject and reply
   address. Reply from the destination inbox only after confirming its sending
   identity is configured; the Worker deliberately sends no automatic reply.

The Worker accepts only `support@bidstage.app`, forwards to the verified secret
destination, stores no message content, and uses no R2, KV, D1, Queue, Durable
Object, or paid email add-on.
