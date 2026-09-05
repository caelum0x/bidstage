-- Money-path idempotency hardening.
--
-- Additive constraints only (expand phase): the payment tables are empty
-- pre-launch, so these unique indexes are safe to add without a data backfill.
--
-- Finding 4: refund/dispute idempotency must key on the provider *adjustment*
-- id (refund_id / dispute_id), not the webhook event id. Two distinct webhook
-- events can carry the same refund, and Dodo refund amounts are incremental,
-- so replaying the same refund under a new event id would double-subtract.
-- A unique key on (provider, provider_adjustment_id) lets reversePlacement
-- claim each adjustment exactly once via ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX payment_adjustments_provider_adjustment_idx
  ON payment_adjustments (provider, provider_adjustment_id);

-- Finding 10: a provider transaction id must credit at most one bid. Only the
-- provider order id was unique before, so a reused transaction id on a second
-- order could create a second contribution (double-credit). This partial unique
-- index surfaces such an anomaly as a failed settlement instead of a silent
-- double-count. Nulls are excluded because the id is optional at settle time.
CREATE UNIQUE INDEX bids_provider_transaction_idx
  ON bids (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
