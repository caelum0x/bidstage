CREATE TABLE listing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 64),
  destination text NOT NULL,
  category text NOT NULL CHECK (category IN ('ai', 'developer', 'design', 'commerce', 'consumer', 'other')),
  actor_type text NOT NULL CHECK (actor_type IN ('settlement', 'operator', 'owner')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, version_number)
);

INSERT INTO listing_versions
  (listing_id, version_number, title, destination, category, actor_type, reason, created_at)
SELECT id, 1, title, destination, category, 'settlement', 'initial_listing', created_at
FROM listings
ON CONFLICT (listing_id, version_number) DO NOTHING;

CREATE TABLE listing_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  previous_status text NOT NULL CHECK (previous_status IN ('active', 'review', 'removed')),
  next_status text NOT NULL CHECK (next_status IN ('active', 'review', 'removed')),
  action text NOT NULL CHECK (action IN ('approve', 'suspend', 'remove', 'restore')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z0-9_]{3,48}$'),
  public_note text NOT NULL CHECK (char_length(public_note) BETWEEN 3 AND 240),
  operator_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX listing_moderation_listing_time_idx
  ON listing_moderation (listing_id, created_at DESC);

CREATE TABLE operator_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operator_audit_events_time_idx
  ON operator_audit_events (created_at DESC);

CREATE INDEX listings_review_queue_idx
  ON listings (created_at ASC)
  WHERE status = 'review';
