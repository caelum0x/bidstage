import { MarketInputError } from "./market";

const OSI_LICENSES_URL = "https://opensource.org/api/licenses";

type OsiLicenseRecord = {
  spdx_id?: unknown;
};

function licenseRecords(value: unknown): OsiLicenseRecord[] {
  if (Array.isArray(value)) return value as OsiLicenseRecord[];
  if (!value || typeof value !== "object") return [];
  const body = value as Record<string, unknown>;
  if (Array.isArray(body.licenses)) return body.licenses as OsiLicenseRecord[];
  if (Array.isArray(body.data)) return body.data as OsiLicenseRecord[];
  return [body as OsiLicenseRecord];
}

export function containsOsiApprovedLicense(value: unknown, spdxId: string): boolean {
  const expected = spdxId.trim().toLowerCase();
  return licenseRecords(value).some(
    (license) => typeof license.spdx_id === "string" && license.spdx_id.trim().toLowerCase() === expected,
  );
}

export async function verifyOsiApprovedLicense(spdxId: string): Promise<void> {
  const url = new URL(OSI_LICENSES_URL);
  url.searchParams.set("spdx", spdxId);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Bidstage",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`OSI license lookup failed with ${response.status}`);
  if (!containsOsiApprovedLicense(await response.json(), spdxId)) {
    throw new MarketInputError("Open-source projects need an OSI-approved license");
  }
}
