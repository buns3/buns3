import { describe, expect, test } from "bun:test";
import type { Http, RequestOptions } from "../../http";
import { ok } from "../../result";
import type { Result } from "../../types";
import { createPresigned } from "../presigned";

// A presigned URL is a COMPLETE credential-bearing URL: consuming it needs no
// bucket, no key, no token and no path building. Hence its own plane rather
// than presign-only options bolted onto objects.*.

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
  return { http, calls, presigned: createPresigned(http) };
}

const last = (calls: Call[]) => calls[calls.length - 1]!;
const ct = (call: Call) => new Headers(call.init?.headers).get("content-type");

const URL_ = "http://localhost:8000/dev/hello.txt?keyId=2da12ce8&expires=1788464027&sig=9163e14f";

const META_HEADERS = {
  "content-type": "text/plain",
  "content-length": "5",
  "last-modified": "Wed, 03 Sep 2026 12:00:00 GMT",
  etag: '"abc-123"',
};

describe("presigned: every call is absolute and anonymous", () => {
  test.each([
    ["get", async (p: ReturnType<typeof createPresigned>) => p.get(URL_), "GET"],
    ["head", async (p: ReturnType<typeof createPresigned>) => p.head(URL_), "HEAD"],
    ["put", async (p: ReturnType<typeof createPresigned>) => p.put(URL_, "x"), "PUT"],
    ["delete", async (p: ReturnType<typeof createPresigned>) => p.delete(URL_), "DELETE"],
  ])("%s sends the URL verbatim with absolute + anonymous", async (_, call, method) => {
    const { presigned, calls } = fakeHttp(() =>
      new Response(JSON.stringify({ bucket: "dev", key: "k" }), {
        status: 200,
        headers: META_HEADERS,
      }),
    );
    await call(presigned);
    const c = last(calls);
    // absolute: request() must NOT prepend baseUrl to a complete URL.
    // anonymous: a Bearer header alongside presign params is a 401 by the
    // server's ambiguity rule — presented credentials are always judged.
    expect(c.init).toMatchObject({ absolute: true, anonymous: true, method });
    expect(c.path).toBe(URL_);
  });

  test("the query string is never touched or re-encoded", async () => {
    const { presigned, calls } = fakeHttp();
    const tricky =
      "http://x/dev/a%20b/100%25.txt?keyId=abc&expires=0&sig=deadbeef";
    await presigned.get(tricky);
    expect(last(calls).path).toBe(tricky);
  });
});

describe("presigned.get", () => {
  test("returns the raw Response — streaming stays the caller's call", async () => {
    const { presigned } = fakeHttp(() => new Response("hello", { status: 200 }));
    const r = await presigned.get(URL_);
    expect(r.success && (await r.data.text())).toBe("hello");
  });
});

describe("presigned.head", () => {
  test("parses headers into ObjectMeta, same parser as objects.head", async () => {
    const { presigned } = fakeHttp(() => ({
      headers: new Headers(META_HEADERS),
      status: 200,
    }));
    const r = await presigned.head(URL_);
    expect(r).toEqual({
      success: true,
      data: {
        contentType: "text/plain",
        size: 5,
        lastModified: "Wed, 03 Sep 2026 12:00:00 GMT",
        etag: "abc-123",
      },
    });
  });

  test("a parse failure surfaces as a failure, not a wrapped success", async () => {
    const { presigned } = fakeHttp(() => ({ headers: new Headers(), status: 200 }));
    expect((await presigned.head(URL_)).success).toBe(false);
  });
});

describe("presigned.put", () => {
  const putRes = (location: string | null = "/dev/k") =>
    new Response(JSON.stringify({ bucket: "dev", key: "k" }), {
      status: 201,
      headers: location ? { Location: location } : {},
    });

  test("shares putInit with objects.put: explicit Content-Type, never fetch inference", async () => {
    const { presigned, calls } = fakeHttp(() => putRes());
    await presigned.put(URL_, "hello");
    expect(ct(last(calls))).toBe("application/octet-stream");
  });

  test.each([
    ["explicit wins", new Blob(["x"], { type: "image/png" }), "text/csv", "text/csv"],
    ["typed Blob", new Blob(["x"], { type: "image/png" }), undefined, "image/png"],
    ["untyped Blob", new Blob(["x"]), undefined, "application/octet-stream"],
  ] as const)("Content-Type precedence: %s", async (_, body, contentType, expected) => {
    const { presigned, calls } = fakeHttp(() => putRes());
    await presigned.put(URL_, body, contentType ? { contentType } : {});
    expect(ct(last(calls))).toBe(expected);
  });

  test("a ReadableStream body sets duplex: half (undici throws without it)", async () => {
    const { presigned, calls } = fakeHttp(() => putRes());
    await presigned.put(URL_, new ReadableStream());
    expect(last(calls).init).toHaveProperty("duplex", "half");
  });

  test("returns the server's echo plus the Location header", async () => {
    const { presigned } = fakeHttp(() => putRes("/dev/k"));
    const r = await presigned.put(URL_, "x");
    expect(r).toEqual({
      success: true,
      data: { bucket: "dev", key: "k", location: "/dev/k" },
    });
  });
});

describe("presigned.delete", () => {
  test("returns void, not the consumed 204 Response", async () => {
    const { presigned } = fakeHttp();
    expect(await presigned.delete(URL_)).toEqual({ success: true, data: undefined });
  });
});

describe("presigned: surface", () => {
  test("exposes exactly the four presignable methods", () => {
    // Mirrors the server's PRESIGN_METHODS. POST/PATCH are not presignable.
    const { presigned } = fakeHttp();
    expect(Object.keys(presigned).sort()).toEqual(["delete", "get", "head", "put"]);
  });

  test("has NO list or deleteMany — presign is structurally single-key", () => {
    // One canonical string binds exactly one method+bucket+key+expiry, so a
    // presigned URL can never authorize a batch or an enumeration.
    const { presigned } = fakeHttp();
    expect(presigned).not.toHaveProperty("list");
    expect(presigned).not.toHaveProperty("deleteMany");
  });

  test("failures pass through unchanged (expired / forged URLs)", async () => {
    // Verified live against the server: expired -> 401 PRESIGNED_EXPIRED,
    // tampered signature -> 401 INVALID_API_KEY (no oracle).
    const http: Http = {
      request: async () => ({ success: false, status: 401, code: "PRESIGNED_EXPIRED" }),
      requestJson: async () => ({ success: false, status: 401, code: "PRESIGNED_EXPIRED" }),
    };
    expect(await createPresigned(http).get(URL_)).toMatchObject({
      success: false,
      status: 401,
      code: "PRESIGNED_EXPIRED",
    });
  });
});
