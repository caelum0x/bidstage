CREATE TABLE destination_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,
  checkout_id uuid NOT NULL REFERENCES payment_checkouts(id),
  method text NOT NULL CHECK (method IN ('dns_txt')),
  hostname text NOT NULL,
  record_name text NOT NULL,
  challenge_token text NOT NULL UNIQUE CHECK (challenge_token ~ '^bidstage-verification=[a-f0-9]{32}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'verified', 'expired')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  verified_at timestamptz
);

CREATE INDEX destination_verifications_state_expiry_idx
  ON destination_verifications (state, expires_at);
