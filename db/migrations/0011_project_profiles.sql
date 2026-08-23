ALTER TABLE payment_checkouts
  ADD COLUMN country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN funding_provider text CHECK (funding_provider IS NULL OR funding_provider IN ('github_sponsors', 'open_collective')),
  ADD COLUMN funding_url text,
  ADD COLUMN github_verification_method text CHECK (github_verification_method IS NULL OR github_verification_method IN ('personal_owner', 'repository_file')),
  ADD CONSTRAINT payment_checkouts_funding_pair CHECK (
    (funding_provider IS NULL AND funding_url IS NULL)
    OR (funding_provider IS NOT NULL AND funding_url IS NOT NULL)
  );

ALTER TABLE listings
  ADD COLUMN country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN funding_provider text CHECK (funding_provider IS NULL OR funding_provider IN ('github_sponsors', 'open_collective')),
  ADD COLUMN funding_url text,
  ADD COLUMN github_verification_method text CHECK (github_verification_method IS NULL OR github_verification_method IN ('personal_owner', 'repository_file')),
  ADD CONSTRAINT listings_funding_pair CHECK (
    (funding_provider IS NULL AND funding_url IS NULL)
    OR (funding_provider IS NOT NULL AND funding_url IS NOT NULL)
  );

ALTER TABLE listing_versions
  ADD COLUMN country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN funding_provider text CHECK (funding_provider IS NULL OR funding_provider IN ('github_sponsors', 'open_collective')),
  ADD COLUMN funding_url text,
  ADD CONSTRAINT listing_versions_funding_pair CHECK (
    (funding_provider IS NULL AND funding_url IS NULL)
    OR (funding_provider IS NOT NULL AND funding_url IS NOT NULL)
  );

CREATE INDEX listings_country_rank_idx
  ON listings (country_code, total_cents DESC, last_bid_at ASC)
  WHERE status = 'active' AND product_kind = 'open_source';
