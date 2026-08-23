import { creemEnv } from "./env";

type CreemCheckoutResponse = {
  id?: unknown;
  checkout_url?: unknown;
  status?: unknown;
  mode?: unknown;
  request_id?: unknown;
  product?: unknown;
  order?: unknown;
};

export type CreemCheckoutSnapshot = {
  id: string;
  status: CreemCheckout["status"];
  mode: string;
  requestId: string | null;
  productId: string | null;
  order: null | {
    id: string | null;
    status: string | null;
    amountCents: number | null;
    currency: string | null;
    transactionId: string | null;
  };
};

function entityId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function creemBaseUrl(testMode: boolean): string {
  return testMode ? "https://test-api.creem.io" : "https://api.creem.io";
}

export type CreemCheckout = {
  id: string;
  checkoutUrl: string;
  status: "pending" | "processing" | "completed" | "expired";
};

export type CreateCreemCheckoutInput = {
  requestId: string;
  amountCents: number;
  successUrl: string;
  metadata: Record<string, string | number>;
};

/**
 * Creem checkout adapter. A reviewed one-time product anchors the checkout;
 * Creem's custom_price carries the exact contribution quoted by Bidstage.
 * Price and settlement are still revalidated in the signed webhook.
 */
export async function createCreemCheckout(
  input: Readonly<CreateCreemCheckoutInput>,
): Promise<CreemCheckout> {
  const env = creemEnv();
  const baseUrl = creemBaseUrl(env.testMode);
  const response = await fetch(`${baseUrl}/v1/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.apiKey,
    },
    body: JSON.stringify({
      product_id: env.productId,
      request_id: input.requestId,
      units: 1,
      custom_price: input.amountCents,
      success_url: input.successUrl,
      metadata: input.metadata,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as CreemCheckoutResponse;
  if (!response.ok) {
    throw new Error(`Creem checkout failed with status ${response.status}`);
  }
  if (
    typeof body.id !== "string" ||
    typeof body.checkout_url !== "string" ||
    !/^https:\/\//i.test(body.checkout_url) ||
    !["pending", "processing", "completed", "expired"].includes(String(body.status))
  ) {
    throw new Error("Creem returned an invalid checkout response");
  }
  return {
    id: body.id,
    checkoutUrl: body.checkout_url,
    status: body.status as CreemCheckout["status"],
  };
}

export async function retrieveCreemCheckout(checkoutId: string): Promise<CreemCheckoutSnapshot> {
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(checkoutId)) {
    throw new Error("Invalid Creem checkout ID");
  }
  const env = creemEnv();
  const response = await fetch(
    `${creemBaseUrl(env.testMode)}/v1/checkouts?checkout_id=${encodeURIComponent(checkoutId)}`,
    {
      headers: { Accept: "application/json", "x-api-key": env.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as CreemCheckoutResponse;
  if (!response.ok) throw new Error(`Creem checkout lookup failed with status ${response.status}`);
  if (
    typeof body.id !== "string" ||
    typeof body.mode !== "string" ||
    !["pending", "processing", "completed", "expired"].includes(String(body.status))
  ) {
    throw new Error("Creem returned an invalid checkout snapshot");
  }
  const order = body.order && typeof body.order === "object" && !Array.isArray(body.order)
    ? body.order as Record<string, unknown>
    : null;
  return {
    id: body.id,
    status: body.status as CreemCheckout["status"],
    mode: body.mode,
    requestId: typeof body.request_id === "string" ? body.request_id : null,
    productId: entityId(body.product),
    order: order ? {
      id: entityId(order),
      status: typeof order.status === "string" ? order.status : null,
      amountCents: Number.isSafeInteger(order.amount) ? order.amount as number : null,
      currency: typeof order.currency === "string" ? order.currency.toLowerCase() : null,
      transactionId: entityId(order.transaction),
    } : null,
  };
}
