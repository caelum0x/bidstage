ALTER TABLE payment_checkouts
  ADD COLUMN contribution_url text,
  ADD COLUMN contribution_note text CHECK (contribution_note IS NULL OR char_length(contribution_note) BETWEEN 10 AND 180),
  ADD CONSTRAINT payment_checkouts_contribution_pair CHECK (
    (contribution_url IS NULL AND contribution_note IS NULL)
    OR (contribution_url IS NOT NULL AND contribution_note IS NOT NULL)
  );

ALTER TABLE listings
  ADD COLUMN contribution_url text,
  ADD COLUMN contribution_note text CHECK (contribution_note IS NULL OR char_length(contribution_note) BETWEEN 10 AND 180),
  ADD CONSTRAINT listings_contribution_pair CHECK (
    (contribution_url IS NULL AND contribution_note IS NULL)
    OR (contribution_url IS NOT NULL AND contribution_note IS NOT NULL)
  );

ALTER TABLE listing_versions
  ADD COLUMN contribution_url text,
  ADD COLUMN contribution_note text CHECK (contribution_note IS NULL OR char_length(contribution_note) BETWEEN 10 AND 180),
  ADD CONSTRAINT listing_versions_contribution_pair CHECK (
    (contribution_url IS NULL AND contribution_note IS NULL)
    OR (contribution_url IS NOT NULL AND contribution_note IS NOT NULL)
  );

CREATE INDEX listings_contribution_opportunities_idx
  ON listings (updated_at DESC)
  WHERE status = 'active'
    AND product_kind = 'open_source'
    AND contribution_url IS NOT NULL;
