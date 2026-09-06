import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "../server";
import {
  blobPath,
  dataPath,
  resetStorage,
  seedBucket,
  seedKey,
  seedObject,
} from "../../../../test/helpers";

const app = createServer();
const HOUR = 60 * 60 * 1000;
const codeOf = async (res: Response) => ((await res.json()) as { code: string }).code;

const post = (init?: { token?: string; body?: unknown }) =>
  app.handle(
    new Request("http://buns3.test/_admin/cleanup", {
      method: "POST",
      headers: {
        ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
  );

async function plantOrphan(bucket: string, ageMs: number) {
  const file = blobPath(bucket, crypto.randomUUID());
  await writeFile(file, "x");
  const then = new Date(Date.now() - ageMs);
  await utimes(file, then, then);
  return file;
}

beforeEach(async () => {
  await resetStorage();
  const tmp = path.join(dataPath(), ".tmp");
  for (const entry of readdirSync(tmp)) {
    rmSync(path.join(tmp, entry), { recursive: true, force: true });
  }
});

describe("POST /_admin/cleanup", () => {
  test("runs both sweeps for real by default and reports each", async () => {
    await seedBucket("b");
    const object = await seedObject("b", "k.txt");
    const orphan = await plantOrphan("b", 2 * HOUR);
    const { token } = await seedKey({ name: "admin", isAdmin: true });

    const res = await post({ token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dryRun: false,
      temp: { success: true, data: { scanned: 0, removed: 0, skipped: 0, errors: 0 } },
      orphans: { success: true, data: { scanned: 2, removed: 1, skipped: 0, errors: 0 } },
    });
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(blobPath("b", object.id))).toBe(true);
  });

  test("dryRun reports without removing", async () => {
    await seedBucket("b");
    const orphan = await plantOrphan("b", 2 * HOUR);
    const { token } = await seedKey({ name: "admin", isAdmin: true });

    const res = await post({ token, body: { dryRun: true } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { dryRun: boolean; orphans: { data: { removed: number } } };
    expect(json.dryRun).toBe(true);
    expect(json.orphans.data.removed).toBe(1);
    expect(existsSync(orphan)).toBe(true);
  });

  test("the age gate cannot be set by the client", async () => {
    // An extra key is ignored, and the server's own gate keeps a fresh orphan.
    await seedBucket("b");
    const fresh = await plantOrphan("b", 0);
    const { token } = await seedKey({ name: "admin", isAdmin: true });

    const res = await post({ token, body: { olderThanMs: 0 } });
    expect(res.status).toBe(200);
    expect(existsSync(fresh)).toBe(true);
  });

  test("a malformed body is a 422", async () => {
    const { token } = await seedKey({ name: "admin", isAdmin: true });

    const res = await post({ token, body: { dryRun: "yes" } });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("VALIDATION_ERROR");
  });

  test("admin plane: anonymous is 401, a data key is 403", async () => {
    await seedBucket("b");
    const { token } = await seedKey({
      name: "d",
      bucketName: "b",
      canRead: true,
      canWrite: true,
    });

    expect((await post()).status).toBe(401);
    const denied = await post({ token });
    expect(denied.status).toBe(403);
    expect(await codeOf(denied)).toBe("API_KEY_NOT_CAPABLE");
  });
});
