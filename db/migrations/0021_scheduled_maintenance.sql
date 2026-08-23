CREATE TABLE maintenance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_at timestamptz NOT NULL UNIQUE,
  cron_expression text NOT NULL CHECK (char_length(cron_expression) BETWEEN 5 AND 64),
  state text NOT NULL DEFAULT 'running'
    CHECK (state IN ('running', 'completed', 'attention', 'failed')),
  cleanup_counts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(cleanup_counts) = 'object'),
  health_counts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(health_counts) = 'object'),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{3,48}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
    (state = 'running' AND completed_at IS NULL AND error_code IS NULL)
    OR (state IN ('completed', 'attention') AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (state = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX maintenance_runs_state_time_idx
  ON maintenance_runs (state, scheduled_at DESC);

COMMENT ON TABLE maintenance_runs IS
  'Idempotent hourly retention and operational-health runs invoked by the Cloudflare Cron Trigger; counts contain no customer content or credentials.';
