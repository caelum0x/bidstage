import { query, transaction } from "./db";
import { inspectDestinationResolution, type DestinationResolutionOutcome } from "./destination-safety";

// Twenty projects use at most 40 external DNS requests per invocation. This
// preserves headroom below the Workers Free limit of 50 external subrequests.
const MAX_RECHECKS_PER_RUN = 20;
const DESTINATION_RECHECK_CONCURRENCY = 2;
const SYSTEM_OPERATOR_ID = "system:scheduled-maintenance";

type RecheckCandidate = {
  id: string;
  slug: string;
  destination: string;
};

export type DestinationRecheckCounts = {
  checked: number;
  passed: number;
  rejected: number;
  failed: number;
  suspended: number;
};

const emptyCounts = (): DestinationRecheckCounts => ({
  checked: 0,
  passed: 0,
  rejected: 0,
  failed: 0,
  suspended: 0,
});

async function recordOutcome(
  candidate: RecheckCandidate,
  checkedAt: Date,
  outcome: DestinationResolutionOutcome,
): Promise<{ recorded: boolean; suspended: boolean }> {
  return transaction(async (client) => {
    const currentRows = await client.query<{ status: string; destination: string }>(
      "SELECT status, destination FROM listings WHERE id = $1 FOR UPDATE",
      [candidate.id],
    );
    const current = currentRows.rows[0];
    if (!current || current.status !== "active" || current.destination !== candidate.destination) {
      return { recorded: false, suspended: false };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO listing_destination_rechecks
         (listing_id, checked_at, state, address_count, address_fingerprint, error_code)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (listing_id, checked_at) DO NOTHING
       RETURNING id`,
      [
        candidate.id,
        checkedAt,
        outcome.state,
        outcome.addressCount,
        outcome.addressFingerprint,
        outcome.errorCode,
      ],
    );
    if (!inserted.rows[0]) return { recorded: false, suspended: false };
    if (outcome.state !== "rejected") return { recorded: true, suspended: false };

    await client.query(
      "UPDATE listings SET status = 'review', updated_at = now() WHERE id = $1",
      [candidate.id],
    );
    const moderation = await client.query<{ id: string }>(
      `INSERT INTO listing_moderation
         (listing_id, previous_status, next_status, action, reason_code, public_note, operator_id)
       VALUES ($1, 'active', 'review', 'suspend', 'destination_dns_unsafe',
               'Bidstage paused this placement after its destination stopped resolving only to public network addresses.',
               $2)
       RETURNING id`,
      [candidate.id, SYSTEM_OPERATOR_ID],
    );
    await client.query(
      `INSERT INTO operator_audit_events
         (operator_id, action, target_type, target_id, details)
       VALUES ($1, 'destination.recheck_rejected', 'listing', $2, $3::jsonb)`,
      [SYSTEM_OPERATOR_ID, candidate.id, JSON.stringify({
        slug: candidate.slug,
        checkedAt: checkedAt.toISOString(),
        errorCode: outcome.errorCode,
        moderationId: moderation.rows[0]!.id,
      })],
    );
    return { recorded: true, suspended: true };
  });
}

export async function runDestinationRechecks(checkedAt: Date): Promise<DestinationRecheckCounts> {
  const candidates = await query<RecheckCandidate>(
    `SELECT listing.id, listing.slug, listing.destination
     FROM listings AS listing
     WHERE listing.status = 'active'
       AND listing.product_kind = 'open_source'
       AND NOT EXISTS (
         SELECT 1
         FROM listing_destination_rechecks AS recheck
         WHERE recheck.listing_id = listing.id
           AND recheck.checked_at > $1::timestamptz - interval '24 hours'
       )
     ORDER BY (
       SELECT max(recheck.checked_at)
       FROM listing_destination_rechecks AS recheck
       WHERE recheck.listing_id = listing.id
     ) ASC NULLS FIRST, listing.created_at ASC, listing.id ASC
     LIMIT $2`,
    [checkedAt, MAX_RECHECKS_PER_RUN],
  );
  if (candidates.length === 0) return emptyCounts();

  const inspections: Array<{ candidate: RecheckCandidate; outcome: DestinationResolutionOutcome }> = [];
  for (let index = 0; index < candidates.length; index += DESTINATION_RECHECK_CONCURRENCY) {
    inspections.push(...await Promise.all(
      candidates.slice(index, index + DESTINATION_RECHECK_CONCURRENCY).map(async (candidate) => ({
        candidate,
        outcome: await inspectDestinationResolution(candidate.destination),
      })),
    ));
  }
  const counts = emptyCounts();
  for (const inspection of inspections) {
    const result = await recordOutcome(inspection.candidate, checkedAt, inspection.outcome);
    if (!result.recorded) continue;
    counts.checked += 1;
    counts[inspection.outcome.state] += 1;
    if (result.suspended) counts.suspended += 1;
  }
  return counts;
}
