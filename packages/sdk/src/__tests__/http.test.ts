import { describe, expect, test } from "bun:test";
import { createHttp, defaultRetryPolicy } from "../http";

// --- fakes -----------------------------------------------------------------

type Step = Error | (() => Response);

/** A fetch that replays `steps` in order (throw an Error, or return a Response) and records every call. */
function fakeFetch(...steps: Step[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === undefined) throw new Error("fakeFetch: no steps");
    if (step instanceof Error) throw step;
    return step();
  };
  return { fetch, calls };
}

/** A sleep that never waits and records what it was asked to wait. */
function recordingSleep() {
  const delays: number[] = [];
  return { sleep: async (ms: number) => void delays.push(ms), delays };
}

const okJson = (body: unknown = { a: 1 }) => () =>
  new Response(JSON.stringify(body), { status: 200 });
const status = (code: number, headers?: HeadersInit) => () =>
  new Response("", { status: code, headers });
const down = new Error("connection refused");

// --- URL + auth ------------------------------------------------------------

describe("createHttp: URL assembly and auth header", () => {
  test("strips any number of trailing slashes from baseUrl (never //path)", async () => {
    const { fetch, calls } = fakeFetch(status(204));
    await createHttp("http://x///", { fetch }).request("/b/k");
    expect(calls[0]?.url).toBe("http://x/b/k");
  });

  test("sets Authorization: Bearer <token> when a token is configured", async () => {
    const { fetch, calls } = fakeFetch(status(204));
    await createHttp("http://x", { token: "abc", fetch }).request("/p");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer abc");
  });

  test("anonymous: true sends NO Authorization header even with a token (public-read path)", async () => {
    const { fetch, calls } = fakeFetch(status(204));
    await createHttp("http://x", { token: "abc", fetch }).request("/p", { anonymous: true });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBeNull();
    // and the SDK-only flag must not leak into the fetch init
    expect(calls[0]?.init).not.toHaveProperty("anonymous");
  });

  test("no token → no Authorization header", async () => {
    const { fetch, calls } = fakeFetch(status(204));
    await createHttp("http://x", { fetch }).request("/p");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBeNull();
  });

  test("replaces (not appends to) a caller-supplied Authorization header", async () => {
    const { fetch, calls } = fakeFetch(status(204));
    await createHttp("http://x", { token: "abc", fetch }).request("/p", {
      headers: { Authorization: "Bearer stale" },
    });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer abc");
  });
});

// --- results ---------------------------------------------------------------

describe("createHttp: result mapping", () => {
  test("2xx → ok(Response) — including body-less 204", async () => {
    const { fetch } = fakeFetch(status(204));
    const r = await createHttp("http://x", { fetch }).request("/p");
    expect(r.success).toBe(true);
    expect(r.success && r.data.status).toBe(204);
  });

  test("non-2xx → fromProblem (code from problem+json, status from transport)", async () => {
    const { fetch } = fakeFetch(
      () => new Response(JSON.stringify({ code: "BUCKET_NOT_FOUND" }), { status: 404 }),
    );
    const r = await createHttp("http://x", { fetch }).request("/p");
    expect(r).toMatchObject({ success: false, status: 404, code: "BUCKET_NOT_FOUND" });
  });

  test("fetch throwing → NETWORK_ERROR status 0, never a thrown exception", async () => {
    const { fetch } = fakeFetch(down);
    const r = await createHttp("http://x", { retry: false, fetch }).request("/p");
    expect(r).toMatchObject({ success: false, status: 0, code: "NETWORK_ERROR" });
  });

  test("requestJson parses the body as T on success", async () => {
    const { fetch } = fakeFetch(okJson({ hello: "world" }));
    const r = await createHttp("http://x", { fetch }).requestJson<{ hello: string }>("/p");
    expect(r).toEqual({ success: true, data: { hello: "world" } });
  });

  test("requestJson passes a failure through unchanged (does not touch the body)", async () => {
    const { fetch } = fakeFetch(status(404));
    const r = await createHttp("http://x", { fetch }).requestJson("/p");
    expect(r).toMatchObject({ success: false, status: 404, code: "UNKNOWN" });
  });

  test("request/requestJson survive destructuring (closure, not `this`)", async () => {
    const { fetch } = fakeFetch(okJson());
    const { requestJson } = createHttp("http://x", { fetch });
    await expect(requestJson("/p")).resolves.toMatchObject({ success: true });
  });
});

// --- retries ---------------------------------------------------------------

describe("createHttp: retry policy", () => {
  test("network failure ×2 then success → 3 calls, exponential delays 200/400 (jittered upper bound)", async () => {
    const { fetch, calls } = fakeFetch(down, down, okJson());
    const { sleep, delays } = recordingSleep();
    const r = await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(r.success).toBe(true);
    expect(calls).toHaveLength(3);
    expect(delays).toHaveLength(2);
    // full jitter: delay ∈ [0, baseDelay * 2^attempt]. Pins the exponent —
    // both `(base*2)^attempt` (XOR) and `(base*2)**attempt` regressed here.
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThanOrEqual(200);
    expect(delays[1]).toBeGreaterThanOrEqual(0);
    expect(delays[1]).toBeLessThanOrEqual(400);
  });

  test("exhausting attempts on persistent network failure → NETWORK_ERROR after exactly `attempts` calls", async () => {
    const { fetch, calls } = fakeFetch(down);
    const { sleep, delays } = recordingSleep();
    const r = await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(r).toMatchObject({ success: false, code: "NETWORK_ERROR" });
    expect(calls).toHaveLength(defaultRetryPolicy.attempts);
    expect(delays).toHaveLength(defaultRetryPolicy.attempts - 1); // no sleep after the last attempt
  });

  test.each([502, 503, 504, 429])("%i is retried, then reported when it persists", async (code) => {
    const { fetch, calls } = fakeFetch(status(code));
    const { sleep } = recordingSleep();
    const r = await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(calls).toHaveLength(3);
    expect(r).toMatchObject({ success: false, status: code });
  });

  test.each([500, 400, 401, 403, 404, 409, 422])("%i is NOT retried (one call)", async (code) => {
    const { fetch, calls } = fakeFetch(status(code));
    const { sleep, delays } = recordingSleep();
    await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(calls).toHaveLength(1);
    expect(delays).toHaveLength(0);
  });

  test("a retryable status followed by success → returns the success", async () => {
    const { fetch, calls } = fakeFetch(status(503), okJson());
    const { sleep } = recordingSleep();
    const r = await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(r.success).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("delay is clamped to maxDelay (attempt 5 would be 6400ms unclamped)", async () => {
    const { fetch } = fakeFetch(down);
    const { sleep, delays } = recordingSleep();
    await createHttp("http://x", { fetch, sleep, retry: { attempts: 7 } }).request("/p");
    for (const d of delays) expect(d).toBeLessThanOrEqual(defaultRetryPolicy.maxDelay);
    expect(delays).toHaveLength(6);
  });

  test("retry: false → exactly one attempt, no sleep", async () => {
    const { fetch, calls } = fakeFetch(down);
    const { sleep, delays } = recordingSleep();
    await createHttp("http://x", { fetch, sleep, retry: false }).request("/p");
    expect(calls).toHaveLength(1);
    expect(delays).toHaveLength(0);
  });

  test("retry: { attempts: 5 } merges over defaults", async () => {
    const { fetch, calls } = fakeFetch(down);
    const { sleep } = recordingSleep();
    await createHttp("http://x", { fetch, sleep, retry: { attempts: 5 } }).request("/p");
    expect(calls).toHaveLength(5);
  });

  test("a ReadableStream body is NEVER retried — it was consumed by the first attempt", async () => {
    const { fetch, calls } = fakeFetch(down);
    const { sleep, delays } = recordingSleep();
    const r = await createHttp("http://x", { fetch, sleep }).request("/p", {
      method: "PUT",
      body: new ReadableStream(),
    });
    expect(calls).toHaveLength(1);
    expect(delays).toHaveLength(0);
    expect(r).toMatchObject({ success: false, code: "NETWORK_ERROR" });
  });

  test.each<[string, BodyInit | null | undefined]>([
    ["undefined", undefined],
    ["null", null],
    ["string", "text"],
    ["Blob", new Blob(["x"])],
    ["ArrayBuffer", new ArrayBuffer(4)],
    ["Uint8Array (ArrayBufferView)", new Uint8Array([1, 2])],
  ])("a %s body IS replayable and gets retried", async (_, body) => {
    const { fetch, calls } = fakeFetch(down, okJson());
    const { sleep } = recordingSleep();
    const r = await createHttp("http://x", { fetch, sleep }).request("/p", { method: "PUT", body });
    expect(calls).toHaveLength(2);
    expect(r.success).toBe(true);
  });

  test("abandons (cancels) a retryable response body before sleeping, so the connection is released", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ cancel: () => void (cancelled = true) });
    const { fetch } = fakeFetch(() => new Response(stream, { status: 503 }), okJson());
    const { sleep } = recordingSleep();
    await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(cancelled).toBe(true);
  });
});

// --- Retry-After -----------------------------------------------------------

describe("createHttp: Retry-After", () => {
  test("Retry-After: 0 is honored exactly (delay 0, not the exponential 0..200)", async () => {
    const { fetch } = fakeFetch(status(503, { "Retry-After": "0" }), okJson());
    const { sleep, delays } = recordingSleep();
    await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(delays).toEqual([0]);
  });

  test("Retry-After in seconds is converted to ms, un-jittered (exact)", async () => {
    // 1s → exactly 1000ms. A server-chosen delay is honored as-is (no jitter):
    // jitter exists to de-synchronize OUR backoff, and the server already coordinated this one.
    // Exact assertion on purpose — it distinguishes "header used" from "header parsed then ignored".
    const { fetch } = fakeFetch(status(503, { "Retry-After": "1" }), okJson());
    const { sleep, delays } = recordingSleep();
    await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(delays).toEqual([1000]);
  });

  test("Retry-After beyond maxDelay is clamped to exactly maxDelay", async () => {
    // 60s → 60000ms → clamped to the 2000ms cap (documented: the server's hint is a floor we may undercut)
    const { fetch } = fakeFetch(status(503, { "Retry-After": "60" }), okJson());
    const { sleep, delays } = recordingSleep();
    await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(delays).toEqual([defaultRetryPolicy.maxDelay]);
  });

  test("an HTTP-date Retry-After in the past falls back to exponential backoff", async () => {
    const { fetch } = fakeFetch(
      status(503, { "Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT" }),
      okJson(),
    );
    const { sleep, delays } = recordingSleep();
    await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(delays[0]).toBeLessThanOrEqual(200);
  });

  test("garbage Retry-After falls back to exponential backoff (never NaN, never throws)", async () => {
    const { fetch } = fakeFetch(status(503, { "Retry-After": "soon-ish" }), okJson());
    const { sleep, delays } = recordingSleep();
    await createHttp("http://x", { fetch, sleep }).request("/p");
    expect(Number.isNaN(delays[0])).toBe(false);
    expect(delays[0]).toBeLessThanOrEqual(200);
  });
});
