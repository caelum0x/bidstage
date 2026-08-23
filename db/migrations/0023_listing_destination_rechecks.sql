CREATE TABLE listing_destination_rechecks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('passed', 'rejected', 'failed')),
  address_count integer CHECK (address_count IS NULL OR address_count > 0),
  address_fingerprint text CHECK (
    address_fingerprint IS NULL OR address_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{3,48}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, checked_at),
  CHECK (
    (state = 'passed' AND address_count IS NOT NULL AND address_fingerprint IS NOT NULL AND error_code IS NULL)
    OR (
      state = 'rejected'
      AND address_count IS NULL
      AND address_fingerprint IS NULL
      AND error_code IN ('invalid_hostname', 'non_public_address', 'unresolved_destination')
    )
    OR (
      state = 'failed'
      AND address_count IS NULL
      AND address_fingerprint IS NULL
      AND error_code = 'dns_unavailable'
    )
  )
);

CREATE INDEX listing_destination_rechecks_listing_time_idx
  ON listing_destination_rechecks (listing_id, checked_at DESC);

CREATE INDEX listing_destination_rechecks_state_time_idx
  ON listing_destination_rechecks (state, checked_at DESC);

COMMENT ON TABLE listing_destination_rechecks IS
  'Bounded scheduled DNS safety evidence for active project destinations; stores only address counts, one-way fingerprints, and bounded result codes.';
