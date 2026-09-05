import type { DatabaseClient } from "./db";

/**
 * State-guarded persistence of a provider checkout session onto an existing
 * `payment_checkouts` intent.
 *
 * Two hazards are guarded here:
 *
 *  - A late provider response (slow network, concurrent retry) must never clobber
 *    a checkout that a webhook has already advanced to a money state
 *    (`settled` / `partially_refunded` / `refunded` / `disputed`). The state is
 *    therefore only flipped to `pending` from the pre-provider states
 *    (`creating` / `failed`); a money state is left untouched.
 *
 *  - Concurrent retries that each created a provider session must converge on a
 *    single payable session. `coalesce` keeps the first-writer's
 *    `provider_checkout_id` / `checkout_url`, and the persisted (canonical) URL
 *    is returned so every caller hands the buyer the same session and any extra
 *    provider session is left orphaned (never surfaced, never paid).
 */
export type PersistedCheckoutSession = {
  providerCheckoutId: string | null;
  checkoutUrl: string | null;
};

export async function persistProviderCheckoutSession(
  client: DatabaseClient,
  input: Readonly<{ checkoutId: string; providerCheckoutId: string; checkoutUrl: string }>,
): Promise<PersistedCheckoutSession> {
  const result = await client.query<{
    provider_checkout_id: string | null;
    checkout_url: string | null;
  }>(
    `UPDATE payment_checkouts
       SET provider_checkout_id = coalesce(provider_checkout_id, $2),
           checkout_url = coalesce(checkout_url, $3),
           state = CASE WHEN state IN ('creating', 'failed') THEN 'pending' ELSE state END,
           failure_code = CASE WHEN state IN ('creating', 'failed') THEN NULL ELSE failure_code END,
           updated_at = now()
     WHERE id = $1
     RETURNING provider_checkout_id, checkout_url`,
    [input.checkoutId, input.providerCheckoutId, input.checkoutUrl],
  );
  const row = result.rows[0];
  if (!row) {
    // The intent row was created moments ago in this request, so a zero-row
    // UPDATE means something is seriously wrong (wrong database, external
    // deletion). Failing loudly routes the caller to its failure path instead
    // of handing the buyer a provider session no webhook can ever settle.
    throw new Error("Checkout intent disappeared before the provider session could be persisted");
  }
  return {
    providerCheckoutId: row.provider_checkout_id,
    checkoutUrl: row.checkout_url,
  };
}

/**
 * Mark a checkout as failed when its provider session could not be created.
 * Only pre-provider intents without a persisted session are affected, so a
 * concurrently-succeeded session or an already-settled/reversed checkout is
 * never downgraded to `failed`.
 */
export async function markProviderCheckoutFailed(
  client: DatabaseClient,
  checkoutId: string,
): Promise<void> {
  await client.query(
    `UPDATE payment_checkouts
       SET state = 'failed', failure_code = 'provider_checkout_failed', updated_at = now()
     WHERE id = $1
       AND provider_checkout_id IS NULL
       AND state IN ('creating', 'failed')`,
    [checkoutId],
  );
}
