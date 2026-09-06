import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { type } from "arktype";
import type { Buns3ErrorCode } from "$/lib/error-codes";
import { db } from "$/modules/prisma/db";
import { BucketName } from "$/modules/validation/bucket";
import { BASE_PATH, TEMP_DIR_NAME } from "./constants";
import { isErrnoException } from "./errors";

export type SweepOptions = {
  olderThanMs: number;
  dryRun: boolean;
};

export type SweepData = {
  scanned: number;
  removed: number;
  skipped: number;
  errors: number;
};

export type SweepResult =
  | { success: true; data: SweepData }
  | { success: false; code: Buns3ErrorCode };

const OUTCOMES = [
  "removed",
  "fresh",
  "owned",
  "not-a-uuid",
  "not-a-file",
  "vanished",
  "error",
] as const;

type Outcome = (typeof OUTCOMES)[number];
type Counts = Record<Outcome, number>;

const TEMP_PATH = path.resolve(BASE_PATH, TEMP_DIR_NAME);
const Uuid = type("string.uuid");

function emptyCounts(): Counts {
  return Object.fromEntries(OUTCOMES.map((k) => [k, 0])) as Counts;
}

function add(a: Counts, b: Counts): Counts {
  return Object.fromEntries(OUTCOMES.map((k) => [k, a[k] + b[k]])) as Counts;
}

function total(counts: Counts): number {
  return OUTCOMES.reduce((n, k) => n + counts[k], 0);
}

function summarize(counts: Counts, failures = 0): SweepData {
  return {
    scanned: total(counts),
    removed: counts.removed,
    skipped: counts.fresh + counts["not-a-file"] + counts["not-a-uuid"],
    errors: counts.error + failures,
  };
}

function isGone(err: unknown): boolean {
  return (
    isErrnoException(err) &&
    (err.code === "ENOENT" || err.code === "ENOTEMPTY")
  );
}

async function sweepFile(
  filePath: string,
  cutoff: number,
  dryRun: boolean,
): Promise<Outcome> {
  const file = Bun.file(filePath);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return "not-a-file";
    if (stat.mtimeMs >= cutoff) return "fresh";

    if (!dryRun) await file.unlink();
    return "removed";
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return "vanished";

    console.error("cleanup: could not remove", filePath, err);
    return "error";
  }
}

function classifyRootEntry(entry: Dirent): "bucket" | "temp" | "file" | "unknown" {
  if (!entry.isDirectory()) return "file";
  if (entry.name === TEMP_DIR_NAME) return "temp";
  return BucketName(entry.name) instanceof type.errors ? "unknown" : "bucket";
}

async function sweepBucketDir(
  name: string,
  cutoff: number,
  dryRun: boolean,
): Promise<{ counts: Counts; failures: number }> {
  const dir = path.resolve(BASE_PATH, name);
  const bucket = await db.orm.Bucket.select("name").first({ name });
  const rows = await db.orm.Object.select("id").where({ bucketName: name }).all();
  const owned = new Set(rows.map((o) => o.id));
  const counts = emptyCounts();
  let dirIsOld = false;

  try {
    dirIsOld = (await fs.stat(dir)).mtimeMs < cutoff;
    for await (const entry of await fs.opendir(dir)) {
      if (owned.has(entry.name)) {
        counts.owned++;
      } else if (Uuid(entry.name) instanceof type.errors) {
        console.warn("cleanup: not a blob, leaving alone", path.join(dir, entry.name));
        counts["not-a-uuid"]++;
      } else {
        counts[await sweepFile(path.resolve(dir, entry.name), cutoff, dryRun)]++;
      }
    }
  } catch (err) {
    console.error("cleanup: could not read bucket dir", dir, err);
    return { counts, failures: 1 };
  }

  if (bucket || !dirIsOld) return { counts, failures: 0 };

  const remaining = total(counts) - counts.removed - counts.vanished;
  if (remaining > 0) return { counts, failures: 0 };

  try {
    if (!dryRun) await fs.rmdir(dir);
    console.warn(`cleanup: ${dryRun ? "would remove" : "removed"} rowless bucket dir`, dir);
    return { counts, failures: 0 };
  } catch (err) {
    if (isGone(err)) return { counts, failures: 0 };

    console.error("cleanup: could not remove bucket dir", dir, err);
    return { counts, failures: 1 };
  }
}

export async function sweepTempFiles(opts: SweepOptions): Promise<SweepResult> {
  const cutoff = Date.now() - opts.olderThanMs;
  const counts = emptyCounts();

  try {
    for await (const entry of await fs.opendir(TEMP_PATH)) {
      counts[await sweepFile(path.resolve(TEMP_PATH, entry.name), cutoff, opts.dryRun)]++;
    }
    return { success: true, data: summarize(counts) };
  } catch (err) {
    console.error("cleanup: could not read temp dir", TEMP_PATH, err);
    return { success: false, code: "FS_ERROR" };
  }
}

export async function sweepOrphanBlobs(opts: SweepOptions): Promise<SweepResult> {
  const cutoff = Date.now() - opts.olderThanMs;
  let counts = emptyCounts();
  let failures = 0;

  try {
    for await (const entry of await fs.opendir(BASE_PATH)) {
      switch (classifyRootEntry(entry)) {
        case "file":
        case "temp":
          continue;
        case "unknown":
          console.warn("cleanup: not a bucket dir, leaving alone", path.join(BASE_PATH, entry.name));
          continue;
        case "bucket": {
          const swept = await sweepBucketDir(entry.name, cutoff, opts.dryRun);
          counts = add(counts, swept.counts);
          failures += swept.failures;
        }
      }
    }
    return { success: true, data: summarize(counts, failures) };
  } catch (err) {
    console.error("cleanup: could not read data dir", BASE_PATH, err);
    return { success: false, code: "FS_ERROR" };
  }
}
