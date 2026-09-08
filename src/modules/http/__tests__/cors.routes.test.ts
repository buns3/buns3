import { beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "../server";
import { resetStorage, seedBucket, seedKey, seedObject } from "../../../../test/helpers";

// Route-level: CORS through the real app, with the real auth macros in front.
//
// The seam is `createServer({ corsOrigins })`, because the header set is decided
// once when the app is built. A configured server is built explicitly where it
// is needed.
//
// `off` relies on the preload's `delete process.env.CORS_ORIGINS`, and has to:
// the seam CANNOT express "off" explicitly, because `corsOrigins` defaults to
// `config.CORS_ORIGINS` and passing `undefined` fires that default rather than
// overriding it. Removing the preload pin therefore fails these three tests —
// loudly, which is the point, since a developer's .env would otherwise rewrite
// what every object response asserts.

const off = createServer();
const on = createServer({ corsOrigins: ["https://app.example.com", "http://localhost:*"] });
const any = createServer({ corsOrigins: "*" });

const send = (app: ReturnType<typeof createServer>, path: string, init?: RequestInit) =>
  app.handle(new Request(`http://buns3.test${path}`, init));

const from = (origin: string) => ({ origin });
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(resetStorage);

describe("a cacheable response must say it varies by origin", () => {
  test("public object + allowed origin: Vary carries Origin next to the shared cache directive", async () => {
    // The whole reason this feature needs a test. An anonymous read of a
    // public bucket is `public, max-age=60`, so Cloudflare stores it. If that
    // stored copy carries one site's Access-Control-Allow-Origin and does not
    // say it varies by Origin, the edge hands that grant to every other site.
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    const res = await send(on, "/pub/a.txt", { headers: from("https://app.example.com") });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(res.headers.get("vary")).toBe("Authorization, Origin");
  });

  test("with CORS off the object response claims no origin variance", async () => {
    // Nothing varies by Origin when no origin is ever echoed, and claiming
    // otherwise would split every cache entry for nothing.
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    const res = await send(off, "/pub/a.txt", { headers: from("https://app.example.com") });
    expect(res.status).toBe(200);
    expect(res.headers.get("vary")).toBe("Authorization");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("Vary is stated even when the origin is refused", async () => {
    // The refusal itself is origin-dependent, so a cache must not reuse it.
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    const res = await send(on, "/pub/a.txt", { headers: from("https://evil.example") });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Authorization, Origin");
  });
});

describe("unset means genuinely off", () => {
  test("no Access-Control header is sent at all", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    const res = await send(off, "/pub/a.txt", { headers: from("https://app.example.com") });
    const cors = [...res.headers.keys()].filter((h) => h.startsWith("access-control"));
    expect(cors).toEqual([]);
  });

  test("a preflight is not answered", async () => {
    const res = await send(off, "/pub/a.txt", {
      method: "OPTIONS",
      headers: { ...from("https://app.example.com"), "access-control-request-method": "GET" },
    });
    expect(res.status).not.toBe(204);
  });
});

describe("preflight is answered before auth", () => {
  test("a private object preflights without a credential", async () => {
    // A browser cannot attach the Authorization header until the preflight
    // succeeds, so answering 401 here would make every authenticated
    // cross-origin call impossible.
    await seedBucket("priv");
    await seedObject("priv", "a.txt");

    const res = await send(on, "/priv/a.txt", {
      method: "OPTIONS",
      headers: { ...from("https://app.example.com"), "access-control-request-method": "GET" },
    });
    expect(res.status).toBe(204);
  });

  test("a preflight discloses nothing about a bucket that does not exist", async () => {
    const missing = await send(on, "/nosuchbucket/a.txt", {
      method: "OPTIONS",
      headers: { ...from("https://app.example.com"), "access-control-request-method": "GET" },
    });
    const present = await send(on, "/priv/a.txt", {
      method: "OPTIONS",
      headers: { ...from("https://app.example.com"), "access-control-request-method": "GET" },
    });
    expect(missing.status).toBe(present.status);
  });

  test("the preflight allows Authorization, or the header could never be sent", async () => {
    const res = await send(on, "/priv/a.txt", {
      method: "OPTIONS",
      headers: {
        ...from("https://app.example.com"),
        "access-control-request-method": "PUT",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(res.headers.get("access-control-max-age")).toBe("600");
  });
});

describe("what a browser is allowed to read back", () => {
  test("Location is exposed, or every cross-origin write reports a null location", async () => {
    // The SDK reads this header on put, putChunked, presigned put, upload
    // complete and bucket create. An unexposed header is simply absent to
    // JavaScript, so the write would succeed while the client saw nothing.
    await seedBucket("b");
    const { token } = await seedKey({ name: "w", bucketName: "b", canWrite: true });

    const res = await send(on, "/b/a.txt", {
      method: "PUT",
      headers: { ...from("https://app.example.com"), ...auth(token), "content-type": "text/plain" },
      body: "hi",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/b/a.txt");
    expect(res.headers.get("access-control-expose-headers")).toContain("Location");
  });

  test("ETag is exposed, since conditional requests are the client's job", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    const res = await send(on, "/pub/a.txt", { headers: from("https://app.example.com") });
    expect(res.headers.get("access-control-expose-headers")).toContain("ETag");
  });
});

describe("credentials are never granted", () => {
  test("Access-Control-Allow-Credentials is absent, on every configuration", async () => {
    // buns3 authenticates with a Bearer header, not cookies. Granting
    // credentialed CORS would buy nothing and would forbid "*".
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    for (const app of [on, any]) {
      const res = await send(app, "/pub/a.txt", { headers: from("https://app.example.com") });
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });
});

describe("the configured globs apply end to end", () => {
  beforeEach(async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");
  });

  test.each([
    ["https://app.example.com", "https://app.example.com"],
    ["http://localhost:5173", "http://localhost:5173"],
    ["http://localhost:5174", "http://localhost:5174"],
  ])("%s is allowed", async (origin, echoed) => {
    const res = await send(on, "/pub/a.txt", { headers: from(origin) });
    expect(res.headers.get("access-control-allow-origin")).toBe(echoed);
  });

  test.each([
    "https://evil.example",
    "http://app.example.com",
    "https://app.example.com.attacker.net",
    "http://localhost",
  ])("%s is refused", async (origin) => {
    const res = await send(on, "/pub/a.txt", { headers: from(origin) });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test('"*" allows an origin no list would name', async () => {
    const res = await send(any, "/pub/a.txt", { headers: from("https://anything.example") });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
