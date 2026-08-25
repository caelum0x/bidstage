import { test } from "node:test";
import assert from "node:assert/strict";
import { reversalStates } from "../lib/reversal-states";

test("a partial refund reports partial states; a full refund reports refunded states", () => {
  assert.deepEqual(
    reversalStates({
      kind: "refund",
      priorAdjustmentState: "none",
      priorCheckoutState: "settled",
      fullyReversed: false,
    }),
    { adjustmentState: "partial_refund", checkoutState: "partially_refunded" },
  );
  assert.deepEqual(
    reversalStates({
      kind: "refund",
      priorAdjustmentState: "partial_refund",
      priorCheckoutState: "partially_refunded",
      fullyReversed: true,
    }),
    { adjustmentState: "refunded", checkoutState: "refunded" },
  );
});

test("a dispute reports disputed states regardless of how much was reversed", () => {
  for (const fullyReversed of [true, false]) {
    assert.deepEqual(
      reversalStates({
        kind: "dispute",
        priorAdjustmentState: "partial_refund",
        priorCheckoutState: "partially_refunded",
        fullyReversed,
      }),
      { adjustmentState: "disputed", checkoutState: "disputed" },
    );
  }
});

test("a dispute is terminal: a later refund must not downgrade either state field", () => {
  // Provider webhooks are not ordered, so a refund can settle after a dispute.
  // Both the receipt-facing checkout state AND the bid adjustment state must
  // stay 'disputed' — otherwise the public receipt would misrepresent a
  // chargeback as a voluntary refund. This is the regression guard for the
  // adjustment_state field, which previously lacked the sticky-dispute check.
  assert.deepEqual(
    reversalStates({
      kind: "refund",
      priorAdjustmentState: "disputed",
      priorCheckoutState: "disputed",
      fullyReversed: false,
    }),
    { adjustmentState: "disputed", checkoutState: "disputed" },
  );
  assert.deepEqual(
    reversalStates({
      kind: "refund",
      priorAdjustmentState: "disputed",
      priorCheckoutState: "disputed",
      fullyReversed: true,
    }),
    { adjustmentState: "disputed", checkoutState: "disputed" },
  );
});
