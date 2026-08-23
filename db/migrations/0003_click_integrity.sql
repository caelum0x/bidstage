ALTER TABLE click_events
  ADD COLUMN session_hash text,
  ADD COLUMN user_agent_class text NOT NULL DEFAULT 'unknown'
    CHECK (user_agent_class IN ('browser', 'bot', 'unknown')),
  ADD COLUMN decision text NOT NULL DEFAULT 'verified'
    CHECK (decision IN ('verified', 'excluded_bot', 'excluded_prefetch', 'excluded_repeat', 'excluded_non_navigation')),
  ADD COLUMN exclusion_reason text,
  ADD COLUMN retention_expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');

CREATE INDEX click_events_retention_idx
  ON click_events (retention_expires_at);

CREATE INDEX click_events_listing_verified_time_idx
  ON click_events (listing_id, clicked_at DESC)
  WHERE decision = 'verified';

CREATE TABLE click_sessions (
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  PRIMARY KEY (listing_id, session_hash)
);

CREATE INDEX click_sessions_expiry_idx
  ON click_sessions (expires_at);
