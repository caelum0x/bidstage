import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { authorizedMaintenanceRequest } from "@/lib/maintenance-auth";
import { MarketInputError } from "@/lib/market-error";
import {
  parseMaintenanceInvocation,
  runScheduledMaintenance,
} from "@/lib/scheduled-maintenance";

const privateHeaders = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 1024;

class MaintenancePayloadTooLarge extends Error {}

async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Missing request body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new MaintenancePayloadTooLarge();
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body) as unknown;
}

export async function POST(request: Request) {
  let maintenanceSecret: string;
  try {
    maintenanceSecret = serverEnv().maintenanceSecret;
  } catch {
    return NextResponse.json(
      { error: "maintenance_unavailable" },
      { status: 503, headers: { ...privateHeaders, "Retry-After": "60" } },
    );
  }
  if (!authorizedMaintenanceRequest(request, maintenanceSecret)) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: privateHeaders });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "invalid_content_type" },
      { status: 415, headers: privateHeaders },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "request_too_large" },
      { status: 413, headers: privateHeaders },
    );
  }

  try {
    const invocation = parseMaintenanceInvocation(await boundedJson(request));
    const result = await runScheduledMaintenance(invocation);
    return NextResponse.json(result, {
      status: result.state === "attention" || result.state === "failed" ? 409 : 200,
      headers: privateHeaders,
    });
  } catch (error) {
    if (error instanceof MaintenancePayloadTooLarge) {
      return NextResponse.json(
        { error: "request_too_large" },
        { status: 413, headers: privateHeaders },
      );
    }
    const clientError = error instanceof MarketInputError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error: clientError ? "invalid_maintenance_invocation" : "maintenance_failed",
      },
      {
        status: clientError ? 400 : 503,
        headers: { ...privateHeaders, ...(clientError ? {} : { "Retry-After": "60" }) },
      },
    );
  }
}
