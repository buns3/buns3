import { beforeEach, describe, expect, test } from "bun:test";
import pino from "pino";
import { createServer } from "../server";
import { capturedLogs, logger as rootLogger } from "$/lib/logger";
import { resetStorage, seedBucket, seedKey, seedObject } from "../../../../test/helpers";

// The request log through a captured pino stream. The one rule with teeth:
// a presigned URL IS a credential, so the query string never reaches a log.

type Line = Record<string, unknown>;
const lines: Line[] = [];
const logger = pino({ level: "info" }, { write: (s: string) => void lines.push(JSON.parse(s)) });
const app = createServer({ logger });

const requests = () => lines.filter((l) => l.msg === "request");
const get = (url: string, token?: string) =>
  app.handle(new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

beforeEach(async () => {
  await resetStorage();
  lines.length = 0;
  capturedLogs.length = 0;
});

describe("request log", () => {
  test("one line per request, with method, path, status, duration and id", async () => {
    await get("http://buns3.test/_server");
    const [line] = requests();
    expect(requests()).toHaveLength(1);
    expect(line).toMatchObject({ method: "GET", path: "/_server", status: 401 });
    expect(typeof line!.requestId).toBe("string");
    expect(typeof line!.ms).toBe("number");
  });

  test("a healthy /_health logs at debug, not info — it is polled every 10s", async () => {
    await get("http://buns3.test/_health");
    expect(requests()).toHaveLength(0);
    const debugLogger = pino({ level: "debug" }, { write: (s: string) => void lines.push(JSON.parse(s)) });
    await createServer({ logger: debugLogger }).handle(new Request("http://buns3.test/_health"));
    expect(requests().map((l) => l.level)).toEqual([20]);
  });

  test("GET / is a page for humans and stays at info", async () => {
    await get("http://buns3.test/");
    expect(requests().map((l) => l.status)).toEqual([200]);
  });

  test("a presigned request is logged without its query string", async () => {
    await seedBucket("b");
    await seedObject("b", "secret.txt");
    const { token } = await seedKey({ name: "d", bucketName: "b", canRead: true });
    const minted = await app.handle(
      new Request("http://buns3.test/_self/presign", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ method: "GET", bucket: "b", key: "secret.txt", ttl: 60 }),
      }),
    );
    const { url } = (await minted.json()) as { url: string };
    expect(url).toContain("sig=");
    lines.length = 0;

    const res = await get(url);
    expect(res.status).toBe(200);

    const [line] = requests();
    expect(line).toMatchObject({ path: "/b/secret.txt", status: 200, auth: "presign" });
    const serialised = JSON.stringify(line);
    for (const secret of ["sig=", "keyId=", "expires=", "?"]) {
      expect(serialised).not.toContain(secret);
    }
  });

  test("the Authorization header never appears in a line", async () => {
    const { token } = await seedKey({ name: "admin", isAdmin: true });
    await get("http://buns3.test/_server", token);
    expect(JSON.stringify(requests())).not.toContain(token);
  });

  test("auth kind is recorded per credential, and absent where no macro ran", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");
    const { token } = await seedKey({ name: "admin", isAdmin: true });

    await get("http://buns3.test/pub/a.txt");
    await get("http://buns3.test/_server", token);
    await get("http://buns3.test/");

    expect(requests().map((l) => l.auth)).toEqual(["anonymous", "key", undefined]);
  });

  test("at debug, a rejected presign says why, and still never the signature", async () => {
    // Module children inherit the root's level, so raise it there for this test.
    const debugApp = createServer({ logger: rootLogger });
    rootLogger.level = "debug";
    const debugLines = capturedLogs;
    try {
    await seedBucket("b");
    await seedObject("b", "a.txt");
    const { token } = await seedKey({ name: "d", bucketName: "b", canRead: true });
    const minted = await debugApp.handle(
      new Request("http://buns3.test/_self/presign", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ method: "GET", bucket: "b", key: "a.txt", ttl: 60 }),
      }),
    );
    const { url } = (await minted.json()) as { url: string };
    debugLines.length = 0;

    const tampered = url.replace(/sig=([0-9a-f]{8})/, "sig=deadbeef");
    expect((await debugApp.handle(new Request(tampered))).status).toBe(401);

    const why = debugLines.find((l) => l.msg === "presigned signature rejected");
    expect(why).toMatchObject({ module: "api-keys", failure: "mismatch" });
    const all = JSON.stringify(debugLines);
    expect(all).not.toContain("deadbeef");
    expect(all).not.toContain("sig=");
    } finally {
      rootLogger.level = "info";
    }
  });

  test("control-plane lifecycle is logged at info, never with a token", async () => {
    const { token } = await seedKey({ name: "admin", isAdmin: true });
    capturedLogs.length = 0;
    await app.handle(new Request("http://buns3.test/_admin/buckets/fresh", { method: "PUT", headers: { authorization: `Bearer ${token}` } }));
    expect(capturedLogs.find((l) => l.msg === "bucket created")).toMatchObject({ module: "storage", bucket: "fresh" });
    expect(JSON.stringify(capturedLogs)).not.toContain(token);
  });

  test("error responses are logged with their status and an id", async () => {
    await get("http://buns3.test/priv/a.txt");
    await get("http://buns3.test/bad_name");
    expect(requests().map((l) => l.status)).toEqual([401, 422]);
    // The 422 is thrown in a transform, before any derive: the id must still be there.
    for (const line of requests()) expect(typeof line.requestId).toBe("string");
  });
});
