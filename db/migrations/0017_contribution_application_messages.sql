CREATE TABLE contribution_application_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES contribution_applications(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES founder_accounts(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 3 AND 1200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contribution_application_messages_application_time_idx
  ON contribution_application_messages (application_id, created_at ASC, id ASC);
