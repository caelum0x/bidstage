import { createHmac, timingSafeEqual } from "node:crypto";

import { dodoEnv } from "./env";

type DodoCheckoutResponse = {
  session_id?: unknown;
  checkout_url?: unknown;
};

export type DodoCheckout = {
  id: string;
  checkoutUrl: string;
};

export type DodoCheckoutSnapshot = {
  id: string;
  paymentId: string | null;
  paymentStatus: string | null;
  payment: null | {
    id: string;
    checkoutId: string | null;
    status: string | null;
    businessId: string;
    paymentProvider: string;
    amountCents: number;
    currency: string;
    checkoutMetadataId: string | null;
    productId: string | null;
    quantity: number | null;
    subscriptionId: string | null;
  };
};

export type CreateDodoCheckoutInput = {
  requestId: string;
  amountCents: number;
  successUrl: string;
  metadata: Record<string, string | number>;
};

function dodoBaseUrl(testMode: boolean): string {
  return testMode ? "https://test.dodopayments.com" : "https://live.dodopayments.com";
}

export function trustedDodoCheckoutUrl(value: string, testMode: boolean): string | null {
  try {
    const url = new URL(value);
    const trustedHosts = testMode
      ? ["test.dodopayments.com", "checkout.dodopayments.com"]
      : ["live.dodopayments.com", "checkout.dodopayments.com"];
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !trustedHosts.includes(url.hostname)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function createDodoCheckout(
  input: Readonly<CreateDodoCheckoutInput>,
): Promise<DodoCheckout> {
  const env = dodoEnv();
  const response = await fetch(`${dodoBaseUrl(env.testMode)}/checkouts`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.apiKey}`,
      "Content-Type": "application/json",
      // Stable per-checkout idempotency key. Concurrent retries of the same
      // Bidstage checkout (identical requestId) return the same provider session
      // instead of creating a second payable checkout.
      "Idempotency-Key": input.requestId,
    },
    body: JSON.stringify({
      product_cart: [{ product_id: env.productId, quantity: 1, amount: input.amountCents }],
      return_url: input.successUrl,
      cancel_url: input.successUrl,
      metadata: Object.fromEntries(
        Object.entries(input.metadata).map(([key, value]) => [key, String(value)]),
      ),
      feature_flags: {
        allow_currency_selection: false,
        allow_discount_code: false,
        allow_editing_addons: false,
      },
      short_link: false,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as DodoCheckoutResponse;
  if (!response.ok) throw new Error(`Dodo checkout failed with status ${response.status}`);
  if (typeof body.session_id !== "string" || typeof body.checkout_url !== "string") {
    throw new Error("Dodo returned an invalid checkout response");
  }
  const checkoutUrl = trustedDodoCheckoutUrl(body.checkout_url, env.testMode);
  if (!checkoutUrl) {
    throw new Error("Dodo returned an untrusted checkout URL");
  }
  return { id: body.session_id, checkoutUrl };
}

function dodoId(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{6,160}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

async function dodoGet(path: string): Promise<Record<string, unknown>> {
  const env = dodoEnv();
  const response = await fetch(`${dodoBaseUrl(env.testMode)}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Dodo lookup failed with status ${response.status}`);
  return body;
}

export async function retrieveDodoCheckout(checkoutId: string): Promise<DodoCheckoutSnapshot> {
  const id = dodoId(checkoutId, "Dodo checkout ID");
  const checkout = await dodoGet(`/checkouts/${encodeURIComponent(id)}`);
  if (checkout.id !== id) throw new Error("Dodo returned a mismatched checkout snapshot");
  const paymentId = typeof checkout.payment_id === "string"
    ? dodoId(checkout.payment_id, "Dodo payment ID")
    : null;
  if (!paymentId) {
    return {
      id,
      paymentId: null,
      paymentStatus: typeof checkout.payment_status === "string" ? checkout.payment_status : null,
      payment: null,
    };
  }

  const payment = await dodoGet(`/payments/${encodeURIComponent(paymentId)}`);
  const metadata = payment.metadata && typeof payment.metadata === "object" && !Array.isArray(payment.metadata)
    ? payment.metadata as Record<string, unknown>
    : {};
  const cart = Array.isArray(payment.product_cart) ? payment.product_cart : [];
  const product = cart.length === 1 && cart[0] && typeof cart[0] === "object" && !Array.isArray(cart[0])
    ? cart[0] as Record<string, unknown>
    : null;
  if (
    payment.payment_id !== paymentId
    || typeof payment.business_id !== "string"
    || typeof payment.payment_provider !== "string"
    || !Number.isSafeInteger(payment.total_amount)
    || typeof payment.currency !== "string"
  ) {
    throw new Error("Dodo returned an invalid payment snapshot");
  }
  return {
    id,
    paymentId,
    paymentStatus: typeof checkout.payment_status === "string" ? checkout.payment_status : null,
    payment: {
      id: paymentId,
      checkoutId: typeof payment.checkout_session_id === "string" ? payment.checkout_session_id : null,
      status: typeof payment.status === "string" ? payment.status : null,
      businessId: payment.business_id,
      paymentProvider: payment.payment_provider,
      amountCents: payment.total_amount as number,
      currency: payment.currency.toLowerCase(),
      checkoutMetadataId: typeof metadata.checkout_id === "string" ? metadata.checkout_id : null,
      productId: typeof product?.product_id === "string" ? product.product_id : null,
      quantity: Number.isSafeInteger(product?.quantity) ? product!.quantity as number : null,
      subscriptionId: typeof payment.subscription_id === "string" ? payment.subscription_id : null,
    },
  };
}

type DodoWebhookHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

/** Standard Webhooks HMAC verification, including its five-minute replay window. */
export function verifyDodoWebhookSignature(
  rawBody: string,
  headers: Readonly<DodoWebhookHeaders>,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(headers.id) || !/^\d{10,13}$/.test(headers.timestamp)) {
    return false;
  }
  const timestamp = Number(headers.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;

  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSecret)) return false;
  const key = Buffer.from(encodedSecret, "base64");
  if (key.length < 24 || key.length > 64) return false;
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();

  for (const versionedSignature of headers.signature.trim().split(/\s+/).slice(0, 16)) {
    const separator = versionedSignature.indexOf(",");
    if (separator < 0 || versionedSignature.slice(0, separator) !== "v1") continue;
    const encodedSignature = versionedSignature.slice(separator + 1);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSignature)) continue;
    const supplied = Buffer.from(encodedSignature, "base64");
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}
