CREATE TABLE founder_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id bigint NOT NULL UNIQUE CHECK (github_user_id > 0),
  github_login text NOT NULL CHECK (github_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
  display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 120),
  avatar_url text NOT NULL,
  profile_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE founder_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id uuid NOT NULL REFERENCES founder_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX founder_sessions_active_idx
  ON founder_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE payment_checkouts
  ADD COLUMN founder_id uuid REFERENCES founder_accounts(id) ON DELETE SET NULL;

ALTER TABLE listings
  ADD COLUMN founder_id uuid REFERENCES founder_accounts(id) ON DELETE SET NULL;
