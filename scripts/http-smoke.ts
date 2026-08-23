import { auditResponseHeaders } from "../lib/release-audit";

const rawBaseUrl = process.env.SMOKE_BASE_URL?.trim();
if (!rawBaseUrl) throw new Error("SMOKE_BASE_URL is required");
const baseUrl = new URL(rawBaseUrl);
if (!["http:", "https:"].includes(baseUrl.protocol)) throw new Error("SMOKE_BASE_URL must use HTTP(S)");

async function response(path: string, accept: string): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    headers: { Accept: accept },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const healthResponse = await response("/api/health", "application/json");
  const health = await healthResponse.json().catch(() => undefined) as Record<string, unknown> | undefined;
  requireCondition(healthResponse.ok && health?.ok === true, `health failed with HTTP ${healthResponse.status}`);
  requireCondition(health.database === "ready", "health did not report a ready database");
  requireCondition(
    ["database_only", "configured"].includes(String(health.edge_rate_limit)),
    "health did not report a usable rate limiter",
  );
  requireCondition(
    ["awaiting_first_run", "ready", "running"].includes(String(health.maintenance)),
    `maintenance readiness is ${String(health.maintenance)}`,
  );

  const categoriesResponse = await response("/categories", "text/html");
  const categories = await categoriesResponse.text();
  requireCondition(categoriesResponse.ok, `categories failed with HTTP ${categoriesResponse.status}`);
  requireCondition(categories.includes("Project categories."), "category index marker is missing");
  requireCondition(categories.includes("Paid rank") || categories.includes("net settled placement total"), "category ranking disclosure is missing");

  const authResponse = await response("/auth/error", "text/html");
  const authPage = await authResponse.text();
  requireCondition(authResponse.ok, `auth error page failed with HTTP ${authResponse.status}`);
  requireCondition(/<meta[^>]+name="robots"[^>]+content="noindex, nofollow"/i.test(authPage), "auth error page is indexable");
  const headerFailures = auditResponseHeaders(authResponse.headers, baseUrl.protocol === "https:")
    .filter((check) => check.status === "fail");
  requireCondition(
    headerFailures.length === 0,
    `security headers failed: ${headerFailures.map((check) => check.name).join(", ")}`,
  );

  const robotsResponse = await response("/robots.txt", "text/plain");
  const robots = await robotsResponse.text();
  requireCondition(robotsResponse.ok, `robots failed with HTTP ${robotsResponse.status}`);
  for (const path of ["/api/", "/account", "/go/", "/receipt/", "/support/"]) {
    requireCondition(robots.includes(`Disallow: ${path}`), `robots does not exclude ${path}`);
  }
  requireCondition(robots.includes("Sitemap: https://bidstage.app/sitemap.xml"), "robots does not advertise the canonical sitemap");

  const sitemapResponse = await response("/sitemap.xml", "application/xml");
  const sitemap = await sitemapResponse.text();
  requireCondition(sitemapResponse.ok, `sitemap failed with HTTP ${sitemapResponse.status}`);
  requireCondition(sitemap.includes("https://bidstage.app/categories</loc>"), "sitemap omits category index");
  requireCondition(sitemap.includes("https://bidstage.app/category/developer</loc>"), "sitemap omits category detail");
  requireCondition(!/\/(?:api|account|auth|go|receipt|support)\//.test(sitemap), "sitemap exposes a private route");

  console.log("HTTP smoke passed: health, categories, noindex, security headers, robots, and sitemap.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
