import { createHash } from "node:crypto";

import { isPublicIpAddress } from "./destination-safety";
import { cloudflareUrlScannerEnv } from "./env";

const API_ORIGIN = "https://api.cloudflare.com";
const REQUEST_TIMEOUT_MS = 10_000;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type JsonRecord = Record<string, unknown>;
type Fetcher = typeof fetch;

export type SubmittedDestinationScan = {
  scanId: string;
  canonicalUrl: string;
  reportUrl: string;
  visibility: "public";
};

export type DestinationScanFinding = {
  scanId: string;
  state: "passed" | "rejected" | "failed";
  destinationFingerprint: string;
  finalOrigin: string | null;
  redirectCount: number | null;
  redirectChainFingerprint: string | null;
  hasVerdicts: boolean | null;
  malicious: boolean | null;
  categories: string[];
  tags: string[];
  errorCode: string | null;
};

export type DestinationScanResult =
  | { state: "pending" }
  | { state: "complete"; finding: DestinationScanFinding };

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function apiResult(value: unknown): JsonRecord {
  const outer = record(value);
  if (!outer) throw new Error("Cloudflare URL Scanner returned an invalid response");
  const nested = record(outer.result);
  return nested && outer.success === true ? nested : outer;
}

function trustedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const clean = item.trim().replace(/[^\p{L}\p{N} ._:/+()-]/gu, "").slice(0, 80);
    return clean ? [clean] : [];
  }))].slice(0, 20);
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("Cloudflare URL Scanner returned an invalid scan identifier");
  }
  return value.toLowerCase();
}

function scanUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("Cloudflare URL Scanner returned an invalid URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Cloudflare URL Scanner returned an invalid URL");
  }
  return url;
}

function canonicalTarget(value: unknown): string {
  const url = scanUrl(value);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.href;
}

function submittedTarget(value: unknown): string {
  const url = scanUrl(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("URL Scanner destinations must use credential-free HTTPS on the default port");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const literalIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || (!hostname.includes(".") && !literalIp)
    || (literalIp && !isPublicIpAddress(hostname))
  ) {
    throw new Error("URL Scanner destinations must use a public hostname or address");
  }
  return canonicalTarget(url.href);
}

export function destinationFingerprint(destination: string): string {
  return createHash("sha256").update(submittedTarget(destination)).digest("hex");
}

function reportUrl(scanId: string): string {
  return `https://radar.cloudflare.com/scan/${scanId}`;
}

function redirectEvidence(report: JsonRecord, submittedUrl: string, finalUrl: string): {
  count: number;
  fingerprint: string;
  unsafe: boolean;
} {
  const page = record(report.page);
  const history = Array.isArray(page?.history) ? page.history : [];
  let unsafe = false;
  const historyUrls = history.flatMap((entry) => {
    const value = typeof entry === "string" ? entry : record(entry)?.url;
    try {
      if (typeof value !== "string") {
        unsafe = true;
        return [];
      }
      return [submittedTarget(value)];
    } catch {
      unsafe = true;
      return [];
    }
  });
  const data = record(report.data);
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const primaryRedirects = requests.filter((entry) => {
    const request = record(record(entry)?.request);
    return request?.primaryRequest === true && record(request.redirectResponse) !== undefined;
  }).length;
  const chain = historyUrls.length
    ? historyUrls
    : [canonicalTarget(submittedUrl), canonicalTarget(finalUrl)];
  const count = Math.min(20, historyUrls.length > 1 ? historyUrls.length - 1 : primaryRedirects);
  return {
    count,
    fingerprint: createHash("sha256").update(chain.join("\0")).digest("hex"),
    unsafe,
  };
}

function failedFinding(scanId: string, destination: string, errorCode: string): DestinationScanFinding {
  return {
    scanId,
    state: "failed",
    destinationFingerprint: destinationFingerprint(destination),
    finalOrigin: null,
    redirectCount: null,
    redirectChainFingerprint: null,
    hasVerdicts: null,
    malicious: null,
    categories: [],
    tags: [],
    errorCode,
  };
}

export function parseDestinationScanReport(
  value: unknown,
  expectedScanId: string,
  expectedDestination: string,
): DestinationScanFinding {
  const report = apiResult(value);
  const task = record(report.task);
  const scanId = uuid(task?.uuid);
  if (scanId !== uuid(expectedScanId)) throw new Error("URL scan identifier does not match the queued review");
  if (submittedTarget(task?.url) !== submittedTarget(expectedDestination)) {
    throw new Error("URL scan destination does not match the queued review");
  }
  if (task?.success !== true) return failedFinding(scanId, expectedDestination, "scan_failed");

  const page = record(report.page);
  let finalUrl: URL;
  try {
    finalUrl = scanUrl(page?.url);
  } catch {
    return failedFinding(scanId, expectedDestination, "invalid_final_url");
  }
  try {
    submittedTarget(finalUrl.href);
  } catch {
    return {
      ...failedFinding(scanId, expectedDestination, "unsafe_final_url"),
      state: "rejected",
      finalOrigin: finalUrl.origin,
    };
  }

  const primaryIp = typeof page?.ip === "string" ? page.ip : "";
  const redirect = redirectEvidence(report, expectedDestination, finalUrl.href);
  const verdict = record(record(report.verdicts)?.overall);
  const hasVerdicts = verdict?.hasVerdicts === true;
  const malicious = typeof verdict?.malicious === "boolean" ? verdict.malicious : null;
  const base = {
    scanId,
    destinationFingerprint: destinationFingerprint(expectedDestination),
    finalOrigin: finalUrl.origin,
    redirectCount: redirect.count,
    redirectChainFingerprint: redirect.fingerprint,
    hasVerdicts,
    malicious,
    categories: trustedStringArray(verdict?.categories),
    tags: trustedStringArray(verdict?.tags),
  };
  if (redirect.unsafe) {
    return { ...base, state: "rejected", errorCode: "unsafe_redirect_chain" };
  }
  if (!isPublicIpAddress(primaryIp)) {
    return { ...base, state: "rejected", errorCode: "non_public_primary_ip" };
  }
  if (!hasVerdicts || malicious === null) {
    return { ...base, state: "failed", errorCode: "verdict_missing" };
  }
  if (malicious) return { ...base, state: "rejected", errorCode: "malicious_verdict" };
  const status = Number(page?.status);
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    return { ...base, state: "failed", errorCode: "destination_http_status" };
  }
  return { ...base, state: "passed", errorCode: null };
}

async function json(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new Error(`Cloudflare URL Scanner returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function submitDestinationScan(
  destination: string,
  fetcher: Fetcher = fetch,
): Promise<SubmittedDestinationScan> {
  submittedTarget(destination);
  const env = cloudflareUrlScannerEnv();
  const response = await fetcher(`${API_ORIGIN}/client/v4/accounts/${env.accountId}/urlscanner/v2/scan`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: destination, visibility: "public" }),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Cloudflare URL Scanner submission failed with HTTP ${response.status}`);
  const result = apiResult(await json(response));
  const scanId = uuid(result.uuid);
  return {
    scanId,
    canonicalUrl: submittedTarget(result.url),
    reportUrl: reportUrl(scanId),
    visibility: "public",
  };
}

export async function retrieveDestinationScan(
  scanId: string,
  destination: string,
  fetcher: Fetcher = fetch,
): Promise<DestinationScanResult> {
  const env = cloudflareUrlScannerEnv();
  const trustedScanId = uuid(scanId);
  const response = await fetcher(
    `${API_ORIGIN}/client/v4/accounts/${env.accountId}/urlscanner/v2/result/${trustedScanId}`,
    {
      headers: { Accept: "application/json", Authorization: `Bearer ${env.apiToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (response.status === 404) return { state: "pending" };
  if (!response.ok) throw new Error(`Cloudflare URL Scanner lookup failed with HTTP ${response.status}`);
  return {
    state: "complete",
    finding: parseDestinationScanReport(await json(response), trustedScanId, destination),
  };
}
