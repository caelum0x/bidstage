import { NextResponse } from "next/server";

import { query, transaction, type DatabaseClient } from "@/lib/db";
import { verifyDodoWebhookSignature } from "@/lib/dodo";
import { dodoEnv } from "@/lib/env";
import { markPaymentEvent, reversePlacement, settlePlacement } from "@/lib/payment-settlement";
import { webhookIncidentId } from "@/lib/webhook-incidents";

export const runtime = "nodejs";

type JsonObject = Record<string, unknown>;
type DodoEvent = { id: string; type: string; businessId: string; data: JsonObject };

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function cents(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function eventObjectId(type: string, data: JsonObject): string {
  if (type.startsWith("payment.")) return text(data.payment_id, "Dodo payment id");
  if (type.startsWith("refund.")) return text(data.refund_id, "Dodo refund id");
  if (type.startsWith("dispute.")) return text(data.dispute_id, "Dodo dispute id");
  return typeof data.payload_type === "string" ? data.payload_type : "unknown";
}

function parseEvent(value: unknown, eventId: string, expectedBusinessId: string): DodoEvent {
  const envelope = object(value, "Dodo event");
  const businessId = text(envelope.business_id, "Dodo business id");
  const type = text(envelope.type, "Dodo event type");
  const data = object(envelope.data, "Dodo event data");
  if (businessId !== expectedBusinessId || data.business_id !== expectedBusinessId) {
    throw new Error("Dodo event belongs to a different business");
  }
  return { id: eventId, type, businessId, data };
}

async function settleDodoPayment(
  client: DatabaseClient,
  event: DodoEvent,
  expectedProductId: string,
) {
  const payment = event.data;
  const metadata = object(payment.metadata, "Dodo payment metadata");
  const customer = object(payment.customer, "Dodo customer");
  if (
    payment.payload_type !== "Payment"
    || payment.status !== "succeeded"
    || payment.payment_provider !== "dodo"
    || (payment.subscription_id !== null && payment.subscription_id !== undefined)
    || metadata.product !== "bidstage"
  ) {
    throw new Error("Dodo settlement is not a completed one-time Bidstage payment");
  }
  const productCart = payment.product_cart;
  if (!Array.isArray(productCart) || productCart.length !== 1) {
    throw new Error("Dodo settlement has an invalid product cart");
  }
  const product = object(productCart[0], "Dodo product cart item");
  if (product.product_id !== expectedProductId || product.quantity !== 1) {
    throw new Error("Dodo settlement product does not match the configured placement product");
  }
  await settlePlacement(client, {
    provider: "dodo",
    eventId: event.id,
    checkoutId: text(metadata.checkout_id, "Dodo checkout metadata id"),
    providerCheckoutId: text(payment.checkout_session_id, "Dodo checkout session id"),
    providerOrderId: text(payment.payment_id, "Dodo payment id"),
    providerTransactionId: text(payment.payment_id, "Dodo payment id"),
    amountCents: cents(payment.total_amount, "Dodo total amount"),
    currency: text(payment.currency, "Dodo payment currency"),
    payerEmail: typeof customer.email === "string" ? customer.email : null,
  });
}

async function reverseDodoPayment(
  client: DatabaseClient,
  event: DodoEvent,
  kind: "refund" | "dispute",
) {
  const adjustment = event.data;
  if (kind === "refund") {
    if (adjustment.payload_type !== "Refund" || adjustment.status !== "succeeded") {
      throw new Error("Dodo refund has not succeeded");
    }
    await reversePlacement(client, {
      provider: "dodo",
      eventId: event.id,
      providerAdjustmentId: text(adjustment.refund_id, "Dodo refund id"),
      providerOrderId: text(adjustment.payment_id, "Dodo refund payment id"),
      providerTransactionId: text(adjustment.payment_id, "Dodo refund payment id"),
      kind,
      currency: text(adjustment.currency, "Dodo refund currency"),
      adjustmentAmountCents: cents(adjustment.amount, "Dodo refund amount"),
    });
    return;
  }
  if (adjustment.payload_type !== "Dispute" || adjustment.dispute_status !== "dispute_opened") {
    throw new Error("Dodo dispute is not newly opened");
  }
  await reversePlacement(client, {
    provider: "dodo",
    eventId: event.id,
    providerAdjustmentId: text(adjustment.dispute_id, "Dodo dispute id"),
    providerOrderId: text(adjustment.payment_id, "Dodo dispute payment id"),
    providerTransactionId: text(adjustment.payment_id, "Dodo dispute payment id"),
    kind,
    currency: text(adjustment.currency, "Dodo dispute currency"),
  });
}

export async function POST(request: Request) {
  const eventId = request.headers.get("webhook-id") ?? "";
  const timestamp = request.headers.get("webhook-timestamp") ?? "";
  const signature = request.headers.get("webhook-signature") ?? "";
  if (!eventId || !timestamp || !signature) {
    return NextResponse.json({ error: "missing_signature_headers" }, { status: 400 });
  }
  const rawBody = await request.text();
  const env = dodoEnv();
  if (!verifyDodoWebhookSignature(rawBody, { id: eventId, timestamp, signature }, env.webhookKey)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: DodoEvent;
  try {
    event = parseEvent(JSON.parse(rawBody), eventId, env.businessId);
  } catch {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  const objectId = eventObjectId(event.type, event.data);

  try {
    await transaction(async (client) => {
      const eventClaim = await client.query<{ processing_state: string }>(
        `INSERT INTO payment_events
           (provider, event_id, event_type, object_id, processing_state)
         VALUES ('dodo', $1, $2, $3, 'received')
         ON CONFLICT (provider, event_id) DO UPDATE SET
           attempt_count = payment_events.attempt_count + 1
         RETURNING processing_state`,
        [event.id, event.type, objectId],
      );
      if (eventClaim.rows[0]?.processing_state === "processed") return;

      if (event.type === "payment.succeeded") {
        await settleDodoPayment(client, event, env.productId);
      } else if (event.type === "refund.succeeded") {
        await reverseDodoPayment(client, event, "refund");
      } else if (event.type === "dispute.opened") {
        await reverseDodoPayment(client, event, "dispute");
      } else {
        await markPaymentEvent(client, "dodo", event.id, "ignored");
      }
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    const incident = webhookIncidentId(event.id);
    try {
      await query(
        `INSERT INTO payment_events
           (provider, event_id, event_type, object_id, processing_state, incident_id)
         VALUES ('dodo', $1, $2, $3, 'failed', $4)
         ON CONFLICT (provider, event_id) DO UPDATE SET
           event_type = EXCLUDED.event_type,
           object_id = EXCLUDED.object_id,
           processing_state = 'failed',
           attempt_count = payment_events.attempt_count + 1,
           incident_id = EXCLUDED.incident_id,
           processed_at = NULL`,
        [event.id, event.type, objectId, incident],
      );
    } catch (recordError) {
      console.error("Bidstage could not persist the failed Dodo event", {
        incident,
        eventId: event.id,
        recordError,
      });
    }
    console.error("Bidstage Dodo event processing failed", {
      incident,
      eventId: event.id,
      eventType: event.type,
      error,
    });
    return NextResponse.json({ error: "event_processing_failed", incident }, { status: 500 });
  }
}
