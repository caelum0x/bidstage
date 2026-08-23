import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

import { Pool, type PoolClient } from "pg";

import { reversePlacement, settlePlacement, type SettlePlacementInput } from "../../lib/payment-settlement";

const rawDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!rawDatabaseUrl && process.env.BIDSTAGE_REQUIRE_INTEGRATION === "1") {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
}

if (!rawDatabaseUrl) {
  test("PostgreSQL integration suite requires TEST_DATABASE_URL", { skip: "integration database not configured" }, () => {});
} else {

const databaseUrl = new URL(rawDatabaseUrl);
if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
  throw new Error("TEST_DATABASE_URL must use PostgreSQL");
}
const databaseName = databaseUrl.pathname.slice(1).toLowerCase();
if (!databaseName.includes("test")) {
  throw new Error("TEST_DATABASE_URL database name must contain 'test'");
}

const schema = `bidstage_it_${randomBytes(8).toString("hex")}`;
const admin = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
const isolatedUrl = new URL(databaseUrl);
isolatedUrl.searchParams.set("options", `-c search_path=${schema},public`);
const pool = new Pool({ connectionString: isolatedUrl.toString(), max: 8 });

async function inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function migrate(): Promise<void> {
  const migrationDirectory = resolve(process.cwd(), "db", "migrations");
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const client = await pool.connect();
  try {
    for (const migration of migrations) {
      await client.query("BEGIN");
      try {
        await client.query(await readFile(resolve(migrationDirectory, migration), "utf8"));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Integration migration failed: ${migration}`, { cause: error });
      }
    }
  } finally {
    client.release();
  }
}

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate();
});

after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

type CheckoutFixture = {
  checkoutId: string;
  providerCheckoutId: string;
  eventId: string;
  amountCents: number;
};

async function founderId(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO founder_accounts
       (github_user_id, github_login, display_name, avatar_url, profile_url)
     VALUES (912345, 'integration-owner', 'Integration Owner',
             'https://avatars.githubusercontent.com/u/912345',
             'https://github.com/integration-owner')
     RETURNING id`,
  );
  return result.rows[0]!.id;
}

async function checkoutFixture(
  founder: string,
  suffix: string,
  amountCents: number,
): Promise<CheckoutFixture> {
  const providerCheckoutId = `checkout_${suffix}`;
  const eventId = `event_settle_${suffix}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO payment_checkouts
       (public_reference, provider, idempotency_hash, request_fingerprint,
        provider_checkout_id, title, destination, category, contribution_cents,
        quoted_category_rank, quoted_overall_rank, quoted_total_cents, quote_as_of,
        state, founder_id, product_kind, github_repository_id, github_owner,
        github_name, github_url, github_description, github_stars,
        github_license_spdx, github_primary_language, github_verification_method)
     VALUES ($1, 'creem', $2, $3, $4, 'Concurrency Kit',
             'https://concurrency-kit.example/', 'developer', $5,
             1, 1, $5, now(), 'pending', $6, 'open_source', 88112233,
             'integration-owner', 'concurrency-kit',
             'https://github.com/integration-owner/concurrency-kit',
             'A fixture for transaction integration tests.', 42, 'MIT',
             'TypeScript', 'personal_owner')
     RETURNING id`,
    [
      randomBytes(12).toString("hex"),
      `idempotency_${suffix}`,
      `fingerprint_${suffix}`,
      providerCheckoutId,
      amountCents,
      founder,
    ],
  );
  await pool.query(
    `INSERT INTO payment_events (provider, event_id, event_type, object_id)
     VALUES ('creem', $1, 'checkout.completed', $2)`,
    [eventId, providerCheckoutId],
  );
  return { checkoutId: result.rows[0]!.id, providerCheckoutId, eventId, amountCents };
}

function settlementInput(fixture: CheckoutFixture): SettlePlacementInput {
  return {
    provider: "creem",
    eventId: fixture.eventId,
    checkoutId: fixture.checkoutId,
    providerCheckoutId: fixture.providerCheckoutId,
    providerOrderId: `order_${fixture.providerCheckoutId}`,
    providerTransactionId: `transaction_${fixture.providerCheckoutId}`,
    amountCents: fixture.amountCents,
    currency: "USD",
    payerEmail: null,
  };
}

async function addEvent(eventId: string, eventType: string, objectId: string): Promise<void> {
  await pool.query(
    `INSERT INTO payment_events (provider, event_id, event_type, object_id)
     VALUES ('creem', $1, $2, $3)`,
    [eventId, eventType, objectId],
  );
}

test("concurrent settlements, duplicate fulfillment, mismatch, and reversals preserve the ledger", async () => {
  const founder = await founderId();
  const first = await checkoutFixture(founder, "first", 700);
  const second = await checkoutFixture(founder, "second", 500);

  await Promise.all([first, second].map((fixture) => inTransaction(
    (client) => settlePlacement(client, settlementInput(fixture)),
  )));

  const listing = await pool.query<{
    id: string;
    total_cents: string;
    bid_count: number;
    listing_count: string;
  }>(
    `SELECT id::text, total_cents::text, bid_count,
            count(*) OVER ()::text AS listing_count
     FROM listings
     WHERE destination = 'https://concurrency-kit.example/'`,
  );
  assert.equal(listing.rows[0]!.listing_count, "1");
  assert.equal(listing.rows[0]!.total_cents, "1200");
  assert.equal(listing.rows[0]!.bid_count, 2);

  const initialCounts = await pool.query<{
    bids: string;
    fulfillments: string;
    ledger_entries: string;
    ledger_total: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM bids) AS bids,
       (SELECT count(*)::text FROM payment_fulfillments) AS fulfillments,
       (SELECT count(*)::text FROM rank_ledger) AS ledger_entries,
       (SELECT sum(amount_cents)::text FROM rank_ledger) AS ledger_total`,
  );
  assert.deepEqual(initialCounts.rows[0], {
    bids: "2",
    fulfillments: "2",
    ledger_entries: "2",
    ledger_total: "1200",
  });

  const duplicateEventId = "event_settle_first_retry";
  await addEvent(duplicateEventId, "checkout.completed", first.providerCheckoutId);
  await inTransaction((client) => settlePlacement(client, {
    ...settlementInput(first),
    eventId: duplicateEventId,
  }));
  const afterDuplicate = await pool.query<{ ledger_entries: string; event_state: string }>(
    `SELECT
       (SELECT count(*)::text FROM rank_ledger) AS ledger_entries,
       (SELECT processing_state FROM payment_events WHERE event_id = $1) AS event_state`,
    [duplicateEventId],
  );
  assert.deepEqual(afterDuplicate.rows[0], { ledger_entries: "2", event_state: "processed" });

  const mismatch = await checkoutFixture(founder, "mismatch", 500);
  await assert.rejects(
    inTransaction((client) => settlePlacement(client, {
      ...settlementInput(mismatch),
      amountCents: 600,
    })),
    /does not match the checkout intent/,
  );
  const mismatchEvidence = await pool.query<{ fulfillments: string; state: string }>(
    `SELECT
       (SELECT count(*)::text FROM payment_fulfillments WHERE provider_checkout_id = $1) AS fulfillments,
       (SELECT processing_state FROM payment_events WHERE event_id = $2) AS state`,
    [mismatch.providerCheckoutId, mismatch.eventId],
  );
  assert.deepEqual(mismatchEvidence.rows[0], { fulfillments: "0", state: "received" });

  await pool.query("UPDATE listings SET status = 'active' WHERE id = $1", [listing.rows[0]!.id]);
  await addEvent("event_refund_300", "refund.created", "refund_300");
  await addEvent("event_refund_500", "refund.created", "refund_500");
  await Promise.all([
    { eventId: "event_refund_300", adjustmentId: "refund_300", cumulative: 300 },
    { eventId: "event_refund_500", adjustmentId: "refund_500", cumulative: 500 },
  ].map((refund) => inTransaction((client) => reversePlacement(client, {
    provider: "creem",
    eventId: refund.eventId,
    providerAdjustmentId: refund.adjustmentId,
    providerOrderId: settlementInput(first).providerOrderId,
    providerTransactionId: settlementInput(first).providerTransactionId,
    kind: "refund",
    currency: "USD",
    cumulativeReversedCents: refund.cumulative,
    originalAmountCents: 700,
  }))));

  const concurrentRefund = await pool.query<{
    refunded_cents: number;
    total_cents: string;
    reversal_total: string;
  }>(
    `SELECT bid.refunded_cents, listing.total_cents::text,
            (SELECT (-sum(amount_cents))::text FROM rank_ledger
             WHERE entry_type = 'refund_reversal') AS reversal_total
     FROM bids AS bid
     JOIN listings AS listing ON listing.id = bid.listing_id
     WHERE bid.checkout_id = $1`,
    [first.checkoutId],
  );
  assert.deepEqual(concurrentRefund.rows[0], {
    refunded_cents: 500,
    total_cents: "700",
    reversal_total: "500",
  });

  await addEvent("event_refund_full", "refund.created", "refund_full");
  await inTransaction((client) => reversePlacement(client, {
    provider: "creem",
    eventId: "event_refund_full",
    providerAdjustmentId: "refund_full",
    providerOrderId: settlementInput(first).providerOrderId,
    providerTransactionId: settlementInput(first).providerTransactionId,
    kind: "refund",
    currency: "USD",
    cumulativeReversedCents: 700,
    originalAmountCents: 700,
  }));

  await addEvent("event_dispute_second", "dispute.created", "dispute_second");
  await inTransaction((client) => reversePlacement(client, {
    provider: "creem",
    eventId: "event_dispute_second",
    providerAdjustmentId: "dispute_second",
    providerOrderId: settlementInput(second).providerOrderId,
    providerTransactionId: settlementInput(second).providerTransactionId,
    kind: "dispute",
    currency: "USD",
    originalAmountCents: 500,
  }));

  const finalState = await pool.query<{
    total_cents: string;
    bid_count: number;
    status: string;
    ledger_total: string;
    contribution_total: string;
    reversal_total: string;
  }>(
    `SELECT listing.total_cents::text, listing.bid_count, listing.status,
            sum(ledger.amount_cents)::text AS ledger_total,
            sum(ledger.amount_cents) FILTER (WHERE ledger.entry_type = 'contribution')::text AS contribution_total,
            (-sum(ledger.amount_cents) FILTER (WHERE ledger.entry_type <> 'contribution'))::text AS reversal_total
     FROM listings AS listing
     JOIN rank_ledger AS ledger ON ledger.listing_id = listing.id
     WHERE listing.id = $1
     GROUP BY listing.id`,
    [listing.rows[0]!.id],
  );
  assert.deepEqual(finalState.rows[0], {
    total_cents: "0",
    bid_count: 0,
    status: "review",
    ledger_total: "0",
    contribution_total: "1200",
    reversal_total: "1200",
  });
});
}
