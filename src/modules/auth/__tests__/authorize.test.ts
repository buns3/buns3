import { beforeEach, describe, expect, test } from "bun:test";
import { authorize } from "../authorize";
import { deriveKeyId, hashToken, sign } from "$/lib/presign";
import { apiKeyStorage } from "../../api-keys/api-key-storage";
import { resetStorage, seedBucket, seedKey } from "../../../../test/helpers";
import type { ApiKey } from "../../api-keys/types";

const asKey = (apiKey: ApiKey) => ({ kind: "key" as const, apiKey });
const anon = { kind: "anonymous" as const };
const now = () => Math.floor(Date.now() / 1000);

beforeEach(resetStorage);

describe("authorize — anonymous (the branch tier-1 can't reach)", () => {
  test("read on a public bucket is allowed", async () => {
    await seedBucket("pub", { publicRead: true });
    const result = await authorize({ state: anon, capability: "read", bucket: "pub", method: "GET" });
    expect(result.success).toBe(true);
  });

  test("read on a private bucket and a missing bucket are the same 401 (no oracle)", async () => {
    await seedBucket("priv");
    const onPrivate = await authorize({ state: anon, capability: "read", bucket: "priv", method: "GET" });
    const onMissing = await authorize({ state: anon, capability: "read", bucket: "ghost", method: "GET" });
    expect(onPrivate).toEqual({ success: false, code: "INVALID_API_KEY" });
    expect(onMissing).toEqual(onPrivate);
  });

  test.each(["write", "list", "admin", true] as const)(
    "capability %p is never anonymous, even on a public bucket",
    async (capability) => {
      await seedBucket("pub", { publicRead: true });
      const result = await authorize({ state: anon, capability, bucket: "pub", method: "GET" });
      expect(result).toEqual({ success: false, code: "INVALID_API_KEY" });
    },
  );

  test("no bucket on the route means no anonymous access", async () => {
    const result = await authorize({ state: anon, capability: "read", method: "GET" });
    expect(result).toEqual({ success: false, code: "INVALID_API_KEY" });
  });
});

describe("authorize — keys", () => {
  test("capabilities are independent: write does not imply read, list maps to read", async () => {
    await seedBucket("alpha");
    const { apiKey: writeOnly } = await seedKey({ name: "w", bucketName: "alpha", canWrite: true });
    const { apiKey: readOnly } = await seedKey({ name: "r", bucketName: "alpha", canRead: true });

    expect((await authorize({ state: asKey(writeOnly), capability: "write", bucket: "alpha", method: "PUT" })).success).toBe(true);
    expect(await authorize({ state: asKey(writeOnly), capability: "read", bucket: "alpha", method: "GET" })).toEqual({
      success: false,
      code: "API_KEY_NOT_CAPABLE",
    });
    expect((await authorize({ state: asKey(readOnly), capability: "list", bucket: "alpha", method: "GET" })).success).toBe(true);
    expect((await authorize({ state: asKey(readOnly), capability: true, method: "GET" })).success).toBe(true);
  });

  test("scope mismatch is 403 without consulting bucket existence", async () => {
    await seedBucket("alpha");
    const { apiKey } = await seedKey({ name: "k", bucketName: "alpha", canRead: true });
    const wrongBucket = await authorize({ state: asKey(apiKey), capability: "read", bucket: "other", method: "GET" });
    const missingBucket = await authorize({ state: asKey(apiKey), capability: "read", bucket: "ghost", method: "GET" });
    expect(wrongBucket).toEqual({ success: false, code: "API_KEY_SCOPE_MISMATCH" });
    expect(missingBucket).toEqual(wrongBucket);
  });

  test("admin is control-plane only: passes admin, fails read/write everywhere", async () => {
    await seedBucket("pub", { publicRead: true });
    const { apiKey } = await seedKey({ name: "a", isAdmin: true });
    expect((await authorize({ state: asKey(apiKey), capability: "admin", method: "PATCH" })).success).toBe(true);
    expect(await authorize({ state: asKey(apiKey), capability: "read", bucket: "pub", method: "GET" })).toEqual({
      success: false,
      code: "API_KEY_NOT_CAPABLE",
    });
  });
});

describe("authorize — presign state", () => {
  async function mintedState(bucket: string, key: string, method: "GET" | "PUT" = "GET") {
    const { apiKey } = await seedKey({ name: "signer", bucketName: bucket, canRead: true, canWrite: true });
    const minted = await apiKeyStorage.presign({ id: apiKey.id, method, bucket, key, ttl: 60 });
    if (!minted.success) throw new Error("mint failed");
    return { kind: "presign" as const, params: minted.data };
  }

  test("valid signature authorizes as the signing key", async () => {
    await seedBucket("alpha");
    const state = await mintedState("alpha", "doc.txt");
    const result = await authorize({ state, capability: "read", bucket: "alpha", key: "doc.txt", method: "GET" });
    expect(result.success).toBe(true);
  });

  test("method swap fails: a GET signature does not authorize PUT", async () => {
    await seedBucket("alpha");
    const state = await mintedState("alpha", "doc.txt", "GET");
    const result = await authorize({ state, capability: "write", bucket: "alpha", key: "doc.txt", method: "PUT" });
    expect(result).toEqual({ success: false, code: "INVALID_API_KEY" });
  });

  test("presign without bucket/key on the route is refused (data-plane only)", async () => {
    await seedBucket("alpha");
    const state = await mintedState("alpha", "doc.txt");
    const result = await authorize({ state, capability: true, method: "GET" });
    expect(result).toEqual({ success: false, code: "INVALID_API_KEY" });
  });

  test("expired signature is PRESIGNED_EXPIRED", async () => {
    await seedBucket("alpha");
    const { token } = await seedKey({ name: "s", bucketName: "alpha", canRead: true });
    // sign an already-expired tuple directly through the lib — no sleeping
    const tokenHash = hashToken(token);
    const expires = now() - 10;
    const params = {
      keyId: deriveKeyId(tokenHash),
      expires,
      sig: sign({ tokenHash, method: "GET", bucket: "alpha", key: "x", expires }),
    };
    const result = await authorize({
      state: { kind: "presign", params },
      capability: "read",
      bucket: "alpha",
      key: "x",
      method: "GET",
    });
    expect(result).toEqual({ success: false, code: "PRESIGNED_EXPIRED" });
  });
});
