import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseEnv } from "./env";
import { privacyHash } from "./privacy-hash";

const globalPool = globalThis as typeof globalThis & { bidstagePool?: Pool };

type HyperdriveBinding = {
  connectionString: string;
};

function hyperdriveConnectionString(): string | undefined {
  try {
    const env = getCloudflareContext().env as { HYPERDRIVE?: HyperdriveBinding };
    return env.HYPERDRIVE?.connectionString;
  } catch {
    // Node scripts and plain `next build` do not run inside a Workers request.
    return undefined;
  }
}

export function database(): Pool {
  if (!globalPool.bidstagePool) {
    const hyperdriveUrl = hyperdriveConnectionString();
    const env = hyperdriveUrl ? undefined : databaseEnv();
    globalPool.bidstagePool = new Pool({
      connectionString: hyperdriveUrl ?? env?.databaseUrl,
      // Workers allow six simultaneous outbound connections. Leave one slot
      // available for payment, DNS verification, and other request work.
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: !hyperdriveUrl && env?.databaseSsl ? { rejectUnauthorized: true } : undefined,
    });
  }
  return globalPool.bidstagePool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await database().query<T>(text, values);
  return result.rows;
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function takeRateLimit(bucket: string, subject: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = `${bucket}:${privacyHash(subject)}`;
  const rows = await query<{ allowed: boolean }>(
    `INSERT INTO request_rate_limits (key, window_started_at, request_count)
     VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       window_started_at = CASE
         WHEN request_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN now()
         ELSE request_rate_limits.window_started_at
       END,
       request_count = CASE
         WHEN request_rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN 1
         ELSE request_rate_limits.request_count + 1
       END
     RETURNING request_count <= $3 AS allowed`,
    [key, windowSeconds, limit],
  );
  return rows[0]?.allowed === true;
}
