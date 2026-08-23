import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Client, Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseEnv } from "./env";
import { privacyHash } from "./privacy-hash";

const globalPool = globalThis as typeof globalThis & { bidstageNodePool?: Pool };

type HyperdriveBinding = {
  connectionString: string;
};

export type DatabaseClient = Pick<PoolClient, "query">;

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
  if (hyperdriveConnectionString()) {
    throw new Error("database() is only available to Node migration and operator processes");
  }
  if (!globalPool.bidstageNodePool) {
    const env = databaseEnv();
    globalPool.bidstageNodePool = new Pool({
      connectionString: env.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: env.databaseSsl ? { rejectUnauthorized: true } : undefined,
    });
  }
  return globalPool.bidstageNodePool;
}

async function withHyperdriveClient<T>(connectionString: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const hyperdriveUrl = hyperdriveConnectionString();
  const result = hyperdriveUrl
    ? await withHyperdriveClient(hyperdriveUrl, (client) => client.query<T>(text, values))
    : await database().query<T>(text, values);
  return result.rows;
}

export async function transaction<T>(run: (client: DatabaseClient) => Promise<T>): Promise<T> {
  const hyperdriveUrl = hyperdriveConnectionString();
  if (hyperdriveUrl) {
    return withHyperdriveClient(hyperdriveUrl, async (client) => {
      await client.query("BEGIN");
      try {
        const value = await run(client);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

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
