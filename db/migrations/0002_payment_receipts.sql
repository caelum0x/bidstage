CREATE TABLE payment_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference text NOT NULL UNIQUE CHECK (public_reference ~ '^[a-f0-9]{24}$'),
  provider text NOT NULL CHECK (provider IN ('stripe', 'creem')),
  idempotency_hash text NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  provider_checkout_id text UNIQUE,
  provider_order_id text UNIQUE,
  provider_transaction_id text,
  checkout_url text,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 64),
  destination text NOT NULL,
  category text NOT NULL CHECK (category IN ('ai', 'developer', 'design', 'commerce', 'consumer', 'other')),
  contribution_cents integer NOT NULL CHECK (contribution_cents >= 500),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  quoted_category_rank integer NOT NULL CHECK (quoted_category_rank > 0),
  quoted_overall_rank integer NOT NULL CHECK (quoted_overall_rank > 0),
  quoted_total_cents bigint NOT NULL CHECK (quoted_total_cents >= contribution_cents),
  quote_as_of timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'creating'
    CHECK (state IN ('creating', 'pending', 'settled', 'failed', 'expired', 'partially_refunded', 'refunded', 'disputed')),
  failure_code text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX payment_checkouts_state_time_idx
  ON payment_checkouts (state, created_at DESC);

ALTER TABLE bids
  RENAME COLUMN stripe_checkout_session_id TO provider_checkout_id;

ALTER TABLE bids
  RENAME COLUMN stripe_payment_intent_id TO provider_order_id;

ALTER TABLE bids
  ADD COLUMN provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'creem')),
  ADD COLUMN checkout_id uuid UNIQUE REFERENCES payment_checkouts(id),
  ADD COLUMN provider_transaction_id text,
  ADD COLUMN refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  ADD COLUMN adjustment_state text NOT NULL DEFAULT 'none'
    CHECK (adjustment_state IN ('none', 'partial_refund', 'refunded', 'disputed')),
  ADD CONSTRAINT bids_refund_not_above_contribution
    CHECK (refunded_cents <= amount_cents);

CREATE UNIQUE INDEX bids_provider_order_idx
  ON bids (provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

ALTER TABLE checkout_fulfillments
  RENAME TO payment_fulfillments;

ALTER TABLE payment_fulfillments
  RENAME COLUMN stripe_checkout_session_id TO provider_checkout_id;

ALTER TABLE payment_fulfillments
  RENAME COLUMN stripe_event_id TO provider_event_id;

ALTER TABLE payment_fulfillments
  ADD COLUMN provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'creem'));

CREATE TABLE payment_events (
  provider text NOT NULL CHECK (provider IN ('stripe', 'creem')),
  event_id text NOT NULL,
  event_type text NOT NULL,
  object_id text,
  processing_state text NOT NULL DEFAULT 'received'
    CHECK (processing_state IN ('received', 'processed', 'failed', 'ignored')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  incident_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX payment_events_state_time_idx
  ON payment_events (processing_state, received_at DESC);

CREATE TABLE payment_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe', 'creem')),
  provider_event_id text NOT NULL,
  provider_adjustment_id text NOT NULL,
  provider_transaction_id text,
  checkout_id uuid NOT NULL REFERENCES payment_checkouts(id),
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('refund', 'dispute')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  cumulative_amount_cents integer NOT NULL CHECK (cumulative_amount_cents > 0),
  currency text NOT NULL CHECK (currency = 'usd'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX payment_adjustments_checkout_time_idx
  ON payment_adjustments (checkout_id, created_at DESC);

CREATE TABLE rank_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  checkout_id uuid NOT NULL REFERENCES payment_checkouts(id),
  entry_type text NOT NULL CHECK (entry_type IN ('contribution', 'refund_reversal', 'dispute_reversal')),
  amount_cents integer NOT NULL,
  provider_event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (entry_type = 'contribution' AND amount_cents > 0)
    OR (entry_type IN ('refund_reversal', 'dispute_reversal') AND amount_cents < 0)
  )
);

CREATE UNIQUE INDEX rank_ledger_contribution_checkout_idx
  ON rank_ledger (checkout_id)
  WHERE entry_type = 'contribution';

CREATE UNIQUE INDEX rank_ledger_provider_event_type_idx
  ON rank_ledger (provider_event_id, entry_type);

CREATE INDEX rank_ledger_listing_time_idx
  ON rank_ledger (listing_id, created_at DESC);
