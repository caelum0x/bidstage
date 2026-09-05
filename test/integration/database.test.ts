import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

import { Pool, type PoolClient } from "pg";

import { reversePlacement, settlePlacement, type SettlePlacementInput } from "../../lib/payment-settlement";
import {
  markProviderCheckoutFailed,
  persistProviderCheckoutSession,
} from "../../lib/checkout-session";

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
  destination: string;
};

async function founderId(
  githubUserId = 912345,
  login = "integration-owner",
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO founder_accounts
       (github_user_id, github_login, display_name, avatar_url, profile_url)
     VALUES ($1, $2, 'Integration Owner',
             'https://avatars.githubusercontent.com/u/912345',
             'https://github.com/integration-owner')
     RETURNING id`,
    [githubUserId, login],
  );
  return result.rows[0]!.id;
}

async function checkoutFixture(
  founder: string,
  suffix: string,
  amountCents: number,
  destination = "https://concurrency-kit.example/",
  githubRepositoryId = 88112233,
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
             $7, 'developer', $5::integer,
             1, 1, ($5::bigint), now(), 'pending', $6, 'open_source', $8::bigint,
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
      destination,
      githubRepositoryId,
    ],
  );
  await pool.query(
    `INSERT INTO payment_events (provider, event_id, event_type, object_id)
     VALUES ('creem', $1, 'checkout.completed', $2)`,
    [eventId, providerCheckoutId],
  );
  return { checkoutId: result.rows[0]!.id, providerCheckoutId, eventId, amountCents, destination };
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

test("a late provider session write never clobbers a settled checkout, and retries converge", async () => {
  const founder = await founderId(920002, "guard-owner");
  const settled = await checkoutFixture(founder, "guard", 600, "https://guard.example/", 5500002);
  await inTransaction((client) => settlePlacement(client, settlementInput(settled)));

  // A slow/duplicate provider response arrives after settlement with a different
  // session id. It must not overwrite the settled state or the persisted session.
  const persisted = await inTransaction((client) =>
    persistProviderCheckoutSession(client, {
      checkoutId: settled.checkoutId,
      providerCheckoutId: "checkout_guard_late",
      checkoutUrl: "https://pay.example/late",
    }),
  );
  const settledRow = await pool.query<{ state: string; provider_checkout_id: string }>(
    "SELECT state, provider_checkout_id FROM payment_checkouts WHERE id = $1",
    [settled.checkoutId],
  );
  assert.equal(settledRow.rows[0]!.state, "settled");
  assert.equal(settledRow.rows[0]!.provider_checkout_id, settled.providerCheckoutId);
  assert.equal(persisted.providerCheckoutId, settled.providerCheckoutId);

  // Concurrent retries that each created a provider session converge on one
  // payable session (first writer wins) and both callers see the same URL.
  const fresh = await checkoutFixture(founder, "guard2", 600, "https://guard2.example/", 5500012);
  await pool.query(
    "UPDATE payment_checkouts SET state = 'creating', provider_checkout_id = NULL, checkout_url = NULL WHERE id = $1",
    [fresh.checkoutId],
  );
  const [a, b] = await Promise.all([
    inTransaction((client) => persistProviderCheckoutSession(client, {
      checkoutId: fresh.checkoutId,
      providerCheckoutId: "sess_a",
      checkoutUrl: "https://pay.example/a",
    })),
    inTransaction((client) => persistProviderCheckoutSession(client, {
      checkoutId: fresh.checkoutId,
      providerCheckoutId: "sess_b",
      checkoutUrl: "https://pay.example/b",
    })),
  ]);
  assert.equal(a.providerCheckoutId, b.providerCheckoutId);
  assert.equal(a.checkoutUrl, b.checkoutUrl);
  const converged = await pool.query<{ state: string; provider_checkout_id: string }>(
    "SELECT state, provider_checkout_id FROM payment_checkouts WHERE id = $1",
    [fresh.checkoutId],
  );
  assert.equal(converged.rows[0]!.state, "pending");
  assert.equal(converged.rows[0]!.provider_checkout_id, a.providerCheckoutId);

  // The failure path must not downgrade a checkout that already has a session.
  await markProviderCheckoutFailed(pool, fresh.checkoutId);
  const afterFailed = await pool.query<{ state: string }>(
    "SELECT state FROM payment_checkouts WHERE id = $1",
    [fresh.checkoutId],
  );
  assert.equal(afterFailed.rows[0]!.state, "pending");
});

test("a second distinct capture on an already-fulfilled checkout is surfaced, not swallowed", async () => {
  const founder = await founderId(920003, "dupcap-owner");
  const fixture = await checkoutFixture(founder, "dupcap", 500, "https://dupcap.example/", 5500003);
  await inTransaction((client) => settlePlacement(client, settlementInput(fixture)));

  await addEvent("event_dupcap_second", "checkout.completed", fixture.providerCheckoutId);
  await assert.rejects(
    inTransaction((client) => settlePlacement(client, {
      ...settlementInput(fixture),
      eventId: "event_dupcap_second",
      providerOrderId: "order_dupcap_second",
      providerTransactionId: "transaction_dupcap_second",
    })),
    /Conflicting capture/,
  );

  // A true replay of the same capture under a new event id stays idempotent.
  await addEvent("event_dupcap_replay", "checkout.completed", fixture.providerCheckoutId);
  await inTransaction((client) => settlePlacement(client, {
    ...settlementInput(fixture),
    eventId: "event_dupcap_replay",
  }));
  const bids = await pool.query<{ count: string }>(
    "SELECT count(*)::text FROM bids WHERE checkout_id = $1",
    [fixture.checkoutId],
  );
  assert.equal(bids.rows[0]!.count, "1");
});

test("an incremental refund replayed under a new event id applies only once", async () => {
  const founder = await founderId(920004, "incremental-owner");
  const fixture = await checkoutFixture(founder, "incremental", 700, "https://incremental.example/", 5500004);
  await inTransaction((client) => settlePlacement(client, settlementInput(fixture)));
  await pool.query("UPDATE listings SET status = 'active' WHERE destination = $1", [fixture.destination]);

  const refund = (eventId: string) => inTransaction((client) => reversePlacement(client, {
    provider: "creem",
    eventId,
    providerAdjustmentId: "refund_incremental_r1",
    providerOrderId: settlementInput(fixture).providerOrderId,
    providerTransactionId: settlementInput(fixture).providerTransactionId,
    kind: "refund",
    currency: "USD",
    adjustmentAmountCents: 300,
    originalAmountCents: 700,
  }));

  await addEvent("event_incr_1", "refund.created", "refund_incremental_r1");
  await refund("event_incr_1");
  await addEvent("event_incr_2", "refund.created", "refund_incremental_r1");
  await refund("event_incr_2"); // replay under a new event id, same refund id

  const state = await pool.query<{
    refunded_cents: number;
    total_cents: string;
    adjustments: string;
    reversals: string;
  }>(
    `SELECT bid.refunded_cents, listing.total_cents::text,
            (SELECT count(*)::text FROM payment_adjustments WHERE checkout_id = bid.checkout_id) AS adjustments,
            (SELECT count(*)::text FROM rank_ledger
             WHERE checkout_id = bid.checkout_id AND entry_type = 'refund_reversal') AS reversals
     FROM bids AS bid JOIN listings AS listing ON listing.id = bid.listing_id
     WHERE bid.checkout_id = $1`,
    [fixture.checkoutId],
  );
  assert.deepEqual(state.rows[0], {
    refunded_cents: 300,
    total_cents: "400",
    adjustments: "1",
    reversals: "1",
  });
});

test("a refund after a dispute is a zero-delta no-op that keeps the disputed state", async () => {
  const founder = await founderId(920009, "afterdispute-owner");
  const fixture = await checkoutFixture(founder, "afterdispute", 500, "https://afterdispute.example/", 5500009);
  await inTransaction((client) => settlePlacement(client, settlementInput(fixture)));
  await pool.query("UPDATE listings SET status = 'active' WHERE destination = $1", [fixture.destination]);

  await addEvent("event_ad_dispute", "dispute.created", "dispute_ad");
  await inTransaction((client) => reversePlacement(client, {
    provider: "creem",
    eventId: "event_ad_dispute",
    providerAdjustmentId: "dispute_ad",
    providerOrderId: settlementInput(fixture).providerOrderId,
    providerTransactionId: settlementInput(fixture).providerTransactionId,
    kind: "dispute",
    currency: "USD",
    originalAmountCents: 500,
  }));

  await addEvent("event_ad_refund", "refund.created", "refund_ad");
  await assert.doesNotReject(inTransaction((client) => reversePlacement(client, {
    provider: "creem",
    eventId: "event_ad_refund",
    providerAdjustmentId: "refund_ad",
    providerOrderId: settlementInput(fixture).providerOrderId,
    providerTransactionId: settlementInput(fixture).providerTransactionId,
    kind: "refund",
    currency: "USD",
    adjustmentAmountCents: 500,
    originalAmountCents: 500,
  })));

  const state = await pool.query<{
    adjustment_state: string;
    refunded_cents: number;
    total_cents: string;
    adjustments: string;
    event_state: string;
  }>(
    `SELECT bid.adjustment_state, bid.refunded_cents, listing.total_cents::text,
            (SELECT count(*)::text FROM payment_adjustments WHERE checkout_id = bid.checkout_id) AS adjustments,
            (SELECT processing_state FROM payment_events WHERE event_id = 'event_ad_refund') AS event_state
     FROM bids AS bid JOIN listings AS listing ON listing.id = bid.listing_id
     WHERE bid.checkout_id = $1`,
    [fixture.checkoutId],
  );
  assert.deepEqual(state.rows[0], {
    adjustment_state: "disputed",
    refunded_cents: 500,
    total_cents: "0",
    // The no-op refund is still recorded (zero applied amount) so the refund id
    // remains auditable next to the dispute row.
    adjustments: "2",
    event_state: "processed",
  });
  const noOp = await pool.query<{
    adjustment_type: string;
    amount_cents: number;
    cumulative_amount_cents: number;
  }>(
    `SELECT adjustment_type, amount_cents, cumulative_amount_cents
     FROM payment_adjustments WHERE provider_adjustment_id = 'refund_ad'`,
  );
  assert.deepEqual(noOp.rows[0], {
    adjustment_type: "clamped_reversal",
    amount_cents: 0,
    cumulative_amount_cents: 1000,
  });
});

test("an over-refund from a new adjustment id leaves a queryable clamped_reversal audit row", async () => {
  const founder = await founderId(920020, "overrefund-owner");
  const fixture = await checkoutFixture(founder, "overrefund", 700, "https://overrefund.example/", 5500020);
  await inTransaction((client) => settlePlacement(client, settlementInput(fixture)));
  await pool.query("UPDATE listings SET status = 'active' WHERE destination = $1", [fixture.destination]);

  const refund = (eventId: string, adjustmentId: string, amountCents: number) => {
    return inTransaction((client) => reversePlacement(client, {
      provider: "creem",
      eventId,
      providerAdjustmentId: adjustmentId,
      providerOrderId: settlementInput(fixture).providerOrderId,
      providerTransactionId: settlementInput(fixture).providerTransactionId,
      kind: "refund",
      currency: "USD",
      adjustmentAmountCents: amountCents,
      originalAmountCents: 700,
    }));
  };

  await addEvent("event_or_full", "refund.created", "refund_or_full");
  await refund("event_or_full", "refund_or_full", 700);
  // A second, DISTINCT refund id for the full amount — e.g. a provider console
  // mistake — must not move money, but must not vanish either.
  await addEvent("event_or_extra", "refund.created", "refund_or_extra");
  await assert.doesNotReject(refund("event_or_extra", "refund_or_extra", 700));

  const state = await pool.query<{
    refunded_cents: number;
    anomaly_type: string;
    anomaly_amount: number;
    anomaly_cumulative: number;
  }>(
    `SELECT bid.refunded_cents,
            anomaly.adjustment_type AS anomaly_type,
            anomaly.amount_cents AS anomaly_amount,
            anomaly.cumulative_amount_cents AS anomaly_cumulative
     FROM bids AS bid
     JOIN payment_adjustments AS anomaly
       ON anomaly.provider_adjustment_id = 'refund_or_extra'
     WHERE bid.checkout_id = $1`,
    [fixture.checkoutId],
  );
  assert.deepEqual(state.rows[0], {
    refunded_cents: 700,
    anomaly_type: "clamped_reversal",
    // Zero applied, but the provider-claimed cumulative (700 already refunded
    // + 700 re-issued = 1400) is preserved for reconciliation.
    anomaly_amount: 0,
    anomaly_cumulative: 1400,
  });
});

test("a provider transaction id credits at most one bid across checkouts", async () => {
  const founder = await founderId(920010, "txn-owner");
  const a = await checkoutFixture(founder, "txna", 500, "https://txna.example/", 5500010);
  const b = await checkoutFixture(founder, "txnb", 500, "https://txnb.example/", 5500011);
  const sharedTransaction = "transaction_shared_txid";

  await inTransaction((client) => settlePlacement(client, {
    ...settlementInput(a),
    providerTransactionId: sharedTransaction,
  }));
  await assert.rejects(
    inTransaction((client) => settlePlacement(client, {
      ...settlementInput(b),
      providerTransactionId: sharedTransaction,
    })),
    /duplicate key|bids_provider_transaction/,
  );
  const bids = await pool.query<{ count: string }>(
    "SELECT count(*)::text FROM bids WHERE provider_transaction_id = $1",
    [sharedTransaction],
  );
  assert.equal(bids.rows[0]!.count, "1");
});

test("launch notifications capture once per email and keep first attribution", async () => {
  const founder = await founderId(778899, "launch-notify-founder");
  const subscribe = (source: string, repositoryUrl: string | null, founderRef: string | null) =>
    pool.query(
      `INSERT INTO launch_notifications (email, source, repository_url, founder_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      ["buyer@example.com", source, repositoryUrl, founderRef],
    );

  const first = await subscribe("checkout_disabled", "https://github.com/acme/widget", founder);
  assert.equal(first.rowCount, 1);
  // A repeat signup (different source, no founder) is an idempotent no-op that
  // preserves the original attribution instead of overwriting it.
  const replay = await subscribe("landing", null, null);
  assert.equal(replay.rowCount, 0);
  const stored = await pool.query<{
    email: string;
    source: string;
    repository_url: string | null;
    founder_id: string | null;
  }>(
    "SELECT email, source, repository_url, founder_id FROM launch_notifications WHERE email = $1",
    ["buyer@example.com"],
  );
  assert.equal(stored.rowCount, 1);
  assert.deepEqual(stored.rows[0], {
    email: "buyer@example.com",
    source: "checkout_disabled",
    repository_url: "https://github.com/acme/widget",
    founder_id: founder,
  });

  // The table's own constraints reject un-normalized or unknown values even if
  // a future caller bypasses the route-level validation.
  await assert.rejects(
    pool.query(
      "INSERT INTO launch_notifications (email, source) VALUES ($1, $2)",
      ["Upper@Example.com", "checkout_disabled"],
    ),
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO launch_notifications (email, source) VALUES ($1, $2)",
      ["ok@example.com", "not_a_source"],
    ),
  );
});
}
