import { readFileSync } from "node:fs";

function fail(message: string): never {
  console.error(`Public launch preflight failed: ${message}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
};
if (manifest.dependencies?.next !== "16.2.11") {
  fail("Next.js must be pinned to the patched 16.2.11 Active LTS release");
}

const wrangler = readFileSync("wrangler.jsonc", "utf8");
if (!/"binding"\s*:\s*"HYPERDRIVE"[\s\S]*?"id"\s*:\s*"[a-f0-9]{32}"/i.test(wrangler)) {
  fail("the production Hyperdrive binding is missing");
}
if (!/"CHECKOUT_ENABLED"\s*:\s*"false"/.test(wrangler)) {
  fail("the credential-limited public launch must keep checkout disabled");
}
for (const name of [
  "FOUNDER_ACCESS_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "RATE_LIMIT_SALT",
  "MAINTENANCE_SECRET",
]) {
  if (!new RegExp(`"${name}"`).test(wrangler)) fail(`${name} is not declared in wrangler.jsonc`);
}

console.log("Public launch preflight passed for Next.js 16.2.11 with checkout disabled.");
