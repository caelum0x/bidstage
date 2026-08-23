import { query, transaction } from "./db";
import { runDestinationRechecks } from "./destination-rechecks";
import { MarketInputError } from "./market-error";

export const MAINTENANCE_CRON = "15 * * * *";
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export type MaintenanceInvocation = {
  scheduledAt: Date;
  cron: typeof MAINTENANCE_CRON;
};

export type CleanupCounts = {
  click_events: number;
  click_sessions: number;
  rate_limits: number;
  founder_sessions: number;
  destination_verifications_expired: number;
  destination_verifications_deleted: number;
  destination_rechecks: number;
  privacy_requests: number;
  maintenance_runs: number;
};

export type MaintenanceHealthCounts = {
  stuck_payment_events: number;
  stale_checkouts: number;
  stuck_destination_scans: number;
  destination_recheck_failures: number;
  overdue_privacy_requests: number;
};

export type MaintenanceActivityCounts = {
  rank_observations: number;
  destination_rechecks: number;
  destination_suspensions: number;
};

export type MaintenanceResult = {
  duplicate: boolean;
  scheduledAt: string;
  state: "running" | "completed" | "attention" | "failed";
  cleanupCounts: CleanupCounts;
  activityCounts: MaintenanceActivityCounts;
  healthCounts: MaintenanceHealthCounts;
};

type MaintenanceRunRow = {
  state: MaintenanceResult["state"];
  cleanup_counts: CleanupCounts;
  activity_counts: MaintenanceActivityCounts;
  health_counts: MaintenanceHealthCounts;
};

const emptyCleanupCounts = (): CleanupCounts => ({
  click_events: 0,
  click_sessions: 0,
  rate_limits: 0,
  founder_sessions: 0,
  destination_verifications_expired: 0,
  destination_verifications_deleted: 0,
  destination_rechecks: 0,
  privacy_requests: 0,
  maintenance_runs: 0,
});

const emptyHealthCounts = (): MaintenanceHealthCounts => ({
  stuck_payment_events: 0,
  stale_checkouts: 0,
  stuck_destination_scans: 0,
  destination_recheck_failures: 0,
  overdue_privacy_requests: 0,
});

const emptyActivityCounts = (): MaintenanceActivityCounts => ({
  rank_observations: 0,
  destination_rechecks: 0,
  destination_suspensions: 0,
});

export function maintenanceNeedsAttention(counts: MaintenanceHealthCounts): boolean {
  return counts.stuck_payment_events > 0
    || counts.stuck_destination_scans > 0
    || counts.destination_recheck_failures > 0
    || counts.overdue_privacy_requests > 0;
}

export function parseMaintenanceInvocation(
  value: unknown,
  now = Date.now(),
): MaintenanceInvocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketInputError("Invalid maintenance invocation");
  }
  const input = value as Record<string, unknown>;
  if (input.cron !== MAINTENANCE_CRON) {
    throw new MarketInputError("Invalid maintenance schedule");
  }
  if (!Number.isSafeInteger(input.scheduledAt) || Number(input.scheduledAt) <= 0) {
    throw new MarketInputError("Invalid maintenance timestamp");
  }
  const timestamp = Number(input.scheduledAt);
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) {
    throw new MarketInputError("Maintenance timestamp is outside the accepted window");
  }
  const scheduledAt = new Date(timestamp);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new MarketInputError("Invalid maintenance timestamp");
  }
  if (
    scheduledAt.getUTCMinutes() !== 15
    || scheduledAt.getUTCSeconds() !== 0
    || scheduledAt.getUTCMilliseconds() !== 0
  ) {
    throw new MarketInputError("Maintenance timestamp does not match the configured schedule");
  }
  return { scheduledAt, cron: MAINTENANCE_CRON };
}

async function existingRun(scheduledAt: Date): Promise<MaintenanceResult> {
  const rows = await query<MaintenanceRunRow>(
    `SELECT state, cleanup_counts, activity_counts, health_counts
     FROM maintenance_runs
     WHERE scheduled_at = $1
     LIMIT 1`,
    [scheduledAt],
  );
  const row = rows[0];
  if (!row) throw new Error("Maintenance run disappeared after idempotency conflict");
  return {
    duplicate: true,
    scheduledAt: scheduledAt.toISOString(),
    state: row.state,
    cleanupCounts: row.cleanup_counts ?? emptyCleanupCounts(),
    activityCounts: { ...emptyActivityCounts(), ...(row.activity_counts ?? {}) },
    healthCounts: { ...emptyHealthCounts(), ...(row.health_counts ?? {}) },
  };
}

export async function runScheduledMaintenance(
  invocation: MaintenanceInvocation,
): Promise<MaintenanceResult> {
  const started = await query<{ id: string }>(
    `INSERT INTO maintenance_runs (scheduled_at, cron_expression)
     VALUES ($1, $2)
     ON CONFLICT (scheduled_at) DO NOTHING
     RETURNING id`,
    [invocation.scheduledAt, invocation.cron],
  );
  if (!started[0]) return existingRun(invocation.scheduledAt);

  try {
    // DNS requests run before the cleanup transaction so a slow resolver never
    // holds financial, listing, or retention locks.
    const destinationRechecks = await runDestinationRechecks(invocation.scheduledAt);
    const result = await transaction(async (client) => {
      const rankObservations = await client.query(
        `WITH ranked AS (
           SELECT listing.id AS listing_id, listing.total_cents, listing.bid_count,
                  row_number() OVER (
                    ORDER BY listing.total_cents DESC, listing.last_bid_at ASC, listing.slug ASC
                  )::int AS overall_rank,
                  count(*) OVER ()::int AS overall_entries,
                  row_number() OVER (
                    PARTITION BY listing.category
                    ORDER BY listing.total_cents DESC, listing.last_bid_at ASC, listing.slug ASC
                  )::int AS category_rank,
                  count(*) OVER (PARTITION BY listing.category)::int AS category_entries
           FROM listings AS listing
           WHERE listing.status = 'active' AND listing.product_kind = 'open_source'
         ),
         latest AS (
           SELECT DISTINCT ON (observation.listing_id)
                  observation.listing_id, observation.captured_at,
                  observation.overall_rank, observation.overall_entries,
                  observation.category_rank, observation.category_entries,
                  observation.total_cents, observation.bid_count
           FROM listing_rank_observations AS observation
           ORDER BY observation.listing_id, observation.captured_at DESC
         )
         INSERT INTO listing_rank_observations (
           listing_id, captured_at, overall_rank, overall_entries,
           category_rank, category_entries, total_cents, bid_count
         )
         SELECT ranked.listing_id, $1, ranked.overall_rank, ranked.overall_entries,
                ranked.category_rank, ranked.category_entries, ranked.total_cents, ranked.bid_count
         FROM ranked
         LEFT JOIN latest ON latest.listing_id = ranked.listing_id
         WHERE latest.listing_id IS NULL
            OR latest.overall_rank <> ranked.overall_rank
            OR latest.overall_entries <> ranked.overall_entries
            OR latest.category_rank <> ranked.category_rank
            OR latest.category_entries <> ranked.category_entries
            OR latest.total_cents <> ranked.total_cents
            OR latest.bid_count <> ranked.bid_count
            OR latest.captured_at <= $1::timestamptz - interval '24 hours'
         ON CONFLICT (listing_id, captured_at) DO NOTHING`,
        [invocation.scheduledAt],
      );
      const activityCounts: MaintenanceActivityCounts = {
        rank_observations: rankObservations.rowCount ?? 0,
        destination_rechecks: destinationRechecks.checked,
        destination_suspensions: destinationRechecks.suspended,
      };
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
      const expiredVerifications = await client.query(
        `UPDATE destination_verifications
         SET state = 'expired'
         WHERE state = 'pending' AND expires_at <= now()`,
      );
      const deletedVerifications = await client.query(
        `DELETE FROM destination_verifications
         WHERE state = 'expired'
           AND verified_at IS NULL
           AND expires_at <= now() - interval '30 days'`,
      );
      const oldDestinationRechecks = await client.query(
        `DELETE FROM listing_destination_rechecks
         WHERE checked_at <= now() - interval '400 days'`,
      );
      const privacyRequests = await client.query(
        `DELETE FROM privacy_requests
         WHERE state IN ('completed', 'declined', 'cancelled')
           AND completed_at <= now() - interval '3 years'`,
      );
      const oldMaintenanceRuns = await client.query(
        `DELETE FROM maintenance_runs
         WHERE state IN ('completed', 'attention', 'failed')
           AND completed_at <= now() - interval '400 days'`,
      );
      const cleanupCounts: CleanupCounts = {
        click_events: clickEvents.rowCount ?? 0,
        click_sessions: clickSessions.rowCount ?? 0,
        rate_limits: rateLimits.rowCount ?? 0,
        founder_sessions: founderSessions.rowCount ?? 0,
        destination_verifications_expired: expiredVerifications.rowCount ?? 0,
        destination_verifications_deleted: deletedVerifications.rowCount ?? 0,
        destination_rechecks: oldDestinationRechecks.rowCount ?? 0,
        privacy_requests: privacyRequests.rowCount ?? 0,
        maintenance_runs: oldMaintenanceRuns.rowCount ?? 0,
      };

      const healthRows = await client.query<MaintenanceHealthCounts>(
        `SELECT
           (SELECT count(*)::int FROM payment_events
            WHERE processing_state IN ('received', 'failed')
              AND received_at < now() - interval '5 minutes') AS stuck_payment_events,
           (SELECT count(*)::int FROM payment_checkouts
            WHERE state IN ('creating', 'pending')
              AND created_at < now() - interval '1 hour') AS stale_checkouts,
           (SELECT count(*)::int FROM destination_security_reviews
            WHERE state = 'pending'
              AND submitted_at < now() - interval '30 minutes') AS stuck_destination_scans,
           (SELECT count(*)::int
            FROM (
              SELECT DISTINCT ON (listing_id) listing_id, state, checked_at
              FROM listing_destination_rechecks
              ORDER BY listing_id, checked_at DESC
            ) AS latest_recheck
            WHERE latest_recheck.state = 'failed'
              AND latest_recheck.checked_at >= now() - interval '24 hours') AS destination_recheck_failures,
           (SELECT count(*)::int FROM privacy_requests
            WHERE state IN ('open', 'in_progress')
              AND created_at < now() - interval '30 days') AS overdue_privacy_requests`,
      );
      const healthCounts = healthRows.rows[0] ?? emptyHealthCounts();
      // Abandoned pending checkouts are expected and stay visible as a warning.
      // Signed-event, scanner, and statutory-response backlogs are actionable.
      const state = maintenanceNeedsAttention(healthCounts)
        ? "attention" as const
        : "completed" as const;
      await client.query(
        `UPDATE maintenance_runs
         SET state = $2, cleanup_counts = $3::jsonb, activity_counts = $4::jsonb,
             health_counts = $5::jsonb,
             completed_at = now()
         WHERE scheduled_at = $1 AND state = 'running'`,
        [
          invocation.scheduledAt,
          state,
          JSON.stringify(cleanupCounts),
          JSON.stringify(activityCounts),
          JSON.stringify(healthCounts),
        ],
      );
      return { state, cleanupCounts, activityCounts, healthCounts };
    });
    return {
      duplicate: false,
      scheduledAt: invocation.scheduledAt.toISOString(),
      ...result,
    };
  } catch (error) {
    await query(
      `UPDATE maintenance_runs
       SET state = 'failed', error_code = 'maintenance_failed', completed_at = now()
       WHERE scheduled_at = $1 AND state = 'running'`,
      [invocation.scheduledAt],
    ).catch(() => undefined);
    throw error;
  }
}

export async function maintenanceReadiness(): Promise<
  "awaiting_first_run" | "ready" | "attention" | "running" | "failed" | "stale"
> {
  const rows = await query<{ state: MaintenanceResult["state"]; started_at: Date; completed_at: Date | null }>(
    `SELECT state, started_at, completed_at
     FROM maintenance_runs
     ORDER BY scheduled_at DESC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return "awaiting_first_run";
  if (row.state === "failed") return "failed";
  if (row.state === "running") {
    return row.started_at.getTime() < Date.now() - 30 * 60 * 1000 ? "stale" : "running";
  }
  if (!row.completed_at || row.completed_at.getTime() < Date.now() - 90 * 60 * 1000) return "stale";
  return row.state === "attention" ? "attention" : "ready";
}
