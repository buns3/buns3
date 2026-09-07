import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { appendFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileStorage } from "../file-storage";
import { uploadStorage } from "../upload-storage";
import {
  blobPath,
  dataPath,
  resetStorage,
  seedBucket,
  seedObject,
} from "../../../../test/helpers";

// Tier-2: real database, real files. The rules with teeth are that the ROW's
// size is the truth (a crashed append can leave the file longer), and that
// complete swaps the pointer and the blob together or not at all.

const uploadPath = (id: string) => path.join(dataPath(), ".uploads", id);
const stream = (text: string) => new Blob([text]).stream();
const uploadFiles = () => readdir(path.join(dataPath(), ".uploads"));
const tmpFiles = () => readdir(path.join(dataPath(), ".tmp"));

async function open(bucket = "b", key = "big.bin", contentType?: string) {
  const created = await uploadStorage.create(bucket, key, contentType);
  if (!created.success) throw new Error(`create: ${created.code}`);
  return created.data;
}

beforeEach(async () => {
  await resetStorage();
  for (const entry of await uploadFiles()) {
    await Bun.file(uploadPath(entry)).unlink();
  }
  await seedBucket("b");
});

describe("create", () => {
  test("opens a session with an empty file and a zero size", async () => {
    const upload = await open();
    expect(upload).toMatchObject({ bucketName: "b", key: "big.bin", size: 0 });
    expect(existsSync(uploadPath(upload.id))).toBe(true);
    expect((await stat(uploadPath(upload.id))).size).toBe(0);
  });

  test("defaults the content type, and keeps one when given", async () => {
    expect((await open("b", "a")).contentType).toBe("application/octet-stream");
    expect((await open("b", "b", "text/plain")).contentType).toBe("text/plain");
  });

  test("a missing bucket is refused before anything is written", async () => {
    const created = await uploadStorage.create("ghost", "k");
    expect(created).toEqual({ success: false, code: "BUCKET_NOT_FOUND" });
    expect(await uploadFiles()).toEqual([]);
  });

  test("two sessions for the same key are allowed", async () => {
    // Overwrite is legal, so concurrent uploads to one key must be too — and a
    // stale session must never block re-uploading until the sweep runs.
    const first = await open("b", "same.txt");
    const second = await open("b", "same.txt");
    expect(second.id).not.toBe(first.id);
  });
});

describe("append", () => {
  test("grows the file and the recorded size, chunk by chunk", async () => {
    const upload = await open();
    const one = await uploadStorage.append(upload.id, stream("hello "));
    const two = await uploadStorage.append(one.success ? one.data.id : "", stream("world"));

    expect(one.success && one.data.size).toBe(6);
    expect(two.success && two.data.size).toBe(11);
    expect(await Bun.file(uploadPath(upload.id)).text()).toBe("hello world");
  });

  test("a matching offset is accepted, a stale one is refused untouched", async () => {
    const upload = await open();
    await uploadStorage.append(upload.id, stream("abc"));

    expect(await uploadStorage.append(upload.id, stream("def"), 0)).toEqual({
      success: false,
      code: "OFFSET_MISMATCH",
    });
    expect(await Bun.file(uploadPath(upload.id)).text()).toBe("abc");

    const resumed = await uploadStorage.append(upload.id, stream("def"), 3);
    expect(resumed.success && resumed.data.size).toBe(6);
    expect(await Bun.file(uploadPath(upload.id)).text()).toBe("abcdef");
  });

  test("bytes past the recorded size are discarded on the next append", async () => {
    // The crash case: a previous append wrote to disk and died before the row
    // was updated. The row is the truth, so the extra bytes must not survive.
    const upload = await open();
    await uploadStorage.append(upload.id, stream("abc"));
    await appendFile(uploadPath(upload.id), "GARBAGE");

    const next = await uploadStorage.append(upload.id, stream("def"));
    expect(next.success && next.data.size).toBe(6);
    expect(await Bun.file(uploadPath(upload.id)).text()).toBe("abcdef");
  });

  test("updatedAt moves on every append, or the sweep would collect a live upload", async () => {
    const upload = await open();
    await Bun.sleep(5);
    const appended = await uploadStorage.append(upload.id, stream("x"));
    expect(appended.success).toBe(true);
    if (!appended.success) return;
    expect(appended.data.updatedAt.getTime()).toBeGreaterThan(
      upload.updatedAt.getTime(),
    );
  });

  test("an unknown id is a 404, not a new file", async () => {
    expect(await uploadStorage.append(crypto.randomUUID(), stream("x"))).toEqual({
      success: false,
      code: "UPLOAD_NOT_FOUND",
    });
    expect(await uploadFiles()).toEqual([]);
  });
});

describe("get", () => {
  test("reports the session, and 404s an unknown id", async () => {
    const upload = await open();
    await uploadStorage.append(upload.id, stream("12345"));

    const got = await uploadStorage.get(upload.id);
    expect(got.success && got.data).toMatchObject({
      id: upload.id,
      bucketName: "b",
      key: "big.bin",
      size: 5,
    });
    expect(await uploadStorage.get(crypto.randomUUID())).toEqual({
      success: false,
      code: "UPLOAD_NOT_FOUND",
    });
  });
});

describe("abort", () => {
  test("removes the row and the file", async () => {
    const upload = await open();
    await uploadStorage.append(upload.id, stream("data"));

    expect(await uploadStorage.abort(upload.id)).toEqual({
      success: true,
      data: null,
    });
    expect(existsSync(uploadPath(upload.id))).toBe(false);
    expect(await uploadStorage.get(upload.id)).toEqual({
      success: false,
      code: "UPLOAD_NOT_FOUND",
    });
  });

  test("aborting twice is honest about the second time", async () => {
    const upload = await open();
    await uploadStorage.abort(upload.id);
    expect(await uploadStorage.abort(upload.id)).toEqual({
      success: false,
      code: "UPLOAD_NOT_FOUND",
    });
  });
});

describe("complete", () => {
  test("turns the session into an object the data plane can read", async () => {
    const upload = await open("b", "doc.txt", "text/plain");
    await uploadStorage.append(upload.id, stream("chunk one "));
    await uploadStorage.append(upload.id, stream("chunk two"));

    const completed = await uploadStorage.complete(upload.id);
    expect(completed.success).toBe(true);
    if (!completed.success) return;
    expect(completed.data.object).toMatchObject({
      bucketName: "b",
      key: "doc.txt",
      contentType: "text/plain",
      size: 19,
    });

    // the blob is at the pointer's id, which is what a GET resolves
    expect(existsSync(blobPath("b", completed.data.object.id))).toBe(true);
    const got = await fileStorage.get("b", "doc.txt");
    expect(got.success && (await got.data.file.text())).toBe("chunk one chunk two");
  });

  test("the session is gone afterwards, and leaves nothing behind", async () => {
    const upload = await open();
    await uploadStorage.append(upload.id, stream("x"));
    await uploadStorage.complete(upload.id);

    expect(await uploadStorage.get(upload.id)).toEqual({
      success: false,
      code: "UPLOAD_NOT_FOUND",
    });
    expect(existsSync(uploadPath(upload.id))).toBe(false);
    expect(await uploadFiles()).toEqual([]);
    expect(await tmpFiles()).toEqual([]);
  });

  test("completing over an existing object swaps the blob and unlinks the old one", async () => {
    const original = await seedObject("b", "doc.txt", "the old bytes");
    const upload = await open("b", "doc.txt");
    await uploadStorage.append(upload.id, stream("the new bytes"));

    const completed = await uploadStorage.complete(upload.id);
    expect(completed.success).toBe(true);
    if (!completed.success) return;
    expect(completed.data.object.id).not.toBe(original.id);
    expect(existsSync(blobPath("b", original.id))).toBe(false);

    const got = await fileStorage.get("b", "doc.txt");
    expect(got.success && (await got.data.file.text())).toBe("the new bytes");
  });

  test("a session with no appends completes as a zero-byte object", async () => {
    // Empty objects are legal, so an upload nobody wrote to is not an error.
    const upload = await open("b", "empty.bin");
    const completed = await uploadStorage.complete(upload.id);
    expect(completed.success && completed.data.object.size).toBe(0);

    const got = await fileStorage.get("b", "empty.bin");
    expect(got.success && (await got.data.file.text())).toBe("");
  });

  test("an unknown id is a 404", async () => {
    expect(await uploadStorage.complete(crypto.randomUUID())).toEqual({
      success: false,
      code: "UPLOAD_NOT_FOUND",
    });
  });
});
