ALTER TABLE payment_checkouts
  ADD COLUMN destination_dns_checked_at timestamptz,
  ADD COLUMN destination_dns_address_count integer
    CHECK (destination_dns_address_count IS NULL OR destination_dns_address_count > 0),
  ADD COLUMN destination_dns_fingerprint text
    CHECK (destination_dns_fingerprint IS NULL OR destination_dns_fingerprint ~ '^[a-f0-9]{64}$');

COMMENT ON COLUMN payment_checkouts.destination_dns_fingerprint IS
  'SHA-256 fingerprint of the sorted public A/AAAA address set checked before provider checkout; raw addresses are not retained.';
