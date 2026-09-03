import { describe, expect, test } from "bun:test";
import type { Http, RequestOptions } from "../../http";
import { bindBucket, createObjects, parseObjectMeta } from "../objects";
import { ok } from "../../result";
import type { Result } from "../../result";

// --- fakes -----------------------------------------------------------------

type Call = { path: string; init: RequestOptions | undefined };

/** Records every call and returns whatever the caller configured. */
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
  return { http, calls, objects: createObjects(http) };
}

const last = (calls: Call[]) => calls[calls.length - 1]!;
const ct = (call: Call) => new Headers(call.init?.headers).get("content-type");

const META_HEADERS = {
  "content-type": "text/plain",
  "content-length": "42",
  "last-modified": "Wed, 03 Sep 2026 12:00:00 GMT",
  etag: '"abc-123"',
};
// parseObjectMeta only needs headers+status; Bun's Response strips content-length
// from a null-body response, so build the shape directly.
const metaRes = (h: Record<string, string>, status = 200) => ({
  headers: new Headers(h),
  status,
});

// --- parseObjectMeta -------------------------------------------------------

describe("parseObjectMeta", () => {
  test("parses a complete HEAD response", () => {
    expect(parseObjectMeta(metaRes(META_HEADERS))).toEqual({
      success: true,
      data: {
        contentType: "text/plain",
        size: 42,
        lastModified: "Wed, 03 Sep 2026 12:00:00 GMT",
        etag: "abc-123",
      },
    });
  });

  test("unquotes the etag so it equals the bare blob id listings report", () => {
    // head(k).etag === list().objects[i].etag is the invariant.
    const r = parseObjectMeta(metaRes(META_HEADERS));
    expect(r.success && r.data.etag).toBe("abc-123");
  });

  test("strips a proxy-added weak validator prefix (W/)", () => {
    const r = parseObjectMeta(metaRes({ ...META_HEADERS, etag: 'W/"abc-123"' }));
    expect(r.success && r.data.etag).toBe("abc-123");
  });

  test("keeps lastModified as the raw RFC-7231 string (no Date revival)", () => {
    const r = parseObjectMeta(metaRes(META_HEADERS));
    expect(r.success && r.data.lastModified).toBe(
      "Wed, 03 Sep 2026 12:00:00 GMT",
    );
  });

  test.each([
    ["content-type", 'response missing "Content-Type" header'],
    ["content-length", 'response missing "Content-Length" header'],
    ["last-modified", 'response missing "Last-Modified" header'],
    ["etag", 'malformed "ETag" header'],
  ])("a missing %s header is a failure, not a default", (header, detail) => {
    const headers: Record<string, string> = { ...META_HEADERS };
    delete headers[header];
    // The server sets all four unconditionally: absence means this isn't buns3
    // (a proxy answered, wrong baseUrl, changed contract). Never invent values.
    expect(parseObjectMeta(metaRes(headers))).toMatchObject({
      success: false,
      status: 200,
      code: "UNKNOWN",
      detail,
    });
  });

  test.each(['""', "abc-123", '"', "W/"])(
    "rejects malformed etag %j (empty, unquoted, or partial)",
    (etag) => {
      expect(parseObjectMeta(metaRes({ ...META_HEADERS, etag }))).toMatchObject({
        success: false,
        code: "UNKNOWN",
      });
    },
  );

  test("rejects a non-numeric content-length (a rewritten header is a contract violation)", () => {
    expect(
      parseObjectMeta(metaRes({ ...META_HEADERS, "content-length": "abc" })),
    ).toMatchObject({ success: false, code: "UNKNOWN" });
  });

  test("accepts size 0 (zero-byte objects are legal, S3-style)", () => {
    const r = parseObjectMeta(metaRes({ ...META_HEADERS, "content-length": "0" }));
    expect(r.success && r.data.size).toBe(0);
  });

  test("carries the response status into the failure", () => {
    expect(parseObjectMeta(metaRes({}, 502))).toMatchObject({ status: 502 });
  });
});

// --- get / head ------------------------------------------------------------

describe("objects.get", () => {
  test("builds the path with the key encoded exactly once", async () => {
    const { objects, calls } = fakeHttp();
    await objects.get("dev", "a/b c/100%.txt");
    expect(last(calls).path).toBe("/dev/a/b%20c/100%25.txt");
  });

  test("returns the raw Response — streaming is the caller's call", async () => {
    const body = new Response("hello", { status: 200 });
    const { objects } = fakeHttp(() => body);
    const r = await objects.get("dev", "k");
    expect(r.success && (await r.data.text())).toBe("hello");
  });

  test("passes anonymous through for public-read buckets (default false)", async () => {
    const { objects, calls } = fakeHttp();
    await objects.get("dev", "k");
    expect(last(calls).init).toMatchObject({ anonymous: false });
    await objects.get("dev", "k", { anonymous: true });
    expect(last(calls).init).toMatchObject({ anonymous: true });
  });
});

describe("objects.head", () => {
  test("issues a HEAD and returns parsed metadata (not the Response)", async () => {
    const { objects, calls } = fakeHttp(() => metaRes(META_HEADERS));
    const r = await objects.head("dev", "k");
    expect(last(calls).init).toMatchObject({ method: "HEAD" });
    expect(r).toEqual({
      success: true,
      data: {
        contentType: "text/plain",
        size: 42,
        lastModified: "Wed, 03 Sep 2026 12:00:00 GMT",
        etag: "abc-123",
      },
    });
  });

  test("a parse failure surfaces as a failure, never wrapped in a success", async () => {
    // Regression: `return ok(parseObjectMeta(...))` produced Result<Result<T>>,
    // reporting a failure as {success: true, data: {success: false}}.
    const { objects } = fakeHttp(() => metaRes({}));
    const r = await objects.head("dev", "k");
    expect(r.success).toBe(false);
  });
});

// --- put -------------------------------------------------------------------

describe("objects.put", () => {
  const putRes = (location: string | null = "/dev/k") =>
    new Response(JSON.stringify({ bucket: "dev", key: "k" }), {
      status: 201,
      headers: location ? { Location: location } : {},
    });

  test("PUTs to the encoded path and returns the server's echo plus Location", async () => {
    const { objects, calls } = fakeHttp(() => putRes("/dev/a%20b.txt"));
    const r = await objects.put("dev", "a b.txt", "hello");
    expect(last(calls).path).toBe("/dev/a%20b.txt");
    expect(last(calls).init).toMatchObject({ method: "PUT", body: "hello" });
    expect(r).toEqual({
      success: true,
      data: { bucket: "dev", key: "k", location: "/dev/a%20b.txt" },
    });
  });

  test("location is READ from the header, not reconstructed", async () => {
    // If the server ever disagrees with what route() would build, report the server.
    const { objects } = fakeHttp(() => putRes("/somewhere/else"));
    const r = await objects.put("dev", "k", "x");
    expect(r.success && r.data.location).toBe("/somewhere/else");
  });

  test("a missing Location is null — the write still succeeded", async () => {
    const { objects } = fakeHttp(() => putRes(null));
    const r = await objects.put("dev", "k", "x");
    expect(r.success).toBe(true);
    expect(r.success && r.data.location).toBeNull();
  });

  describe("Content-Type precedence", () => {
    test("explicit contentType wins over everything", async () => {
      const { objects, calls } = fakeHttp(() => putRes());
      await objects.put("dev", "k", new Blob(["x"], { type: "image/png" }), {
        contentType: "text/csv",
      });
      expect(ct(last(calls))).toBe("text/csv");
    });

    test("a typed Blob supplies its own type", async () => {
      const { objects, calls } = fakeHttp(() => putRes());
      await objects.put("dev", "k", new Blob(["x"], { type: "image/png" }));
      expect(ct(last(calls))).toBe("image/png");
    });

    test("an untyped Blob falls back to octet-stream (blob.type is '')", async () => {
      const { objects, calls } = fakeHttp(() => putRes());
      await objects.put("dev", "k", new Blob(["x"]));
      expect(ct(last(calls))).toBe("application/octet-stream");
    });

    test("a non-Blob body defaults to octet-stream — never left to fetch inference", async () => {
      // The server stores Content-Type verbatim and does not sniff, so the SDK
      // must always state one.
      const { objects, calls } = fakeHttp(() => putRes());
      await objects.put("dev", "k", "plain string");
      expect(ct(last(calls))).toBe("application/octet-stream");
    });
  });

  test("a ReadableStream body sets duplex: 'half' (undici throws without it)", async () => {
    const { objects, calls } = fakeHttp(() => putRes());
    await objects.put("dev", "k", new ReadableStream());
    expect(last(calls).init).toHaveProperty("duplex", "half");
  });

  test("a non-stream body does not carry a duplex key at all", async () => {
    const { objects, calls } = fakeHttp(() => putRes());
    await objects.put("dev", "k", "x");
    expect(last(calls).init).not.toHaveProperty("duplex");
  });

  test("a stream loses the Blob's type — caller must pass contentType", async () => {
    // Documents the real trap: blob.stream() is not a Blob, so its type is gone.
    const { objects, calls } = fakeHttp(() => putRes());
    await objects.put("dev", "k", new Blob(["x"], { type: "text/plain" }).stream());
    expect(ct(last(calls))).toBe("application/octet-stream");
  });
});

// --- list ------------------------------------------------------------------

describe("objects.list", () => {
  test("no filters → no query string at all (not a bare '?')", async () => {
    const { objects, calls } = fakeHttp(() => ({}));
    await objects.list("dev");
    expect(last(calls).path).toBe("/dev");
  });

  test("appends only DEFINED filters", async () => {
    const { objects, calls } = fakeHttp(() => ({}));
    await objects.list("dev", { prefix: "a/" });
    expect(last(calls).path).toBe("/dev?prefix=a%2F");
  });

  test.each([
    [{ limit: 0 }, "/dev?limit=0"],
    [{ prefix: "" }, "/dev?prefix="],
  ])(
    "sends falsy-but-defined filters %j so the SERVER validates, not the SDK",
    async (filters, expected) => {
      // limit: 0 is out of the server's 1..1000 range and must earn its 422 —
      // dropping it would silently fall back to the default of 100.
      const { objects, calls } = fakeHttp(() => ({}));
      await objects.list("dev", filters);
      expect(last(calls).path).toBe(expected);
    },
  );

  test("query values are encoded by URLSearchParams, never pre-encoded", async () => {
    // Pre-encoding here is the double-encode bug: the server would receive a
    // literal "a%26b%20c/" as the prefix.
    const { objects, calls } = fakeHttp(() => ({}));
    await objects.list("dev", { prefix: "a&b c/", after: "x+y" });
    expect(last(calls).path).toBe("/dev?prefix=a%26b+c%2F&after=x%2By");
  });

  test("builds all three filters together", async () => {
    const { objects, calls } = fakeHttp(() => ({}));
    await objects.list("dev", { prefix: "a/", after: "a/b", limit: 10 });
    expect(last(calls).path).toBe("/dev?prefix=a%2F&after=a%2Fb&limit=10");
  });
});

// --- delete / deleteMany ---------------------------------------------------

describe("objects.delete", () => {
  test("DELETEs the encoded path and returns void — never the consumed 204 Response", async () => {
    const { objects, calls } = fakeHttp();
    const r = await objects.delete("dev", "a//b");
    expect(last(calls).path).toBe("/dev/a//b");
    expect(last(calls).init).toMatchObject({ method: "DELETE" });
    expect(r).toEqual({ success: true, data: undefined });
  });
});

describe("objects.deleteMany", () => {
  test("DELETEs the bucket path with a JSON body and an explicit content-type", async () => {
    // Elysia's parser needs the header; without it the body is ignored and the
    // server 422s on missing keys.
    const { objects, calls } = fakeHttp(() => ({}));
    await objects.deleteMany("dev", ["a", "b/c"]);
    const call = last(calls);
    expect(call.path).toBe("/dev");
    expect(call.init).toMatchObject({ method: "DELETE" });
    expect(ct(call)).toBe("application/json");
    expect(JSON.parse(call.init!.body as string)).toEqual({ keys: ["a", "b/c"] });
  });

  test("sends keys RAW in the body — no path encoding applies here", async () => {
    const { objects, calls } = fakeHttp(() => ({}));
    const keys = ["a//b", "100%.txt", "sdk/ü/日本.txt"];
    await objects.deleteMany("dev", keys);
    expect(JSON.parse(last(calls).init!.body as string).keys).toEqual(keys);
  });

  test.each([[[]], [["a"]]])(
    "does not validate %j client-side — the server owns the 1..1000 rule",
    async (keys) => {
      // An empty array must reach the server: absence of keys NEVER means "all keys".
      const { objects, calls } = fakeHttp(() => ({}));
      await objects.deleteMany("dev", keys);
      expect(JSON.parse(last(calls).init!.body as string)).toEqual({ keys });
    },
  );

  test("does not dedupe client-side (the server dedupes silently)", async () => {
    const { objects, calls } = fakeHttp(() => ({}));
    await objects.deleteMany("dev", ["a", "a"]);
    expect(JSON.parse(last(calls).init!.body as string).keys).toEqual(["a", "a"]);
  });

  test("body is a string, so it is replayable and the retry layer may resend it", async () => {
    const { objects, calls } = fakeHttp(() => ({}));
    await objects.deleteMany("dev", ["a"]);
    expect(typeof last(calls).init!.body).toBe("string");
  });
});

// --- bindBucket -------------------------------------------------------------

describe("bindBucket", () => {
  const scoped = (responder?: (call: Call) => unknown) => {
    const { http, calls, objects } = fakeHttp(responder);
    return { calls, bucket: bindBucket(objects, "photos"), objects, http };
  };

  test("applies the bucket to every method", async () => {
    const { bucket, calls } = scoped(() =>
      new Response(JSON.stringify({ bucket: "photos", key: "k" }), {
        status: 200,
        headers: META_HEADERS,
      }),
    );
    await bucket.get("cat.jpg");
    expect(last(calls).path).toBe("/photos/cat.jpg");
    await bucket.head("cat.jpg");
    expect(last(calls)).toMatchObject({ path: "/photos/cat.jpg" });
    await bucket.put("cat.jpg", "x");
    expect(last(calls).path).toBe("/photos/cat.jpg");
    await bucket.delete("cat.jpg");
    expect(last(calls)).toMatchObject({ path: "/photos/cat.jpg" });
    await bucket.list();
    expect(last(calls).path).toBe("/photos");
    await bucket.deleteMany(["a"]);
    expect(last(calls).path).toBe("/photos");
  });

  test("exposes exactly the six object methods", () => {
    const { bucket } = scoped();
    expect(Object.keys(bucket).sort()).toEqual([
      "delete",
      "deleteMany",
      "get",
      "head",
      "list",
      "put",
    ]);
  });

  test("encodes keys the same way the unbound plane does", async () => {
    const { bucket, objects, calls } = scoped();
    await bucket.get("a/b c/100%.txt");
    const bound = last(calls).path;
    await objects.get("photos", "a/b c/100%.txt");
    expect(bound).toBe(last(calls).path);
    expect(bound).toBe("/photos/a/b%20c/100%25.txt");
  });

  test("forwards options through unchanged", async () => {
    const { bucket, calls } = scoped(() => ({}));
    await bucket.get("k", { anonymous: true });
    expect(last(calls).init).toMatchObject({ anonymous: true });
    await bucket.list({ prefix: "2026/", limit: 5 });
    expect(last(calls).path).toBe("/photos?prefix=2026%2F&limit=5");
  });

  test("methods survive destructuring", async () => {
    const { bucket, calls } = scoped(() => ({}));
    const { list } = bucket;
    await list();
    expect(last(calls).path).toBe("/photos");
  });

  test("binding a second bucket does not disturb the first", async () => {
    const { objects, calls } = scoped(() => ({}));
    const a = bindBucket(objects, "one");
    const b = bindBucket(objects, "two");
    await a.list();
    expect(last(calls).path).toBe("/one");
    await b.list();
    expect(last(calls).path).toBe("/two");
    await a.list();
    expect(last(calls).path).toBe("/one");
  });
});
