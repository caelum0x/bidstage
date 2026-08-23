ALTER TABLE support_cases
  DROP CONSTRAINT support_cases_category_check;

ALTER TABLE support_cases
  ADD CONSTRAINT support_cases_category_check
  CHECK (category IN ('payment', 'refund', 'placement', 'appeal', 'destination', 'technical'));

CREATE UNIQUE INDEX support_cases_open_appeal_checkout_idx
  ON support_cases (checkout_id)
  WHERE category = 'appeal' AND state IN ('open', 'needs_customer');
