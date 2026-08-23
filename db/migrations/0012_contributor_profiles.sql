CREATE TABLE contributor_profiles (
  founder_id uuid PRIMARY KEY REFERENCES founder_accounts(id) ON DELETE CASCADE,
  headline text NOT NULL CHECK (char_length(headline) BETWEEN 3 AND 100),
  bio text CHECK (bio IS NULL OR char_length(bio) BETWEEN 3 AND 500),
  country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  skills text[] NOT NULL CHECK (cardinality(skills) BETWEEN 1 AND 8),
  availability text NOT NULL CHECK (availability IN ('available', 'limited', 'unavailable')),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contributor_profiles_public_updated_idx
  ON contributor_profiles (updated_at DESC)
  WHERE is_public = true;

CREATE INDEX contributor_profiles_country_public_idx
  ON contributor_profiles (country_code, updated_at DESC)
  WHERE is_public = true;
