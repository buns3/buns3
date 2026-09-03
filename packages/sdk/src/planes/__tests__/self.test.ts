import { describe, expect, test } from "bun:test";
import type { Http, RequestOptions } from "../../http";
import { PRESIGN_HTTP_METHODS } from "../../lib/presign";
import { createSelf } from "../self";
import { ok } from "../../result";
import type { ApiKey, Result } from "../../types";

// --- fakes -----------------------------------------------------------------

type Call = { path: string; init: RequestOptions | undefined };

function fakeHttp(
  responder: (call: Call) => unknown = () => new Response(null, { status: 204 }),
) {
  const calls: Call[] = [];
  const http: Http = {
    request: async (path, init) => {
      calls.push({ path, init });
      return ok(responder({ path, init }) as Response) as Result<Response>;
    },
    requestJson: async <T,>(path: string, init?: RequestOptions) => {
      calls.push({ path, init });
      return ok(responder({ path, init }) as T) as Result<T>;
    },
  };
  return { http, calls, self: createSelf(http) };
}

const last = (calls: Call[]) => calls[calls.length - 1]!;
const ct = (call: Call) => new Headers(call.init?.headers).get("content-type");

const API_KEY: ApiKey = {
  id: "cd14bd71-471a-4095-92db-551cbfb08f5d",
  name: "dev-rw",
  bucketName: "dev",
  canRead: true,
  canWrite: true,
  isAdmin: false,
  tokenHint: "buns3_SoQVz",
  createdAt: "2026-08-29T18:24:59.000Z",
  lastUsedAt: "2026-09-03T19:20:56.733Z",
};

// --- whoami ----------------------------------------------------------------

describe("self.whoami", () => {
  test("GETs /_self and returns the wrapped apiKey", async () => {
    const { self, calls } = fakeHttp(() => ({ apiKey: API_KEY }));
    const r = await self.whoami();
    expect(last(calls).path).toBe("/_self");
    expect(last(calls).init?.method).toBeUndefined(); // default GET
    expect(r).toEqual({ success: true, data: { apiKey: API_KEY } });
  });

  test("keeps the { apiKey } wrapper rather than unwrapping — match the wire", async () => {
    const { self } = fakeHttp(() => ({ apiKey: API_KEY }));
    const r = await self.whoami();
    expect(r.success && r.data).toHaveProperty("apiKey");
  });

  test("apiKey: null is representable (presigned creds carry no key)", async () => {
    // Unreachable on this wire — presign can't reach /_self (no bucket/key on
    // the route → 401) — but the type mirrors the server's response shape.
    const { self } = fakeHttp(() => ({ apiKey: null }));
    const r = await self.whoami();
    expect(r.success && r.data.apiKey).toBeNull();
  });

  test("capability flags are booleans, not the DB's 0/1 (toApiKey mapping)", async () => {
    const { self } = fakeHttp(() => ({ apiKey: API_KEY }));
    const r = await self.whoami();
    expect(r.success && typeof r.data.apiKey?.canRead).toBe("boolean");
  });

  test("timestamps stay raw ISO strings (no Date revival)", async () => {
    const { self } = fakeHttp(() => ({ apiKey: API_KEY }));
    const r = await self.whoami();
    expect(r.success && r.data.apiKey?.createdAt).toBe("2026-08-29T18:24:59.000Z");
  });
});

// --- revoke ----------------------------------------------------------------

describe("self.revoke", () => {
  test("DELETEs /_self and returns void — the 204 Response is not handed out", async () => {
    const { self, calls } = fakeHttp();
    const r = await self.revoke();
    expect(last(calls).path).toBe("/_self");
    expect(last(calls).init).toMatchObject({ method: "DELETE" });
    expect(r).toEqual({ success: true, data: undefined });
  });

  test("passes a failure through unchanged", async () => {
    const http: Http = {
      request: async () => ({ success: false, status: 401, code: "INVALID_API_KEY" }),
      requestJson: async () => ({ success: false, status: 401, code: "INVALID_API_KEY" }),
    };
    // Self-revocation is one-shot: after it succeeds, that bearer 401s on every
    // later call. Only ever exercised against fakes — a live run would revoke
    // the token under the test suite.
    expect(await createSelf(http).revoke()).toMatchObject({
      success: false,
      code: "INVALID_API_KEY",
    });
  });
});

// --- presign (server-validated variant) ------------------------------------

describe("self.presign", () => {
  const PRESIGNED = {
    url: "http://localhost:8000/dev/hello.txt?keyId=2da12ce8&expires=1788464027&sig=9163e14f",
    expires: 1788464027,
  };

  test("POSTs /_self/presign with a JSON body and explicit content-type", async () => {
    // Elysia's parser needs the header; without it the body is ignored and the
    // server 422s on missing fields.
    const { self, calls } = fakeHttp(() => PRESIGNED);
    const r = await self.presign({
      method: "GET",
      bucket: "dev",
      key: "hello.txt",
      ttl: 300,
    });
    const call = last(calls);
    expect(call.path).toBe("/_self/presign");
    expect(call.init).toMatchObject({ method: "POST" });
    expect(ct(call)).toBe("application/json");
    expect(JSON.parse(call.init!.body as string)).toEqual({
      method: "GET",
      bucket: "dev",
      key: "hello.txt",
      ttl: 300,
    });
    expect(r).toEqual({ success: true, data: PRESIGNED });
  });

  test("sends the key RAW in the body — no path encoding applies here", async () => {
    const { self, calls } = fakeHttp(() => PRESIGNED);
    const key = "sdk dir/100%.txt";
    await self.presign({ method: "GET", bucket: "dev", key, ttl: 60 });
    expect(JSON.parse(last(calls).init!.body as string).key).toBe(key);
  });

  test.each([...PRESIGN_HTTP_METHODS])("accepts presign method %s", async (method) => {
    const { self, calls } = fakeHttp(() => PRESIGNED);
    await self.presign({ method, bucket: "dev", key: "k", ttl: 60 });
    expect(JSON.parse(last(calls).init!.body as string).method).toBe(method);
  });

  test("does NOT validate ttl client-side — the server owns the 7-day cap", async () => {
    // Verified live: ttl 999999999 → 422 VALIDATION_ERROR
    // "ttl must be at most 604800". The SDK must let that reach the server.
    const { self, calls } = fakeHttp(() => PRESIGNED);
    await self.presign({ method: "GET", bucket: "dev", key: "k", ttl: 999_999_999 });
    expect(JSON.parse(last(calls).init!.body as string).ttl).toBe(999_999_999);
  });

  test("ttl 0 is sent (legal: expiry is inclusive, 'this second only')", async () => {
    const { self, calls } = fakeHttp(() => PRESIGNED);
    await self.presign({ method: "GET", bucket: "dev", key: "k", ttl: 0 });
    expect(JSON.parse(last(calls).init!.body as string).ttl).toBe(0);
  });

  test("returns expires as an absolute unix timestamp, distinct from the ttl duration", async () => {
    // ttl is a DURATION, expires is a TIMESTAMP — one number must never serve both.
    const { self } = fakeHttp(() => PRESIGNED);
    const r = await self.presign({ method: "GET", bucket: "dev", key: "k", ttl: 300 });
    expect(r.success && r.data.expires).toBe(1788464027);
  });

  test.each([
    [403, "API_KEY_SCOPE_MISMATCH"],
    [403, "API_KEY_NOT_CAPABLE"],
    [401, "INVALID_API_KEY"],
  ] as const)(
    "surfaces the server's mint-time verdict %i %s",
    async (status, code) => {
      // This is what the validated variant buys over the offline signer, which
      // signs blind: a wrong-bucket or admin key fails HERE, not at use time.
      const http: Http = {
        request: async () => ({ success: false, status, code }),
        requestJson: async () => ({ success: false, status, code }),
      };
      expect(await createSelf(http).presign({
        method: "GET",
        bucket: "other",
        key: "k",
        ttl: 60,
      })).toMatchObject({ success: false, status, code });
    },
  );
});
