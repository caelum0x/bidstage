import { createHash } from "node:crypto";

import { MarketInputError } from "./market-error";

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const MAX_DNS_MESSAGE_BYTES = 65_535;

export type DestinationSafetyErrorCode =
  | "invalid_hostname"
  | "non_public_address"
  | "unresolved_destination";

export class DestinationSafetyError extends MarketInputError {
  readonly code: DestinationSafetyErrorCode;

  constructor(message: string, code: DestinationSafetyErrorCode = "invalid_hostname") {
    super(message);
    this.code = code;
  }
}

export type DestinationResolutionOutcome =
  | { state: "passed"; addressCount: number; addressFingerprint: string; errorCode: null }
  | { state: "rejected"; addressCount: null; addressFingerprint: null; errorCode: DestinationSafetyErrorCode }
  | { state: "failed"; addressCount: null; addressFingerprint: null; errorCode: "dns_unavailable" };

function ipv4Bytes(address: string): number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return undefined;
  const bytes = address.split(".").map(Number);
  return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ? bytes
    : undefined;
}

function ipv6Bytes(address: string): number[] | undefined {
  const input = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!/^[0-9a-f:.]+$/.test(input) || input.split("::").length > 2) return undefined;
  const normalized = input.includes(".")
    ? (() => {
        const lastColon = input.lastIndexOf(":");
        const embedded = ipv4Bytes(input.slice(lastColon + 1));
        return embedded
          ? `${input.slice(0, lastColon)}:${((embedded[0]! << 8) | embedded[1]!).toString(16)}:${((embedded[2]! << 8) | embedded[3]!).toString(16)}`
          : undefined;
      })()
    : input;
  if (!normalized) return undefined;
  const [leftRaw, rightRaw] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (!normalized.includes("::") && left.length !== 8) return undefined;
  const missing = 8 - left.length - right.length;
  if (missing < (normalized.includes("::") ? 1 : 0)) return undefined;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function publicIpv4(bytes: number[]): boolean {
  const [a, b, c] = bytes;
  if (a === undefined || b === undefined || c === undefined) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicIpv6(bytes: number[]): boolean {
  if (bytes.length !== 16) return false;
  // Current global-unicast allocation is 2000::/3. Explicitly remove IETF
  // documentation and ORCHID ranges that sit inside it.
  if ((bytes[0]! & 0xe0) !== 0x20) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2]! <= 0x01) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  if (
    bytes[0] === 0x20 && bytes[1] === 0x01
    && ((bytes[2] === 0x00 && (bytes[3]! & 0xf0) === 0x10) || (bytes[2] === 0x00 && (bytes[3]! & 0xf0) === 0x20))
  ) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false;
  if (bytes[0] === 0x3f && (bytes[1]! & 0xf0) === 0xf0) return false;
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const ipv4 = ipv4Bytes(address);
  if (ipv4) return publicIpv4(ipv4);
  const ipv6 = ipv6Bytes(address);
  return ipv6 ? publicIpv6(ipv6) : false;
}

export function buildDnsQuery(hostname: string, type: 1 | 16 | 28): Uint8Array {
  const labels = hostname.replace(/\.$/, "").split(".");
  const labelPattern = type === 16
    ? /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i
    : /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
  if (
    labels.length < 2
    || labels.some((label) => !label || label.length > 63 || !labelPattern.test(label))
  ) throw new DestinationSafetyError("Project website has an invalid public hostname", "invalid_hostname");
  const length = 12 + labels.reduce((total, label) => total + 1 + label.length, 0) + 1 + 4;
  const message = new Uint8Array(length);
  const view = new DataView(message.buffer);
  view.setUint16(2, 0x0100); // recursion desired
  view.setUint16(4, 1); // one question
  let offset = 12;
  for (const label of labels) {
    message[offset++] = label.length;
    for (const character of label) message[offset++] = character.charCodeAt(0);
  }
  message[offset++] = 0;
  view.setUint16(offset, type);
  view.setUint16(offset + 2, 1); // IN
  return message;
}

function skipName(message: Uint8Array, start: number): number {
  let offset = start;
  for (let labels = 0; labels < 128; labels += 1) {
    if (offset >= message.length) throw new Error("Truncated DNS name");
    const length = message[offset]!;
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= message.length) throw new Error("Truncated DNS pointer");
      return offset + 2;
    }
    offset += 1;
    if (length === 0) return offset;
    if ((length & 0xc0) !== 0 || offset + length > message.length) throw new Error("Invalid DNS label");
    offset += length;
  }
  throw new Error("DNS name exceeds label limit");
}

function ipv6Text(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: 8 }, (_, index) => view.getUint16(index * 2).toString(16)).join(":");
}

type DnsRecord = { type: number; recordClass: number; data: Uint8Array };

function parseDnsRecords(payload: ArrayBuffer): { responseCode: number; records: DnsRecord[] } {
  if (payload.byteLength < 12 || payload.byteLength > MAX_DNS_MESSAGE_BYTES) throw new Error("Invalid DNS response size");
  const message = new Uint8Array(payload);
  const view = new DataView(payload);
  const flags = view.getUint16(2);
  if ((flags & 0x8000) === 0 || (flags & 0x0200) !== 0) throw new Error("Incomplete DNS response");
  const questions = view.getUint16(4);
  const answers = view.getUint16(6);
  if (questions > 8 || answers > 256) throw new Error("DNS response exceeds record limit");
  let offset = 12;
  for (let index = 0; index < questions; index += 1) {
    offset = skipName(message, offset);
    if (offset + 4 > message.length) throw new Error("Truncated DNS question");
    offset += 4;
  }
  const records: DnsRecord[] = [];
  for (let index = 0; index < answers; index += 1) {
    offset = skipName(message, offset);
    if (offset + 10 > message.length) throw new Error("Truncated DNS answer");
    const type = view.getUint16(offset);
    const recordClass = view.getUint16(offset + 2);
    const dataLength = view.getUint16(offset + 8);
    offset += 10;
    if (offset + dataLength > message.length) throw new Error("Truncated DNS record data");
    records.push({ type, recordClass, data: message.slice(offset, offset + dataLength) });
    offset += dataLength;
  }
  return { responseCode: flags & 0x000f, records };
}

export function parseDnsAddressResponse(payload: ArrayBuffer): { responseCode: number; addresses: string[] } {
  const { responseCode, records } = parseDnsRecords(payload);
  const addresses = records.flatMap((record) => {
    if (record.recordClass === 1 && record.type === 1 && record.data.length === 4) {
      return [Array.from(record.data).join(".")];
    }
    if (record.recordClass === 1 && record.type === 28 && record.data.length === 16) {
      return [ipv6Text(record.data)];
    }
    return [];
  });
  return { responseCode, addresses };
}

export function parseDnsTxtResponse(payload: ArrayBuffer): { responseCode: number; values: string[] } {
  const { responseCode, records } = parseDnsRecords(payload);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const values = records.flatMap((record) => {
    if (record.recordClass !== 1 || record.type !== 16) return [];
    const chunks: string[] = [];
    let offset = 0;
    while (offset < record.data.length) {
      const length = record.data[offset++]!;
      if (offset + length > record.data.length) throw new Error("Truncated DNS TXT value");
      chunks.push(decoder.decode(record.data.slice(offset, offset + length)));
      offset += length;
    }
    return [chunks.join("")];
  });
  return { responseCode, values };
}

async function dnsRequest(hostname: string, type: 1 | 16 | 28): Promise<ArrayBuffer> {
  const query = buildDnsQuery(hostname, type);
  const url = new URL(DOH_ENDPOINT);
  url.searchParams.set("dns", Buffer.from(query).toString("base64url"));
  const response = await fetch(url, {
    headers: { Accept: "application/dns-message" },
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/dns-message")) {
    throw new Error("DNS resolver returned an invalid response");
  }
  return response.arrayBuffer();
}

async function resolve(hostname: string, type: 1 | 28): Promise<{ responseCode: number; addresses: string[] }> {
  return parseDnsAddressResponse(await dnsRequest(hostname, type));
}

export async function resolveDnsTxtRecords(hostname: string): Promise<string[]> {
  const result = parseDnsTxtResponse(await dnsRequest(hostname, 16));
  if (![0, 3].includes(result.responseCode)) throw new Error("Public DNS resolution is temporarily unavailable");
  return result.values;
}

export async function reviewDestinationResolution(destination: string): Promise<{ addresses: string[] }> {
  const hostname = new URL(destination).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (ipv4Bytes(hostname) || ipv6Bytes(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new DestinationSafetyError("Project website resolves to a non-public network", "non_public_address");
    }
    return { addresses: [hostname] };
  }
  const responses = await Promise.all([resolve(hostname, 1), resolve(hostname, 28)]);
  if (responses.some((response) => ![0, 3].includes(response.responseCode))) {
    throw new Error("Public DNS resolution is temporarily unavailable");
  }
  const addresses = [...new Set(responses.flatMap((response) => response.addresses))].sort();
  if (addresses.length === 0) {
    throw new DestinationSafetyError("Project website must resolve in public DNS before checkout", "unresolved_destination");
  }
  if (addresses.some((address) => !isPublicIpAddress(address))) {
    throw new DestinationSafetyError("Project website resolves to a non-public or reserved network", "non_public_address");
  }
  return { addresses };
}

export async function inspectDestinationResolution(
  destination: string,
  resolver: (value: string) => Promise<{ addresses: string[] }> = reviewDestinationResolution,
): Promise<DestinationResolutionOutcome> {
  try {
    const result = await resolver(destination);
    const addresses = [...new Set(result.addresses)].sort();
    if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
      return {
        state: "rejected",
        addressCount: null,
        addressFingerprint: null,
        errorCode: addresses.length === 0 ? "unresolved_destination" : "non_public_address",
      };
    }
    return {
      state: "passed",
      addressCount: addresses.length,
      addressFingerprint: createHash("sha256").update(addresses.join("\0")).digest("hex"),
      errorCode: null,
    };
  } catch (error) {
    if (error instanceof DestinationSafetyError) {
      return {
        state: "rejected",
        addressCount: null,
        addressFingerprint: null,
        errorCode: error.code,
      };
    }
    return {
      state: "failed",
      addressCount: null,
      addressFingerprint: null,
      errorCode: "dns_unavailable",
    };
  }
}
