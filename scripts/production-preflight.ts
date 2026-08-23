import { existsSync, readFileSync, statSync } from "node:fs";

const BLOCKED_NEXT_VERSIONS = new Set(["16.3.0"]);
const REQUIRED_SECRETS = [
  "CREEM_API_KEY",
  "CREEM_WEBHOOK_SECRET",
  "CREEM_PRODUCT_ID",
  "TURNSTILE_SECRET_KEY",
  "FOUNDER_ACCESS_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_API_TOKEN",
  "RATE_LIMIT_SALT",
  "MAINTENANCE_SECRET",
] as const;

function fail(message: string): never {
  console.error(`Production preflight failed: ${message}`);
  process.exit(1);
}

function parseSecretFile(path: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const sourceLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) fail(`${path} contains an invalid line`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result.set(key, value);
  }
  return result;
}

const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
};
const nextVersion = packageManifest.dependencies?.next;
if (!nextVersion || BLOCKED_NEXT_VERSIONS.has(nextVersion)) {
  fail(`Next.js ${nextVersion ?? "unknown"} cannot ship. Install the patched 16.3 release announced for 26 August 2026.`);
}

const wrangler = readFileSync("wrangler.jsonc", "utf8");
const hyperdrive = wrangler.match(
  /"hyperdrive"\s*:\s*\[\s*\{[\s\S]*?"binding"\s*:\s*"HYPERDRIVE"[\s\S]*?"id"\s*:\s*"([a-f0-9]{32})"[\s\S]*?\}\s*\]/i,
);
if (!hyperdrive) {
  fail("wrangler.jsonc needs a dedicated HYPERDRIVE binding before deployment");
}
const turnstileSiteKey = wrangler.match(/"TURNSTILE_SITE_KEY"\s*:\s*"([^"]+)"/)?.[1];
if (!turnstileSiteKey || /^1x0{10,}/.test(turnstileSiteKey)) {
  fail("wrangler.jsonc needs the production TURNSTILE_SITE_KEY public variable");
}

const secretFile = ".secrets.production";
if (!existsSync(secretFile)) {
  fail(`copy .secrets.production.example to ${secretFile}, fill it, and run chmod 600 ${secretFile}`);
}
if ((statSync(secretFile).mode & 0o077) !== 0) {
  fail(`${secretFile} must not grant group or public access; run chmod 600 ${secretFile}`);
}

const secrets = parseSecretFile(secretFile);
for (const key of REQUIRED_SECRETS) {
  const value = secrets.get(key);
  if (!value) fail(`${key} is missing from ${secretFile}`);
  if (/replace|example|placeholder/i.test(value)) fail(`${key} still contains a placeholder`);
}

for (const key of ["FOUNDER_ACCESS_SECRET", "RATE_LIMIT_SALT", "MAINTENANCE_SECRET"] as const) {
  if ((secrets.get(key)?.length ?? 0) < 32) fail(`${key} must contain at least 32 characters`);
}
if (new Set(["FOUNDER_ACCESS_SECRET", "RATE_LIMIT_SALT", "MAINTENANCE_SECRET"].map((key) => secrets.get(key))).size !== 3) {
  fail("FOUNDER_ACCESS_SECRET, RATE_LIMIT_SALT, and MAINTENANCE_SECRET must use different values");
}
if (/^1x0{10,}/.test(secrets.get("TURNSTILE_SECRET_KEY") ?? "")) {
  fail("production cannot use Cloudflare's published Turnstile test keys");
}

console.log(`Production preflight passed for Next.js ${nextVersion} and Hyperdrive ${hyperdrive[1]}.`);
