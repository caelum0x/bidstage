import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isLaunchNotifySource,
  normalizeLaunchNotifyEmail,
  normalizeLaunchNotifyRepositoryUrl,
} from "../lib/launch-notify";

test("normalizeLaunchNotifyEmail trims, lowercases, and validates shape", () => {
  assert.equal(normalizeLaunchNotifyEmail("  Founder@Example.COM  "), "founder@example.com");
  assert.equal(normalizeLaunchNotifyEmail("a.b+tag@sub.domain.dev"), "a.b+tag@sub.domain.dev");
});

test("normalizeLaunchNotifyEmail rejects invalid addresses", () => {
  for (const bad of ["", "   ", "plainaddress", "@no-local.dev", "user@", "user@@double.dev", "user@nodot", `a${"x".repeat(255)}@example.com`]) {
    assert.throws(() => normalizeLaunchNotifyEmail(bad), /email/i, `expected rejection: ${JSON.stringify(bad)}`);
  }
  assert.throws(() => normalizeLaunchNotifyEmail(42), /email/i);
  assert.throws(() => normalizeLaunchNotifyEmail(undefined), /email/i);
});

test("normalizeLaunchNotifyRepositoryUrl accepts http(s) URLs and null", () => {
  assert.equal(
    normalizeLaunchNotifyRepositoryUrl("https://github.com/acme/widget"),
    "https://github.com/acme/widget",
  );
  assert.equal(normalizeLaunchNotifyRepositoryUrl("  https://gitlab.com/a/b  "), "https://gitlab.com/a/b");
  // WHATWG-normalized: scheme and host lowercase, path casing preserved.
  assert.equal(
    normalizeLaunchNotifyRepositoryUrl("HTTPS://GitHub.com/Acme/Widget"),
    "https://github.com/Acme/Widget",
  );
  assert.equal(normalizeLaunchNotifyRepositoryUrl(null), null);
  assert.equal(normalizeLaunchNotifyRepositoryUrl(undefined), null);
  assert.equal(normalizeLaunchNotifyRepositoryUrl(""), null);
});

test("normalizeLaunchNotifyRepositoryUrl rejects non-web schemes and oversized values", () => {
  assert.throws(() => normalizeLaunchNotifyRepositoryUrl("javascript:alert(1)"), /repository/i);
  assert.throws(() => normalizeLaunchNotifyRepositoryUrl("ftp://example.com/x"), /repository/i);
  assert.throws(() => normalizeLaunchNotifyRepositoryUrl("not a url"), /repository/i);
  assert.throws(() => normalizeLaunchNotifyRepositoryUrl(`https://example.com/${"x".repeat(600)}`), /repository/i);
  assert.throws(() => normalizeLaunchNotifyRepositoryUrl(42), /repository/i);
});

test("isLaunchNotifySource accepts only known sources", () => {
  assert.equal(isLaunchNotifySource("checkout_disabled"), true);
  assert.equal(isLaunchNotifySource("landing"), true);
  assert.equal(isLaunchNotifySource("spam"), false);
  assert.equal(isLaunchNotifySource(""), false);
  assert.equal(isLaunchNotifySource(42), false);
});
