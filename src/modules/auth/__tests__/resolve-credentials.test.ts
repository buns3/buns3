import { describe, expect, test } from "bun:test";
import { resolveCredentials } from "../authorize";

const HEX64 = "a".repeat(64);
const presignQuery = {
  keyId: HEX64,
  expires: "1800000000",
  sig: "b".repeat(64),
};
const TOKEN = "buns3_" + "A".repeat(43);

describe("resolveCredentials — bearer", () => {
  test("valid Bearer header resolves to bearer credentials", () => {
    const r = resolveCredentials(`Bearer ${TOKEN}`);
    expect(r).toEqual({
      success: true,
      credentials: { kind: "bearer", token: TOKEN },
    });
  });

  test("scheme prefix is case-insensitive", () => {
    const r = resolveCredentials(`bEaReR ${TOKEN}`);
    expect(r.success && r.credentials.kind).toBe("bearer");
  });

  test.each([
    ["Basic scheme", "Basic abc"],
    ["bare token (no scheme)", TOKEN],
    ["Bearer without space", "Bearerabc"],
  ])("non-Bearer presentation (%s) fails", (_label, header) => {
    expect(resolveCredentials(header)).toEqual({
      success: false,
      code: "INVALID_API_KEY",
    });
  });
});

describe("resolveCredentials — anonymous", () => {
  test("no header, no presign params -> anonymous", () => {
    expect(resolveCredentials(undefined)).toEqual({
      success: true,
      credentials: { kind: "anonymous" },
    });
    expect(resolveCredentials(undefined, { unrelated: "1" })).toEqual({
      success: true,
      credentials: { kind: "anonymous" },
    });
  });
});

describe("resolveCredentials — presign", () => {
  test("full valid trio resolves to presign credentials with parsed expires", () => {
    const r = resolveCredentials(undefined, presignQuery);
    expect(r.success).toBe(true);
    if (r.success && r.credentials.kind === "presign") {
      expect(r.credentials.params.keyId).toBe(HEX64);
      expect(r.credentials.params.expires).toBe(1800000000);
      expect(r.credentials.params.sig).toBe("b".repeat(64));
    } else {
      throw new Error("expected presign credentials");
    }
  });

  test("both header and presign params -> ambiguity rejected", () => {
    expect(resolveCredentials(`Bearer ${TOKEN}`, presignQuery)).toEqual({
      success: false,
      code: "INVALID_API_KEY",
    });
  });

  test.each(["keyId", "expires", "sig"] as const)(
    "partial params (only %s) -> failure, never anonymous fallback",
    (field) => {
      expect(
        resolveCredentials(undefined, { [field]: presignQuery[field] }),
      ).toEqual({ success: false, code: "INVALID_API_KEY" });
    },
  );

  test("empty-valued param (?sig=) still selects the presign path and fails", () => {
    expect(resolveCredentials(undefined, { sig: "" })).toEqual({
      success: false,
      code: "INVALID_API_KEY",
    });
  });

  test("malformed expires -> failure", () => {
    expect(
      resolveCredentials(undefined, { ...presignQuery, expires: "1e10" }),
    ).toEqual({ success: false, code: "INVALID_API_KEY" });
  });
});
