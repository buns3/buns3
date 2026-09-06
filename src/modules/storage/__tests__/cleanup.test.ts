import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { sweepOrphanBlobs, sweepTempFiles } from "../cleanup";
import {
  blobPath,
  dataPath,
  resetStorage,
  seedBucket,
  seedObject,
} from "../../../../test/helpers";

// Tier-2: real data dir, real DB. Every case plants files with explicit
// mtimes, because the age gate is the whole safety story — a blob without a
// pointer is also what every in-flight upload looks like for a moment.

const HOUR = 60 * 60 * 1000;
const sweep = { olderThanMs: HOUR, dryRun: false };

const tmpDir = () => path.join(dataPath(), ".tmp");

async function age(p: string, ageMs: number) {
  const then = new Date(Date.now() - ageMs);
  await utimes(p, then, then);
}

async function plant(file: string, ageMs = 0) {
  await writeFile(file, "x");
  if (ageMs > 0) await age(file, ageMs);
  return file;
}

// A directory's mtime moves every time an entry is added, so age it last.
async function plantRowlessDir(name: string, ageMs: number, files: number[]) {
  const dir = path.join(dataPath(), name);
  await mkdir(dir);
  const planted = [];
  for (const fileAge of files) {
    planted.push(await plant(path.join(dir, crypto.randomUUID()), fileAge));
  }
  if (ageMs > 0) await age(dir, ageMs);
  return { dir, files: planted };
}

beforeEach(async () => {
  await resetStorage();
  // resetStorage deliberately keeps .tmp; these tests must not inherit its contents
  for (const entry of readdirSync(tmpDir())) {
    rmSync(path.join(tmpDir(), entry), { recursive: true, force: true });
  }
});

describe("sweepTempFiles", () => {
  test("removes a stale temp file and keeps a fresh one", async () => {
    const stale = await plant(path.join(tmpDir(), crypto.randomUUID()), 2 * HOUR);
    const fresh = await plant(path.join(tmpDir(), crypto.randomUUID()));

    const result = await sweepTempFiles(sweep);
    expect(result).toEqual({
      success: true,
      data: { scanned: 2, removed: 1, skipped: 1, errors: 0 },
    });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("dry run reports the removal and leaves the file", async () => {
    const stale = await plant(path.join(tmpDir(), crypto.randomUUID()), 2 * HOUR);

    const result = await sweepTempFiles({ ...sweep, dryRun: true });
    expect(result.success && result.data.removed).toBe(1);
    expect(existsSync(stale)).toBe(true);
  });

  test("a directory inside .tmp is ignored, not an error", async () => {
    await mkdir(path.join(tmpDir(), "nested"));

    const result = await sweepTempFiles(sweep);
    expect(result).toEqual({
      success: true,
      data: { scanned: 1, removed: 0, skipped: 1, errors: 0 },
    });
  });
});

describe("sweepOrphanBlobs", () => {
  test("never removes a blob that has a pointer, however old", async () => {
    // The data-eater test. Age alone must not be enough.
    await seedBucket("b");
    const object = await seedObject("b", "k.txt");
    const blob = blobPath("b", object.id);
    const then = new Date(Date.now() - 2 * HOUR);
    await utimes(blob, then, then);

    const result = await sweepOrphanBlobs(sweep);
    expect(existsSync(blob)).toBe(true);
    expect(result).toEqual({
      success: true,
      data: { scanned: 1, removed: 0, skipped: 0, errors: 0 },
    });
  });

  test("removes an old orphan, keeps a fresh one and counts it as skipped", async () => {
    await seedBucket("b");
    const object = await seedObject("b", "k.txt");
    const old = await plant(blobPath("b", crypto.randomUUID()), 2 * HOUR);
    const fresh = await plant(blobPath("b", crypto.randomUUID()));

    const result = await sweepOrphanBlobs(sweep);
    expect(result).toEqual({
      success: true,
      data: { scanned: 3, removed: 1, skipped: 1, errors: 0 },
    });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(blobPath("b", object.id))).toBe(true);
  });

  test("a file that is not a UUID is left alone, even when old", async () => {
    // Blobs are always UUIDs. Anything else is not the sweep's to delete.
    await seedBucket("b");
    const stray = await plant(blobPath("b", "notes.txt"), 2 * HOUR);

    const result = await sweepOrphanBlobs(sweep);
    expect(existsSync(stray)).toBe(true);
    expect(result.success && result.data.skipped).toBe(1);
  });

  test("a file at the data root is neither entered nor counted", async () => {
    // Stands in for the SQLite file, which sits next to the bucket dirs in a
    // real deployment but not in this fixture.
    const stray = await plant(path.join(dataPath(), "db.sqlite"), 2 * HOUR);

    const result = await sweepOrphanBlobs(sweep);
    expect(existsSync(stray)).toBe(true);
    expect(result.success && result.data.scanned).toBe(0);
  });

  test("a directory that is not a valid bucket name is not entered", async () => {
    // Fail closed: the sweep only understands bucket dirs, and refuses to
    // guess about anything else it finds.
    const dir = path.join(dataPath(), "Upper");
    await mkdir(dir);
    const inside = await plant(path.join(dir, crypto.randomUUID()), 2 * HOUR);

    const result = await sweepOrphanBlobs(sweep);
    expect(existsSync(inside)).toBe(true);
    expect(result.success && result.data.scanned).toBe(0);
  });

  test("a bucket dir with no bucket row is emptied and removed", async () => {
    // Bucket delete only removes an EMPTY dir, so a bucket deleted while it
    // still had orphans leaves its dir behind. This is the only path that
    // collects it.
    const { dir } = await plantRowlessDir("ghost", 2 * HOUR, [2 * HOUR, 2 * HOUR]);

    const result = await sweepOrphanBlobs(sweep);
    expect(result).toEqual({
      success: true,
      data: { scanned: 2, removed: 2, skipped: 0, errors: 0 },
    });
    expect(existsSync(dir)).toBe(false);
  });

  test("a rowless dir with a fresh file stays, without an error", async () => {
    const { dir, files } = await plantRowlessDir("ghost", 2 * HOUR, [0]);

    const result = await sweepOrphanBlobs(sweep);
    expect(result.success && result.data.errors).toBe(0);
    expect(existsSync(files[0]!)).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  test("a fresh empty rowless dir is left alone", async () => {
    // bucketStorage.create mkdirs before its transaction commits, so a
    // brand-new bucket looks exactly like this for a moment.
    const { dir } = await plantRowlessDir("ghost", 0, []);

    await sweepOrphanBlobs(sweep);
    expect(existsSync(dir)).toBe(true);
  });

  test("an empty dir that still has a bucket row is not removed", async () => {
    // Directory lifecycle belongs to bucket delete; the sweep only collects
    // what nothing else owns.
    await seedBucket("b");

    await sweepOrphanBlobs(sweep);
    expect(existsSync(path.join(dataPath(), "b"))).toBe(true);
  });

  test("dry run reports what the real run would do and touches nothing", async () => {
    await seedBucket("b");
    const orphan = await plant(blobPath("b", crypto.randomUUID()), 2 * HOUR);
    const { dir: ghost, files } = await plantRowlessDir("ghost", 2 * HOUR, [2 * HOUR]);
    const inGhost = files[0]!;

    const dry = await sweepOrphanBlobs({ ...sweep, dryRun: true });
    expect(dry).toEqual({
      success: true,
      data: { scanned: 2, removed: 2, skipped: 0, errors: 0 },
    });
    expect(existsSync(orphan)).toBe(true);
    expect(existsSync(inGhost)).toBe(true);
    expect(existsSync(ghost)).toBe(true);

    // and the real run then agrees with the report
    const real = await sweepOrphanBlobs(sweep);
    expect(real.success && real.data.removed).toBe(2);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(ghost)).toBe(false);
  });
});
