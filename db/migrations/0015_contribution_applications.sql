CREATE TABLE contribution_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  contributor_id uuid NOT NULL REFERENCES founder_accounts(id) ON DELETE CASCADE,
  message text NOT NULL CHECK (char_length(message) BETWEEN 20 AND 800),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (listing_id, contributor_id)
);

CREATE INDEX contribution_applications_contributor_time_idx
  ON contribution_applications (contributor_id, created_at DESC);

CREATE INDEX contribution_applications_listing_state_time_idx
  ON contribution_applications (listing_id, state, created_at DESC);
