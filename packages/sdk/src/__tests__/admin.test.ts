import { describe, expect, test } from "bun:test";
import { createAdmin, createAdminBuckets, createAdminKeys } from "../admin";
import type { Http, RequestOptions } from "../http";
import { ok } from "../result";
import type { ApiKey, BucketWithCount, Result } from "../types";

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
  return { http, calls, admin: createAdmin(http) };
}

const last = (calls: Call[]) => calls[calls.length - 1]!;
const ct = (call: Call) => new Headers(call.init?.headers).get("content-type");
const body = (call: Call) => JSON.parse(call.init!.body as string);

const BUCKET: BucketWithCount = {
  name: "dev",
  publicRead: true,
  createdAt: "2026-08-29T18:24:38.000Z",
  objects: 14,
};

const API_KEY: ApiKey = {
  id: "094d4564-314e-4e8d-a73b-bd172f00d057",
  name: "sdk-probe",
  bucketName: "dev",
  canRead: true,
  canWrite: false,
  isAdmin: false,
  tokenHint: "buns3_5zvlc",
  createdAt: "2026-09-03T20:29:39.233Z",
  lastUsedAt: null,
};

// --- shape -----------------------------------------------------------------

describe("createAdmin", () => {
  test("exposes two namespaces mirroring the server's route groups", () => {
    const { admin } = fakeHttp();
    expect(Object.keys(admin)).toEqual(["buckets", "keys"]);
    // delete/list/create exist on BOTH — nesting is what keeps them from colliding
    expect(typeof admin.buckets.delete).toBe("function");
    expect(typeof admin.keys.delete).toBe("function");
  });

  test("factories survive destructuring (closures, not methods)", async () => {
    const { http } = fakeHttp(() => ({ buckets: [] }));
    const { list } = createAdminBuckets(http);
    await expect(list()).resolves.toMatchObject({ success: true });
  });
});

// --- buckets ---------------------------------------------------------------

describe("admin.buckets", () => {
  test("list GETs /_admin/buckets and returns the { buckets } wrapper", async () => {
    const { admin, calls } = fakeHttp(() => ({ buckets: [BUCKET] }));
    const r = await admin.buckets.list();
    expect(last(calls).path).toBe("/_admin/buckets");
    expect(r).toEqual({ success: true, data: { buckets: [BUCKET] } });
  });

  test("list rows carry the objects count (BucketWithCount, not Bucket)", async () => {
    const { admin } = fakeHttp(() => ({ buckets: [BUCKET] }));
    const r = await admin.buckets.list();
    expect(r.success && r.data.buckets[0]?.objects).toBe(14);
  });

  test("get returns the SINGULAR { bucket } wrapper — the wrappers differ per route", async () => {
    // Pinning the key name: an earlier version typed this as `buckets`, which
    // typechecked (requestJson's `as T` is unchecked) but is undefined at runtime.
    const { admin, calls } = fakeHttp(() => ({ bucket: BUCKET }));
    const r = await admin.buckets.get("dev");
    expect(last(calls).path).toBe("/_admin/buckets/dev");
    expect(r.success && r.data.bucket).toEqual(BUCKET);
  });

  test("create PUTs and reads Location from the header (not reconstructed)", async () => {
    const { admin, calls } = fakeHttp(
      () =>
        new Response(JSON.stringify({ bucket: BUCKET }), {
          status: 201,
          headers: { Location: "/dev" },
        }),
    );
    const r = await admin.buckets.create("dev");
    expect(last(calls).init).toMatchObject({ method: "PUT" });
    expect(r.success && r.data.location).toBe("/dev");
    expect(r.success && r.data.bucket).toEqual(BUCKET);
  });

  test("create's Location is the DATA-plane path, passed through verbatim", async () => {
    // The server answers /_admin/buckets/:bucket with Location: /:bucket.
    const { admin } = fakeHttp(
      () =>
        new Response(JSON.stringify({ bucket: BUCKET }), {
          status: 201,
          headers: { Location: "/somewhere/else" },
        }),
    );
    const r = await admin.buckets.create("dev");
    expect(r.success && r.data.location).toBe("/somewhere/else");
  });

  test("create tolerates a missing Location — the bucket was still created", async () => {
    const { admin } = fakeHttp(
      () => new Response(JSON.stringify({ bucket: BUCKET }), { status: 201 }),
    );
    const r = await admin.buckets.create("dev");
    expect(r.success).toBe(true);
    expect(r.success && r.data.location).toBeNull();
  });

  test("update PATCHes with a JSON body and explicit content-type", async () => {
    const { admin, calls } = fakeHttp(() => ({ bucket: BUCKET }));
    await admin.buckets.update("dev", { publicRead: true });
    const call = last(calls);
    expect(call.path).toBe("/_admin/buckets/dev");
    expect(call.init).toMatchObject({ method: "PATCH" });
    expect(ct(call)).toBe("application/json");
    expect(body(call)).toEqual({ publicRead: true });
  });

  test("update sends an empty object through — the server owns the at-least-one-property rule", async () => {
    // Verified live: {} → 422 "must be an object containing at least one
    // property to update". The SDK must not pre-empt that.
    const { admin, calls } = fakeHttp(() => ({ bucket: BUCKET }));
    await admin.buckets.update("dev", {});
    expect(body(last(calls))).toEqual({});
  });

  test("update can set publicRead false (a falsy value must not be dropped)", async () => {
    const { admin, calls } = fakeHttp(() => ({ bucket: BUCKET }));
    await admin.buckets.update("dev", { publicRead: false });
    expect(body(last(calls))).toEqual({ publicRead: false });
  });

  test("delete returns void, not the consumed 204 Response", async () => {
    const { admin, calls } = fakeHttp();
    const r = await admin.buckets.delete("dev");
    expect(last(calls).init).toMatchObject({ method: "DELETE" });
    expect(r).toEqual({ success: true, data: undefined });
  });

  test("a 409 BUCKET_NOT_EMPTY flows through as an ordinary failure", async () => {
    const http: Http = {
      request: async () => ({ success: false, status: 409, code: "BUCKET_NOT_EMPTY" }),
      requestJson: async () => ({ success: false, status: 409, code: "BUCKET_NOT_EMPTY" }),
    };
    expect(await createAdminBuckets(http).delete("dev")).toMatchObject({
      success: false,
      status: 409,
      code: "BUCKET_NOT_EMPTY",
    });
  });

  test("an invalid bucket name is sent as-is so the SERVER 422s (no client-side gate)", async () => {
    const { admin, calls } = fakeHttp(() => ({ bucket: BUCKET }));
    await admin.buckets.get("BAD_NAME");
    expect(last(calls).path).toBe("/_admin/buckets/BAD_NAME");
  });

  test("a bucket name containing / cannot forge extra path segments (%2F)", async () => {
    const { admin, calls } = fakeHttp(() => ({ bucket: BUCKET }));
    await admin.buckets.get("a/b");
    expect(last(calls).path).toBe("/_admin/buckets/a%2Fb");
  });
});

// --- keys ------------------------------------------------------------------

describe("admin.keys", () => {
  test("list GETs /_admin/keys and returns the { apiKeys } wrapper", async () => {
    // Note the wrapper differs from buckets': apiKeys vs buckets. Do NOT factor
    // these into a generic single-key unwrapper.
    const { admin, calls } = fakeHttp(() => ({ apiKeys: [API_KEY] }));
    const r = await admin.keys.list();
    expect(last(calls).path).toBe("/_admin/keys");
    expect(r).toEqual({ success: true, data: { apiKeys: [API_KEY] } });
  });

  test("listed keys never carry a token — only the hint", async () => {
    const { admin } = fakeHttp(() => ({ apiKeys: [API_KEY] }));
    const r = await admin.keys.list();
    expect(r.success && r.data.apiKeys[0]).not.toHaveProperty("token");
    expect(r.success && r.data.apiKeys[0]?.tokenHint).toBe("buns3_5zvlc");
  });

  test("create POSTs a JSON body and returns { apiKey, token } — the token appears exactly once, ever", async () => {
    const { admin, calls } = fakeHttp(() => ({ apiKey: API_KEY, token: "buns3_secret" }));
    const input = {
      name: "sdk-probe",
      bucketName: "dev",
      canRead: true,
      canWrite: false,
      isAdmin: false,
    } as const;
    const r = await admin.keys.create(input);
    const call = last(calls);
    expect(call.path).toBe("/_admin/keys");
    expect(call.init).toMatchObject({ method: "POST" });
    expect(ct(call)).toBe("application/json");
    expect(body(call)).toEqual(input);
    expect(r.success && r.data.token).toBe("buns3_secret");
  });

  test("a freshly created key has lastUsedAt null", async () => {
    const { admin } = fakeHttp(() => ({ apiKey: API_KEY, token: "t" }));
    const r = await admin.keys.create({
      name: "x",
      bucketName: "dev",
      canRead: true,
      canWrite: false,
      isAdmin: false,
    });
    expect(r.success && r.data.apiKey.lastUsedAt).toBeNull();
  });

  test("an admin key input is sent verbatim (bucketName null, capabilities false)", async () => {
    const { admin, calls } = fakeHttp(() => ({ apiKey: API_KEY, token: "t" }));
    const input = {
      name: "admin",
      bucketName: null,
      canRead: false,
      canWrite: false,
      isAdmin: true,
    } as const;
    await admin.keys.create(input);
    expect(body(last(calls))).toEqual(input);
  });

  test("the no-capability combo is NOT rejected client-side — arktype's .narrow owns it", async () => {
    // TS cannot express "at least one of canRead/canWrite", so this must reach
    // the server. Verified live: 422 "must be a key with at least one capability".
    const { admin, calls } = fakeHttp(() => ({ apiKey: API_KEY, token: "t" }));
    const input = {
      name: "x",
      bucketName: "dev",
      canRead: false,
      canWrite: false,
      isAdmin: false,
    } as const;
    await admin.keys.create(input);
    expect(body(last(calls))).toEqual(input);
  });

  test("delete DELETEs /_admin/keys/:id and returns void", async () => {
    const { admin, calls } = fakeHttp();
    const r = await admin.keys.delete(API_KEY.id);
    expect(last(calls).path).toBe(`/_admin/keys/${API_KEY.id}`);
    expect(last(calls).init).toMatchObject({ method: "DELETE" });
    expect(r).toEqual({ success: true, data: undefined });
  });

  test("a non-uuid id is sent as-is so the server 422s (no client-side uuid check)", async () => {
    const { admin, calls } = fakeHttp();
    await admin.keys.delete("not-a-uuid");
    expect(last(calls).path).toBe("/_admin/keys/not-a-uuid");
  });

  test.each([
    [404, "API_KEY_NOT_FOUND"],
    [422, "VALIDATION_ERROR"],
    [403, "API_KEY_NOT_CAPABLE"],
  ] as const)("surfaces %i %s from the server", async (status, code) => {
    const http: Http = {
      request: async () => ({ success: false, status, code }),
      requestJson: async () => ({ success: false, status, code }),
    };
    expect(await createAdminKeys(http).delete(API_KEY.id)).toMatchObject({
      success: false,
      status,
      code,
    });
  });
});
