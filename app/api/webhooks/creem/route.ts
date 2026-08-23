import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { query, transaction, type DatabaseClient } from "@/lib/db";
import { creemEnv } from "@/lib/env";
import { markPaymentEvent, reversePlacement, settlePlacement } from "@/lib/payment-settlement";
import { webhookIncidentId } from "@/lib/webhook-incidents";

export const runtime = "nodejs";

type JsonObject = Record<string, unknown>;
type CreemEvent = { id: string; eventType: string; object: JsonObject & { id: string } };

function verifiedSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

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

function reference(value: unknown, label: string): string {
  if (typeof value === "string") return text(value, label);
  return text(object(value, label).id, `${label}.id`);
}

function parseEvent(value: unknown): CreemEvent {
  const envelope = object(value, "Creem event");
  const payload = object(envelope.object, "Creem event object");
  return {
    id: text(envelope.id, "Creem event id"),
    eventType: text(envelope.eventType, "Creem event type"),
    object: { ...payload, id: text(payload.id, "Creem object id") },
  };
}

function validMode(mode: unknown, testMode: boolean): boolean {
  if (typeof mode !== "string") return false;
  return testMode ? ["test", "sandbox", "local"].includes(mode) : mode === "prod";
}

async function settleCheckout(
  client: DatabaseClient,
  event: CreemEvent,
  expectedProductId: string,
  testMode: boolean,
) {
  const payload = event.object;
  const order = object(payload.order, "Creem order");
  const customer = payload.customer ? object(payload.customer, "Creem customer") : null;
  if (
    payload.status !== "completed"
    || order.status !== "paid"
    || order.product !== expectedProductId
    || !validMode(payload.mode, testMode)
  ) {
    throw new Error("Creem settlement is not a completed payment for the configured product");
  }
  await settlePlacement(client, {
    provider: "creem",
    eventId: event.id,
    checkoutId: text(payload.request_id, "Creem request id"),
    providerCheckoutId: payload.id as string,
    providerOrderId: text(order.id, "Creem order id"),
    providerTransactionId: typeof order.transaction === "string"
      ? order.transaction
      : payload.transaction ? reference(payload.transaction, "Creem transaction") : null,
    amountCents: cents(order.amount, "Creem order amount"),
    currency: text(order.currency, "Creem order currency"),
    payerEmail: typeof customer?.email === "string" ? customer.email : null,
  });
}

async function reverseCreemContribution(
  client: DatabaseClient,
  event: CreemEvent,
  kind: "refund" | "dispute",
  testMode: boolean,
) {
  const payload = event.object;
  const providerTransaction = object(payload.transaction, "Creem transaction");
  const transactionId = text(providerTransaction.id, "Creem transaction id");
  const transactionAmount = cents(providerTransaction.amount, "Creem transaction amount");
  if (!validMode(payload.mode ?? providerTransaction.mode, testMode)) {
    throw new Error("Creem adjustment mode does not match the configured environment");
  }
  if (kind === "refund" && payload.status !== "succeeded") {
    throw new Error("Creem refund has not succeeded");
  }
  if (kind === "dispute" && providerTransaction.status !== "chargeback") {
    throw new Error("Creem dispute is not a chargeback");
  }

  let cumulativeReversedCents: number | undefined;
  if (kind === "refund") {
    const amountPaid = cents(providerTransaction.amount_paid, "Creem paid amount");
    const cumulativePaidRefund = cents(
      providerTransaction.refunded_amount,
      "Creem cumulative refunded amount",
    );
    cumulativeReversedCents = Math.min(
      transactionAmount,
      Math.round((transactionAmount * cumulativePaidRefund) / amountPaid),
    );
  }
  await reversePlacement(client, {
    provider: "creem",
    eventId: event.id,
    providerAdjustmentId: payload.id as string,
    providerOrderId: reference(providerTransaction.order, "Creem transaction order"),
    providerTransactionId: transactionId,
    kind,
    currency: text(providerTransaction.currency, "Creem transaction currency"),
    originalAmountCents: transactionAmount,
    cumulativeReversedCents,
  });
}

export async function POST(request: Request) {
  const signature = request.headers.get("creem-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  const rawBody = await request.text();
  const env = creemEnv();
  if (!verifiedSignature(rawBody, signature, env.webhookSecret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: CreemEvent;
  try {
    event = parseEvent(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  try {
    await transaction(async (client) => {
      const eventClaim = await client.query<{ processing_state: string }>(
        `INSERT INTO payment_events
           (provider, event_id, event_type, object_id, processing_state)
         VALUES ('creem', $1, $2, $3, 'received')
         ON CONFLICT (provider, event_id) DO UPDATE SET
           attempt_count = payment_events.attempt_count + 1
         RETURNING processing_state`,
        [event.id, event.eventType, event.object.id],
      );
      if (eventClaim.rows[0]?.processing_state === "processed") return;

      if (event.eventType === "checkout.completed") {
        await settleCheckout(client, event, env.productId, env.testMode);
      } else if (event.eventType === "refund.created") {
        await reverseCreemContribution(client, event, "refund", env.testMode);
      } else if (event.eventType === "dispute.created") {
        await reverseCreemContribution(client, event, "dispute", env.testMode);
      } else {
        await markPaymentEvent(client, "creem", event.id, "ignored");
      }
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    const incident = webhookIncidentId(event.id);
    try {
      await query(
        `INSERT INTO payment_events
           (provider, event_id, event_type, object_id, processing_state, incident_id)
         VALUES ('creem', $1, $2, $3, 'failed', $4)
         ON CONFLICT (provider, event_id) DO UPDATE SET
           event_type = EXCLUDED.event_type,
           object_id = EXCLUDED.object_id,
           processing_state = 'failed',
           attempt_count = payment_events.attempt_count + 1,
           incident_id = EXCLUDED.incident_id,
           processed_at = NULL`,
        [event.id, event.eventType, event.object.id, incident],
      );
    } catch (recordError) {
      console.error("Bidstage could not persist the failed Creem event", {
        incident,
        eventId: event.id,
        recordError,
      });
    }
    console.error("Bidstage Creem event processing failed", {
      incident,
      eventId: event.id,
      eventType: event.eventType,
      error,
    });
    return NextResponse.json({ error: "event_processing_failed", incident }, { status: 500 });
  }
}
