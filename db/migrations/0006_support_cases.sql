CREATE TABLE support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference text NOT NULL UNIQUE CHECK (public_reference ~ '^[a-f0-9]{16}$'),
  access_token_hash text NOT NULL CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),
  checkout_id uuid NOT NULL REFERENCES payment_checkouts(id),
  category text NOT NULL CHECK (category IN ('payment', 'refund', 'placement', 'destination', 'technical')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 20 AND 1200),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'needs_customer', 'resolved', 'closed')),
  operator_response text CHECK (operator_response IS NULL OR char_length(operator_response) BETWEEN 3 AND 1200),
  assigned_operator_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX support_cases_queue_idx
  ON support_cases (state, created_at ASC);
