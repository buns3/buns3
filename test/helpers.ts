// Tier-2 helpers. Imported by test files only — by then the preload has
// pointed SQLITE_PATH/DATA_PATH at the run's throwaway dirs, so importing
// project modules here is safe.
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { db } from "$/modules/prisma/db";
import { bucketStorage } from "$/modules/storage/bucket";
import { fileStorage } from "$/modules/storage/file-storage";
import { apiKeyStorage } from "$/modules/api-keys/api-key-storage";

// Wipe all rows (FK order) and all bucket dirs, keeping .tmp. Tests that
// touch the DB or disk call this in beforeEach — isolation is explicit,
// tier-1 files never pay for it.
export async function resetStorage() {
  // The ORM forbids unfiltered deletes at the TYPE level (`this: never` on a
  // where-less deleteAll) even though the runtime executes them — probed. The
  // always-true predicate is the accepted tax for a deliberate full wipe.
  await db.orm.Object.where((o) => o.id.isNotNull()).deleteAll();
  await db.orm.ApiKey.where((k) => k.id.isNotNull()).deleteAll();
  await db.orm.Bucket.where((b) => b.name.isNotNull()).deleteAll();

  const dataPath = process.env.DATA_PATH!;
  for (const entry of readdirSync(dataPath)) {
    if (entry === ".tmp") continue;
    rmSync(path.join(dataPath, entry), { recursive: true, force: true });
  }
}

// Seeds go through the real storage APIs, never raw SQL — a seed that breaks
// is itself a finding.
export async function seedBucket(name: string, opts?: { publicRead?: boolean }) {
  const created = await bucketStorage.create(name);
  if (!created.success) throw new Error(`seedBucket(${name}): ${created.code}`);
  if (opts?.publicRead) {
    const updated = await bucketStorage.update(name, { publicRead: true });
    if (!updated.success) throw new Error(`seedBucket(${name}): ${updated.code}`);
  }
  return created.bucket;
}

export async function seedKey(input: {
  name: string;
  bucketName?: string;
  canRead?: boolean;
  canWrite?: boolean;
  isAdmin?: boolean;
}) {
  const result = await apiKeyStorage.create({
    name: input.name,
    bucketName: input.bucketName ?? null,
    canRead: input.canRead ?? false,
    canWrite: input.canWrite ?? false,
    isAdmin: input.isAdmin ?? false,
  } as Parameters<typeof apiKeyStorage.create>[0]);
  if (!result.success) throw new Error(`seedKey(${input.name}): ${result.code}`);
  return result.data; // { apiKey, token } — token only exists here
}

export async function seedObject(bucket: string, key: string, content = "test content") {
  const result = await fileStorage.put(
    bucket,
    key,
    new Blob([content]).stream(),
    "text/plain",
  );
  if (!result.success) throw new Error(`seedObject(${bucket}/${key}): ${result.code}`);
  return result.object;
}

export const dataPath = () => process.env.DATA_PATH!;
export const blobPath = (bucket: string, id: string) =>
  path.join(dataPath(), bucket, id);
