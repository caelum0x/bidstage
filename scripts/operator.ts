import { createHash } from "node:crypto";
import { database } from "../lib/db";
import { retrieveCreemCheckout } from "../lib/creem";
import { retrieveDodoCheckout } from "../lib/dodo";
import { creemEnv, dodoEnv } from "../lib/env";
import { reviewDestinationResolution } from "../lib/destination-safety";
import {
  destinationFingerprint,
  retrieveDestinationScan,
  submitDestinationScan,
} from "../lib/cloudflare-url-scanner";

type Action = "approve" | "suspend" | "remove" | "restore";

const operatorId = process.env.OPERATOR_ID?.trim();
if (!operatorId || operatorId.length < 3 || operatorId.length > 120) {
  throw new Error("OPERATOR_ID is required and must identify the person running the command");
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function cleanReason(value: string | undefined): string {
  const reason = value?.toLowerCase().replace(/[^a-z0-9_]/g, "_") ?? "";
  if (!/^[a-z0-9_]{3,48}$/.test(reason)) {
    throw new Error("--reason must be 3–48 lowercase letters, numbers, or underscores");
  }
  return reason;
}

function cleanNote(value: string | undefined): string {
  const note = value?.trim().replace(/\s+/g, " ") ?? "";
  if (note.length < 3 || note.length > 240) {
    throw new Error("--note must be 3–240 characters and suitable for a public audit record");
  }
  return note;
}

function cleanResponse(value: string | undefined): string {
  const note = value?.trim().replace(/\s+/g, " ") ?? "";
  if (note.length < 3 || note.length > 1200) {
    throw new Error("--note must be 3–1200 characters");
  }
  return note;
}

function nextStatus(action: Action): "active" | "review" | "removed" {
  if (action === "approve" || action === "restore") return "active";
  if (action === "suspend") return "review";
  return "removed";
}

async function queue() {
  const rows = await database().query<{
    slug: string;
    title: string;
    destination: string;
    category: string;
    total: string;
    age: string;
    ownership: string;
    destination_review: string;
    submitted: Date;
  }>(
    `SELECT slug, title, destination, category,
            ('$' || to_char(total_cents / 100.0, 'FM999999990.00')) AS total,
            age(now(), listings.created_at)::text AS age,
            coalesce(verification.state, 'not_started') AS ownership,
            coalesce(scanner.state, 'not_started') AS destination_review,
            listings.updated_at AS submitted
     FROM listings
     LEFT JOIN destination_verifications AS verification
       ON verification.listing_id = listings.id
     LEFT JOIN LATERAL (
       SELECT review.state
       FROM destination_security_reviews AS review
       WHERE review.listing_id = listings.id
       ORDER BY review.submitted_at DESC
       LIMIT 1
     ) AS scanner ON true
     WHERE listings.status = 'review'
     ORDER BY listings.updated_at ASC
     LIMIT 100`,
  );
  if (rows.rows.length === 0) {
    console.log("Review queue is empty.");
    return;
  }
  console.table(rows.rows);
}

async function inspect(slug: string) {
  const listing = await database().query(
    `SELECT slug, title, destination, category, status, total_cents,
            bid_count, outbound_clicks, created_at, updated_at
     FROM listings WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  if (!listing.rows[0]) throw new Error(`Listing not found: ${slug}`);
  const history = await database().query(
    `SELECT moderation.action, moderation.previous_status, moderation.next_status,
            moderation.reason_code, moderation.public_note,
            moderation.operator_id, moderation.created_at
     FROM listing_moderation AS moderation
     JOIN listings ON listings.id = moderation.listing_id
     WHERE listings.slug = $1
     ORDER BY moderation.created_at DESC
     LIMIT 25`,
    [slug],
  );
  const versions = await database().query(
    `SELECT versions.version_number, versions.title, versions.destination,
            versions.category, versions.actor_type, versions.reason,
            versions.created_at
     FROM listing_versions AS versions
     JOIN listings ON listings.id = versions.listing_id
     WHERE listings.slug = $1
     ORDER BY versions.version_number DESC
     LIMIT 25`,
    [slug],
  );
  const verification = await database().query(
    `SELECT verification.method, verification.hostname, verification.record_name,
            verification.state, verification.attempt_count, verification.last_error,
            verification.created_at, verification.expires_at, verification.verified_at
     FROM destination_verifications AS verification
     JOIN listings ON listings.id = verification.listing_id
     WHERE listings.slug = $1
     LIMIT 1`,
    [slug],
  );
  const securityReviews = await database().query(
    `SELECT review.provider_scan_id, review.state, review.visibility,
            review.report_url, review.final_origin, review.redirect_count,
            review.has_verdicts, review.malicious, review.verdict_categories,
            review.verdict_tags, review.error_code, review.submitted_at,
            review.completed_at, review.expires_at
     FROM destination_security_reviews AS review
     JOIN listings ON listings.id = review.listing_id
     WHERE listings.slug = $1
     ORDER BY review.submitted_at DESC
     LIMIT 10`,
    [slug],
  );
  const destinationRechecks = await database().query(
    `SELECT recheck.checked_at, recheck.state, recheck.address_count,
            recheck.address_fingerprint, recheck.error_code
     FROM listing_destination_rechecks AS recheck
     JOIN listings ON listings.id = recheck.listing_id
     WHERE listings.slug = $1
     ORDER BY recheck.checked_at DESC
     LIMIT 25`,
    [slug],
  );
  console.table(listing.rows);
  console.table(versions.rows);
  console.table(verification.rows);
  console.table(securityReviews.rows);
  console.table(destinationRechecks.rows);
  console.table(history.rows);
}

type DestinationReviewRow = {
  id: string;
  provider_scan_id: string;
  state: "pending" | "passed" | "rejected" | "failed";
  report_url: string;
  final_origin: string | null;
  redirect_count: number | null;
  has_verdicts: boolean | null;
  malicious: boolean | null;
  error_code: string | null;
  submitted_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
};

async function destinationScan(slug: string) {
  const listingResult = await database().query<{ id: string; destination: string }>(
    "SELECT id, destination FROM listings WHERE slug = $1 LIMIT 1",
    [slug],
  );
  const listing = listingResult.rows[0];
  if (!listing) throw new Error(`Listing not found: ${slug}`);
  const fingerprint = destinationFingerprint(listing.destination);
  const reviews = await database().query<DestinationReviewRow>(
    `SELECT id, provider_scan_id::text, state, report_url, final_origin,
            redirect_count, has_verdicts, malicious, error_code,
            submitted_at, completed_at, expires_at
     FROM destination_security_reviews
     WHERE listing_id = $1 AND destination_fingerprint = $2
     ORDER BY submitted_at DESC
     LIMIT 1`,
    [listing.id, fingerprint],
  );
  const latest = reviews.rows[0];

  if (latest?.state === "passed" && latest.expires_at && latest.expires_at > new Date() && !process.argv.includes("--force")) {
    console.table([latest]);
    console.log("A fresh destination scan already passes. Use --force to submit a new public scan.");
    return;
  }

  if (latest?.state === "pending") {
    const remote = await retrieveDestinationScan(latest.provider_scan_id, listing.destination);
    if (remote.state === "pending") {
      console.table([{ slug, scanId: latest.provider_scan_id, state: "pending", report: latest.report_url }]);
      console.log("Cloudflare is still scanning. Re-run this command after 10–30 seconds.");
      return;
    }
    const finding = remote.finding;
    const client = await database().connect();
    let completed: DestinationReviewRow;
    try {
      await client.query("BEGIN");
      const updated = await client.query<DestinationReviewRow>(
        `UPDATE destination_security_reviews
         SET state = $2, final_origin = $3, redirect_count = $4,
             redirect_chain_fingerprint = $5, has_verdicts = $6,
             malicious = $7, verdict_categories = $8, verdict_tags = $9,
             error_code = $10, completed_at = now(),
             expires_at = CASE WHEN $2 = 'passed' THEN now() + interval '7 days' ELSE NULL END
         WHERE id = $1 AND state = 'pending'
         RETURNING id, provider_scan_id::text, state, report_url, final_origin,
                   redirect_count, has_verdicts, malicious, error_code,
                   submitted_at, completed_at, expires_at`,
        [
          latest.id,
          finding.state,
          finding.finalOrigin,
          finding.redirectCount,
          finding.redirectChainFingerprint,
          finding.hasVerdicts,
          finding.malicious,
          finding.categories,
          finding.tags,
          finding.errorCode,
        ],
      );
      if (!updated.rows[0]) throw new Error("Destination scan was already completed by another operator");
      completed = updated.rows[0];
      await client.query(
        `INSERT INTO operator_audit_events
           (operator_id, action, target_type, target_id, details)
         VALUES ($1, 'destination.scan_completed', 'listing', $2, $3::jsonb)`,
        [operatorId, listing.id, JSON.stringify({
          slug,
          scanId: finding.scanId,
          state: finding.state,
          destinationFingerprint: finding.destinationFingerprint,
          finalOrigin: finding.finalOrigin,
          redirectCount: finding.redirectCount,
          redirectChainFingerprint: finding.redirectChainFingerprint,
          hasVerdicts: finding.hasVerdicts,
          malicious: finding.malicious,
          categories: finding.categories,
          tags: finding.tags,
          errorCode: finding.errorCode,
        })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.table([completed]);
    if (finding.state !== "passed") {
      throw new Error(`Destination scan did not pass (${finding.errorCode ?? finding.state})`);
    }
    console.log("Destination scan passed and remains valid for activation for seven days.");
    return;
  }

  const submission = await submitDestinationScan(listing.destination);
  if (destinationFingerprint(submission.canonicalUrl) !== fingerprint) {
    throw new Error("Cloudflare canonicalized the submitted destination unexpectedly");
  }
  const client = await database().connect();
  let review: DestinationReviewRow | undefined;
  try {
    await client.query("BEGIN");
    const inserted = await client.query<DestinationReviewRow>(
      `INSERT INTO destination_security_reviews
         (listing_id, provider_scan_id, destination_fingerprint, visibility, report_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (listing_id, destination_fingerprint) WHERE state = 'pending'
       DO NOTHING
       RETURNING id, provider_scan_id::text, state, report_url, final_origin,
                 redirect_count, has_verdicts, malicious, error_code,
                 submitted_at, completed_at, expires_at`,
      [listing.id, submission.scanId, fingerprint, submission.visibility, submission.reportUrl],
    );
    review = inserted.rows[0];
    if (review) {
      await client.query(
        `INSERT INTO operator_audit_events
           (operator_id, action, target_type, target_id, details)
         VALUES ($1, 'destination.scan_submitted', 'listing', $2, $3::jsonb)`,
        [operatorId, listing.id, JSON.stringify({
          slug,
          scanId: submission.scanId,
          visibility: submission.visibility,
          destinationFingerprint: fingerprint,
          reportUrl: submission.reportUrl,
        })],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!review) {
    console.log("Another operator already submitted a scan for this destination. Re-run to check it.");
    return;
  }
  console.table([review]);
  console.log("Public URL scan submitted. Re-run this command after 10–30 seconds to store the verdict.");
}

async function moderate(slug: string, action: Action) {
  const reasonCode = cleanReason(option("reason"));
  const publicNote = cleanNote(option("note"));
  let destinationReview: {
    addressCount: number;
    checkedAt: string;
    destination: string;
    fingerprint: string;
  } | undefined;
  if (action === "approve" || action === "restore") {
    const destinationRows = await database().query<{ destination: string }>(
      "SELECT destination FROM listings WHERE slug = $1 LIMIT 1",
      [slug],
    );
    if (!destinationRows.rows[0]) throw new Error(`Listing not found: ${slug}`);
    const destination = destinationRows.rows[0].destination;
    const resolution = await reviewDestinationResolution(destination);
    destinationReview = {
      addressCount: resolution.addresses.length,
      checkedAt: new Date().toISOString(),
      destination,
      fingerprint: createHash("sha256").update(resolution.addresses.join("\0")).digest("hex"),
    };
  }
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      destination: string;
      id: string;
      status: "active" | "review" | "removed";
    }>(
      "SELECT id, status, destination FROM listings WHERE slug = $1 FOR UPDATE",
      [slug],
    );
    const listing = result.rows[0];
    if (!listing) throw new Error(`Listing not found: ${slug}`);
    if (destinationReview && destinationReview.destination !== listing.destination) {
      throw new Error("Listing destination changed during DNS review; retry the moderation command");
    }
    const targetStatus = nextStatus(action);
    if (listing.status === targetStatus) {
      throw new Error(`Listing is already ${targetStatus}; no audit event was created`);
    }
    if (action === "approve" && listing.status !== "review") {
      throw new Error("Only a listing under review can be approved");
    }
    if (action === "suspend" && listing.status !== "active") {
      throw new Error("Only an active listing can be suspended");
    }
    if (action === "restore" && listing.status !== "removed") {
      throw new Error("Only a removed listing can be restored");
    }

    let ownershipEvidence: { method: string; verified_at: Date } | undefined;
    let securityEvidence: {
      provider_scan_id: string;
      report_url: string;
      final_origin: string;
      redirect_count: number;
      redirect_chain_fingerprint: string;
      completed_at: Date;
      expires_at: Date;
    } | undefined;
    if (destinationReview) {
      const hostname = new URL(listing.destination).hostname.toLowerCase();
      const ownership = await client.query<{ method: string; verified_at: Date }>(
        `SELECT method, verified_at
         FROM destination_verifications
         WHERE listing_id = $1
           AND state = 'verified'
           AND verified_at IS NOT NULL
           AND hostname = $2
         LIMIT 1`,
        [listing.id, hostname],
      );
      ownershipEvidence = ownership.rows[0];
      if (!ownershipEvidence) {
        throw new Error("Verified DNS ownership proof is required before activation");
      }
      const security = await client.query<{
        provider_scan_id: string;
        report_url: string;
        final_origin: string;
        redirect_count: number;
        redirect_chain_fingerprint: string;
        completed_at: Date;
        expires_at: Date;
      }>(
        `SELECT provider_scan_id::text, report_url, final_origin,
                redirect_count, redirect_chain_fingerprint,
                completed_at, expires_at
         FROM destination_security_reviews
         WHERE listing_id = $1
           AND destination_fingerprint = $2
           AND state = 'passed'
           AND has_verdicts = true
           AND malicious = false
           AND expires_at > now()
         ORDER BY completed_at DESC
         LIMIT 1`,
        [listing.id, destinationFingerprint(listing.destination)],
      );
      securityEvidence = security.rows[0];
      if (!securityEvidence) {
        throw new Error("A fresh passing destination scan is required; run operator scan for this listing");
      }
    }

    await client.query(
      "UPDATE listings SET status = $2, updated_at = now() WHERE id = $1",
      [listing.id, targetStatus],
    );
    const moderation = await client.query<{ id: string }>(
      `INSERT INTO listing_moderation
         (listing_id, previous_status, next_status, action, reason_code, public_note, operator_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [listing.id, listing.status, targetStatus, action, reasonCode, publicNote, operatorId],
    );
    await client.query(
      `INSERT INTO operator_audit_events
         (operator_id, action, target_type, target_id, details)
       VALUES ($1, $2, 'listing', $3, $4::jsonb)`,
      [
        operatorId,
        `listing.${action}`,
        listing.id,
        JSON.stringify({
          slug,
          previousStatus: listing.status,
          nextStatus: targetStatus,
          reasonCode,
          publicNote,
          moderationId: moderation.rows[0]!.id,
          destinationDnsReview: destinationReview
            ? {
                checkedAt: destinationReview.checkedAt,
                addressCount: destinationReview.addressCount,
                fingerprint: destinationReview.fingerprint,
              }
            : undefined,
          destinationOwnershipReview: ownershipEvidence
            ? { method: ownershipEvidence.method, verifiedAt: ownershipEvidence.verified_at.toISOString() }
            : undefined,
          destinationSecurityReview: securityEvidence
            ? {
                provider: "cloudflare_url_scanner",
                scanId: securityEvidence.provider_scan_id,
                reportUrl: securityEvidence.report_url,
                finalOrigin: securityEvidence.final_origin,
                redirectCount: securityEvidence.redirect_count,
                redirectChainFingerprint: securityEvidence.redirect_chain_fingerprint,
                completedAt: securityEvidence.completed_at.toISOString(),
                expiresAt: securityEvidence.expires_at.toISOString(),
              }
            : undefined,
        }),
      ],
    );
    await client.query("COMMIT");
    console.log(`${slug}: ${listing.status} -> ${targetStatus} (${action})`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function supportQueue() {
  const cases = await database().query(
    `SELECT support.public_reference, support.category, support.state,
            checkout.public_reference AS receipt, support.created_at,
            left(support.message, 100) AS message
     FROM support_cases AS support
     JOIN payment_checkouts AS checkout ON checkout.id = support.checkout_id
     WHERE support.state IN ('open', 'needs_customer')
     ORDER BY support.created_at ASC
     LIMIT 100`,
  );
  if (cases.rows.length === 0) console.log("Support queue is empty.");
  else console.table(cases.rows);
}

async function inspectCase(reference: string) {
  const result = await database().query(
    `SELECT support.public_reference, support.category, support.state, support.message,
            support.operator_response, support.assigned_operator_id,
            checkout.public_reference AS receipt, checkout.title, checkout.destination,
            support.created_at, support.updated_at
     FROM support_cases AS support
     JOIN payment_checkouts AS checkout ON checkout.id = support.checkout_id
     WHERE support.public_reference = $1
     LIMIT 1`,
    [reference],
  );
  if (!result.rows[0]) throw new Error(`Support case not found: ${reference}`);
  const messages = await database().query(
    `SELECT messages.author_type, messages.body, messages.operator_id,
            messages.created_at
     FROM support_case_messages AS messages
     JOIN support_cases AS support ON support.id = messages.support_case_id
     WHERE support.public_reference = $1
     ORDER BY messages.created_at ASC, messages.id ASC`,
    [reference],
  );
  console.table(result.rows);
  console.table(messages.rows);
}

async function replyCase(reference: string) {
  const state = option("status");
  if (!state || !["open", "needs_customer", "resolved", "closed"].includes(state)) {
    throw new Error("--status must be open, needs_customer, resolved, or closed");
  }
  const note = cleanResponse(option("note"));
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; state: string }>(
      "SELECT id, state FROM support_cases WHERE public_reference = $1 FOR UPDATE",
      [reference],
    );
    const supportCase = result.rows[0];
    if (!supportCase) throw new Error(`Support case not found: ${reference}`);
    await client.query(
      `UPDATE support_cases
       SET state = $2, operator_response = $3, assigned_operator_id = $4,
           updated_at = now(),
           resolved_at = CASE WHEN $2 IN ('resolved', 'closed') THEN now() ELSE NULL END
       WHERE id = $1`,
      [supportCase.id, state, note, operatorId],
    );
    await client.query(
      `INSERT INTO support_case_messages
         (support_case_id, author_type, body, operator_id)
       VALUES ($1, 'operator', $2, $3)`,
      [supportCase.id, note, operatorId],
    );
    await client.query(
      `INSERT INTO operator_audit_events
         (operator_id, action, target_type, target_id, details)
       VALUES ($1, 'support.reply', 'support_case', $2, $3::jsonb)`,
      [operatorId, supportCase.id, JSON.stringify({ reference, previousState: supportCase.state, nextState: state })],
    );
    await client.query("COMMIT");
    console.log(`${reference}: ${supportCase.state} -> ${state}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function reconcile(receiptReference: string) {
  const result = await database().query<{
    id: string;
    provider: "creem" | "dodo";
    state: string;
    provider_checkout_id: string | null;
    provider_order_id: string | null;
    provider_transaction_id: string | null;
    contribution_cents: number;
    currency: string;
  }>(
    `SELECT id, provider, state, provider_checkout_id, provider_order_id,
            provider_transaction_id, contribution_cents, currency
     FROM payment_checkouts
     WHERE public_reference = $1 AND provider IN ('creem', 'dodo')
     LIMIT 1`,
    [receiptReference],
  );
  const local = result.rows[0];
  if (!local?.provider_checkout_id) throw new Error("Receipt has no provider checkout ID to reconcile");
  if (local.provider === "dodo") {
    const remote = await retrieveDodoCheckout(local.provider_checkout_id);
    const env = dodoEnv();
    const checks = {
      checkoutId: remote.id === local.provider_checkout_id,
      paymentId: !local.provider_order_id || remote.paymentId === local.provider_order_id,
      paymentCheckoutId: !remote.payment || remote.payment.checkoutId === local.provider_checkout_id,
      requestId: !remote.payment || remote.payment.checkoutMetadataId === local.id,
      productId: !remote.payment || remote.payment.productId === env.productId,
      quantity: !remote.payment || remote.payment.quantity === 1,
      businessId: !remote.payment || remote.payment.businessId === env.businessId,
      processor: !remote.payment || remote.payment.paymentProvider === "dodo",
      oneTime: !remote.payment || remote.payment.subscriptionId === null,
      amount: !remote.payment || remote.payment.amountCents === local.contribution_cents,
      currency: !remote.payment || remote.payment.currency === local.currency,
    };
    const mismatches = Object.entries(checks).filter(([, valid]) => !valid).map(([name]) => name);
    console.table([{ receiptReference, localState: local.state, remoteStatus: remote.paymentStatus ?? "none", mismatches: mismatches.join(", ") || "none" }]);
    await database().query(
      `INSERT INTO operator_audit_events
         (operator_id, action, target_type, target_id, details)
       VALUES ($1, 'payment.reconcile', 'payment_checkout', $2, $3::jsonb)`,
      [operatorId, local.id, JSON.stringify({ receiptReference, provider: "dodo", localState: local.state, remote, checks })],
    );
    if (mismatches.length) throw new Error(`Reconciliation mismatch: ${mismatches.join(", ")}`);
    if (remote.paymentStatus === "succeeded" && local.state === "pending") {
      console.log("Dodo reports succeeded while Bidstage is pending. Resend the signed payment.succeeded webhook; do not settle from this read-only command.");
    }
    return;
  }
  const remote = await retrieveCreemCheckout(local.provider_checkout_id);
  const env = creemEnv();
  const checks = {
    checkoutId: remote.id === local.provider_checkout_id,
    requestId: remote.requestId === local.id,
    productId: remote.productId === env.productId,
    mode: env.testMode ? ["test", "sandbox"].includes(remote.mode) : remote.mode === "prod",
    amount: remote.order?.amountCents === local.contribution_cents,
    currency: remote.order?.currency === local.currency,
    orderId: !local.provider_order_id || remote.order?.id === local.provider_order_id,
    transactionId: !local.provider_transaction_id || remote.order?.transactionId === local.provider_transaction_id,
  };
  const mismatches = Object.entries(checks).filter(([, valid]) => !valid).map(([name]) => name);
  console.table([{ receiptReference, localState: local.state, remoteStatus: remote.status, orderStatus: remote.order?.status ?? "none", mismatches: mismatches.join(", ") || "none" }]);
  await database().query(
    `INSERT INTO operator_audit_events
       (operator_id, action, target_type, target_id, details)
     VALUES ($1, 'payment.reconcile', 'payment_checkout', $2, $3::jsonb)`,
    [operatorId, local.id, JSON.stringify({ receiptReference, localState: local.state, remote, checks })],
  );
  if (mismatches.length) throw new Error(`Reconciliation mismatch: ${mismatches.join(", ")}`);
  if (remote.status === "completed" && local.state === "pending") {
    console.log("Creem reports completed while Bidstage is pending. Resend the signed checkout.completed webhook; do not settle from this read-only command.");
  }
}

async function webhookQueue() {
  const events = await database().query(
    `SELECT event_id, event_type, object_id, processing_state,
            attempt_count, incident_id, received_at, processed_at
     FROM payment_events
     WHERE processing_state IN ('received', 'failed')
     ORDER BY received_at ASC
     LIMIT 100`,
  );
  if (events.rows.length === 0) {
    console.log("Webhook dead-letter queue is empty.");
    return;
  }
  console.table(events.rows);
  console.log("Retry through Creem's signed webhook resend. Local replay cannot mint ranking value.");
}

async function inspectWebhook(identifier: string) {
  const result = await database().query(
    `SELECT event_id, event_type, object_id, processing_state,
            attempt_count, incident_id, received_at, processed_at
     FROM payment_events
     WHERE event_id = $1 OR incident_id = $1
     ORDER BY received_at DESC
     LIMIT 1`,
    [identifier],
  );
  if (!result.rows[0]) throw new Error(`Webhook event not found: ${identifier}`);
  console.table(result.rows);
  console.log("Use the provider dashboard to resend this event with a fresh valid signature.");
}

type RetentionCounts = {
  click_events: number;
  click_sessions: number;
  rate_limits: number;
  founder_sessions: number;
  destination_verifications_expired: number;
  destination_verifications_deleted: number;
  privacy_requests: number;
  maintenance_runs: number;
};

async function retention(apply: boolean) {
  if (!apply) {
    const preview = await database().query<RetentionCounts>(
      `SELECT
         (SELECT count(*)::int FROM click_events
          WHERE retention_expires_at <= now()) AS click_events,
         (SELECT count(*)::int FROM click_sessions
          WHERE expires_at <= now()) AS click_sessions,
         (SELECT count(*)::int FROM request_rate_limits
          WHERE window_started_at <= now() - interval '2 days') AS rate_limits,
         (SELECT count(*)::int FROM founder_sessions
          WHERE expires_at <= now()
             OR revoked_at <= now() - interval '30 days') AS founder_sessions,
         (SELECT count(*)::int FROM destination_verifications
          WHERE state = 'pending' AND expires_at <= now()) AS destination_verifications_expired,
         (SELECT count(*)::int FROM destination_verifications
          WHERE state = 'expired'
            AND verified_at IS NULL
            AND expires_at <= now() - interval '30 days') AS destination_verifications_deleted,
         (SELECT count(*)::int FROM privacy_requests
          WHERE state IN ('completed', 'declined', 'cancelled')
            AND completed_at <= now() - interval '3 years') AS privacy_requests,
         (SELECT count(*)::int FROM maintenance_runs
          WHERE state IN ('completed', 'attention', 'failed')
            AND completed_at <= now() - interval '400 days') AS maintenance_runs`,
    );
    console.table(preview.rows);
    console.log("Dry run only. Re-run with --apply to clean expired records.");
    return;
  }

  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const clickEvents = await client.query(
      "DELETE FROM click_events WHERE retention_expires_at <= now()",
    );
    const clickSessions = await client.query(
      "DELETE FROM click_sessions WHERE expires_at <= now()",
    );
    const rateLimits = await client.query(
      `DELETE FROM request_rate_limits
       WHERE window_started_at <= now() - interval '2 days'`,
    );
    const founderSessions = await client.query(
      `DELETE FROM founder_sessions
       WHERE expires_at <= now()
          OR revoked_at <= now() - interval '30 days'`,
    );
    const destinationVerifications = await client.query(
      `UPDATE destination_verifications
       SET state = 'expired'
       WHERE state = 'pending' AND expires_at <= now()`,
    );
    const deletedDestinationVerifications = await client.query(
      `DELETE FROM destination_verifications
       WHERE state = 'expired'
         AND verified_at IS NULL
         AND expires_at <= now() - interval '30 days'`,
    );
    const privacyRequests = await client.query(
      `DELETE FROM privacy_requests
       WHERE state IN ('completed', 'declined', 'cancelled')
         AND completed_at <= now() - interval '3 years'`,
    );
    const maintenanceRuns = await client.query(
      `DELETE FROM maintenance_runs
       WHERE state IN ('completed', 'attention', 'failed')
         AND completed_at <= now() - interval '400 days'`,
    );
    const counts: RetentionCounts = {
      click_events: clickEvents.rowCount ?? 0,
      click_sessions: clickSessions.rowCount ?? 0,
      rate_limits: rateLimits.rowCount ?? 0,
      founder_sessions: founderSessions.rowCount ?? 0,
      destination_verifications_expired: destinationVerifications.rowCount ?? 0,
      destination_verifications_deleted: deletedDestinationVerifications.rowCount ?? 0,
      privacy_requests: privacyRequests.rowCount ?? 0,
      maintenance_runs: maintenanceRuns.rowCount ?? 0,
    };
    await client.query(
      `INSERT INTO operator_audit_events
         (operator_id, action, target_type, target_id, details)
       VALUES ($1, 'operations.retention_cleanup', 'system', 'expired_records', $2::jsonb)`,
      [operatorId, JSON.stringify({
        counts,
        rateLimitRetentionDays: 2,
        revokedSessionRetentionDays: 30,
        expiredDnsChallengeRetentionDays: 30,
        closedPrivacyRequestRetentionYears: 3,
        maintenanceRunRetentionDays: 400,
      })],
    );
    await client.query("COMMIT");
    console.table([counts]);
    console.log("Expired records cleaned and the operation was added to the audit ledger.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function privacyQueue() {
  const rows = await database().query(
    `SELECT request.public_reference, request.request_type, request.state,
            founder.github_login, request.assigned_operator_id,
            age(now(), request.created_at)::text AS age,
            request.created_at
     FROM privacy_requests AS request
     JOIN founder_accounts AS founder ON founder.id = request.founder_id
     WHERE request.state IN ('open', 'in_progress')
     ORDER BY request.created_at ASC
     LIMIT 100`,
  );
  if (rows.rows.length === 0) console.log("Privacy request queue is empty.");
  else console.table(rows.rows);
}

async function inspectPrivacyRequest(reference: string) {
  if (!/^[a-f0-9]{16}$/.test(reference)) throw new Error("Invalid privacy request reference");
  const rows = await database().query(
    `SELECT request.public_reference, request.request_type, request.details,
            request.state, request.operator_response, request.assigned_operator_id,
            request.created_at, request.updated_at, request.completed_at,
            founder.github_user_id::text, founder.github_login, founder.display_name,
            founder.profile_url
     FROM privacy_requests AS request
     JOIN founder_accounts AS founder ON founder.id = request.founder_id
     WHERE request.public_reference = $1
     LIMIT 1`,
    [reference],
  );
  if (!rows.rows[0]) throw new Error(`Privacy request not found: ${reference}`);
  console.table(rows.rows);
}

async function claimPrivacyRequest(reference: string) {
  if (!/^[a-f0-9]{16}$/.test(reference)) throw new Error("Invalid privacy request reference");
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query<{ id: string; request_type: string }>(
      `UPDATE privacy_requests
       SET state = 'in_progress', assigned_operator_id = $2, updated_at = now()
       WHERE public_reference = $1 AND state = 'open'
       RETURNING id, request_type`,
      [reference, operatorId],
    );
    const request = rows.rows[0];
    if (!request) throw new Error("Privacy request is not open or was claimed by another operator");
    await client.query(
      `INSERT INTO operator_audit_events
         (operator_id, action, target_type, target_id, details)
       VALUES ($1, 'privacy.request_claimed', 'privacy_request', $2, $3::jsonb)`,
      [operatorId, request.id, JSON.stringify({ reference, requestType: request.request_type })],
    );
    await client.query("COMMIT");
    console.log(`${reference}: open -> in_progress (${operatorId})`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resolvePrivacyRequest(reference: string) {
  if (!/^[a-f0-9]{16}$/.test(reference)) throw new Error("Invalid privacy request reference");
  const status = option("status");
  if (status !== "completed" && status !== "declined") {
    throw new Error("--status must be completed or declined");
  }
  const response = cleanResponse(option("note"));
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query<{ id: string; request_type: string }>(
      `UPDATE privacy_requests
       SET state = $2, operator_response = $3, updated_at = now(), completed_at = now()
       WHERE public_reference = $1
         AND state = 'in_progress'
         AND assigned_operator_id = $4
         AND ($2 = 'declined' OR request_type <> 'deletion')
       RETURNING id, request_type`,
      [reference, status, response, operatorId],
    );
    const request = rows.rows[0];
    if (!request) {
      throw new Error("Claim this request with the same OPERATOR_ID; completed deletion requests must use privacy-minimize");
    }
    await client.query(
      `INSERT INTO operator_audit_events
         (operator_id, action, target_type, target_id, details)
       VALUES ($1, 'privacy.request_resolved', 'privacy_request', $2, $3::jsonb)`,
      [operatorId, request.id, JSON.stringify({
        reference,
        requestType: request.request_type,
        status,
        responseLength: response.length,
        responseFingerprint: createHash("sha256").update(response).digest("hex"),
      })],
    );
    await client.query("COMMIT");
    console.log(`${reference}: in_progress -> ${status}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function minimizePrivacyRequest(reference: string) {
  if (!/^[a-f0-9]{16}$/.test(reference)) throw new Error("Invalid privacy request reference");
  const extraNote = option("note") ? cleanResponse(option("note")) : undefined;
  const response = [
    "Eligible account data was minimized: the contributor profile and pending applications were deleted, the optional display name was cleared, and active sessions were revoked.",
    "Bidstage retained the GitHub account identifier, accepted contribution correspondence, project authorization, payment, public ledger, safety, and audit records under the published retention schedule.",
    extraNote,
  ].filter(Boolean).join(" ");
  if (response.length > 1200) throw new Error("The generated privacy response exceeds 1200 characters");

  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const requestRows = await client.query<{ id: string; founder_id: string }>(
      `SELECT id, founder_id
       FROM privacy_requests
       WHERE public_reference = $1
         AND request_type = 'deletion'
         AND state = 'in_progress'
         AND assigned_operator_id = $2
       FOR UPDATE`,
      [reference, operatorId],
    );
    const request = requestRows.rows[0];
    if (!request) throw new Error("Claim this open deletion request with the same OPERATOR_ID before minimizing data");

    const profile = await client.query(
      "DELETE FROM contributor_profiles WHERE founder_id = $1",
      [request.founder_id],
    );
    const applications = await client.query(
      `DELETE FROM contribution_applications
       WHERE contributor_id = $1 AND state = 'pending'`,
      [request.founder_id],
    );
    const sessions = await client.query(
      `UPDATE founder_sessions
       SET revoked_at = now()
       WHERE founder_id = $1 AND revoked_at IS NULL`,
      [request.founder_id],
    );
    await client.query(
      `UPDATE founder_accounts
       SET display_name = NULL, updated_at = now()
       WHERE id = $1`,
      [request.founder_id],
    );
    await client.query(
      `UPDATE privacy_requests
       SET state = 'completed', operator_response = $2,
           updated_at = now(), completed_at = now()
       WHERE id = $1`,
      [request.id, response],
    );
    const counts = {
      contributorProfilesDeleted: profile.rowCount ?? 0,
      pendingApplicationsDeleted: applications.rowCount ?? 0,
      sessionsRevoked: sessions.rowCount ?? 0,
      optionalDisplayNamesCleared: 1,
    };
    await client.query(
      `INSERT INTO operator_audit_events
         (operator_id, action, target_type, target_id, details)
       VALUES ($1, 'privacy.account_minimized', 'privacy_request', $2, $3::jsonb)`,
      [operatorId, request.id, JSON.stringify({
        reference,
        counts,
        responseLength: response.length,
        responseFingerprint: createHash("sha256").update(response).digest("hex"),
      })],
    );
    await client.query("COMMIT");
    console.table([counts]);
    console.log(`${reference}: eligible account data minimized; request completed`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "queue") return queue();
  if (command === "cases") return supportQueue();
  if (command === "webhooks") return webhookQueue();
  if (command === "retention") return retention(process.argv.includes("--apply"));
  if (command === "privacy") return privacyQueue();
  const reference = process.argv[3]?.trim();
  if (command === "privacy-case") {
    if (!reference) throw new Error("A privacy request reference is required");
    return inspectPrivacyRequest(reference);
  }
  if (command === "privacy-claim") {
    if (!reference) throw new Error("A privacy request reference is required");
    return claimPrivacyRequest(reference);
  }
  if (command === "privacy-resolve") {
    if (!reference) throw new Error("A privacy request reference is required");
    return resolvePrivacyRequest(reference);
  }
  if (command === "privacy-minimize") {
    if (!reference) throw new Error("A privacy request reference is required");
    return minimizePrivacyRequest(reference);
  }
  const slug = process.argv[3]?.trim();
  if (!slug) throw new Error("A listing slug is required");
  if (command === "inspect") return inspect(slug);
  if (command === "scan") return destinationScan(slug);
  if (command === "case") return inspectCase(slug);
  if (command === "reply") return replyCase(slug);
  if (command === "reconcile") return reconcile(slug);
  if (command === "webhook") return inspectWebhook(slug);
  if (command === "moderate") {
    const action = process.argv[4] as Action | undefined;
    if (!action || !["approve", "suspend", "remove", "restore"].includes(action)) {
      throw new Error("Action must be approve, suspend, remove, or restore");
    }
    return moderate(slug, action);
  }
  throw new Error(
    "Usage: operator queue | inspect <slug> | scan <slug> [--force] | moderate <slug> <action> | cases | case <reference> | reply <reference> | reconcile <receipt-reference> | webhooks | webhook <event-or-incident-id> | privacy | privacy-case <reference> | privacy-claim <reference> | privacy-resolve <reference> --status <completed|declined> --note <response> | privacy-minimize <reference> [--note <response>] | retention [--apply]",
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await database().end();
  });
