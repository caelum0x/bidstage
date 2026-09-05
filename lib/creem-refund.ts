/**
 * Pure, validated conversion of Creem's externally reported refund amounts into
 * the cumulative amount to reverse against the Bidstage contribution.
 *
 * Creem reports `amount_paid` (what the buyer paid) and `refunded_amount`
 * (cumulative refunded) on the transaction, while Bidstage credits its own
 * `transaction.amount`. These can legitimately differ (fees, currency display),
 * so the refunded amount is scaled into Bidstage's contribution space. Because
 * this trusts external numbers, the inputs are validated for internal
 * consistency and the result is clamped so a reversal can never exceed the
 * contribution — an inconsistent payload is rejected rather than guessed.
 *
 * Extracted from the Creem webhook so the arithmetic is unit-testable.
 */
export type CreemRefundAmounts = {
  /** Bidstage's credited contribution amount (transaction.amount), in cents. */
  transactionAmount: number;
  /** Provider-reported amount the buyer paid, in cents. */
  amountPaid: number;
  /** Provider-reported cumulative refunded amount, in cents. */
  refundedAmount: number;
};

function positiveInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export function creemCumulativeReversedCents(
  input: Readonly<CreemRefundAmounts>,
): number {
  const transactionAmount = positiveInt(input.transactionAmount, "Creem transaction amount");
  const amountPaid = positiveInt(input.amountPaid, "Creem paid amount");
  const refundedAmount = positiveInt(input.refundedAmount, "Creem cumulative refunded amount");
  if (refundedAmount > amountPaid) {
    throw new Error("Creem cumulative refund exceeds the amount paid");
  }
  return Math.min(
    transactionAmount,
    Math.round((transactionAmount * refundedAmount) / amountPaid),
  );
}
