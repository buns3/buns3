import { beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "../server";
import {
  resetStorage,
  seedBucket,
  seedKey,
  seedObject,
} from "../../../../test/helpers";

// Route-level tier-2 tests: the real app, the real DB and filesystem, no port.
// createServer() returns the Elysia instance without listening, so
// app.handle(new Request(...)) exercises macros, auth, handlers and error
// rendering exactly as a socket would.

const app = createServer();

const get = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://buns3.test${path}`, init));

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(resetStorage);

describe("Cache-Control follows the credential", () => {
  test("anonymous read of a public bucket is publicly cacheable", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    const res = await get("/pub/a.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });

  test("a read with a key is never cacheable, even on a PUBLIC bucket", async () => {
    // The content is public, but the response was authenticated — HTTP says
    // such responses are not shared-cacheable, and buns3 judges a presented
    // key as that key regardless of the bucket flag.
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");
    const { token } = await seedKey({
      name: "reader",
      bucketName: "pub",
      canRead: true,
    });

    const res = await get("/pub/a.txt", { headers: auth(token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a read of a PRIVATE bucket with a key is not cacheable", async () => {
    await seedBucket("priv");
    await seedObject("priv", "a.txt");
    const { token } = await seedKey({
      name: "reader",
      bucketName: "priv",
      canRead: true,
    });

    const res = await get("/priv/a.txt", { headers: auth(token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("Vary: Authorization on every object response — one URL, two callers", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");
    const { token } = await seedKey({
      name: "reader",
      bucketName: "pub",
      canRead: true,
    });

    expect((await get("/pub/a.txt")).headers.get("vary")).toBe("Authorization");
    expect(
      (await get("/pub/a.txt", { headers: auth(token) })).headers.get("vary"),
    ).toBe("Authorization");
  });

  test("HEAD carries the same directives as GET — they must agree", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    const head = await get("/pub/a.txt", { method: "HEAD" });
    const body = await get("/pub/a.txt");
    expect(head.headers.get("cache-control")).toBe(
      body.headers.get("cache-control"),
    );
    expect(head.headers.get("etag")).toBe(body.headers.get("etag"));
  });

  test("responses that are not objects state nothing, so a CDN bypasses them", async () => {
    // Fail-closed: listings, admin and errors opt OUT by never opting in.
    await seedBucket("pub", { publicRead: true });
    const { token } = await seedKey({
      name: "lister",
      bucketName: "pub",
      canRead: true,
    });

    const listing = await get("/pub", { headers: auth(token) });
    expect(listing.status).toBe(200);
    expect(listing.headers.get("cache-control")).toBeNull();

    const unauthorized = await get("/pub/a.txt", {
      headers: auth("buns3_notarealtoken"),
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBeNull();
  });
});

describe("conditional requests", () => {
  test("a matching ETag gets 304 with no body", async () => {
    await seedBucket("pub", { publicRead: true });
    const object = await seedObject("pub", "a.txt", "hello");

    const res = await get("/pub/a.txt", {
      headers: { "if-none-match": `"${object.id}"` },
    });
    expect(res.status).toBe(304);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  test("a 304 carries validators and directives but NOT payload headers", async () => {
    await seedBucket("pub", { publicRead: true });
    const object = await seedObject("pub", "a.txt");

    const res = await get("/pub/a.txt", {
      headers: { "if-none-match": `"${object.id}"` },
    });
    expect(res.headers.get("etag")).toBe(`"${object.id}"`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("vary")).toBe("Authorization");
    expect(res.headers.get("last-modified")).not.toBeNull();
    // A 304 describes no representation, so these must be absent.
    expect(res.headers.get("content-type")).toBeNull();
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
  });

  test("a stale ETag gets the object back, payload headers and all", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt", "hello");

    const res = await get("/pub/a.txt", {
      headers: { "if-none-match": '"11111111-2222-3333-4444-555555555555"' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hello");
  });

  test("an overwrite invalidates a previously issued validator", async () => {
    // The ETag is the blob id, and a write mints a new blob — so the old
    // validator stops matching without anyone tracking versions.
    await seedBucket("pub", { publicRead: true });
    const first = await seedObject("pub", "a.txt", "one");
    await seedObject("pub", "a.txt", "two");

    const res = await get("/pub/a.txt", {
      headers: { "if-none-match": `"${first.id}"` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("two");
  });

  test("HEAD answers conditionally too", async () => {
    await seedBucket("pub", { publicRead: true });
    const object = await seedObject("pub", "a.txt");

    const res = await get("/pub/a.txt", {
      method: "HEAD",
      headers: { "if-none-match": `"${object.id}"` },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("content-length")).toBeNull();
  });

  test("an authenticated 304 still says no-store", async () => {
    await seedBucket("priv");
    const object = await seedObject("priv", "a.txt");
    const { token } = await seedKey({
      name: "reader",
      bucketName: "priv",
      canRead: true,
    });

    const res = await get("/priv/a.txt", {
      headers: { ...auth(token), "if-none-match": `"${object.id}"` },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a matching ETag does NOT bypass auth", async () => {
    // A 304 is a statement about content, so it must never be reachable by
    // someone who would get a 401 for the 200.
    await seedBucket("priv");
    const object = await seedObject("priv", "a.txt");

    const res = await get("/priv/a.txt", {
      headers: { "if-none-match": `"${object.id}"` },
    });
    expect(res.status).toBe(401);
  });

  test("a wildcard If-None-Match matches an existing object", async () => {
    await seedBucket("pub", { publicRead: true });
    await seedObject("pub", "a.txt");

    const res = await get("/pub/a.txt", { headers: { "if-none-match": "*" } });
    expect(res.status).toBe(304);
  });
});

describe("favicon", () => {
  test("answers 204 rather than being read as a bucket name", async () => {
    const res = await get("/favicon.ico");
    expect(res.status).toBe(204);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  test("is cacheable for a day", async () => {
    expect((await get("/favicon.ico")).headers.get("cache-control")).toBe(
      "public, max-age=86400",
    );
  });

  test("repeat calls work — the shared Response instance is not consumed", async () => {
    for (const _ of [1, 2, 3]) {
      expect((await get("/favicon.ico")).status).toBe(204);
    }
  });

  test("does not weaken validation for other root paths", async () => {
    // The exception is favicon.ico alone; a malformed bucket name still 422s
    // and a well-formed one still 401s, both before any lookup.
    expect((await get("/bad_name")).status).toBe(422);
    expect((await get("/notabucket")).status).toBe(401);
  });
});
