import { test } from "node:test";
import assert from "node:assert/strict";

import { creemCumulativeReversedCents } from "../lib/creem-refund";
import { createDodoCheckout } from "../lib/dodo";
import { createCreemCheckout } from "../lib/creem";
import { resetServerEnvForTests } from "../lib/env";

test("creemCumulativeReversedCents scales external refund amounts into contribution space", () => {
  // Equal paid/credited amounts pass through unchanged.
  assert.equal(
    creemCumulativeReversedCents({ transactionAmount: 700, amountPaid: 700, refundedAmount: 300 }),
    300,
  );
  // A different paid amount is scaled proportionally.
  assert.equal(
    creemCumulativeReversedCents({ transactionAmount: 700, amountPaid: 1000, refundedAmount: 500 }),
    350,
  );
  // A full refund is clamped to the contribution.
  assert.equal(
    creemCumulativeReversedCents({ transactionAmount: 700, amountPaid: 700, refundedAmount: 700 }),
    700,
  );
});

test("creemCumulativeReversedCents rejects inconsistent external amounts", () => {
  assert.throws(
    () => creemCumulativeReversedCents({ transactionAmount: 700, amountPaid: 700, refundedAmount: 800 }),
    /exceeds the amount paid/,
  );
  assert.throws(
    () => creemCumulativeReversedCents({ transactionAmount: 700, amountPaid: 0, refundedAmount: 100 }),
    /positive integer/,
  );
  assert.throws(
    () => creemCumulativeReversedCents({ transactionAmount: 700, amountPaid: 700, refundedAmount: 0 }),
    /positive integer/,
  );
});

function setEnv(name: string, value: string): void {
  (process.env as Record<string, string | undefined>)[name] = value;
}

type CapturedRequest = { url: string; headers: Record<string, string> };

async function withMockedFetch(
  body: unknown,
  run: () => Promise<void>,
): Promise<CapturedRequest> {
  const captured: CapturedRequest = { url: "", headers: {} };
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.url = String(url);
    captured.headers = { ...(init?.headers as Record<string, string> | undefined) };
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return captured;
}

test("createDodoCheckout sends a stable per-checkout idempotency key", async () => {
  setEnv("DODO_PAYMENTS_API_KEY", "dodo_test_key");
  setEnv("DODO_PAYMENTS_WEBHOOK_KEY", "whsec_dodo");
  setEnv("DODO_PAYMENTS_PRODUCT_ID", "prod_dodo");
  setEnv("DODO_PAYMENTS_BUSINESS_ID", "biz_dodo");
  setEnv("DODO_PAYMENTS_TEST_MODE", "true");
  resetServerEnvForTests();

  const captured = await withMockedFetch(
    { session_id: "sess_dodo_1", checkout_url: "https://checkout.dodopayments.com/pay/1" },
    async () => {
      const checkout = await createDodoCheckout({
        requestId: "checkout-uuid-1",
        amountCents: 500,
        successUrl: "https://bidstage.example/receipt/abc",
        metadata: { product: "bidstage" },
      });
      assert.equal(checkout.id, "sess_dodo_1");
    },
  );
  assert.equal(captured.headers["Idempotency-Key"], "checkout-uuid-1");
});

test("createCreemCheckout sends a stable per-checkout idempotency key", async () => {
  setEnv("CREEM_API_KEY", "creem_test_key");
  setEnv("CREEM_WEBHOOK_SECRET", "creem_secret");
  setEnv("CREEM_PRODUCT_ID", "prod_creem");
  setEnv("CREEM_TEST_MODE", "true");
  resetServerEnvForTests();

  const captured = await withMockedFetch(
    { id: "sess_creem_1", checkout_url: "https://checkout.creem.io/pay/1", status: "pending" },
    async () => {
      const checkout = await createCreemCheckout({
        requestId: "checkout-uuid-2",
        amountCents: 500,
        successUrl: "https://bidstage.example/receipt/abc",
        metadata: { product: "bidstage" },
      });
      assert.equal(checkout.id, "sess_creem_1");
    },
  );
  assert.equal(captured.headers["Idempotency-Key"], "checkout-uuid-2");
});
