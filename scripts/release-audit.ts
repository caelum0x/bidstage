import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { database } from "../lib/db";
import { auditMigrationNames, auditResponseHeaders, type ReleaseCheck } from "../lib/release-audit";

type AppliedMigration = { name: string; sha256: string };
type CountRow = { count: string };

const checks: ReleaseCheck[] = [];
let databaseUsed = false;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, status: ok ? "pass" : "fail", detail });
}

function warning(name: string, detail: string): void {
  checks.push({ name, status: "warn", detail });
}

async function count(sql: string): Promise<number> {
  const result = await database().query<CountRow>(sql);
  return Number(result.rows[0]?.count ?? Number.NaN);
}

async function auditHttp(baseUrl: string): Promise<void> {
  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    record("release URL", false, "--url must be an absolute HTTP(S) URL");
    return;
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(origin.hostname);
  record("release transport", origin.protocol === "https:" || local, local ? "local preview exception" : origin.protocol);
  const healthResponse = await fetch(new URL("/api/health", origin), {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const health = await healthResponse.json().catch(() => undefined) as Record<string, unknown> | undefined;
  record(
    "deployed readiness",
    healthResponse.ok && health?.ok === true && health.database === "ready",
    healthResponse.ok ? `${health?.service ?? "unknown"}; database=${health?.database ?? "unknown"}` : `HTTP ${healthResponse.status}`,
  );
  const edgeMode = String(health?.edge_rate_limit ?? "unknown");
  record(
    "deployed edge rate limiter",
    edgeMode === "configured" || (local && edgeMode === "database_only"),
    local ? `${edgeMode}; local database-only mode permitted` : edgeMode,
  );
  const maintenance = String(health?.maintenance ?? "unknown");
  record(
    "deployed scheduled maintenance",
    ["ready", "running", "awaiting_first_run"].includes(maintenance),
    maintenance,
  );
  const expectedProvider = (process.env.PAYMENT_PROVIDER?.trim().toLowerCase() || "creem");
  record(
    "deployed payment provider",
    health?.payment_provider === expectedProvider,
    `expected=${expectedProvider}; deployed=${String(health?.payment_provider ?? "unknown")}`,
  );
  record(
    "health response is uncached",
    (healthResponse.headers.get("cache-control") ?? "").includes("no-store"),
    healthResponse.headers.get("cache-control") ?? "header missing",
  );

  const pageResponse = await fetch(new URL("/auth/error", origin), {
    headers: { Accept: "text/html" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  record("static release page", pageResponse.ok, `HTTP ${pageResponse.status}`);
  checks.push(...auditResponseHeaders(pageResponse.headers, origin.protocol === "https:"));

  for (const [path, marker] of [
    ["/legal/privacy", "Privacy notice"],
    ["/legal/retention", "Data retention schedule"],
    ["/legal/processors", "Service provider register"],
    ["/legal/refunds", "Refund policy"],
  ] as const) {
    const response = await fetch(new URL(path, origin), {
      headers: { Accept: "text/html" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    record(
      `deployed policy ${path}`,
      response.ok && body.includes(marker),
      response.ok ? (body.includes(marker) ? "published" : "expected title missing") : `HTTP ${response.status}`,
    );
  }

  const bidsPage = await fetch(new URL("/bids", origin), {
    headers: { Accept: "text/html" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const bidsBody = await bidsPage.text();
  record(
    "deployed project bidding guide",
    bidsPage.ok && bidsBody.includes("How project bidding works") && bidsBody.includes("Start a placement"),
    bidsPage.ok ? "open-source placement boundary published" : `HTTP ${bidsPage.status}`,
  );

  const [categoriesResponse, robotsResponse, sitemapResponse] = await Promise.all([
    fetch(new URL("/categories", origin), {
      headers: { Accept: "text/html" }, redirect: "error", signal: AbortSignal.timeout(10_000),
    }),
    fetch(new URL("/robots.txt", origin), {
      headers: { Accept: "text/plain" }, redirect: "error", signal: AbortSignal.timeout(10_000),
    }),
    fetch(new URL("/sitemap.xml", origin), {
      headers: { Accept: "application/xml" }, redirect: "error", signal: AbortSignal.timeout(10_000),
    }),
  ]);
  const [categoriesBody, robotsBody, sitemapBody] = await Promise.all([
    categoriesResponse.text(), robotsResponse.text(), sitemapResponse.text(),
  ]);
  record(
    "deployed category index",
    categoriesResponse.ok && categoriesBody.includes("Project categories."),
    categoriesResponse.ok ? "public category index published" : `HTTP ${categoriesResponse.status}`,
  );
  record(
    "deployed crawler rules",
    robotsResponse.ok
      && robotsBody.includes("Sitemap: https://bidstage.app/sitemap.xml")
      && robotsBody.includes("Disallow: /api/")
      && robotsBody.includes("Disallow: /receipt/"),
    robotsResponse.ok ? "sitemap advertised and private routes excluded" : `HTTP ${robotsResponse.status}`,
  );
  record(
    "deployed public sitemap",
    sitemapResponse.ok
      && sitemapBody.includes("/categories</loc>")
      && sitemapBody.includes("/category/developer</loc>")
      && !/\/(?:api|account|receipt|support)\//.test(sitemapBody),
    sitemapResponse.ok ? "category routes present; private routes absent" : `HTTP ${sitemapResponse.status}`,
  );
}

async function auditDatabase(): Promise<void> {
  databaseUsed = true;
  const migrationsDirectory = resolve(process.cwd(), "db", "migrations");
  const files = (await readdir(migrationsDirectory)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  const applied = await database().query<AppliedMigration>(
    "SELECT name, sha256 FROM schema_migrations ORDER BY name",
  );
  checks.push(...auditMigrationNames(files, applied.rows.map((row) => row.name)));
  const hashes = new Map(applied.rows.map((row) => [row.name, row.sha256]));
  const mismatchedHashes: string[] = [];
  for (const file of files) {
    const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    if (hashes.get(file) !== digest) mismatchedHashes.push(file);
  }
  record(
    "applied migration hashes",
    mismatchedHashes.length === 0,
    mismatchedHashes.length ? `mismatch: ${mismatchedHashes.join(", ")}` : `${files.length} hashes match`,
  );

  const privileges = await database().query<{
    database_create: boolean;
    schema_create: boolean;
    dangerous_table_privileges: string;
  }>(
    `SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
            has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
            (SELECT count(*)::text
             FROM information_schema.role_table_grants
             WHERE grantee = current_user
               AND table_schema = 'public'
               AND privilege_type IN ('TRIGGER', 'TRUNCATE', 'REFERENCES')) AS dangerous_table_privileges`,
  );
  const privilege = privileges.rows[0];
  record(
    "runtime role cannot change schema",
    privilege?.database_create === false && privilege.schema_create === false,
    privilege ? `database_create=${privilege.database_create}; schema_create=${privilege.schema_create}` : "privilege query returned no row",
  );
  record(
    "runtime role avoids administrative table grants",
    privilege?.dangerous_table_privileges === "0",
    `${privilege?.dangerous_table_privileges ?? "unknown"} administrative grants`,
  );

  const ledgerMismatches = await count(
    `SELECT count(*)::text AS count
     FROM listings AS listing
     LEFT JOIN (
       SELECT listing_id, coalesce(sum(amount_cents), 0) AS ledger_total
       FROM rank_ledger GROUP BY listing_id
     ) AS ledger ON ledger.listing_id = listing.id
     WHERE listing.total_cents <> coalesce(ledger.ledger_total, 0)`,
  );
  record("listing totals equal immutable ledger", ledgerMismatches === 0, `${ledgerMismatches} mismatches`);

  const bidCountMismatches = await count(
    `SELECT count(*)::text AS count
     FROM listings AS listing
     LEFT JOIN (
       SELECT listing_id, count(*) FILTER (WHERE refunded_cents < amount_cents) AS active_bids
       FROM bids GROUP BY listing_id
     ) AS bid ON bid.listing_id = listing.id
     WHERE listing.bid_count <> coalesce(bid.active_bids, 0)`,
  );
  record("listing contribution counts match bids", bidCountMismatches === 0, `${bidCountMismatches} mismatches`);

  const economicMismatches = await count(
    `SELECT count(*)::text AS count
     FROM bids AS bid
     JOIN payment_checkouts AS checkout ON checkout.id = bid.checkout_id
     WHERE bid.provider <> checkout.provider
        OR bid.amount_cents <> checkout.contribution_cents
        OR checkout.state IN ('creating', 'pending', 'failed', 'expired')`,
  );
  record("settled bids match checkout intent", economicMismatches === 0, `${economicMismatches} mismatches`);

  const missingFulfillments = await count(
    `SELECT count(*)::text AS count
     FROM payment_checkouts AS checkout
     LEFT JOIN payment_fulfillments AS fulfillment
       ON fulfillment.provider = checkout.provider
      AND fulfillment.provider_checkout_id = checkout.provider_checkout_id
     WHERE checkout.state IN ('settled', 'partially_refunded', 'refunded', 'disputed')
       AND fulfillment.provider_checkout_id IS NULL`,
  );
  record("settled checkouts have fulfillment claims", missingFulfillments === 0, `${missingFulfillments} missing claims`);

  const missingDnsReviews = await count(
    `SELECT count(*)::text AS count
     FROM payment_checkouts AS checkout
     WHERE checkout.product_kind = 'open_source'
       AND checkout.created_at >= (
         SELECT applied_at FROM schema_migrations
         WHERE name = '0018_destination_dns_review.sql'
       )
       AND (
         checkout.destination_dns_checked_at IS NULL
         OR checkout.destination_dns_address_count IS NULL
         OR checkout.destination_dns_fingerprint IS NULL
       )`,
  );
  record("new checkouts retain DNS review evidence", missingDnsReviews === 0, `${missingDnsReviews} missing reviews`);

  const activationEvidenceGaps = await count(
    `SELECT count(*)::text AS count
     FROM listing_moderation AS moderation
     JOIN listings AS listing ON listing.id = moderation.listing_id
     WHERE moderation.next_status = 'active'
       AND moderation.created_at >= (
         SELECT applied_at FROM schema_migrations
         WHERE name = '0019_destination_security_reviews.sql'
       )
       AND (
         NOT EXISTS (
           SELECT 1
           FROM destination_verifications AS verification
           WHERE verification.listing_id = listing.id
             AND verification.state = 'verified'
             AND verification.verified_at IS NOT NULL
             AND verification.verified_at <= moderation.created_at
         )
         OR NOT EXISTS (
           SELECT 1
           FROM destination_security_reviews AS review
           WHERE review.listing_id = listing.id
             AND review.destination_fingerprint = encode(digest(listing.destination, 'sha256'), 'hex')
             AND review.state = 'passed'
             AND review.has_verdicts = true
             AND review.malicious = false
             AND review.completed_at <= moderation.created_at
             AND review.expires_at > moderation.created_at
         )
       )`,
  );
  record(
    "post-migration activations retain ownership and URL-scan evidence",
    activationEvidenceGaps === 0,
    `${activationEvidenceGaps} activation evidence gaps`,
  );

  const stuckDestinationScans = await count(
    `SELECT count(*)::text AS count
     FROM destination_security_reviews
     WHERE state = 'pending' AND submitted_at < now() - interval '30 minutes'`,
  );
  record(
    "destination scan queue is clear",
    stuckDestinationScans === 0,
    `${stuckDestinationScans} scans pending over 30 minutes`,
  );

  const missingDestinationRechecks = await count(
    `SELECT count(*)::text AS count
     FROM listings AS listing
     WHERE listing.status = 'active'
       AND listing.product_kind = 'open_source'
       AND NOT EXISTS (
         SELECT 1
         FROM listing_destination_rechecks AS recheck
         WHERE recheck.listing_id = listing.id
           AND recheck.checked_at >= now() - interval '25 hours'
       )`,
  );
  const destinationRecheckMigrationGrace = await count(
    `SELECT count(*)::text AS count
     FROM schema_migrations
     WHERE name = '0023_listing_destination_rechecks.sql'
       AND applied_at >= now() - interval '26 hours'`,
  );
  record(
    "active destinations have current DNS safety evidence",
    missingDestinationRechecks === 0 || destinationRecheckMigrationGrace > 0,
    missingDestinationRechecks === 0
      ? "every active project has a DNS safety result from the last 25 hours"
      : destinationRecheckMigrationGrace > 0
        ? `${missingDestinationRechecks} projects remain inside the bounded first-day migration grace`
        : `${missingDestinationRechecks} active projects lack a current DNS safety result`,
  );

  const unsafeDestinationState = await count(
    `SELECT count(*)::text AS count
     FROM listings AS listing
     JOIN LATERAL (
       SELECT state
       FROM listing_destination_rechecks AS recheck
       WHERE recheck.listing_id = listing.id
       ORDER BY recheck.checked_at DESC
       LIMIT 1
     ) AS latest ON true
     WHERE listing.status = 'active' AND latest.state = 'rejected'`,
  );
  record(
    "rejected DNS destinations leave the active board",
    unsafeDestinationState === 0,
    `${unsafeDestinationState} rejected destinations remain active`,
  );

  const unresolvedDestinationRechecks = await count(
    `SELECT count(*)::text AS count
     FROM (
       SELECT DISTINCT ON (listing_id) listing_id, state, checked_at
       FROM listing_destination_rechecks
       ORDER BY listing_id, checked_at DESC
     ) AS latest
     WHERE latest.state = 'failed' AND latest.checked_at >= now() - interval '24 hours'`,
  );
  record(
    "destination DNS recheck queue has no resolver failures",
    unresolvedDestinationRechecks === 0,
    `${unresolvedDestinationRechecks} latest DNS checks require retry`,
  );

  const expiredDestinationRechecks = await count(
    `SELECT count(*)::text AS count
     FROM listing_destination_rechecks
     WHERE checked_at < now() - interval '407 days'`,
  );
  record(
    "destination DNS evidence retention",
    expiredDestinationRechecks === 0,
    `${expiredDestinationRechecks} checks exceed retention plus cleanup grace`,
  );

  const activeDestinationRecheckCapacity = await count(
    `SELECT count(*)::text AS count
     FROM listings
     WHERE status = 'active' AND product_kind = 'open_source'`,
  );
  record(
    "hourly DNS recheck capacity",
    activeDestinationRecheckCapacity <= 480,
    `${activeDestinationRecheckCapacity}/480 active projects on the free-plan schedule`,
  );

  const overduePrivacyRequests = await count(
    `SELECT count(*)::text AS count
     FROM privacy_requests
     WHERE state IN ('open', 'in_progress')
       AND created_at < now() - interval '30 days'`,
  );
  record(
    "privacy request response window",
    overduePrivacyRequests === 0,
    `${overduePrivacyRequests} active requests older than 30 days`,
  );

  const expiredPrivacyRequests = await count(
    `SELECT count(*)::text AS count
     FROM privacy_requests
     WHERE state IN ('completed', 'declined', 'cancelled')
       AND completed_at < now() - interval '3 years 7 days'`,
  );
  record(
    "closed privacy-request retention",
    expiredPrivacyRequests === 0,
    `${expiredPrivacyRequests} closed requests exceed retention plus cleanup grace`,
  );

  const recentMaintenanceRuns = await count(
    `SELECT count(*)::text AS count
     FROM maintenance_runs
     WHERE state IN ('completed', 'attention')
       AND completed_at >= now() - interval '90 minutes'`,
  );
  const maintenanceMigrationGrace = await count(
    `SELECT count(*)::text AS count
     FROM schema_migrations
     WHERE name = '0021_scheduled_maintenance.sql'
       AND applied_at >= now() - interval '90 minutes'`,
  );
  record(
    "scheduled maintenance is current",
    recentMaintenanceRuns > 0 || maintenanceMigrationGrace > 0,
    recentMaintenanceRuns > 0
      ? `${recentMaintenanceRuns} completed run(s) in the last 90 minutes`
      : maintenanceMigrationGrace > 0 ? "first-run deployment grace" : "no recent completed run",
  );

  const stuckMaintenanceRuns = await count(
    `SELECT count(*)::text AS count
     FROM maintenance_runs
     WHERE (state = 'running' AND started_at < now() - interval '30 minutes')
        OR (state = 'failed' AND completed_at >= now() - interval '24 hours')`,
  );
  record(
    "scheduled maintenance has no unresolved execution failure",
    stuckMaintenanceRuns === 0,
    `${stuckMaintenanceRuns} stale or recently failed runs`,
  );

  const expiredMaintenanceRuns = await count(
    `SELECT count(*)::text AS count
     FROM maintenance_runs
     WHERE state IN ('completed', 'attention', 'failed')
       AND completed_at < now() - interval '407 days'`,
  );
  record(
    "maintenance-run retention",
    expiredMaintenanceRuns === 0,
    `${expiredMaintenanceRuns} runs exceed retention plus cleanup grace`,
  );

  const missingRankObservations = await count(
    `SELECT count(*)::text AS count
     FROM listings AS listing
     WHERE listing.status = 'active'
       AND listing.product_kind = 'open_source'
       AND NOT EXISTS (
         SELECT 1
         FROM listing_rank_observations AS observation
         WHERE observation.listing_id = listing.id
           AND observation.captured_at >= now() - interval '25 hours'
       )`,
  );
  const rankObservationMigrationGrace = await count(
    `SELECT count(*)::text AS count
     FROM schema_migrations
     WHERE name = '0022_listing_rank_observations.sql'
       AND applied_at >= now() - interval '2 hours'`,
  );
  record(
    "active listings have current rank observations",
    missingRankObservations === 0 || rankObservationMigrationGrace > 0,
    missingRankObservations === 0
      ? "every active open-source listing has a change or daily checkpoint from the last 25 hours"
      : rankObservationMigrationGrace > 0
        ? `${missingRankObservations} listings awaiting first-run deployment grace`
        : `${missingRankObservations} listings lack a current observation`,
  );

  const invalidRankObservations = await count(
    `SELECT count(*)::text AS count
     FROM listing_rank_observations
     WHERE overall_rank > overall_entries
        OR category_rank > category_entries
        OR total_cents < 0
        OR bid_count < 0`,
  );
  record(
    "rank observations preserve valid public evidence",
    invalidRankObservations === 0,
    `${invalidRankObservations} invalid observations`,
  );

  const invalidCorrespondence = await count(
    `SELECT count(*)::text AS count
     FROM contribution_application_messages AS message
     JOIN contribution_applications AS application ON application.id = message.application_id
     JOIN listings AS listing ON listing.id = application.listing_id
     WHERE application.state <> 'accepted'
        OR message.author_id NOT IN (application.contributor_id, listing.founder_id)`,
  );
  record("application correspondence remains participant-scoped", invalidCorrespondence === 0, `${invalidCorrespondence} invalid messages`);

  const stuckEvents = await count(
    `SELECT count(*)::text AS count
     FROM payment_events
     WHERE processing_state IN ('received', 'failed')
       AND received_at < now() - interval '5 minutes'`,
  );
  record("payment webhook queue is clear", stuckEvents === 0, `${stuckEvents} stuck events`);

  const staleCheckouts = await count(
    `SELECT count(*)::text AS count
     FROM payment_checkouts
     WHERE state IN ('creating', 'pending')
       AND created_at < now() - interval '1 hour'`,
  );
  if (staleCheckouts > 0) warning("stale checkout review", `${staleCheckouts} checkouts require provider reconciliation`);
  else record("stale checkout review", true, "no checkout older than one hour awaiting settlement");
}

function printResults(): void {
  for (const check of checks) {
    const mark = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${mark.padEnd(4)}  ${check.name} — ${check.detail}`);
  }
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  console.log(`\n${checks.length} checks: ${failures} failed, ${warnings} warnings.`);
  if (failures) process.exitCode = 1;
}

async function main(): Promise<void> {
  const skipHttp = process.argv.includes("--skip-http");
  const skipDatabase = process.argv.includes("--skip-db");
  if (skipHttp && skipDatabase) throw new Error("At least one release audit target must remain enabled");
  if (!skipHttp) {
    const baseUrl = option("url") ?? process.env.RELEASE_BASE_URL?.trim() ?? process.env.APP_URL?.trim();
    if (!baseUrl) record("release URL", false, "set RELEASE_BASE_URL or pass --url");
    else await auditHttp(baseUrl).catch((error) => {
      record("deployed HTTP audit", false, error instanceof Error ? error.message : String(error));
    });
  }
  if (!skipDatabase) await auditDatabase().catch((error) => {
    record("database audit", false, error instanceof Error ? error.message : String(error));
  });
}

main()
  .catch((error) => {
    record("release auditor execution", false, error instanceof Error ? error.message : String(error));
  })
  .finally(async () => {
    if (databaseUsed) {
      try {
        await database().end();
      } catch {
        // The audit may fail before a pool exists (for example, missing URL).
      }
    }
    printResults();
  });
