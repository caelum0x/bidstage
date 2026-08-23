ALTER TABLE payment_checkouts
  ADD COLUMN founder_access_hash text
    CHECK (founder_access_hash IS NULL OR founder_access_hash ~ '^[a-f0-9]{64}$');

COMMENT ON COLUMN payment_checkouts.founder_access_hash IS
  'SHA-256 hash of the HttpOnly founder capability issued by checkout; never exposed by public receipt APIs.';
