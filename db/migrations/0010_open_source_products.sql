ALTER TABLE payment_checkouts
  ADD COLUMN product_kind text NOT NULL DEFAULT 'commercial'
    CHECK (product_kind IN ('commercial', 'open_source')),
  ADD COLUMN github_repository_id bigint CHECK (github_repository_id IS NULL OR github_repository_id > 0),
  ADD COLUMN github_owner text,
  ADD COLUMN github_name text,
  ADD COLUMN github_url text,
  ADD COLUMN github_description text,
  ADD COLUMN github_stars integer CHECK (github_stars IS NULL OR github_stars >= 0),
  ADD COLUMN github_license_spdx text,
  ADD COLUMN github_primary_language text,
  ADD CONSTRAINT payment_checkouts_open_source_metadata CHECK (
    product_kind = 'commercial'
    OR (
      founder_id IS NOT NULL
      AND github_repository_id IS NOT NULL
      AND github_owner IS NOT NULL
      AND github_name IS NOT NULL
      AND github_url IS NOT NULL
      AND github_license_spdx IS NOT NULL
    )
  );

ALTER TABLE listings
  ADD COLUMN product_kind text NOT NULL DEFAULT 'commercial'
    CHECK (product_kind IN ('commercial', 'open_source')),
  ADD COLUMN github_repository_id bigint CHECK (github_repository_id IS NULL OR github_repository_id > 0),
  ADD COLUMN github_owner text,
  ADD COLUMN github_name text,
  ADD COLUMN github_url text,
  ADD COLUMN github_description text,
  ADD COLUMN github_stars integer CHECK (github_stars IS NULL OR github_stars >= 0),
  ADD COLUMN github_license_spdx text,
  ADD COLUMN github_primary_language text,
  ADD COLUMN github_metadata_updated_at timestamptz,
  ADD CONSTRAINT listings_open_source_metadata CHECK (
    product_kind = 'commercial'
    OR (
      founder_id IS NOT NULL
      AND github_repository_id IS NOT NULL
      AND github_owner IS NOT NULL
      AND github_name IS NOT NULL
      AND github_url IS NOT NULL
      AND github_license_spdx IS NOT NULL
    )
  );

CREATE UNIQUE INDEX listings_github_repository_idx
  ON listings (github_repository_id)
  WHERE github_repository_id IS NOT NULL;

CREATE INDEX listings_kind_rank_idx
  ON listings (product_kind, total_cents DESC, last_bid_at ASC)
  WHERE status = 'active';
