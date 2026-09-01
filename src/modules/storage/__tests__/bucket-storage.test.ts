import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { bucketStorage } from "../bucket";
import { apiKeyStorage } from "../../api-keys/api-key-storage";
import { dataPath, resetStorage, seedBucket, seedKey, seedObject } from "../../../../test/helpers";

const bucketDir = (name: string) => path.join(dataPath(), name);

beforeEach(resetStorage);

describe("bucketStorage.create", () => {
  test("creates the row and the directory, publicRead defaults false", async () => {
    const result = await bucketStorage.create("alpha");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.bucket.name).toBe("alpha");
    expect(result.bucket.publicRead).toBe(false);
    expect(result.bucket.objects).toBe(0);
    expect(result.bucket.createdAt).toBeInstanceOf(Date);
    expect(existsSync(bucketDir("alpha"))).toBe(true);
  });

  test("duplicate name is refused", async () => {
    await seedBucket("alpha");
    const result = await bucketStorage.create("alpha");
    expect(result).toEqual({ success: false, code: "BUCKET_ALREADY_EXIST" });
  });
});

describe("bucketStorage.get / head / list", () => {
  test("get returns the bucket with its object count", async () => {
    await seedBucket("alpha");
    await seedObject("alpha", "one.txt");
    await seedObject("alpha", "two.txt");
    const result = await bucketStorage.get("alpha");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.bucket.objects).toBe(2);
  });

  test("get on a missing bucket is BUCKET_NOT_FOUND", async () => {
    const result = await bucketStorage.get("ghost");
    expect(result).toEqual({ success: false, code: "BUCKET_NOT_FOUND" });
  });

  test("list returns all buckets with counts", async () => {
    await seedBucket("alpha");
    await seedBucket("beta");
    await seedObject("beta", "x.txt");
    const result = await bucketStorage.list();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const byName = Object.fromEntries(result.buckets.map((b) => [b.name, b.objects]));
    expect(byName).toEqual({ alpha: 0, beta: 1 });
  });
});

describe("bucketStorage.update", () => {
  test("toggles publicRead and returns a boolean on the mapped bucket", async () => {
    await seedBucket("alpha");
    const on = await bucketStorage.update("alpha", { publicRead: true });
    expect(on.success && on.bucket.publicRead).toBe(true);
    const off = await bucketStorage.update("alpha", { publicRead: false });
    expect(off.success && off.bucket.publicRead).toBe(false);
  });

  test("update on a missing bucket is BUCKET_NOT_FOUND", async () => {
    const result = await bucketStorage.update("ghost", { publicRead: true });
    expect(result).toEqual({ success: false, code: "BUCKET_NOT_FOUND" });
  });
});

describe("bucketStorage.delete", () => {
  test("deletes an empty bucket and removes its directory", async () => {
    await seedBucket("alpha");
    expect(existsSync(bucketDir("alpha"))).toBe(true);
    const result = await bucketStorage.delete("alpha");
    expect(result.success).toBe(true);
    expect(existsSync(bucketDir("alpha"))).toBe(false);
    expect((await bucketStorage.get("alpha")).success).toBe(false);
  });

  test("refuses a non-empty bucket", async () => {
    await seedBucket("alpha");
    await seedObject("alpha", "keep.txt");
    const result = await bucketStorage.delete("alpha");
    expect(result).toEqual({ success: false, code: "BUCKET_NOT_EMPTY" });
    expect(existsSync(bucketDir("alpha"))).toBe(true);
  });

  test("missing bucket is BUCKET_NOT_FOUND", async () => {
    const result = await bucketStorage.delete("ghost");
    expect(result).toEqual({ success: false, code: "BUCKET_NOT_FOUND" });
  });

  test("scoped keys cascade away with the bucket", async () => {
    await seedBucket("alpha");
    const { token } = await seedKey({ name: "alpha-rw", bucketName: "alpha", canRead: true, canWrite: true });
    expect((await apiKeyStorage.verify(token)).success).toBe(true);
    await bucketStorage.delete("alpha");
    expect(await apiKeyStorage.verify(token)).toEqual({
      success: false,
      code: "INVALID_API_KEY",
    });
  });
});
