CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex')
    CHECK (public_reference ~ '^[a-f0-9]{16}$'),
  founder_id uuid NOT NULL REFERENCES founder_accounts(id),
  request_type text NOT NULL
    CHECK (request_type IN ('access', 'correction', 'deletion', 'restriction')),
  details text NOT NULL CHECK (char_length(details) BETWEEN 20 AND 1200),
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'in_progress', 'completed', 'declined', 'cancelled')),
  operator_response text
    CHECK (operator_response IS NULL OR char_length(operator_response) BETWEEN 3 AND 1200),
  assigned_operator_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (updated_at >= created_at),
  CHECK (
    (state = 'open'
      AND assigned_operator_id IS NULL
      AND operator_response IS NULL
      AND completed_at IS NULL)
    OR (state = 'in_progress'
      AND assigned_operator_id IS NOT NULL
      AND operator_response IS NULL
      AND completed_at IS NULL)
    OR (state IN ('completed', 'declined')
      AND assigned_operator_id IS NOT NULL
      AND operator_response IS NOT NULL
      AND completed_at IS NOT NULL)
    OR (state = 'cancelled' AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX privacy_requests_one_active_type_idx
  ON privacy_requests (founder_id, request_type)
  WHERE state IN ('open', 'in_progress');

CREATE INDEX privacy_requests_operator_queue_idx
  ON privacy_requests (state, created_at ASC)
  WHERE state IN ('open', 'in_progress');

COMMENT ON TABLE privacy_requests IS
  'Authenticated account-data requests and their operator disposition; economic and safety records remain governed by the published retention schedule.';
