import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { listingSlug, MarketInputError, normalizeDestination, parseCheckoutInput, parseRankQuoteInput, requestIp, requestSubject } from "../lib/market";
import { existingPlacementMatches, founderCanEditListing } from "../lib/listing-ownership";
import { containsOsiApprovedLicense } from "../lib/osi";
import { normalizeCountryCode, normalizeFunding, requireFundingPublisher } from "../lib/project-profile";
import { matchesRepositoryAuthorization } from "../lib/github";
import { normalizeContributorSkills, parseContributorProfile } from "../lib/contributor-profile";
import { parseContributionOpportunity, requireOpportunityRepository } from "../lib/contribution-opportunity";
import { webhookIncidentId } from "../lib/webhook-incidents";
import { trustedDodoCheckoutUrl, verifyDodoWebhookSignature } from "../lib/dodo";
import {
  parseContributionApplicationAction,
  parseContributionApplicationMessage,
  parseContributionFollowupMessage,
} from "../lib/contribution-application";
import { isSupportCategory, normalizeSupportMessage } from "../lib/support";
import { auditMigrationNames, auditResponseHeaders } from "../lib/release-audit";
import {
  buildDnsQuery,
  DestinationSafetyError,
  inspectDestinationResolution,
  isPublicIpAddress,
  parseDnsAddressResponse,
  parseDnsTxtResponse,
} from "../lib/destination-safety";
import { countryName, isCountryCode } from "../lib/countries";
import { destinationFingerprint, parseDestinationScanReport } from "../lib/cloudflare-url-scanner";
import { parsePrivacyRequest, privacyRequestLabel } from "../lib/privacy-request";
import { edgeRateLimitKey } from "../lib/edge-rate-limit";
import { authorizedMaintenanceRequest } from "../lib/maintenance-auth";
import { MAINTENANCE_CRON, maintenanceNeedsAttention, parseMaintenanceInvocation } from "../lib/scheduled-maintenance";
import { sampleRankHistory, type RankHistoryPoint } from "../lib/rank-history";

test("normalizes public destinations and stable X handles", () => {
  assert.equal(normalizeDestination("Example.COM/launch/?utm=x#hero"), "https://example.com/launch");
  assert.equal(normalizeDestination("@Founder_1"), "https://x.com/founder_1");
});

test("rejects private, credentialed, and non-http destinations", () => {
  for (const input of ["localhost:3000", "http://127.0.0.1", "http://192.168.1.4", "https://user:pass@example.com", "javascript:alert(1)", "http://[fc00::1]", "http://[fd12::1]", "http://[fe80::1]", "http://[::1]"]) {
    assert.throws(() => normalizeDestination(input));
  }
});

test("accepts public domains that merely begin with private IPv6 prefixes", () => {
  assert.equal(normalizeDestination("fd.io"), "https://fd.io/");
  assert.equal(normalizeDestination("https://fdroid.org"), "https://fdroid.org/");
  assert.equal(normalizeDestination("fda.gov"), "https://fda.gov/");
  assert.equal(normalizeDestination("fcbarcelona.com"), "https://fcbarcelona.com/");
  assert.equal(normalizeDestination("fe80host.example"), "https://fe80host.example/");
});

test("checkout validation is strict and produces a normalized payload", () => {
  assert.deepEqual(parseCheckoutInput({
    title: "  Signal   Works ", destination: "signal.example", category: "ai", amountCents: 500, acceptedRules: true,
    productKind: "open_source", repositoryUrl: "https://github.com/signal/works",
    countryCode: "tr", fundingUrl: "https://github.com/sponsors/signal",
  }), {
    title: "Signal Works", destination: "https://signal.example/", category: "ai", amountCents: 500, acceptedRules: true,
    productKind: "open_source", repositoryUrl: "https://github.com/signal/works",
    countryCode: "TR", fundingUrl: "https://github.com/sponsors/signal", fundingProvider: "github_sponsors",
    contributionOpportunity: null,
  });
  assert.throws(() => parseCheckoutInput({ title: "X", destination: "example.com", category: "ai", amountCents: 500, acceptedRules: true }));
  assert.throws(() => parseCheckoutInput({ title: "Valid", destination: "example.com", category: "crypto", amountCents: 500, acceptedRules: true }));
  assert.throws(() => parseCheckoutInput({ title: "Valid", destination: "example.com", category: "ai", amountCents: 499, acceptedRules: true }));
  assert.throws(() => parseCheckoutInput({ title: "Valid", destination: "example.com", category: "ai", amountCents: 500, acceptedRules: false }));
  assert.throws(() => parseCheckoutInput({ title: "Valid", destination: "example.com", category: "ai", amountCents: 500, acceptedRules: true, productKind: "commercial" }));
  assert.throws(() => parseCheckoutInput({ title: "Valid", destination: "example.com", category: "ai", amountCents: 500, acceptedRules: true, productKind: "open_source" }));
});

test("upvote purchases must be whole $5 tokens, not off-grid cent amounts", () => {
  // The UI always sends amountCents = quantity * UPVOTE_PRICE_CENTS, but these
  // validators guard the untrusted public API boundary. An off-grid amount that
  // is not a whole number of upvotes must be rejected on both the checkout and
  // quote paths so the pricing invariant holds server-side.
  const valid = { title: "Signal Works", destination: "example.com", category: "ai", acceptedRules: true, productKind: "open_source", repositoryUrl: "https://github.com/signal/works" } as const;
  assert.equal(parseCheckoutInput({ ...valid, amountCents: 1000 }).amountCents, 1000);
  assert.equal(parseCheckoutInput({ ...valid, amountCents: 5_000_000 }).amountCents, 5_000_000);
  for (const amountCents of [501, 750, 999, 1001, 4_999_999]) {
    assert.throws(() => parseCheckoutInput({ ...valid, amountCents }), MarketInputError, `checkout must reject ${amountCents}`);
  }

  const quote = { destination: "example.com", category: "developer", productKind: "open_source" } as const;
  assert.equal(parseRankQuoteInput({ ...quote, amountCents: 1500 }).amountCents, 1500);
  for (const amountCents of [501, 750, 1001]) {
    assert.throws(() => parseRankQuoteInput({ ...quote, amountCents }), MarketInputError, `quote must reject ${amountCents}`);
  }
});

test("project profiles validate countries and canonical external funding links", () => {
  assert.equal(normalizeCountryCode("tr"), "TR");
  assert.equal(normalizeCountryCode(""), null);
  assert.throws(() => normalizeCountryCode("XX"));
  assert.deepEqual(normalizeFunding("https://opencollective.com/babel"), {
    fundingUrl: "https://opencollective.com/babel",
    fundingProvider: "open_collective",
  });
  assert.throws(() => normalizeFunding("http://github.com/sponsors/person"));
  assert.throws(() => normalizeFunding("https://example.com/donate"));
  assert.throws(() => normalizeFunding("https://github.com/sponsors/person?ref=tracking"));
  const ownedFunding = { countryCode: null, ...normalizeFunding("https://github.com/sponsors/person") };
  assert.doesNotThrow(() => requireFundingPublisher(ownedFunding, "Person"));
  assert.doesNotThrow(() => requireFundingPublisher(ownedFunding, ["maintainer", "person"]));
  assert.throws(() => requireFundingPublisher(ownedFunding, "someone-else"));
});

test("country community routes use valid ISO records and public data boundaries", () => {
  assert.equal(isCountryCode("TR"), true);
  assert.equal(isCountryCode("tr"), true);
  assert.equal(isCountryCode("XX"), false);
  assert.notEqual(countryName("TR"), "TR");
  const route = readFileSync(new URL("../app/api/countries/route.ts", import.meta.url), "utf8");
  assert.match(route, /status = 'active'/);
  assert.match(route, /product_kind = 'open_source'/);
  assert.match(route, /is_public = true/);
  assert.match(route, /s-maxage=60/);
});

test("rank quotes only accept open-source projects", () => {
  assert.equal(parseRankQuoteInput({
    destination: "example.com",
    category: "developer",
    amountCents: 500,
    productKind: "open_source",
  }).productKind, "open_source");
  assert.throws(() => parseRankQuoteInput({
    destination: "example.com",
    category: "developer",
    amountCents: 500,
    productKind: "commercial",
  }));
});

test("OSI catalog responses require an exact SPDX identifier", () => {
  assert.equal(containsOsiApprovedLicense([{ spdx_id: "MIT" }], "MIT"), true);
  assert.equal(containsOsiApprovedLicense({ licenses: [{ spdx_id: "Apache-2.0" }] }, "apache-2.0"), true);
  assert.equal(containsOsiApprovedLicense([{ spdx_id: "MIT-0" }], "MIT"), false);
  assert.equal(containsOsiApprovedLicense({ error: "not found" }, "MIT"), false);
});

test("organization repository authorization is explicit and bound to a GitHub user", () => {
  assert.equal(matchesRepositoryAuthorization({
    type: "bidstage_repository_authorization",
    version: 1,
    github_user_id: 12345,
  }, 12345), true);
  assert.equal(matchesRepositoryAuthorization({
    type: "bidstage_repository_authorization",
    version: 1,
    github_user_id: 12345,
  }, 54321), false);
  assert.equal(matchesRepositoryAuthorization({ github_user_id: 12345 }, 12345), false);
});

test("contributor profiles are opt-in and normalize unique skills", () => {
  assert.deepEqual(normalizeContributorSkills(["TypeScript", " typescript ", "Rust"]), ["TypeScript", "Rust"]);
  assert.deepEqual(parseContributorProfile({
    headline: "  Documentation and TypeScript contributor ",
    bio: "I maintain developer guides and test SDKs.",
    countryCode: "tr",
    skills: ["TypeScript", "Documentation"],
    availability: "limited",
    isPublic: true,
  }), {
    headline: "Documentation and TypeScript contributor",
    bio: "I maintain developer guides and test SDKs.",
    countryCode: "TR",
    skills: ["TypeScript", "Documentation"],
    availability: "limited",
    isPublic: true,
  });
  assert.throws(() => parseContributorProfile({ headline: "Hi", skills: [], availability: "available", isPublic: true }));
  assert.throws(() => normalizeContributorSkills(["valid", "<script>"]));
});

test("contribution opportunities stay inside the verified repository", () => {
  const opportunity = parseContributionOpportunity(
    "https://github.com/open-source/project/issues?q=label%3Ahelp-wanted",
    "Help triage reproducible Windows installation failures.",
  );
  assert.deepEqual(opportunity, {
    contributionUrl: "https://github.com/open-source/project/issues?q=label%3Ahelp-wanted",
    contributionNote: "Help triage reproducible Windows installation failures.",
  });
  assert.doesNotThrow(() => requireOpportunityRepository(opportunity, "open-source", "project"));
  assert.throws(() => requireOpportunityRepository(opportunity, "another-org", "project"));
  assert.throws(() => parseContributionOpportunity("https://example.com/issues", "A valid contribution request."));
  assert.throws(() => parseContributionOpportunity("", "A request without a URL."));
});

test("listing slugs are deterministic and destination-specific", () => {
  assert.equal(listingSlug("https://example.com/one"), listingSlug("https://example.com/one"));
  assert.notEqual(listingSlug("https://example.com/one"), listingSlug("https://example.com/two"));
  assert.match(listingSlug("https://example.com/one"), /^example-[a-f0-9]{8}$/);
});

test("only the recorded founder can edit a non-removed listing", () => {
  assert.equal(founderCanEditListing("founder-a", "founder-a", "active"), true);
  assert.equal(founderCanEditListing("founder-a", "founder-a", "review"), true);
  assert.equal(founderCanEditListing("founder-a", "founder-b", "active"), false);
  assert.equal(founderCanEditListing("founder-a", null, "active"), false);
  assert.equal(founderCanEditListing("founder-a", "founder-a", "removed"), false);
  assert.equal(founderCanEditListing("founder-a", "founder-a", null), false);
});

test("repeat placements preserve the active project identity and use a bounded prefill route", () => {
  const input = parseCheckoutInput({
    title: "Signal Works",
    destination: "signal.example",
    category: "ai",
    amountCents: 500,
    acceptedRules: true,
    productKind: "open_source",
    repositoryUrl: "https://github.com/signal/works",
    countryCode: "TR",
    fundingUrl: "https://github.com/sponsors/signal",
    contributionUrl: "https://github.com/signal/works/issues/42",
    contributionNote: "Help verify the next Linux release.",
  });
  const identity = {
    title: input.title,
    destination: input.destination,
    category: input.category,
    product_kind: "open_source" as const,
    github_repository_id: "9123",
    country_code: input.countryCode,
    funding_provider: input.fundingProvider,
    funding_url: input.fundingUrl,
    contribution_url: input.contributionOpportunity?.contributionUrl ?? null,
    contribution_note: input.contributionOpportunity?.contributionNote ?? null,
  };
  assert.equal(existingPlacementMatches(identity, input, "9123"), true);
  assert.equal(existingPlacementMatches({ ...identity, category: "developer" }, input, "9123"), false);
  assert.equal(existingPlacementMatches({ ...identity, contribution_note: "Changed outside the editor" }, input, "9123"), false);

  const route = readFileSync(
    new URL("../app/api/listings/[slug]/placement/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /status = 'active'/);
  assert.match(route, /product_kind = 'open_source'/);
  assert.match(route, /github_url IS NOT NULL/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /founder_id|payer|email|provider_checkout/);

  const account = readFileSync(new URL("../components/founder-account.tsx", import.meta.url), "utf8");
  assert.match(account, /listingStatus === "active"[\s\S]+Add placement/);
  const board = readFileSync(new URL("../components/bid-board.tsx", import.meta.url), "utf8");
  assert.match(board, /Existing active project/);
  assert.match(board, /Project identity stays fixed/);
  assert.match(board, /placementLoading \|\| Boolean\(placementError\)/);

  const checkout = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  assert.match(checkout, /existingPlacementMatches\(conflict, input, String\(repository\.id\)\)/);
});

test("checkout is gated off by an explicit fail-fast CHECKOUT_ENABLED guard", () => {
  const checkout = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  // The off-switch must be an explicit early return, not an implicit side effect
  // of the Turnstile path, and must run before any provider checkout is created.
  const gate = checkout.match(/if \(!env\.checkoutEnabled\) \{[\s\S]*?"checkout_disabled"[\s\S]*?\}/);
  assert.ok(gate, "checkout route must return checkout_disabled when checkout is off");
  assert.ok(
    checkout.indexOf("!env.checkoutEnabled") < checkout.indexOf("createPlacementCheckout("),
    "the checkout_disabled gate must run before createPlacementCheckout",
  );
});

test("webhook incident references are stable and do not expose provider event IDs", () => {
  const incident = webhookIncidentId("evt_creem_sensitive_123");
  assert.equal(incident, webhookIncidentId("evt_creem_sensitive_123"));
  assert.match(incident, /^[a-f0-9]{12}$/);
  assert.notEqual(incident, webhookIncidentId("evt_creem_sensitive_124"));
  assert.equal(incident.includes("creem"), false);
});

test("Dodo Standard Webhooks signatures verify raw bodies and reject replay", () => {
  const key = Buffer.from("0123456789abcdef0123456789abcdef");
  const secret = `whsec_${key.toString("base64")}`;
  const id = "msg_dodo_123456";
  const timestamp = "1787490000";
  const body = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_123" } });
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  const headers = { id, timestamp, signature: `v2,ignored v1,${signature}` };

  assert.equal(verifyDodoWebhookSignature(body, headers, secret, 1787490000), true);
  assert.equal(verifyDodoWebhookSignature(`${body} `, headers, secret, 1787490000), false);
  assert.equal(verifyDodoWebhookSignature(body, headers, secret, 1787490301), false);
});

test("Dodo checkout redirects stay on the configured environment hosts", () => {
  assert.equal(
    trustedDodoCheckoutUrl("https://test.dodopayments.com/session/cks_123", true),
    "https://test.dodopayments.com/session/cks_123",
  );
  assert.equal(trustedDodoCheckoutUrl("https://live.dodopayments.com/session/cks_123", true), null);
  assert.equal(trustedDodoCheckoutUrl("https://user@checkout.dodopayments.com/session/cks_123", false), null);
  assert.equal(trustedDodoCheckoutUrl("https://dodopayments.com.evil.example/session/cks_123", false), null);
});

test("contribution applications require authored plain-text intent and valid transitions", () => {
  assert.equal(
    parseContributionApplicationMessage("  I can reproduce this issue and add a focused regression test.  "),
    "I can reproduce this issue and add a focused regression test.",
  );
  assert.equal(parseContributionApplicationAction("accept"), "accept");
  assert.throws(() => parseContributionApplicationMessage("Too short"));
  assert.throws(() => parseContributionApplicationMessage("I can help with this <script> unsafe markup."));
  assert.throws(() => parseContributionApplicationAction("reopen"));
});

test("request subjects validate proxy IPs and isolate missing-IP clients", () => {
  const cloudflare = new Request("https://bidstage.app/api/quote", {
    headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "Browser A" },
  });
  const spoofed = new Request("https://bidstage.app/api/quote", {
    headers: { "x-forwarded-for": "not-an-ip", "user-agent": "Browser A" },
  });
  const another = new Request("https://bidstage.app/api/quote", {
    headers: { "user-agent": "Browser B" },
  });

  assert.equal(requestIp(cloudflare), "203.0.113.9");
  assert.equal(requestSubject(cloudflare), "ip:203.0.113.9");
  assert.equal(requestIp(new Request("https://bidstage.app", { headers: { "x-real-ip": "2001:db8::5" } })), "2001:db8::5");
  assert.equal(requestIp(new Request("https://bidstage.app", { headers: { "x-real-ip": "999.0.0.1" } })), undefined);
  assert.equal(requestIp(spoofed), undefined);
  assert.match(requestSubject(spoofed), /^client:[a-f0-9]{64}$/);
  assert.notEqual(requestSubject(spoofed), requestSubject(another));
});

test("placement appeals are a formal support category with normalized messages", () => {
  assert.equal(isSupportCategory("appeal"), true);
  assert.equal(isSupportCategory("chargeback_now"), false);
  assert.equal(
    normalizeSupportMessage("  The project is compliant, and I can provide the missing authorization proof.  "),
    "The project is compliant, and I can provide the missing authorization proof.",
  );
  assert.throws(() => normalizeSupportMessage("Not enough detail."));
});

test("privacy requests accept only bounded, explicit account-data actions", () => {
  assert.deepEqual(parsePrivacyRequest({
    requestType: "deletion",
    details: "  Remove my public contributor profile and review retained account data.  ",
  }), {
    requestType: "deletion",
    details: "Remove my public contributor profile and review retained account data.",
  });
  assert.equal(privacyRequestLabel("restriction"), "Restrict account-data processing");
  assert.throws(() => parsePrivacyRequest({ requestType: "download_everything", details: "A valid request with enough detail." }));
  assert.throws(() => parsePrivacyRequest({ requestType: "access", details: "Too short" }));
  assert.throws(() => parsePrivacyRequest({ requestType: "access", details: "x".repeat(1201) }));
});

test("accepted application follow-up stays concise plain text", () => {
  assert.equal(parseContributionFollowupMessage("  Please open the draft PR against the main branch.  "), "Please open the draft PR against the main branch.");
  assert.throws(() => parseContributionFollowupMessage("no"));
  assert.throws(() => parseContributionFollowupMessage("Open <a>this link</a>."));
});

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[a-f0-9]{2}/gi)?.map((part) => Number.parseInt(part, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

test("shared page chrome preserves keyboard and contrast accessibility contracts", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.match(layout, /className="skip-link" href="#main-content"/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /\.skip-link:focus/);
  assert.match(styles, /\*,\*::before,\*::after/);
  assert.ok(contrastRatio("5f5c55", "E8E0C0") >= 4.5);
  assert.ok(contrastRatio("5f5c55", "EDE4CF") >= 4.5);

  for (const path of [
    "../components/bid-board.tsx",
    "../components/contributor-directory.tsx",
    "../components/opportunity-directory.tsx",
    "../components/founder-account.tsx",
    "../components/receipt-status.tsx",
    "../components/support-case-status.tsx",
    "../app/not-found.tsx",
    "../app/error.tsx",
    "../app/auth/error/page.tsx",
    "../app/legal/[document]/page.tsx",
    "../app/listing/[slug]/page.tsx",
  ]) {
    const page = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(page, /<main[^>]*id="main-content"/);
  }
});

test("release audit fails closed on migration drift and missing security headers", () => {
  const migrations = auditMigrationNames(
    ["0001_initial.sql", "0002_receipts.sql"],
    ["0001_initial.sql", "0003_unknown.sql"],
  );
  assert.equal(migrations.every((check) => check.status === "pass"), false);
  assert.match(migrations[1]!.detail, /0002_receipts\.sql/);

  const headers = new Headers({
    "Content-Security-Policy": "default-src 'self'; script-src-attr 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  });
  assert.equal(auditResponseHeaders(headers).every((check) => check.status === "pass"), true);
  headers.delete("content-security-policy");
  assert.equal(auditResponseHeaders(headers).find((check) => check.name === "content security policy")?.status, "fail");
});

function dnsAddressResponse(hostname: string, type: 1 | 16 | 28, address: number[]): ArrayBuffer {
  const query = buildDnsQuery(hostname, type);
  const response = new Uint8Array(query.length + 12 + address.length);
  response.set(query);
  const view = new DataView(response.buffer);
  view.setUint16(2, 0x8180);
  view.setUint16(6, 1);
  let offset = query.length;
  view.setUint16(offset, 0xc00c); offset += 2;
  view.setUint16(offset, type); offset += 2;
  view.setUint16(offset, 1); offset += 2;
  view.setUint32(offset, 60); offset += 4;
  view.setUint16(offset, address.length); offset += 2;
  response.set(address, offset);
  return response.buffer;
}

test("destination DNS review accepts only globally routable A and AAAA records", () => {
  assert.equal(isPublicIpAddress("104.16.132.229"), true);
  assert.equal(isPublicIpAddress("10.0.0.1"), false);
  assert.equal(isPublicIpAddress("100.64.0.1"), false);
  assert.equal(isPublicIpAddress("192.0.2.10"), false);
  assert.equal(isPublicIpAddress("2606:4700::6810:84e5"), true);
  assert.equal(isPublicIpAddress("2001:db8::1"), false);
  assert.equal(isPublicIpAddress("2001::1"), false);
  assert.equal(isPublicIpAddress("2002:c000:0204::1"), false);
  assert.equal(isPublicIpAddress("3fff::1"), false);
  assert.equal(isPublicIpAddress("fc00::1"), false);
  assert.equal(isPublicIpAddress("::ffff:127.0.0.1"), false);

  assert.deepEqual(
    parseDnsAddressResponse(dnsAddressResponse("example.com", 1, [93, 184, 216, 34])),
    { responseCode: 0, addresses: ["93.184.216.34"] },
  );
  const txt = "bidstage-verification=0123456789abcdef";
  assert.deepEqual(
    parseDnsTxtResponse(dnsAddressResponse("_bidstage-challenge.example.com", 16, [txt.length, ...Buffer.from(txt)])),
    { responseCode: 0, values: [txt] },
  );
  assert.deepEqual(
    parseDnsAddressResponse(dnsAddressResponse("example.com", 28, [
      0x26, 0x06, 0x28, 0x00, 0x02, 0x20, 0x00, 0x01,
      0x02, 0x48, 0x18, 0x93, 0x25, 0xc8, 0x19, 0x46,
    ])).addresses,
    ["2606:2800:220:1:248:1893:25c8:1946"],
  );
  assert.throws(() => parseDnsAddressResponse(new ArrayBuffer(4)));
  assert.throws(() => buildDnsQuery("invalid_host.example", 1));
});

test("scheduled destination rechecks separate unsafe changes from resolver outages", async () => {
  const passed = await inspectDestinationResolution("https://project.example", async () => ({
    addresses: ["2606:4700::6810:84e5", "104.16.132.229", "104.16.132.229"],
  }));
  assert.equal(passed.state, "passed");
  assert.equal(passed.addressCount, 2);
  assert.match(passed.addressFingerprint ?? "", /^[a-f0-9]{64}$/);

  assert.deepEqual(
    await inspectDestinationResolution("https://project.example", async () => ({ addresses: [] })),
    { state: "rejected", addressCount: null, addressFingerprint: null, errorCode: "unresolved_destination" },
  );
  assert.deepEqual(
    await inspectDestinationResolution("https://project.example", async () => {
      throw new DestinationSafetyError("private answer", "non_public_address");
    }),
    { state: "rejected", addressCount: null, addressFingerprint: null, errorCode: "non_public_address" },
  );
  assert.deepEqual(
    await inspectDestinationResolution("https://project.example", async () => {
      throw new Error("resolver unavailable");
    }),
    { state: "failed", addressCount: null, addressFingerprint: null, errorCode: "dns_unavailable" },
  );
});

test("Cloudflare destination reports bind the target and fail closed on unsafe findings", () => {
  const scanId = "095be615-a8ad-4c33-8e9c-c7612fbf6c9f";
  const report = {
    task: { uuid: scanId, url: "https://example.com/", success: true },
    page: {
      url: "https://www.example.com/docs",
      ip: "93.184.216.34",
      status: "200",
      history: [
        { url: "https://example.com/" },
        { url: "https://www.example.com/docs" },
      ],
    },
    data: { requests: [] },
    verdicts: {
      overall: {
        hasVerdicts: true,
        malicious: false,
        categories: ["Technology", "Technology", "<unsafe>"],
        tags: ["Open Source"],
      },
    },
  };
  const finding = parseDestinationScanReport(report, scanId, "https://example.com");
  assert.equal(finding.state, "passed");
  assert.equal(finding.finalOrigin, "https://www.example.com");
  assert.equal(finding.redirectCount, 1);
  assert.match(finding.redirectChainFingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(finding.categories, ["Technology", "unsafe"]);
  assert.equal(
    destinationFingerprint("https://example.com"),
    destinationFingerprint("https://example.com/"),
  );

  const malicious = structuredClone(report);
  malicious.verdicts.overall.malicious = true;
  assert.equal(parseDestinationScanReport(malicious, scanId, "https://example.com").state, "rejected");

  const privateAddress = structuredClone(report);
  privateAddress.page.ip = "10.0.0.8";
  assert.equal(
    parseDestinationScanReport(privateAddress, scanId, "https://example.com").errorCode,
    "non_public_primary_ip",
  );

  const insecureRedirect = structuredClone(report);
  insecureRedirect.page.url = "http://www.example.com/docs";
  assert.equal(
    parseDestinationScanReport(insecureRedirect, scanId, "https://example.com").errorCode,
    "unsafe_final_url",
  );

  const insecureIntermediateRedirect = structuredClone(report);
  insecureIntermediateRedirect.page.history = [
    { url: "https://example.com/" },
    { url: "http://redirect.example.com/hop" },
    { url: "https://www.example.com/docs" },
  ];
  assert.equal(
    parseDestinationScanReport(insecureIntermediateRedirect, scanId, "https://example.com").errorCode,
    "unsafe_redirect_chain",
  );

  const noVerdict = structuredClone(report);
  noVerdict.verdicts.overall.hasVerdicts = false;
  assert.equal(
    parseDestinationScanReport(noVerdict, scanId, "https://example.com").errorCode,
    "verdict_missing",
  );

  assert.throws(() => parseDestinationScanReport(report, scanId, "https://different.example"));
});

test("destination activation is structurally gated by minimal scan evidence", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0019_destination_security_reviews.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /state = 'passed'/);
  assert.match(migration, /has_verdicts = true/);
  assert.match(migration, /malicious = false/);
  assert.match(migration, /expires_at > completed_at/);
  assert.doesNotMatch(migration, /\b(?:screenshot|cookies|response_body|request_logs?)\s+(?:text|jsonb|bytea)/i);

  const operator = readFileSync(new URL("../scripts/operator.ts", import.meta.url), "utf8");
  assert.match(operator, /destination_fingerprint = \$2[\s\S]+state = 'passed'/);
  assert.match(operator, /has_verdicts = true/);
  assert.match(operator, /malicious = false/);
  assert.match(operator, /expires_at > now\(\)/);
  assert.match(operator, /hostname = \$2/);
});

test("privacy governance is authenticated, auditable, and tied to published retention", () => {
  const migration = readFileSync(new URL("../db/migrations/0020_privacy_requests.sql", import.meta.url), "utf8");
  assert.match(migration, /REFERENCES founder_accounts\(id\)/);
  assert.match(migration, /state IN \('open', 'in_progress'\)/);
  assert.match(migration, /operator_response IS NOT NULL/);

  const route = readFileSync(new URL("../app/api/account/privacy-requests/route.ts", import.meta.url), "utf8");
  assert.match(route, /authenticatedFounder\(request\)/);
  assert.match(route, /takeRateLimit\("privacy_request"/);
  assert.match(route, /private, no-store/);
  assert.match(route, /request\.headers\.get\("origin"\)/);

  const operator = readFileSync(new URL("../scripts/operator.ts", import.meta.url), "utf8");
  assert.match(operator, /state = 'in_progress'[\s\S]+assigned_operator_id = \$2/);
  assert.match(operator, /assigned_operator_id = \$4/);
  assert.match(operator, /\$2 = 'declined' OR request_type <> 'deletion'/);
  assert.match(operator, /privacy\.account_minimized/);
  assert.match(operator, /responseFingerprint/);
  assert.match(operator, /interval '3 years'/);

  const legal = readFileSync(new URL("../app/legal/[document]/page.tsx", import.meta.url), "utf8");
  for (const policy of ["refunds", "retention", "processors"]) assert.match(legal, new RegExp(`${policy}:`));
  assert.match(legal, /respond within 30 days/);
});

test("edge write limiting uses private scoped keys before database work", () => {
  const hash = (value: string) => createHmac("sha256", "test-only-edge-secret").update(value).digest("hex");
  const authorized = new Request("https://bidstage.app/api/support/case/messages", {
    headers: {
      authorization: "Bearer private-support-token",
      cookie: "bidstage_session=private-session-token",
      "cf-connecting-ip": "203.0.113.24",
    },
  });
  const first = edgeRateLimitKey(authorized, "support_reply", hash);
  const second = edgeRateLimitKey(authorized, "support_reply", hash);
  const otherBucket = edgeRateLimitKey(authorized, "checkout", hash);
  assert.equal(first, second);
  assert.notEqual(first, otherBucket);
  assert.match(first, /^support_reply:[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /private-support-token|private-session-token|203\.0\.113\.24/);
  assert.throws(() => edgeRateLimitKey(authorized, "Invalid Bucket", hash));

  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"name": "EDGE_WRITE_RATE_LIMITER"/);
  assert.match(config, /"namespace_id": "284712001"/);
  assert.match(config, /"limit": 20[\s\S]+"period": 60/);

  for (const path of [
    "../app/api/checkout/route.ts",
    "../app/api/support/route.ts",
    "../app/api/support/[reference]/messages/route.ts",
    "../app/api/receipts/[reference]/verification/route.ts",
    "../app/api/opportunities/[slug]/applications/route.ts",
    "../app/api/account/contributor-profile/route.ts",
    "../app/api/account/listings/[slug]/route.ts",
    "../app/api/account/applications/[id]/route.ts",
    "../app/api/account/applications/[id]/messages/route.ts",
    "../app/api/account/privacy-requests/route.ts",
    "../app/api/account/privacy-requests/[reference]/route.ts",
  ]) {
    const route = readFileSync(new URL(path, import.meta.url), "utf8");
    const edgeIndex = route.indexOf("enforceEdgeWriteRateLimit(request");
    const databaseIndexes = [
      route.indexOf("takeRateLimit(", edgeIndex),
      route.indexOf("authenticatedFounder(request)", edgeIndex),
    ]
      .filter((index) => index >= 0);
    assert.ok(edgeIndex >= 0, `${path} must use the edge limiter`);
    assert.ok(databaseIndexes.every((index) => edgeIndex < index), `${path} must gate before database work`);
  }

  for (const path of ["../app/api/webhooks/creem/route.ts", "../app/api/webhooks/dodo/route.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), /enforceEdgeWriteRateLimit/);
  }
});

test("scheduled maintenance is authenticated, idempotent, and operationally visible", () => {
  const secret = "test-maintenance-secret-that-is-long-enough";
  const request = new Request("https://bidstage.internal/api/internal/maintenance", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(authorizedMaintenanceRequest(request, secret), true);
  assert.equal(authorizedMaintenanceRequest(request, `${secret}-wrong`), false);
  assert.equal(authorizedMaintenanceRequest(new Request(request.url), secret), false);

  const scheduledAt = Date.UTC(2026, 7, 23, 19, 15);
  assert.deepEqual(
    parseMaintenanceInvocation({ scheduledAt, cron: MAINTENANCE_CRON }, scheduledAt),
    { scheduledAt: new Date(scheduledAt), cron: MAINTENANCE_CRON },
  );
  assert.throws(() => parseMaintenanceInvocation({ scheduledAt, cron: "* * * * *" }, scheduledAt));
  assert.throws(() => parseMaintenanceInvocation({ scheduledAt: scheduledAt + 60_000, cron: MAINTENANCE_CRON }, scheduledAt));
  assert.throws(() => parseMaintenanceInvocation({ scheduledAt: scheduledAt - 86_400_001, cron: MAINTENANCE_CRON }, scheduledAt));
  assert.equal(maintenanceNeedsAttention({
    stuck_payment_events: 0,
    stale_checkouts: 4,
    stuck_destination_scans: 0,
    destination_recheck_failures: 0,
    overdue_privacy_requests: 0,
  }), false);
  assert.equal(maintenanceNeedsAttention({
    stuck_payment_events: 1,
    stale_checkouts: 0,
    stuck_destination_scans: 0,
    destination_recheck_failures: 0,
    overdue_privacy_requests: 0,
  }), true);

  const migration = readFileSync(new URL("../db/migrations/0021_scheduled_maintenance.sql", import.meta.url), "utf8");
  assert.match(migration, /scheduled_at timestamptz NOT NULL UNIQUE/);
  assert.match(migration, /state IN \('running', 'completed', 'attention', 'failed'\)/);
  assert.match(migration, /jsonb_typeof\(cleanup_counts\) = 'object'/);

  const route = readFileSync(new URL("../app/api/internal/maintenance/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("authorizedMaintenanceRequest") < route.indexOf("boundedJson(request)"));
  assert.match(route, /size > MAX_BODY_BYTES[\s\S]+reader\.cancel/);
  assert.match(route, /Cache-Control.*private, no-store/);

  const worker = readFileSync(new URL("../custom-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /await env\.WORKER_SELF_REFERENCE\.fetch/);
  assert.match(worker, /controller\.scheduledTime/);
  assert.match(worker, /maintenance\.completed/);
  assert.doesNotMatch(worker, /console\.(?:log|error)\([^\n]*secret/i);

  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"main": "custom-worker\.ts"/);
  assert.match(config, /"crons": \["15 \* \* \* \*"\]/);
  assert.match(config, /"logs": \{[\s\S]+"head_sampling_rate": 1/);

  const audit = readFileSync(new URL("../scripts/release-audit.ts", import.meta.url), "utf8");
  assert.match(audit, /scheduled maintenance is current/);
  assert.match(audit, /state = 'running'[\s\S]+interval '30 minutes'/);
  const health = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  assert.match(health, /maintenanceReadiness\(\)/);

  const recheckMigration = readFileSync(new URL("../db/migrations/0023_listing_destination_rechecks.sql", import.meta.url), "utf8");
  assert.match(recheckMigration, /state IN \('passed', 'rejected', 'failed'\)/);
  assert.match(recheckMigration, /address_fingerprint[\s\S]+\^\[a-f0-9\]\{64\}\$/);
  assert.match(recheckMigration, /error_code IN \('invalid_hostname', 'non_public_address', 'unresolved_destination'\)/);
  assert.match(recheckMigration, /state = 'failed'[\s\S]+error_code = 'dns_unavailable'/);
  assert.doesNotMatch(recheckMigration, /\baddress(?:es)?\s+(?:text|json|jsonb|inet)/i);

  const rechecks = readFileSync(new URL("../lib/destination-rechecks.ts", import.meta.url), "utf8");
  assert.match(rechecks, /MAX_RECHECKS_PER_RUN = 20/);
  assert.match(rechecks, /DESTINATION_RECHECK_CONCURRENCY = 2/);
  assert.match(rechecks, /status = 'active'[\s\S]+product_kind = 'open_source'/);
  assert.match(rechecks, /'suspend', 'destination_dns_unsafe'/);
  assert.match(rechecks, /outcome\.state !== "rejected"/);

  const scheduled = readFileSync(new URL("../lib/scheduled-maintenance.ts", import.meta.url), "utf8");
  assert.ok(scheduled.indexOf("runDestinationRechecks") < scheduled.indexOf("const result = await transaction"));
  assert.match(scheduled, /listing_destination_rechecks[\s\S]+interval '400 days'/);
  assert.match(audit, /active destinations have current DNS safety evidence/);
  assert.match(audit, /rejected DNS destinations leave the active board/);
  assert.match(audit, /hourly DNS recheck capacity/);
});

test("public crawl routes expose real open-source records and exclude private flows", () => {
  const robots = readFileSync(new URL("../app/robots.ts", import.meta.url), "utf8");
  assert.match(robots, /sitemap: `\$\{SITE_URL\}\/sitemap\.xml`/);
  for (const path of ["/api/", "/account", "/auth/", "/go/", "/receipt/", "/support/"]) {
    assert.ok(robots.includes(`"${path}"`), `robots must exclude ${path}`);
  }

  const sitemap = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  assert.match(sitemap, /CATEGORIES\.map/);
  assert.match(sitemap, /status = 'active' AND product_kind = 'open_source'/);
  assert.match(sitemap, /LIMIT 49000/);
  assert.doesNotMatch(sitemap, /receipt|support|account/);

  const category = readFileSync(new URL("../app/category/[category]/page.tsx", import.meta.url), "utf8");
  assert.match(category, /status = 'active' AND product_kind = 'open_source' AND category = \$1/);
  assert.match(category, /Paid rank stays labeled/);
  assert.doesNotMatch(category, /sample|placeholder|example\.com/i);

  const listing = readFileSync(new URL("../app/listing/[slug]/page.tsx", import.meta.url), "utf8");
  assert.match(listing, /alternates: \{ canonical: `\/listing\/\$\{slug\}` \}/);
  assert.match(listing, /SoftwareSourceCode/);
  assert.match(listing, /BreadcrumbList/);
});

test("manual production verification requires isolated PostgreSQL and deployed HTTP", () => {
  const packageManifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.match(packageManifest.scripts["test:integration"] ?? "", /BIDSTAGE_REQUIRE_INTEGRATION=1/);
  assert.match(packageManifest.scripts.verify ?? "", /test:integration/);
  assert.match(packageManifest.scripts["smoke:http"] ?? "", /http-smoke/);
  assert.match(packageManifest.scripts["create:hyperdrive"] ?? "", /create-hyperdrive\.zsh/);
  assert.match(packageManifest.scripts["deploy:worker"] ?? "", /preflight:production/);
  assert.match(packageManifest.scripts["deploy:worker"] ?? "", /--secrets-file \.secrets\.production/);

  const integration = readFileSync(new URL("./integration/database.test.ts", import.meta.url), "utf8");
  assert.match(integration, /databaseName\.includes\("test"\)/);
  assert.match(integration, /CREATE SCHEMA/);
  assert.match(integration, /DROP SCHEMA IF EXISTS/);
  assert.match(integration, /Promise\.all\(\[first, second\]/);
  assert.match(integration, /event_settle_first_retry/);
  assert.match(integration, /does not match the checkout intent/);
  assert.match(integration, /event_refund_300/);

  const smoke = readFileSync(new URL("../scripts/http-smoke.ts", import.meta.url), "utf8");
  assert.match(smoke, /health\.database === "ready"/);
  assert.match(smoke, /auth error page is indexable/);
  assert.match(smoke, /auditResponseHeaders/);
  assert.match(smoke, /sitemap exposes a private route/);

  const deployment = readFileSync(new URL("../DEPLOYMENT.md", import.meta.url), "utf8");
  assert.match(deployment, /TEST_DATABASE_URL=.*bun run test:integration/);
  assert.match(deployment, /SMOKE_BASE_URL=.*bun run smoke:http/);
  assert.equal(existsSync(new URL("../.github/workflows/verify.yml", import.meta.url)), false);

  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, /"account_id": "c7a5b49549dcb64f2e258db485c723ca"/);
  assert.match(wrangler, /"workers_dev": false/);
  assert.match(wrangler, /"secrets": \{[\s\S]+"required": \[/);
  assert.match(wrangler, /"MAINTENANCE_SECRET"/);

  const preflight = readFileSync(new URL("../scripts/production-preflight.ts", import.meta.url), "utf8");
  assert.match(preflight, /BLOCKED_NEXT_VERSIONS = new Set\(\["16\.3\.0"\]\)/);
  assert.match(preflight, /dedicated HYPERDRIVE binding/);
  assert.match(preflight, /chmod 600/);

  const hyperdriveSetup = readFileSync(new URL("../scripts/create-hyperdrive.zsh", import.meta.url), "utf8");
  assert.match(hyperdriveSetup, /\*-pooler\.\*/);
  assert.match(hyperdriveSetup, /--database bidstage/);
  assert.match(hyperdriveSetup, /--origin-user bidstage_runtime/);
  assert.match(hyperdriveSetup, /--update-config/);
  assert.doesNotMatch(hyperdriveSetup, /neondb_owner/);

  const runtimeGrants = readFileSync(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
  assert.match(runtimeGrants, /current_database\(\) = 'bidstage'/);
  assert.match(runtimeGrants, /pg_has_role\('bidstage_runtime', 'neon_superuser', 'member'\)/);
  assert.match(runtimeGrants, /REVOKE CREATE ON SCHEMA public FROM bidstage_runtime/);
  assert.match(runtimeGrants, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
  assert.match(runtimeGrants, /ALTER DEFAULT PRIVILEGES IN SCHEMA public/);

  const database = readFileSync(new URL("../lib/db.ts", import.meta.url), "utf8");
  assert.match(database, /new Client\(\{ connectionString \}\)/);
  assert.match(database, /await client\.end\(\)/);
  assert.match(database, /bidstageNodePool/);
  assert.doesNotMatch(database, /bidstagePool/);
});

test("rank history is compact, public, and captured from deterministic open-source ranks", () => {
  const points = Array.from({ length: 5 }, (_, index): RankHistoryPoint => ({
    capturedAt: new Date(Date.UTC(2026, 7, 20, index)).toISOString(),
    overallRank: index + 1,
    overallEntries: 5,
    categoryRank: index + 1,
    categoryEntries: 5,
    totalCents: index * 500,
    bidCount: index,
  }));
  assert.deepEqual(
    sampleRankHistory(points, 3).map((point) => point.overallRank),
    [1, 3, 5],
  );
  assert.throws(() => sampleRankHistory(points, 1));

  const migration = readFileSync(new URL("../db/migrations/0022_listing_rank_observations.sql", import.meta.url), "utf8");
  assert.match(migration, /PRIMARY KEY \(listing_id, captured_at\)/);
  assert.match(migration, /overall_rank <= overall_entries/);
  assert.match(migration, /category_rank <= category_entries/);
  assert.doesNotMatch(migration, /\b(?:payer_email|provider_checkout|payment_reference)\b/i);

  const maintenance = readFileSync(new URL("../lib/scheduled-maintenance.ts", import.meta.url), "utf8");
  assert.match(maintenance, /status = 'active' AND listing\.product_kind = 'open_source'/);
  assert.match(maintenance, /last_bid_at ASC, listing\.slug ASC/);
  assert.match(maintenance, /latest\.captured_at <= \$1::timestamptz - interval '24 hours'/);
  assert.match(maintenance, /ON CONFLICT \(listing_id, captured_at\) DO NOTHING/);

  const route = readFileSync(new URL("../app/api/listings/[slug]/rank-history/route.ts", import.meta.url), "utf8");
  assert.match(route, /s-maxage=300/);
  assert.match(route, /listing_not_found/);
  assert.doesNotMatch(route, /payer|email|founder_id|destination/);

  const component = readFileSync(new URL("../components/rank-trail.tsx", import.meta.url), "utf8");
  assert.match(component, /role="img"/);
  assert.match(component, /aria-labelledby="rank-chart-title rank-chart-description"/);
  assert.match(component, /Read latest observations/);

  const audit = readFileSync(new URL("../scripts/release-audit.ts", import.meta.url), "utf8");
  assert.match(audit, /active listings have current rank observations/);
});

test("project bidding guide stays tied to the settled open-source ledger", () => {
  const page = readFileSync(new URL("../app/bids/page.tsx", import.meta.url), "utf8");
  assert.match(page, /status = 'active' AND product_kind = 'open_source'/);
  assert.match(page, /sum\(total_cents\)/);
  assert.match(page, /sum\(bid_count\)/);
  assert.match(page, /per upvote/);
  assert.match(page, /Start a placement/);
  assert.match(page, /signed webhook settles the payment/i);
  assert.match(page, /Refund and dispute reversals subtract/);
  assert.match(page, /href="\/#top"/);
  assert.match(page, /href="\/account"/);
  assert.doesNotMatch(page, /government|tender|procurement|SAM\.gov|Contracts Finder|\bTED\b/i);

  const styles = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.bid-formula-slip/);
  assert.match(styles, /\.bid-guide-metrics/);
  assert.doesNotMatch(styles, /\.bid-deadline-edge|\.bids-filters|\.bids-source-note/);

  const audit = readFileSync(new URL("../scripts/release-audit.ts", import.meta.url), "utf8");
  assert.match(audit, /deployed project bidding guide/);
  assert.match(audit, /Buy upvotes/);
  assert.doesNotMatch(audit, /procurement|Contracts Finder|\bTED\b/i);

  const worker = readFileSync(new URL("../custom-worker.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const health = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  const operator = readFileSync(new URL("../scripts/operator.ts", import.meta.url), "utf8");
  for (const source of [worker, config, health, operator]) {
    assert.doesNotMatch(source, /procurement|PROCUREMENT_SECRET|Contracts Finder|\bTED\b/i);
  }
});
