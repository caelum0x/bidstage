CREATE TABLE support_case_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_case_id uuid NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
  author_type text NOT NULL CHECK (author_type IN ('founder', 'operator')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 3 AND 1200),
  operator_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (author_type = 'founder' AND operator_id IS NULL)
    OR (author_type = 'operator' AND operator_id IS NOT NULL)
  )
);

CREATE INDEX support_case_messages_case_time_idx
  ON support_case_messages (support_case_id, created_at ASC);

INSERT INTO support_case_messages
  (support_case_id, author_type, body, created_at)
SELECT id, 'founder', message, created_at
FROM support_cases;

INSERT INTO support_case_messages
  (support_case_id, author_type, body, operator_id, created_at)
SELECT id, 'operator', operator_response,
       coalesce(assigned_operator_id, 'legacy-operator'), updated_at
FROM support_cases
WHERE operator_response IS NOT NULL;
