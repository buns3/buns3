import { describe, expect, test } from "bun:test";
import {
  canonicalString,
  deriveKeyId,
  hashToken,
  isPresignMethod,
  PRESIGN_METHODS,
  sign,
  verify,
  type SignOptions,
} from "../presign";

const HASH = "a".repeat(64);
const BASE: SignOptions = {
  tokenHash: HASH,
  method: "GET",
  bucket: "dev",
  key: "docs/hello.txt",
  expires: 1_800_000_000,
};
const SIG = sign(BASE);

const verifyWith = (over: Partial<Parameters<typeof verify>[0]>) =>
  verify({ ...BASE, sig: SIG, now: BASE.expires - 60, ...over });

describe("sign", () => {
  test("produces 64 lowercase hex chars", () => {
    expect(SIG).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic", () => {
    expect(sign(BASE)).toBe(SIG);
  });

  test("every field changes the signature", () => {
    expect(sign({ ...BASE, method: "PUT" })).not.toBe(SIG);
    expect(sign({ ...BASE, bucket: "prod" })).not.toBe(SIG);
    expect(sign({ ...BASE, key: "docs/hello.txt2" })).not.toBe(SIG);
    expect(sign({ ...BASE, expires: BASE.expires + 1 })).not.toBe(SIG);
    expect(sign({ ...BASE, tokenHash: "b".repeat(64) })).not.toBe(SIG);
  });
});

describe("verify", () => {
  test("round-trip is valid", () => {
    expect(verifyWith({})).toEqual({ valid: true });
  });

  test("boundary: now === expires is still valid (inclusive expiry)", () => {
    expect(verifyWith({ now: BASE.expires })).toEqual({ valid: true });
  });

  test("boundary: now === expires + 1 is expired", () => {
    expect(verifyWith({ now: BASE.expires + 1 })).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  test.each([
    ["method", { method: "PUT" as const }],
    ["bucket", { bucket: "prod" }],
    ["key", { key: "docs/hello.txt2" }],
    ["tokenHash (revoked/other key)", { tokenHash: "b".repeat(64) }],
  ])("tampered %s -> mismatch", (_label, over) => {
    expect(verifyWith(over)).toEqual({ valid: false, reason: "mismatch" });
  });

  test("sig for a different expiry -> mismatch", () => {
    expect(
      verifyWith({ expires: BASE.expires + 1, now: BASE.expires - 60 }),
    ).toEqual({ valid: false, reason: "mismatch" });
  });

  test.each([
    ["uppercase hex", SIG.toUpperCase()],
    ["too short", "abc"],
    ["invalid hex chars", "z".repeat(64)],
    ["empty", ""],
  ])("malformed sig (%s) -> mismatch, no throw", (_label, sig) => {
    expect(verifyWith({ sig })).toEqual({ valid: false, reason: "mismatch" });
  });

  test("expired wins over garbage sig (branch order)", () => {
    expect(verifyWith({ now: BASE.expires + 1, sig: "nonsense" })).toEqual({
      valid: false,
      reason: "expired",
    });
  });
});

describe("canonicalString", () => {
  test("newline aliasing exists at lib level — upstream validators must gate control chars", () => {
    // {bucket: "foo", key: "bar\nbaz"} and {bucket: "foo\nbar", key: "baz"}
    // canonicalize identically; safe only because BucketName/Key validation
    // rejects newlines before presign ever sees input.
    const a = canonicalString({ method: "GET", bucket: "foo", key: "bar\nbaz", expires: 1 });
    const b = canonicalString({ method: "GET", bucket: "foo\nbar", key: "baz", expires: 1 });
    expect(a).toBe(b);
  });

  test("expires >= 1e21 stringifies exponentially — PresignParams regex must gate length", () => {
    expect(canonicalString({ ...BASE, expires: 1e21 })).toContain("e+21");
  });
});

describe("deriveKeyId", () => {
  test("is 64 lowercase hex and deterministic", () => {
    expect(deriveKeyId(HASH)).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveKeyId(HASH)).toBe(deriveKeyId(HASH));
  });

  test("differs per tokenHash", () => {
    expect(deriveKeyId(HASH)).not.toBe(deriveKeyId("b".repeat(64)));
  });

  test("never collides with a signature under the same key (domain separation)", () => {
    expect(deriveKeyId(HASH)).not.toBe(
      sign({ ...BASE, bucket: "", key: "", expires: 0 }),
    );
  });
});

describe("hashToken", () => {
  test("sha256 hex of the token — known vector", () => {
    // sha256("hello") — cross-implementation anchor (mint side and verify
    // side must agree; the browser presign tool must reproduce this too)
    expect(hashToken("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("isPresignMethod", () => {
  test.each([...PRESIGN_METHODS])("%s is accepted", (m) => {
    expect(isPresignMethod(m)).toBe(true);
  });

  test.each(["PATCH", "OPTIONS", "get", ""])("%s is rejected", (m) => {
    expect(isPresignMethod(m)).toBe(false);
  });
});
