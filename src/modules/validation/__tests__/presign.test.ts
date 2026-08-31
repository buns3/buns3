import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { PresignParams, PresignRequest } from "../presign";

const ok = (v: unknown) => !(v instanceof type.errors);
const HEX64 = "a".repeat(64);
const valid = { keyId: HEX64, expires: "1800000000", sig: "b".repeat(64) };

describe("PresignParams", () => {
  test("accepts the wire trio and parses expires to a number", () => {
    const r = PresignParams(valid);
    expect(ok(r)).toBe(true);
    if (!(r instanceof type.errors)) {
      expect(r.expires).toBe(1800000000);
      expect(typeof r.expires).toBe("number");
    }
  });

  test.each([
    ["exponent form", "1e10"],
    ["float", "1.5"],
    ["negative", "-5"],
    ["13 digits (too long)", "9".repeat(13)],
    ["empty", ""],
    ["non-numeric", "soon"],
  ])("rejects expires: %s", (_label, expires) =>
    expect(ok(PresignParams({ ...valid, expires }))).toBe(false),
  );

  test.each([
    ["uppercase hex keyId", { keyId: HEX64.toUpperCase() }],
    ["short keyId", { keyId: "abc" }],
    ["uppercase hex sig", { sig: "B".repeat(64) }],
    ["short sig", { sig: "abc" }],
    ["non-hex sig", { sig: "z".repeat(64) }],
    ["empty sig (the ?sig= case)", { sig: "" }],
  ])("rejects %s", (_label, over) =>
    expect(ok(PresignParams({ ...valid, ...over }))).toBe(false),
  );

  test.each(["keyId", "expires", "sig"] as const)(
    "rejects when %s is missing (partial param set)",
    (field) => {
      const partial: Record<string, string | undefined> = { ...valid };
      partial[field] = undefined;
      expect(ok(PresignParams(partial))).toBe(false);
    },
  );

  test("extra query params are ignored, not rejected", () => {
    expect(ok(PresignParams({ ...valid, download: "1" }))).toBe(true);
  });
});

describe("mint/verify bound invariant", () => {
  // ttl is a DURATION (capped 7 days); expires is an ABSOLUTE unix timestamp
  // (format bound only). Every mintable expires must pass the verify-side
  // schema — this drifted apart three times in one evening before this test.
  test("expires minted at max ttl passes the verify-side bound, far into the future", () => {
    const MAX_TTL = 604800; // keep in sync with PresignRequest/CLI ttl bound
    const farFutureNow = 4_000_000_000; // year ~2096
    const r = PresignParams({
      keyId: "a".repeat(64),
      expires: String(farFutureNow + MAX_TTL),
      sig: "b".repeat(64),
    });
    expect(ok(r)).toBe(true);
  });

  test("PresignRequest accepts max ttl and rejects one past it", () => {
    const base = { method: "GET", bucket: "dev", key: "x.txt" };
    expect(ok(PresignRequest({ ...base, ttl: 604800 }))).toBe(true);
    expect(ok(PresignRequest({ ...base, ttl: 604801 }))).toBe(false);
  });
});
