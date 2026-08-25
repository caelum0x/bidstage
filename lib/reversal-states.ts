/**
 * Pure state-transition rules for the reversal (refund/dispute) ledger path.
 *
 * A settled contribution is tracked by two derived state fields that are both
 * surfaced on the public receipt: `payment_checkouts.state` and
 * `bids.adjustment_state`. A dispute (chargeback) is terminal — once a
 * contribution is disputed, a later refund event MUST NOT downgrade the record
 * back to a refund state, or the receipt would misrepresent a chargeback as a
 * voluntary refund. Provider webhooks are not ordered, so a refund can settle
 * after a dispute; both fields therefore keep `disputed` sticky.
 *
 * Extracted from `payment-settlement.ts` so the money-path state machine is
 * unit-testable without a database (see test/reversal-states.test.ts).
 */
export type ReversalKind = "refund" | "dispute";

export type BidAdjustmentState = "disputed" | "refunded" | "partial_refund";
export type CheckoutReversalState = "disputed" | "refunded" | "partially_refunded";

export type ReversalStatesInput = {
  kind: ReversalKind;
  priorAdjustmentState: string;
  priorCheckoutState: string;
  /** True when the cumulative reversed amount equals the settled contribution. */
  fullyReversed: boolean;
};

export function reversalStates(
  input: Readonly<ReversalStatesInput>,
): { adjustmentState: BidAdjustmentState; checkoutState: CheckoutReversalState } {
  const disputed = input.kind === "dispute";
  return {
    adjustmentState:
      disputed || input.priorAdjustmentState === "disputed"
        ? "disputed"
        : input.fullyReversed
          ? "refunded"
          : "partial_refund",
    checkoutState:
      disputed || input.priorCheckoutState === "disputed"
        ? "disputed"
        : input.fullyReversed
          ? "refunded"
          : "partially_refunded",
  };
}
