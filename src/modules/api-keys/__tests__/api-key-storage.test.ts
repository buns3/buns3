import { beforeEach, describe, expect, test } from "bun:test";
import { apiKeyStorage } from "../api-key-storage";
import { hashToken, verify as verifySig } from "$/lib/presign";
import { resetStorage, seedBucket, seedKey } from "../../../../test/helpers";

beforeEach(resetStorage);

describe("apiKeyStorage.create + verify", () => {
  test("mints a well-formed token; verify resolves and stamps lastUsedAt", async () => {
    await seedBucket("alpha");
    const { apiKey, token } = await seedKey({ name: "k", bucketName: "alpha", canRead: true });
    expect(token).toMatch(/^buns3_[A-Za-z0-9_-]{43}$/);
    expect(apiKey.tokenHint).toBe(token.slice(0, 11));
    expect(apiKey.canRead).toBe(true);
    expect(apiKey.canWrite).toBe(false);
    expect(apiKey.lastUsedAt).toBeNull();

    const verified = await apiKeyStorage.verify(token);
    expect(verified.success).toBe(true);
    if (!verified.success) return;
    expect(verified.data.lastUsedAt).toBeInstanceOf(Date);
    expect("tokenHash" in verified.data).toBe(false);
  });

  test("malformed and unknown tokens both collapse to INVALID_API_KEY", async () => {
    expect(await apiKeyStorage.verify("garbage")).toEqual({ success: false, code: "INVALID_API_KEY" });
    expect(await apiKeyStorage.verify("buns3_" + "A".repeat(43))).toEqual({
      success: false,
      code: "INVALID_API_KEY",
    });
  });

  test("data key for a missing bucket is refused", async () => {
    const result = await apiKeyStorage.create({
      name: "k",
      bucketName: "ghost",
      canRead: true,
      canWrite: false,
      isAdmin: false,
    } as Parameters<typeof apiKeyStorage.create>[0]);
    expect(result).toEqual({ success: false, code: "BUCKET_NOT_FOUND" });
  });
});

describe("apiKeyStorage.getAll", () => {
  test("lists mapped keys and never anything hash- or token-shaped", async () => {
    await seedBucket("alpha");
    await seedKey({ name: "one", bucketName: "alpha", canRead: true });
    await seedKey({ name: "two", isAdmin: true });
    const result = await apiKeyStorage.getAll();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map((k) => k.name).sort()).toEqual(["one", "two"]);
    for (const k of result.data) {
      expect("tokenHash" in k).toBe(false);
      expect("token" in k).toBe(false);
    }
  });
});

describe("apiKeyStorage.delete", () => {
  test("revocation kills the bearer immediately", async () => {
    await seedBucket("alpha");
    const { apiKey, token } = await seedKey({ name: "k", bucketName: "alpha", canRead: true });
    const del = await apiKeyStorage.delete(apiKey.id);
    expect(del.success).toBe(true);
    expect(await apiKeyStorage.verify(token)).toEqual({ success: false, code: "INVALID_API_KEY" });
  });

  test("unknown id is API_KEY_NOT_FOUND", async () => {
    expect(await apiKeyStorage.delete(crypto.randomUUID())).toEqual({
      success: false,
      code: "API_KEY_NOT_FOUND",
    });
  });
});

describe("apiKeyStorage.presign + verifyPresigned", () => {
  test("storage-minted params verify through the lib and back through storage", async () => {
    await seedBucket("alpha");
    const { apiKey, token } = await seedKey({ name: "k", bucketName: "alpha", canRead: true });
    const expires = Math.floor(Date.now() / 1000) + 60;

    const minted = await apiKeyStorage.presign({
      id: apiKey.id,
      method: "GET",
      bucket: "alpha",
      key: "doc.txt",
      ttl: 60,
    });
    expect(minted.success).toBe(true);
    if (!minted.success) return;
    expect(minted.data.expires).toBeGreaterThanOrEqual(expires - 1);

    // lib-level: the sig verifies against the client-computable hash
    expect(
      verifySig({
        tokenHash: hashToken(token),
        method: "GET",
        bucket: "alpha",
        key: "doc.txt",
        expires: minted.data.expires,
        sig: minted.data.sig,
        now: Math.floor(Date.now() / 1000),
      }),
    ).toEqual({ valid: true });

    // storage-level: the full lookup-and-verify round trip
    const verified = await apiKeyStorage.verifyPresigned({
      keyId: minted.data.keyId,
      method: "GET",
      bucket: "alpha",
      key: "doc.txt",
      expires: minted.data.expires,
      sig: minted.data.sig,
      now: Math.floor(Date.now() / 1000),
    });
    expect(verified.success).toBe(true);
    if (verified.success) expect(verified.data.name).toBe("k");
  });

  test("expired presign is its own code", async () => {
    await seedBucket("alpha");
    const { apiKey } = await seedKey({ name: "k", bucketName: "alpha", canRead: true });
    const minted = await apiKeyStorage.presign({ id: apiKey.id, method: "GET", bucket: "alpha", key: "x", ttl: 0 });
    expect(minted.success).toBe(true);
    if (!minted.success) return;
    const verified = await apiKeyStorage.verifyPresigned({
      keyId: minted.data.keyId,
      method: "GET",
      bucket: "alpha",
      key: "x",
      expires: minted.data.expires,
      sig: minted.data.sig,
      now: minted.data.expires + 1,
    });
    expect(verified).toEqual({ success: false, code: "PRESIGNED_EXPIRED" });
  });

  test("presign for a revoked key is INVALID_API_KEY", async () => {
    await seedBucket("alpha");
    const { apiKey } = await seedKey({ name: "k", bucketName: "alpha", canRead: true });
    await apiKeyStorage.delete(apiKey.id);
    const minted = await apiKeyStorage.presign({ id: apiKey.id, method: "GET", bucket: "alpha", key: "x", ttl: 60 });
    expect(minted).toEqual({ success: false, code: "INVALID_API_KEY" });
  });
});
