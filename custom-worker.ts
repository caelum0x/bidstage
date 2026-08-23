// @ts-expect-error -- OpenNext generates this entrypoint after `next build`.
import openNextWorker from "./.open-next/worker.js";

type MaintenanceSummary = {
  duplicate: boolean;
  scheduledAt: string;
  state: "running" | "completed" | "attention" | "failed";
  cleanupCounts: Record<string, number>;
  activityCounts: Record<string, number>;
  healthCounts: Record<string, number>;
};

type CronController = {
  readonly cron: string;
  readonly scheduledTime: number;
  noRetry(): void;
};

type BidstageWorker = {
  fetch: typeof openNextWorker.fetch;
  scheduled(controller: CronController, env: CloudflareEnv, context: unknown): Promise<void>;
};

const MAINTENANCE_CRON = "15 * * * *";

function numericRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 16) return undefined;
  if (!entries.every(([key, count]) => /^[a-z0-9_]{3,48}$/.test(key) && Number.isInteger(count) && Number(count) >= 0)) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, number>;
}

function maintenanceSummary(value: unknown): MaintenanceSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const cleanupCounts = numericRecord(input.cleanupCounts);
  const activityCounts = numericRecord(input.activityCounts);
  const healthCounts = numericRecord(input.healthCounts);
  if (
    typeof input.duplicate !== "boolean"
    || typeof input.scheduledAt !== "string"
    || !["running", "completed", "attention", "failed"].includes(String(input.state))
    || !cleanupCounts
    || !activityCounts
    || !healthCounts
  ) {
    return undefined;
  }
  return {
    duplicate: input.duplicate,
    scheduledAt: input.scheduledAt,
    state: input.state as MaintenanceSummary["state"],
    cleanupCounts,
    activityCounts,
    healthCounts,
  };
}

async function invokeMaintenance(controller: CronController, env: CloudflareEnv): Promise<void> {
  const secret = process.env.MAINTENANCE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    console.error(JSON.stringify({ event: "maintenance.failed", error: "credential_unavailable" }));
    throw new Error("Scheduled maintenance secret is unavailable");
  }

  const response = await env.WORKER_SELF_REFERENCE.fetch(
    new Request("https://bidstage.internal/api/internal/maintenance", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scheduledAt: controller.scheduledTime,
        cron: controller.cron,
      }),
    }),
  );
  const summary = maintenanceSummary(await response.json());
  if (!response.ok || !summary || summary.state !== "completed") {
    console.error(JSON.stringify({
      event: "maintenance.attention",
      status: response.status,
      state: summary?.state ?? "invalid_response",
      scheduledAt: summary?.scheduledAt ?? new Date(controller.scheduledTime).toISOString(),
      healthCounts: summary?.healthCounts ?? {},
    }));
    throw new Error("Scheduled maintenance requires attention");
  }
  console.log(JSON.stringify({
    event: "maintenance.completed",
    duplicate: summary.duplicate,
    scheduledAt: summary.scheduledAt,
    cleanupCounts: summary.cleanupCounts,
    activityCounts: summary.activityCounts,
    healthCounts: summary.healthCounts,
  }));
}

export default {
  fetch: openNextWorker.fetch,

  async scheduled(controller, env, _context): Promise<void> {
    if (controller.cron === MAINTENANCE_CRON) {
      await invokeMaintenance(controller, env);
      return;
    }
    controller.noRetry();
    console.error(JSON.stringify({
      event: "cron.rejected",
      cron: controller.cron,
      scheduledAt: new Date(controller.scheduledTime).toISOString(),
    }));
  },
} satisfies BidstageWorker;
