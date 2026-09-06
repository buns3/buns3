import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createServer } from "../server";
import { capturedLogs, logger } from "$/lib/logger";
import { dataPath, resetStorage } from "../../../../test/helpers";

const app = createServer({ logger });
const health = () => app.handle(new Request("http://buns3.test/_health"));
const tmp = () => path.join(dataPath(), ".tmp");

beforeEach(async () => {
  await resetStorage();
  capturedLogs.length = 0;
});

describe("GET /_health", () => {
  test("is unauthenticated and reports both checks", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: { db: "ok", storage: "ok" } });
  });

  test("a missing data directory is a 503 that names the failing check", async () => {
    // The volume-mounted-wrong case, as far as a test can fake it.
    rmSync(tmp(), { recursive: true, force: true });
    try {
      const res = await health();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "degraded", checks: { db: "ok", storage: "degraded" } });
      const logged = capturedLogs.find((l) => l.msg === "storage health check failed");
      expect(logged).toMatchObject({ module: "storage" });
      expect(logged!.level).toBe(50);
      expect(capturedLogs.find((l) => l.msg === "request")).toMatchObject({ path: "/_health", status: 503, level: 30 });
    } finally {
      mkdirSync(tmp(), { recursive: true });
      expect(existsSync(tmp())).toBe(true);
    }
  });
});
