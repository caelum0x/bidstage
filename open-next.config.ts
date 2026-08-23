import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Bidstage deliberately uses the adapter's in-memory/dummy incremental cache.
// The public board is database-backed and dynamic, so an R2 cache would add cost
// and invalidation complexity without improving correctness.
export default defineCloudflareConfig({
  routePreloadingBehavior: "none",
});
