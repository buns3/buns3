import { beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "../server";
import { deriveKeyId, hashToken, signUpload } from "$/lib/presign";
import { config } from "$/config";
import {
  resetStorage,
  seedBucket,
  seedKey,
  seedObject,
} from "../../../../test/helpers";

// Route-level tier-2: the real app, no port. What matters here is that the
// session's bucket — which lives in a row, not the path — reaches the
// capability check, and that an unknown id never tells an anonymous caller
// whether it exists.

const app = createServer({});
const BASE = "http://buns3.test";

const req = (
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; body?: string } = {},
) =>
  app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.json !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
    }),
  );

let write = "";
let elsewhere = "";
let readOnly = "";
let admin = "";

async function open(key = "big.bin", contentType?: string) {
  const res = await req("POST", "/_uploads", {
    token: write,
    json: { bucket: "a", key, contentType },
  });
  const { upload } = (await res.json()) as { upload: { uploadId: string } };
  return upload.uploadId;
}

const codeOf = async (res: Response) =>
  ((await res.json()) as { code: string }).code;
const uploadOf = async (res: Response) =>
  ((await res.json()) as { upload: { size: number } }).upload;

const sizeOf = async (id: string) => {
  const res = await req("GET", `/_uploads/${id}`, { token: write });
  const { upload } = (await res.json()) as { upload: { size: number } };
  return upload.size;
};

beforeEach(async () => {
  await resetStorage();
  await seedBucket("a");
  await seedBucket("other");
  write = (await seedKey({ name: "w", bucketName: "a", canRead: true, canWrite: true })).token;
  elsewhere = (await seedKey({ name: "e", bucketName: "other", canRead: true, canWrite: true })).token;
  readOnly = (await seedKey({ name: "r", bucketName: "a", canRead: true })).token;
  admin = (await seedKey({ name: "adm", isAdmin: true })).token;
});

describe("POST /_uploads", () => {
  test("opens a session and points at it with Location", async () => {
    const res = await req("POST", "/_uploads", {
      token: write,
      json: { bucket: "a", key: "big.bin", contentType: "text/plain" },
    });
    expect(res.status).toBe(201);
    const { upload } = (await res.json()) as { upload: Record<string, unknown> };
    expect(upload).toMatchObject({
      bucket: "a",
      key: "big.bin",
      contentType: "text/plain",
      size: 0,
    });
    expect(res.headers.get("location")).toBe(`/_uploads/${upload.uploadId}`);
    // the row is never returned raw
    expect(upload).not.toHaveProperty("id");
    expect(upload).not.toHaveProperty("bucketName");
  });

  test("the body's bucket is what gets authorized, not merely a valid key", async () => {
    // No :id here, so the macro cannot supply a bucket; the handler authorizes
    // explicitly, and this is the test that it actually does.
    const res = await req("POST", "/_uploads", {
      token: elsewhere,
      json: { bucket: "a", key: "x" },
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("API_KEY_SCOPE_MISMATCH");
  });

  test.each([
    ["a read-only key", () => readOnly, 403, "API_KEY_NOT_CAPABLE"],
    ["an admin key, which is control plane only", () => admin, 403, "API_KEY_NOT_CAPABLE"],
  ])("%s is refused", async (_label, token, status, code) => {
    const res = await req("POST", "/_uploads", {
      token: token(),
      json: { bucket: "a", key: "x" },
    });
    expect(res.status).toBe(status);
    expect(await codeOf(res)).toBe(code);
  });

  test("anonymous is 401", async () => {
    const res = await req("POST", "/_uploads", { json: { bucket: "a", key: "x" } });
    expect(res.status).toBe(401);
  });

  test("a nonexistent bucket is refused without saying so", async () => {
    // 403, not 404: whether a bucket exists is not something to leak.
    const res = await req("POST", "/_uploads", {
      token: write,
      json: { bucket: "ghost", key: "x" },
    });
    expect(res.status).toBe(403);
  });

  test.each([
    ["a malformed bucket name", { bucket: "BAD", key: "x" }],
    ["a missing key", { bucket: "a" }],
    ["a slash-only key", { bucket: "a", key: "/" }],
  ])("%s is a 422, before auth is even consulted", async (_label, json) => {
    const res = await req("POST", "/_uploads", { token: elsewhere, json });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /_uploads/:id", () => {
  test("appends raw bytes and reports the new size", async () => {
    // parse: "none" is what keeps this a stream; without it the body is eaten.
    const id = await open();
    const first = await req("PATCH", `/_uploads/${id}`, { token: write, body: "hello " });
    expect(first.status).toBe(200);
    expect((await uploadOf(first)).size).toBe(6);

    const second = await req("PATCH", `/_uploads/${id}`, { token: write, body: "world" });
    expect((await uploadOf(second)).size).toBe(11);
  });

  test("a matching offset is accepted; a stale one is a 409 that changes nothing", async () => {
    const id = await open();
    await req("PATCH", `/_uploads/${id}`, { token: write, body: "abc" });

    const stale = await req("PATCH", `/_uploads/${id}?offset=0`, { token: write, body: "XXX" });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("OFFSET_MISMATCH");
    expect(await sizeOf(id)).toBe(3);

    const resumed = await req("PATCH", `/_uploads/${id}?offset=3`, { token: write, body: "def" });
    expect(resumed.status).toBe(200);
    expect(await sizeOf(id)).toBe(6);
  });

  test("a non-numeric offset is a 422", async () => {
    const id = await open();
    const res = await req("PATCH", `/_uploads/${id}?offset=abc`, { token: write, body: "x" });
    expect(res.status).toBe(422);
  });

  test("an empty body is allowed and changes nothing", async () => {
    const id = await open();
    const res = await req("PATCH", `/_uploads/${id}`, { token: write });
    expect(res.status).toBe(200);
    expect((await uploadOf(res)).size).toBe(0);
  });
});

describe("the session's bucket is what authorizes every :id route", () => {
  test.each([
    ["GET", (id: string) => `/_uploads/${id}`],
    ["PATCH", (id: string) => `/_uploads/${id}`],
    ["POST", (id: string) => `/_uploads/${id}/complete`],
    ["DELETE", (id: string) => `/_uploads/${id}`],
  ])("%s refuses a key scoped to another bucket", async (method, path) => {
    const id = await open();
    const res = await req(method, path(id), { token: elsewhere });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("API_KEY_SCOPE_MISMATCH");
  });

  test.each([
    ["GET", (id: string) => `/_uploads/${id}`],
    ["PATCH", (id: string) => `/_uploads/${id}`],
    ["POST", (id: string) => `/_uploads/${id}/complete`],
    ["DELETE", (id: string) => `/_uploads/${id}`],
  ])("%s answers an unknown id the same way it answers a real one, anonymously", async (method, path) => {
    const real = await open();
    const unknown = crypto.randomUUID();

    const toReal = await req(method, path(real));
    const toUnknown = await req(method, path(unknown));
    expect(toReal.status).toBe(401);
    expect(await toReal.text()).toBe(await toUnknown.text());
  });

  test("a valid key gets an honest 404 for an id that does not exist", async () => {
    const res = await req("GET", `/_uploads/${crypto.randomUUID()}`, { token: write });
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("UPLOAD_NOT_FOUND");
  });

  test("a malformed id is a 422 before any lookup", async () => {
    const res = await req("GET", "/_uploads/not-a-uuid", { token: write });
    expect(res.status).toBe(422);
  });
});

describe("POST /_uploads/:id/complete", () => {
  test("answers exactly as PUT does, and the object reads back", async () => {
    const id = await open("docs/readme.md", "text/plain");
    await req("PATCH", `/_uploads/${id}`, { token: write, body: "one " });
    await req("PATCH", `/_uploads/${id}`, { token: write, body: "two" });

    const done = await req("POST", `/_uploads/${id}/complete`, { token: write });
    expect(done.status).toBe(201);
    expect(await done.json()).toEqual({
      bucket: "a",
      key: "docs/readme.md",
      location: "/a/docs/readme.md",
    });
    expect(done.headers.get("location")).toBe("/a/docs/readme.md");

    const got = await req("GET", "/a/docs/readme.md", { token: write });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("text/plain");
    expect(await got.text()).toBe("one two");
  });

  test("the session is gone, so completing twice is an honest 404", async () => {
    const id = await open();
    await req("PATCH", `/_uploads/${id}`, { token: write, body: "x" });
    expect((await req("POST", `/_uploads/${id}/complete`, { token: write })).status).toBe(201);

    const again = await req("POST", `/_uploads/${id}/complete`, { token: write });
    expect(again.status).toBe(404);
    expect((await req("GET", `/_uploads/${id}`, { token: write })).status).toBe(404);
  });

  test("completing over an existing key replaces it", async () => {
    await seedObject("a", "doc.txt", "old");
    const id = await open("doc.txt");
    await req("PATCH", `/_uploads/${id}`, { token: write, body: "new" });
    await req("POST", `/_uploads/${id}/complete`, { token: write });

    const got = await req("GET", "/a/doc.txt", { token: write });
    expect(await got.text()).toBe("new");
  });
});

describe("DELETE /_uploads/:id", () => {
  test("throws the session away and answers 204", async () => {
    const id = await open();
    await req("PATCH", `/_uploads/${id}`, { token: write, body: "data" });

    const res = await req("DELETE", `/_uploads/${id}`, { token: write });
    expect(res.status).toBe(204);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
    expect((await req("GET", `/_uploads/${id}`, { token: write })).status).toBe(404);
  });

  test("aborting twice is honest about the second time", async () => {
    const id = await open();
    await req("DELETE", `/_uploads/${id}`, { token: write });
    expect((await req("DELETE", `/_uploads/${id}`, { token: write })).status).toBe(404);
  });
});

describe("presigned upload sessions", () => {
  // A session IS the grant: one signature covers every chunk and the finish,
  // because order and offset are the server's business. That is what makes
  // this cheaper than S3 multipart, which needs a presign per part.
  const expires = () => Math.floor(Date.now() / 1000) + 600;

  const signed = async (
    uploadId: string,
    over: Record<string, string | number> = {},
  ) => {
    const tokenHash = hashToken(write);
    const exp = expires();
    const params = new URLSearchParams({
      keyId: deriveKeyId(tokenHash),
      expires: String(exp),
      sig: signUpload({ tokenHash, uploadId, expires: exp }),
      ...Object.fromEntries(
        Object.entries(over).map(([k, v]) => [k, String(v)]),
      ),
    });
    return `?${params}`;
  };

  const anon = (method: string, path: string, body?: string) =>
    app.handle(new Request(`${BASE}${path}`, { method, body }));

  test("one signature carries the whole upload, with no key on the request", async () => {
    const id = await open("browser.bin");
    const q = await signed(id);

    expect((await anon("PATCH", `/_uploads/${id}${q}`, "one ")).status).toBe(200);
    expect((await anon("PATCH", `/_uploads/${id}${q}`, "two")).status).toBe(200);

    const got = await anon("GET", `/_uploads/${id}${q}`);
    expect((await uploadOf(got)).size).toBe(7);

    const done = await anon("POST", `/_uploads/${id}/complete${q}`);
    expect(done.status).toBe(201);

    const object = await req("GET", "/a/browser.bin", { token: write });
    expect(await object.text()).toBe("one two");
  });

  test("aborting is not part of the grant", async () => {
    // Destructive, and a browser never needs it — the minting client can abort
    // with its own key. Cheap to add later, impossible to take back.
    const id = await open();
    const res = await anon("DELETE", `/_uploads/${id}${await signed(id)}`);
    expect(res.status).toBe(401);
    expect((await req("GET", `/_uploads/${id}`, { token: write })).status).toBe(200);
  });

  test("a signature for one session does not open another", async () => {
    const mine = await open("mine.bin");
    const yours = await open("yours.bin");

    const res = await anon("PATCH", `/_uploads/${yours}${await signed(mine)}`, "x");
    expect(res.status).toBe(401);
    expect(await sizeOf(yours)).toBe(0);
  });

  test.each([
    ["a tampered signature", { sig: "0".repeat(64) }],
    ["a malformed signature", { sig: "nope" }],
    ["an unknown keyId", { keyId: "f".repeat(64) }],
  ])("%s is refused", async (_label, over) => {
    const id = await open();
    const res = await anon("PATCH", `/_uploads/${id}${await signed(id, over)}`, "x");
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe("INVALID_API_KEY");
  });

  test("an expired signature says so, and the others do not", async () => {
    // The one presign failure with its own code; everything else collapses to
    // INVALID_API_KEY so a prober learns nothing.
    const id = await open();
    const res = await anon("PATCH", `/_uploads/${id}${await signed(id, { expires: 1 })}`, "x");
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe("PRESIGNED_EXPIRED");
  });

  test("an unknown session answers exactly as a real one does, unsigned", async () => {
    const real = await open();
    const unknown = crypto.randomUUID();
    const bad = { sig: "0".repeat(64) };

    const toReal = await anon("GET", `/_uploads/${real}${await signed(real, bad)}`);
    const toUnknown = await anon("GET", `/_uploads/${unknown}${await signed(unknown, bad)}`);
    expect(toReal.status).toBe(401);
    expect(await toReal.text()).toBe(await toUnknown.text());
  });

  test("an upload signature is not a data-plane signature", async () => {
    // Different identifier in the canonical string; neither can be replayed as
    // the other.
    const id = await open();
    const res = await anon("GET", `/a/big.bin${await signed(id)}`);
    expect(res.status).toBe(401);
  });

  test("the session's own bucket still bounds it", async () => {
    // The signature proves the minter could write this session; the session
    // was created against one bucket and key and cannot reach another.
    const id = await open("scoped.bin");
    await anon("PATCH", `/_uploads/${id}${await signed(id)}`, "data");
    await anon("POST", `/_uploads/${id}/complete${await signed(id)}`);

    expect((await req("GET", "/a/scoped.bin", { token: write })).status).toBe(200);
    expect((await req("GET", "/other/scoped.bin", { token: elsewhere })).status).toBe(404);
  });
});

describe("POST /_uploads/:id/presign", () => {
  const mint = (id: string, body: unknown, token?: string) =>
    app.handle(
      new Request(`${BASE}/_uploads/${id}/presign`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );

  test("mints a URL that works with no credentials on the request", async () => {
    const id = await open("minted.bin");
    const res = await mint(id, { ttl: 600 }, write);
    expect(res.status).toBe(200);

    const { url, expires } = (await res.json()) as { url: string; expires: number };
    expect(url).toContain(`/_uploads/${id}?`);
    expect(expires).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const local = url.replace(config.BASE_URL, BASE);
    expect((await app.handle(new Request(local, { method: "PATCH", body: "bytes" }))).status).toBe(200);
    expect(await sizeOf(id)).toBe(5);
  });

  test("a URL cannot mint another URL", async () => {
    // Presigned credentials are a grant to finish one upload, not to hand out
    // further grants.
    const id = await open();
    const minted = await mint(id, { ttl: 600 }, write);
    const { url } = (await minted.json()) as { url: string };
    const query = url.slice(url.indexOf("?"));

    const res = await app.handle(
      new Request(`${BASE}/_uploads/${id}/presign${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttl: 60 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test.each([
    ["a read-only key", () => readOnly, 403],
    ["a key scoped elsewhere", () => elsewhere, 403],
    ["no credentials", () => undefined, 401],
  ])("%s cannot mint", async (_label, token, expected) => {
    const id = await open();
    expect((await mint(id, { ttl: 600 }, token())).status).toBe(expected);
  });

  test("the ttl is capped, so a URL cannot outlive the session by much", async () => {
    const id = await open();
    expect((await mint(id, { ttl: 60 * 60 * 24 * 8 }, write)).status).toBe(422);
    expect((await mint(id, { ttl: -1 }, write)).status).toBe(422);
  });

  test("an unknown session is a 404 for a valid key", async () => {
    expect((await mint(crypto.randomUUID(), { ttl: 60 }, write)).status).toBe(404);
  });
});
