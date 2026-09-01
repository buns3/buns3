import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileStorage } from "../file-storage";
import { blobPath, dataPath, resetStorage, seedBucket, seedObject } from "../../../../test/helpers";

const tmpEntries = () => readdirSync(path.join(dataPath(), ".tmp"));
const bucketBlobs = (bucket: string) =>
  existsSync(path.join(dataPath(), bucket)) ? readdirSync(path.join(dataPath(), bucket)) : [];

beforeEach(resetStorage);

describe("fileStorage.put", () => {
  test("stores blob + pointer; exactly one blob, .tmp empty afterward", async () => {
    await seedBucket("alpha");
    const result = await fileStorage.put("alpha", "docs/a.txt", new Blob(["hello"]).stream(), "text/plain");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.object.key).toBe("docs/a.txt");
    expect(result.object.size).toBe(5);
    expect(result.object.contentType).toBe("text/plain");
    expect(bucketBlobs("alpha")).toEqual([result.object.id]);
    expect(existsSync(blobPath("alpha", result.object.id))).toBe(true);
    expect(tmpEntries()).toEqual([]);
  });

  test("overwrite swaps the blob: new id on disk, old blob unlinked", async () => {
    await seedBucket("alpha");
    const first = await seedObject("alpha", "k.txt", "version one");
    const result = await fileStorage.put("alpha", "k.txt", new Blob(["v2"]).stream(), "text/plain");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.object.id).not.toBe(first.id);
    expect(bucketBlobs("alpha")).toEqual([result.object.id]);
    expect(existsSync(blobPath("alpha", first.id))).toBe(false);
    expect(tmpEntries()).toEqual([]);
  });

  test("overwrite survives a failing old-blob unlink (no new-blob loss)", async () => {
    await seedBucket("alpha");
    const first = await seedObject("alpha", "k.txt", "v1");
    // simulate the old blob already gone (crash/concurrent-delete): its unlink
    // will reject, and the fix must not let that clobber the freshly written blob
    rmSync(blobPath("alpha", first.id), { force: true });

    const result = await fileStorage.put("alpha", "k.txt", new Blob(["v2"]).stream(), "text/plain");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.object.id).not.toBe(first.id);
    expect(existsSync(blobPath("alpha", result.object.id))).toBe(true);
    // pointer and blob agree — a subsequent GET returns the new content
    const got = await fileStorage.get("alpha", "k.txt");
    expect(got.success && (await got.file.text())).toBe("v2");
  });

  test("zero-byte object is allowed", async () => {
    await seedBucket("alpha");
    const result = await fileStorage.put("alpha", "empty", new Blob([]).stream(), "text/plain");
    expect(result.success && result.object.size).toBe(0);
  });

  test("put into a missing bucket is BUCKET_NOT_FOUND, nothing lands on disk", async () => {
    const result = await fileStorage.put("ghost", "k", new Blob(["x"]).stream(), "text/plain");
    expect(result).toEqual({ success: false, code: "BUCKET_NOT_FOUND" });
    expect(tmpEntries()).toEqual([]);
  });
});

describe("fileStorage.get / head", () => {
  test("get round-trips content and metadata", async () => {
    await seedBucket("alpha");
    await seedObject("alpha", "k.txt", "round trip");
    const result = await fileStorage.get("alpha", "k.txt");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(await result.file.text()).toBe("round trip");
    expect(result.object.contentType).toBe("text/plain");
  });

  test("missing key is KEY_NOT_FOUND", async () => {
    await seedBucket("alpha");
    expect(await fileStorage.get("alpha", "nope")).toEqual({
      success: false,
      code: "KEY_NOT_FOUND",
    });
  });
});

describe("fileStorage.delete", () => {
  test("drops pointer and blob", async () => {
    await seedBucket("alpha");
    const obj = await seedObject("alpha", "k.txt");
    const result = await fileStorage.delete("alpha", "k.txt");
    expect(result.success).toBe(true);
    expect(existsSync(blobPath("alpha", obj.id))).toBe(false);
    expect((await fileStorage.get("alpha", "k.txt")).success).toBe(false);
  });

  test("missing key is KEY_NOT_FOUND (deliberately not idempotent)", async () => {
    await seedBucket("alpha");
    expect(await fileStorage.delete("alpha", "nope")).toEqual({
      success: false,
      code: "KEY_NOT_FOUND",
    });
  });
});

describe("fileStorage.list", () => {
  test("orders by key, paginates by cursor, filters by prefix", async () => {
    await seedBucket("alpha");
    for (const k of ["b/2", "a/1", "b/1", "c", "a/2"]) await seedObject("alpha", k);

    const page1 = await fileStorage.list({ bucket: "alpha", limit: 2 });
    expect(page1.success).toBe(true);
    if (!page1.success) return;
    expect(page1.objects.map((o) => o.key)).toEqual(["a/1", "a/2"]);
    expect(page1.nextAfter).toBe("a/2");

    const page2 = await fileStorage.list({ bucket: "alpha", limit: 2, after: page1.nextAfter! });
    expect(page2.success && page2.objects.map((o) => o.key)).toEqual(["b/1", "b/2"]);

    const last = await fileStorage.list({ bucket: "alpha", limit: 2, after: "b/2" });
    expect(last.success && last.objects.map((o) => o.key)).toEqual(["c"]);
    if (last.success) expect(last.nextAfter).toBeNull();

    const prefixed = await fileStorage.list({ bucket: "alpha", prefix: "b/" });
    expect(prefixed.success && prefixed.objects.map((o) => o.key)).toEqual(["b/1", "b/2"]);
  });

  test("exact-limit final page has null nextAfter", async () => {
    await seedBucket("alpha");
    await seedObject("alpha", "one");
    await seedObject("alpha", "two");
    const result = await fileStorage.list({ bucket: "alpha", limit: 2 });
    expect(result.success && result.nextAfter).toBeNull();
  });

  test("summary fields never leak bucketName or raw id", async () => {
    await seedBucket("alpha");
    const obj = await seedObject("alpha", "k");
    const result = await fileStorage.list({ bucket: "alpha" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const item = result.objects[0]!;
    expect(item.etag).toBe(obj.id);
    expect("bucketName" in item).toBe(false);
    expect("id" in item).toBe(false);
  });
});

describe("fileStorage.deleteMany", () => {
  test("deletes pointers and blobs, reports per key, dedupes", async () => {
    await seedBucket("alpha");
    const a = await seedObject("alpha", "a");
    const b = await seedObject("alpha", "b");
    const keep = await seedObject("alpha", "keep");

    const result = await fileStorage.deleteMany("alpha", ["a", "b", "ghost", "a"]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.summary).toEqual({ deleted: 2, missing: 1 });
    expect(result.results).toEqual([
      { success: true, key: "a" },
      { success: true, key: "b" },
      { success: false, key: "ghost", code: "KEY_NOT_FOUND" },
    ]);
    expect(existsSync(blobPath("alpha", a.id))).toBe(false);
    expect(existsSync(blobPath("alpha", b.id))).toBe(false);
    expect(existsSync(blobPath("alpha", keep.id))).toBe(true);
  });

  test("all-missing batch reports everything, touches nothing", async () => {
    await seedBucket("alpha");
    const keep = await seedObject("alpha", "keep");
    const result = await fileStorage.deleteMany("alpha", ["x", "y"]);
    expect(result.success && result.summary).toEqual({ deleted: 0, missing: 2 });
    expect(existsSync(blobPath("alpha", keep.id))).toBe(true);
  });
});
