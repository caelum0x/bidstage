export type ReleaseCheck = {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
};

export function auditMigrationNames(files: string[], applied: string[]): ReleaseCheck[] {
  const expected = [...files].filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  const actual = [...applied].sort();
  const missing = expected.filter((file) => !actual.includes(file));
  const unknown = actual.filter((file) => !expected.includes(file));
  const numbers = expected.map((file) => Number(file.slice(0, 4)));
  const contiguous = numbers.every((number, index) => number === index + 1);
  return [
    {
      name: "migration files are contiguous",
      status: contiguous ? "pass" : "fail",
      detail: contiguous ? `${expected.length} ordered migration files` : "migration numbering contains a gap",
    },
    {
      name: "deployed migration set matches source",
      status: missing.length === 0 && unknown.length === 0 ? "pass" : "fail",
      detail: missing.length || unknown.length
        ? `missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}`
        : `${actual.length} applied migrations match source`,
    },
  ];
}

export function auditResponseHeaders(headers: Headers, requireHsts = true): ReleaseCheck[] {
  const csp = headers.get("content-security-policy") ?? "";
  const requiredCsp = [
    "default-src 'self'",
    "script-src-attr 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  const checks: ReleaseCheck[] = [
    {
      name: "content security policy",
      status: requiredCsp.every((directive) => csp.includes(directive)) ? "pass" : "fail",
      detail: requiredCsp.every((directive) => csp.includes(directive))
        ? "required injection, framing, object, base, and form boundaries present"
        : "one or more required CSP directives are missing",
    },
    {
      name: "content type protection",
      status: headers.get("x-content-type-options") === "nosniff" ? "pass" : "fail",
      detail: headers.get("x-content-type-options") ?? "header missing",
    },
    {
      name: "frame protection",
      status: headers.get("x-frame-options") === "DENY" ? "pass" : "fail",
      detail: headers.get("x-frame-options") ?? "header missing",
    },
    {
      name: "referrer policy",
      status: headers.get("referrer-policy") === "strict-origin-when-cross-origin" ? "pass" : "fail",
      detail: headers.get("referrer-policy") ?? "header missing",
    },
    {
      name: "cross-origin opener policy",
      status: headers.get("cross-origin-opener-policy") === "same-origin" ? "pass" : "fail",
      detail: headers.get("cross-origin-opener-policy") ?? "header missing",
    },
    {
      name: "framework disclosure",
      status: headers.has("x-powered-by") ? "fail" : "pass",
      detail: headers.has("x-powered-by") ? "x-powered-by is exposed" : "x-powered-by absent",
    },
  ];
  if (requireHsts) {
    const hsts = headers.get("strict-transport-security") ?? "";
    checks.push({
      name: "transport security",
      status: /(?:^|;)\s*max-age=\d+/i.test(hsts) ? "pass" : "fail",
      detail: hsts || "header missing",
    });
  }
  return checks;
}
