import type { DatabaseClient } from "./db";
import { privacyHash } from "./privacy-hash";
import { listingSlug } from "./market";
import { reversalStates } from "./reversal-states";

export type PaymentProvider = "creem" | "dodo";

type CheckoutRow = {
  id: string;
  founder_id: string | null;
  product_kind: "commercial" | "open_source";
  github_repository_id: string | null;
  github_owner: string | null;
  github_name: string | null;
  github_url: string | null;
  github_description: string | null;
  github_stars: number | null;
  github_license_spdx: string | null;
  github_primary_language: string | null;
  country_code: string | null;
  funding_provider: "github_sponsors" | "open_collective" | null;
  funding_url: string | null;
  github_verification_method: "personal_owner" | "repository_file" | null;
  contribution_url: string | null;
  contribution_note: string | null;
  title: string;
  destination: string;
  category: string;
  contribution_cents: number;
  currency: string;
  provider_checkout_id: string | null;
};

type AdjustmentRow = {
  checkout_id: string;
  checkout_state: string;
  adjustment_state: string;
  listing_id: string;
  amount_cents: number;
  refunded_cents: number;
  currency: string;
  provider_transaction_id: string | null;
};

export async function markPaymentEvent(
  client: DatabaseClient,
  provider: PaymentProvider,
  eventId: string,
  state: "processed" | "ignored",
) {
  await client.query(
    `UPDATE payment_events
     SET processing_state = $3, processed_at = now()
     WHERE provider = $1 AND event_id = $2`,
    [provider, eventId, state],
  );
}

export type SettlePlacementInput = {
  provider: PaymentProvider;
  eventId: string;
  checkoutId: string;
  providerCheckoutId: string;
  providerOrderId: string;
  providerTransactionId: string | null;
  amountCents: number;
  currency: string;
  payerEmail: string | null;
};

export async function settlePlacement(
  client: DatabaseClient,
  input: Readonly<SettlePlacementInput>,
) {
  const checkoutResult = await client.query<CheckoutRow>(
    `SELECT id, founder_id, product_kind, github_repository_id::text,
            github_owner, github_name, github_url, github_description,
            github_stars, github_license_spdx, github_primary_language,
            country_code, funding_provider, funding_url, github_verification_method,
            contribution_url, contribution_note,
            title, destination, category, contribution_cents,
            currency, provider_checkout_id
     FROM payment_checkouts
     WHERE id = $1 AND provider = $2
     FOR UPDATE`,
    [input.checkoutId, input.provider],
  );
  const checkout = checkoutResult.rows[0];
  if (
    !checkout
    || checkout.provider_checkout_id !== input.providerCheckoutId
    || checkout.contribution_cents !== input.amountCents
    || checkout.currency !== input.currency.toLowerCase()
  ) {
    throw new Error("Provider settlement does not match the checkout intent");
  }

  const fulfillment = await client.query(
    `INSERT INTO payment_fulfillments
       (provider_checkout_id, provider_event_id, provider)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_checkout_id) DO NOTHING
     RETURNING provider_checkout_id`,
    [input.providerCheckoutId, input.eventId, input.provider],
  );
  if (fulfillment.rowCount === 0) {
    // The checkout session is already fulfilled. A replay of the SAME capture is
    // an idempotent no-op, but a genuinely different order/transaction on the
    // same checkout session is a distinct financial event that must not be
    // silently swallowed — surface it as an incident instead.
    const existing = await client.query<{
      provider_order_id: string | null;
      provider_transaction_id: string | null;
    }>(
      `SELECT provider_order_id, provider_transaction_id
       FROM bids
       WHERE provider = $1 AND provider_checkout_id = $2`,
      [input.provider, input.providerCheckoutId],
    );
    const priorBid = existing.rows[0];
    if (
      priorBid
      && (
        (priorBid.provider_order_id !== null
          && priorBid.provider_order_id !== input.providerOrderId)
        || (priorBid.provider_transaction_id !== null
          && input.providerTransactionId !== null
          && priorBid.provider_transaction_id !== input.providerTransactionId)
      )
    ) {
      throw new Error("Conflicting capture for an already-fulfilled checkout");
    }
    await markPaymentEvent(client, input.provider, input.eventId, "processed");
    return;
  }

  const listing = await client.query<{
    id: string;
    title: string;
    destination: string;
    category: string;
  }>(
    `INSERT INTO listings
       (slug, founder_id, product_kind, github_repository_id, github_owner, github_name,
        github_url, github_description, github_stars, github_license_spdx,
        github_primary_language, github_metadata_updated_at,
        title, destination, category, country_code, funding_provider, funding_url,
        github_verification_method, contribution_url, contribution_note,
        total_cents, bid_count, last_bid_at, status)
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       CASE WHEN $3 = 'open_source' THEN now() ELSE NULL END,
       $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 1, now(), 'review'
     )
     ON CONFLICT (destination) DO UPDATE SET
       total_cents = listings.total_cents + EXCLUDED.total_cents,
       bid_count = listings.bid_count + 1,
       last_bid_at = now(),
       founder_id = listings.founder_id,
       github_description = coalesce(EXCLUDED.github_description, listings.github_description),
       github_stars = coalesce(EXCLUDED.github_stars, listings.github_stars),
       github_license_spdx = coalesce(EXCLUDED.github_license_spdx, listings.github_license_spdx),
       github_primary_language = coalesce(EXCLUDED.github_primary_language, listings.github_primary_language),
       country_code = coalesce(EXCLUDED.country_code, listings.country_code),
       funding_provider = coalesce(EXCLUDED.funding_provider, listings.funding_provider),
       funding_url = coalesce(EXCLUDED.funding_url, listings.funding_url),
       github_verification_method = coalesce(EXCLUDED.github_verification_method, listings.github_verification_method),
       contribution_url = coalesce(EXCLUDED.contribution_url, listings.contribution_url),
       contribution_note = coalesce(EXCLUDED.contribution_note, listings.contribution_note),
       github_metadata_updated_at = CASE
         WHEN EXCLUDED.product_kind = 'open_source' THEN now()
         ELSE listings.github_metadata_updated_at
       END,
       updated_at = now()
     WHERE listings.product_kind = EXCLUDED.product_kind
       AND listings.github_repository_id IS NOT DISTINCT FROM EXCLUDED.github_repository_id
     RETURNING id, title, destination, category`,
    [
      listingSlug(checkout.destination),
      checkout.founder_id,
      checkout.product_kind,
      checkout.github_repository_id,
      checkout.github_owner,
      checkout.github_name,
      checkout.github_url,
      checkout.github_description,
      checkout.github_stars,
      checkout.github_license_spdx,
      checkout.github_primary_language,
      checkout.title,
      checkout.destination,
      checkout.category,
      checkout.country_code,
      checkout.funding_provider,
      checkout.funding_url,
      checkout.github_verification_method,
      checkout.contribution_url,
      checkout.contribution_note,
      checkout.contribution_cents,
    ],
  );
  const listingRecord = listing.rows[0];
  if (!listingRecord) {
    throw new Error("Settled contribution conflicts with the existing listing identity");
  }

  await client.query(
    `INSERT INTO listing_versions
       (listing_id, version_number, title, destination, category, country_code,
        funding_provider, funding_url, contribution_url, contribution_note,
        actor_type, reason)
     VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, 'settlement', 'initial_listing')
     ON CONFLICT (listing_id, version_number) DO NOTHING`,
    [
      listingRecord.id,
      listingRecord.title,
      listingRecord.destination,
      listingRecord.category,
      checkout.country_code,
      checkout.funding_provider,
      checkout.funding_url,
      checkout.contribution_url,
      checkout.contribution_note,
    ],
  );
  const email = input.payerEmail?.trim().toLowerCase() || null;
  await client.query(
    `INSERT INTO bids
       (provider_checkout_id, provider_order_id, provider_transaction_id, provider,
        checkout_id, listing_id, amount_cents, payer_email_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.providerCheckoutId,
      input.providerOrderId,
      input.providerTransactionId,
      input.provider,
      checkout.id,
      listingRecord.id,
      checkout.contribution_cents,
      email ? privacyHash(email) : null,
    ],
  );
  await client.query(
    `INSERT INTO rank_ledger
       (listing_id, checkout_id, provider, entry_type, amount_cents, provider_event_id)
     VALUES ($1, $2, $3, 'contribution', $4, $5)`,
    [listingRecord.id, checkout.id, input.provider, checkout.contribution_cents, input.eventId],
  );
  await client.query(
    `UPDATE payment_checkouts
     SET state = 'settled', provider_order_id = $2, provider_transaction_id = $3,
         settled_at = now(), updated_at = now(), failure_code = NULL
     WHERE id = $1`,
    [checkout.id, input.providerOrderId, input.providerTransactionId],
  );
  await markPaymentEvent(client, input.provider, input.eventId, "processed");
}

export type ReversePlacementInput = {
  provider: PaymentProvider;
  eventId: string;
  providerAdjustmentId: string;
  providerOrderId: string;
  providerTransactionId: string | null;
  kind: "refund" | "dispute";
  currency: string;
  adjustmentAmountCents?: number;
  cumulativeReversedCents?: number;
  originalAmountCents?: number;
};

export async function reversePlacement(
  client: DatabaseClient,
  input: Readonly<ReversePlacementInput>,
) {
  const bidResult = await client.query<AdjustmentRow>(
    `SELECT bids.checkout_id, checkout.state AS checkout_state,
            bids.adjustment_state, bids.listing_id,
            bids.amount_cents, bids.refunded_cents, checkout.currency,
            bids.provider_transaction_id
     FROM bids
     JOIN payment_checkouts AS checkout ON checkout.id = bids.checkout_id
     JOIN listings ON listings.id = bids.listing_id
     WHERE bids.provider = $1 AND bids.provider_order_id = $2
     FOR UPDATE OF bids, checkout, listings`,
    [input.provider, input.providerOrderId],
  );
  const bid = bidResult.rows[0];
  if (
    !bid
    || bid.currency !== input.currency.toLowerCase()
    || (input.originalAmountCents !== undefined && input.originalAmountCents !== bid.amount_cents)
    || (bid.provider_transaction_id && input.providerTransactionId
      && bid.provider_transaction_id !== input.providerTransactionId)
  ) {
    throw new Error("Provider adjustment does not match a settled contribution");
  }

  let targetReversal = bid.amount_cents;
  if (input.kind === "refund") {
    if (input.cumulativeReversedCents !== undefined) {
      if (!Number.isSafeInteger(input.cumulativeReversedCents) || input.cumulativeReversedCents <= 0) {
        throw new Error("Cumulative refund amount must be a positive integer");
      }
      targetReversal = input.cumulativeReversedCents;
    } else {
      if (!Number.isSafeInteger(input.adjustmentAmountCents) || (input.adjustmentAmountCents ?? 0) <= 0) {
        throw new Error("Refund amount must be a positive integer");
      }
      targetReversal = bid.refunded_cents + input.adjustmentAmountCents!;
    }
    // Never reverse more than the settled contribution. A refund that would push
    // past the contribution total is either a duplicate or a refund issued after
    // the bid was already fully reversed (e.g. a provider that refunds to close a
    // won/lost dispute). Both must resolve to a zero-delta, state-preserving
    // no-op rather than throwing forever and jamming the webhook. The DB CHECK
    // (refunded_cents <= amount_cents) also depends on this clamp holding.
    targetReversal = Math.min(targetReversal, bid.amount_cents);
  }
  const delta = Math.max(0, targetReversal - bid.refunded_cents);
  const nextReversed = bid.refunded_cents + delta;
  const { adjustmentState, checkoutState } = reversalStates({
    kind: input.kind,
    priorAdjustmentState: bid.adjustment_state,
    priorCheckoutState: bid.checkout_state,
    fullyReversed: nextReversed === bid.amount_cents,
  });

  if (delta > 0) {
    // Idempotency is keyed on the provider adjustment id (refund_id / dispute_id),
    // NOT the webhook event id. The same adjustment can be delivered under
    // multiple event ids, and Dodo refund amounts are incremental, so keying on
    // the event id would let a replayed refund double-subtract. If the adjustment
    // was already applied, skip every mutation and treat the event as processed.
    const claim = await client.query(
      `INSERT INTO payment_adjustments
         (provider, provider_event_id, provider_adjustment_id, provider_transaction_id,
          checkout_id, adjustment_type, amount_cents, cumulative_amount_cents, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (provider, provider_adjustment_id) DO NOTHING
       RETURNING id`,
      [
        input.provider,
        input.eventId,
        input.providerAdjustmentId,
        input.providerTransactionId,
        bid.checkout_id,
        input.kind,
        delta,
        nextReversed,
        bid.currency,
      ],
    );
    if (claim.rowCount === 0) {
      await markPaymentEvent(client, input.provider, input.eventId, "processed");
      return;
    }
    await client.query(
      `INSERT INTO rank_ledger
         (listing_id, checkout_id, provider, entry_type, amount_cents, provider_event_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        bid.listing_id,
        bid.checkout_id,
        input.provider,
        input.kind === "dispute" ? "dispute_reversal" : "refund_reversal",
        -delta,
        input.eventId,
      ],
    );
    await client.query(
      `UPDATE listings
       SET total_cents = greatest(0, total_cents - $2),
           bid_count = CASE WHEN $3::boolean THEN greatest(0, bid_count - 1) ELSE bid_count END,
           status = CASE
             WHEN status = 'active' AND greatest(0, total_cents - $2) = 0 THEN 'review'
             ELSE status
           END,
           updated_at = now()
       WHERE id = $1`,
      [bid.listing_id, delta, nextReversed === bid.amount_cents],
    );
  }

  await client.query(
    `UPDATE bids
     SET refunded_cents = $2, adjustment_state = $3,
         provider_transaction_id = coalesce(provider_transaction_id, $4)
     WHERE checkout_id = $1`,
    [bid.checkout_id, nextReversed, adjustmentState, input.providerTransactionId],
  );
  await client.query(
    `UPDATE payment_checkouts
     SET state = $2, provider_transaction_id = coalesce(provider_transaction_id, $3),
         updated_at = now()
     WHERE id = $1`,
    [bid.checkout_id, checkoutState, input.providerTransactionId],
  );
  await markPaymentEvent(client, input.provider, input.eventId, "processed");
}
