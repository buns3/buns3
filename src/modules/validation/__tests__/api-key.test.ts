import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { ApiKeyToken, CreateApiKey } from "../api-key";
import { TOKEN_PREFIX } from "../../api-keys/constants";

const ok = (v: unknown) => !(v instanceof type.errors);

describe("ApiKeyToken", () => {
  const body43 = "A".repeat(43);

  test("accepts prefix + 43 base64url chars", () => {
    expect(ok(ApiKeyToken(`${TOKEN_PREFIX}${body43}`))).toBe(true);
    expect(ok(ApiKeyToken(`${TOKEN_PREFIX}${"a0_-".repeat(10)}abc`))).toBe(true);
  });

  test.each([
    ["missing prefix", body43],
    ["wrong prefix", `buns4_${body43}`],
    ["42-char body", `${TOKEN_PREFIX}${"A".repeat(42)}`],
    ["44-char body", `${TOKEN_PREFIX}${"A".repeat(44)}`],
    ["base64 (not url-safe) chars", `${TOKEN_PREFIX}${"A".repeat(41)}+/`],
    ["empty", ""],
  ])("rejects %s", (_label, token) =>
    expect(ok(ApiKeyToken(token))).toBe(false),
  );
});

describe("CreateApiKey (discriminated union)", () => {
  test("accepts a global admin key", () => {
    expect(
      ok(CreateApiKey({ name: "admin", bucketName: null, canRead: false, canWrite: false, isAdmin: true })),
    ).toBe(true);
  });

  test.each([
    ["read-only", true, false],
    ["write-only (write does NOT imply read)", false, true],
    ["read-write", true, true],
  ])("accepts a bucket data key: %s", (_label, canRead, canWrite) => {
    expect(
      ok(CreateApiKey({ name: "k", bucketName: "dev", canRead, canWrite, isAdmin: false })),
    ).toBe(true);
  });

  test("rejects a data key with zero capabilities (narrow)", () => {
    expect(
      ok(CreateApiKey({ name: "k", bucketName: "dev", canRead: false, canWrite: false, isAdmin: false })),
    ).toBe(false);
  });

  test("rejects an admin key with a bucket scope", () => {
    expect(
      ok(CreateApiKey({ name: "a", bucketName: "dev", canRead: false, canWrite: false, isAdmin: true })),
    ).toBe(false);
  });

  test("rejects an admin key with data capabilities", () => {
    expect(
      ok(CreateApiKey({ name: "a", bucketName: null, canRead: true, canWrite: false, isAdmin: true })),
    ).toBe(false);
  });

  test("rejects a data key without a bucket", () => {
    expect(
      ok(CreateApiKey({ name: "k", bucketName: null, canRead: true, canWrite: true, isAdmin: false })),
    ).toBe(false);
  });

  test("rejects an invalid bucket name on a data key", () => {
    expect(
      ok(CreateApiKey({ name: "k", bucketName: "_admin", canRead: true, canWrite: false, isAdmin: false })),
    ).toBe(false);
  });

  test("rejects empty and overlong names", () => {
    expect(ok(CreateApiKey({ name: "", bucketName: null, canRead: false, canWrite: false, isAdmin: true }))).toBe(false);
    expect(ok(CreateApiKey({ name: "x".repeat(51), bucketName: null, canRead: false, canWrite: false, isAdmin: true }))).toBe(false);
  });
});
