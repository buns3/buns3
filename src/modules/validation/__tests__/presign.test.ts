import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { PresignParams } from "../presign";

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
