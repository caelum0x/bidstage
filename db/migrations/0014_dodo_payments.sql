ALTER TABLE payment_checkouts
  DROP CONSTRAINT IF EXISTS payment_checkouts_provider_check,
  ADD CONSTRAINT payment_checkouts_provider_check
    CHECK (provider IN ('stripe', 'creem', 'dodo'));

ALTER TABLE bids
  DROP CONSTRAINT IF EXISTS bids_provider_check,
  ADD CONSTRAINT bids_provider_check
    CHECK (provider IN ('stripe', 'creem', 'dodo'));

ALTER TABLE payment_fulfillments
  DROP CONSTRAINT IF EXISTS payment_fulfillments_provider_check,
  ADD CONSTRAINT payment_fulfillments_provider_check
    CHECK (provider IN ('stripe', 'creem', 'dodo'));

ALTER TABLE payment_events
  DROP CONSTRAINT IF EXISTS payment_events_provider_check,
  ADD CONSTRAINT payment_events_provider_check
    CHECK (provider IN ('stripe', 'creem', 'dodo'));

ALTER TABLE payment_adjustments
  DROP CONSTRAINT IF EXISTS payment_adjustments_provider_check,
  ADD CONSTRAINT payment_adjustments_provider_check
    CHECK (provider IN ('stripe', 'creem', 'dodo'));

-- Provider IDs are only guaranteed unique inside a provider namespace.
ALTER TABLE bids DROP CONSTRAINT IF EXISTS bids_pkey;
ALTER TABLE bids ADD PRIMARY KEY (provider, provider_checkout_id);

ALTER TABLE payment_fulfillments DROP CONSTRAINT IF EXISTS checkout_fulfillments_pkey;
ALTER TABLE payment_fulfillments DROP CONSTRAINT IF EXISTS payment_fulfillments_pkey;
ALTER TABLE payment_fulfillments ADD PRIMARY KEY (provider, provider_checkout_id);

ALTER TABLE rank_ledger ADD COLUMN provider text;

UPDATE rank_ledger AS ledger
SET provider = checkout.provider
FROM payment_checkouts AS checkout
WHERE checkout.id = ledger.checkout_id;

ALTER TABLE rank_ledger
  ALTER COLUMN provider SET NOT NULL,
  ADD CONSTRAINT rank_ledger_provider_check
    CHECK (provider IN ('stripe', 'creem', 'dodo'));

DROP INDEX rank_ledger_provider_event_type_idx;
CREATE UNIQUE INDEX rank_ledger_provider_event_type_idx
  ON rank_ledger (provider, provider_event_id, entry_type);
