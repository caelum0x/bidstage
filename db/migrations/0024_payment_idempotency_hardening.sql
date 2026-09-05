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

-- A reversal that applies nothing (already fully reversed, or clamped to zero)
-- must still be recorded for reconciliation: 'clamped_reversal' rows carry a
-- zero applied amount and the provider-claimed cumulative, so a provider-side
-- over-refund is queryable instead of silently absorbed. Only that type may
-- have amount_cents = 0; real refund/dispute rows still require a positive
-- applied amount.
ALTER TABLE payment_adjustments
  DROP CONSTRAINT payment_adjustments_adjustment_type_check;
ALTER TABLE payment_adjustments
  ADD CONSTRAINT payment_adjustments_adjustment_type_check
    CHECK (adjustment_type IN ('refund', 'dispute', 'clamped_reversal'));
ALTER TABLE payment_adjustments
  DROP CONSTRAINT payment_adjustments_amount_cents_check;
ALTER TABLE payment_adjustments
  ADD CONSTRAINT payment_adjustments_amount_cents_check
    CHECK (CASE WHEN adjustment_type = 'clamped_reversal'
                THEN amount_cents = 0
                ELSE amount_cents > 0 END);
