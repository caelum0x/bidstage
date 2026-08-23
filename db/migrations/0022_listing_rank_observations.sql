CREATE TABLE listing_rank_observations (
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL,
  overall_rank integer NOT NULL CHECK (overall_rank > 0),
  overall_entries integer NOT NULL CHECK (overall_entries > 0),
  category_rank integer NOT NULL CHECK (category_rank > 0),
  category_entries integer NOT NULL CHECK (category_entries > 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  bid_count integer NOT NULL CHECK (bid_count >= 0),
  PRIMARY KEY (listing_id, captured_at),
  CHECK (overall_rank <= overall_entries),
  CHECK (category_rank <= category_entries)
);

CREATE INDEX listing_rank_observations_time_idx
  ON listing_rank_observations (captured_at DESC);

ALTER TABLE maintenance_runs
  ADD COLUMN activity_counts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(activity_counts) = 'object');

COMMENT ON TABLE listing_rank_observations IS
  'Public rank evidence for active open-source listings, persisted when rank inputs change and at least once per 24 hours.';

COMMENT ON COLUMN listing_rank_observations.total_cents IS
  'Aggregate settled placement value at observation time; payer identity and payment references are intentionally excluded.';
