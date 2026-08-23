CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 64),
  destination text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('ai', 'developer', 'design', 'commerce', 'consumer', 'other')),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  bid_count integer NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  outbound_clicks bigint NOT NULL DEFAULT 0 CHECK (outbound_clicks >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'review', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_bid_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX listings_rank_idx ON listings (total_cents DESC, last_bid_at ASC) WHERE status = 'active';
CREATE INDEX listings_category_idx ON listings (category, total_cents DESC) WHERE status = 'active';

CREATE TABLE bids (
  stripe_checkout_session_id text PRIMARY KEY,
  stripe_payment_intent_id text,
  listing_id uuid NOT NULL REFERENCES listings(id),
  amount_cents integer NOT NULL CHECK (amount_cents >= 500),
  payer_email_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Stripe retries normally keep the same Event id, but fulfillment is keyed to
-- the Checkout Session as the stronger economic idempotency boundary.
CREATE TABLE checkout_fulfillments (
  stripe_checkout_session_id text PRIMARY KEY,
  stripe_event_id text NOT NULL,
  fulfilled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  referrer_origin text,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX click_events_listing_time_idx ON click_events (listing_id, clicked_at DESC);

CREATE TABLE request_rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0)
);
