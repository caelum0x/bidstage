-- Pre-launch demand capture.
--
-- While CHECKOUT_ENABLED=false (payment provider approval pending) a founder
-- who tries to pay is a lost, unrecorded buyer. This table records "email me
-- when checkout opens" signups so launch day starts with a warm list. One row
-- per email: a repeat signup is an idempotent no-op that keeps the first
-- attribution (source / repository) rather than churning the row.
CREATE TABLE launch_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE
    CHECK (email = lower(email) AND char_length(email) <= 254
           AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  source text NOT NULL
    CHECK (source IN ('checkout_disabled', 'landing')),
  repository_url text
    CHECK (repository_url IS NULL OR char_length(repository_url) <= 500),
  founder_id uuid REFERENCES founder_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
