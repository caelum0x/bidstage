CREATE TABLE destination_security_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'cloudflare_url_scanner'
    CHECK (provider = 'cloudflare_url_scanner'),
  provider_scan_id uuid NOT NULL UNIQUE,
  destination_fingerprint text NOT NULL
    CHECK (destination_fingerprint ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'passed', 'rejected', 'failed')),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility = 'public'),
  report_url text NOT NULL CHECK (report_url ~ '^https://radar\.cloudflare\.com/scan/[a-f0-9-]+$'),
  final_origin text,
  redirect_count integer CHECK (redirect_count BETWEEN 0 AND 20),
  redirect_chain_fingerprint text
    CHECK (redirect_chain_fingerprint IS NULL OR redirect_chain_fingerprint ~ '^[a-f0-9]{64}$'),
  has_verdicts boolean,
  malicious boolean,
  verdict_categories text[] NOT NULL DEFAULT '{}',
  verdict_tags text[] NOT NULL DEFAULT '{}',
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{3,48}$'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  CHECK (
    (state = 'pending' AND completed_at IS NULL AND expires_at IS NULL)
    OR (state IN ('rejected', 'failed') AND completed_at IS NOT NULL AND expires_at IS NULL)
    OR (
      state = 'passed'
      AND completed_at IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at > completed_at
      AND final_origin IS NOT NULL
      AND redirect_count IS NOT NULL
      AND redirect_chain_fingerprint IS NOT NULL
      AND has_verdicts = true
      AND malicious = false
      AND error_code IS NULL
    )
  )
);

CREATE UNIQUE INDEX destination_security_reviews_one_pending_idx
  ON destination_security_reviews (listing_id, destination_fingerprint)
  WHERE state = 'pending';

CREATE INDEX destination_security_reviews_listing_recent_idx
  ON destination_security_reviews (listing_id, completed_at DESC, submitted_at DESC);

COMMENT ON TABLE destination_security_reviews IS
  'Minimal evidence from public Cloudflare URL Scanner reports; raw page content, cookies, screenshots, and request logs are not retained.';
