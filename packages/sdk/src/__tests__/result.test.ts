import { describe, expect, test } from "bun:test";
import { fail, fromProblem, networkError, ok } from "../result";

const res = (status: number, body: string | null = null) =>
  new Response(body, { status });

describe("ok / fail / networkError", () => {
  test("ok wraps data in the success branch", () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
  });

  test("fail builds the failure branch; detail is optional", () => {
    expect(fail(404, "KEY_NOT_FOUND")).toMatchObject({
      success: false,
      status: 404,
      code: "KEY_NOT_FOUND",
    });
    expect(fail(422, "VALIDATION_ERROR", "bad")).toMatchObject({ detail: "bad" });
  });

  test("networkError is status 0 + NETWORK_ERROR, message from Error or String()", () => {
    expect(networkError(new TypeError("fetch failed"))).toMatchObject({
      success: false,
      status: 0,
      code: "NETWORK_ERROR",
      detail: "fetch failed",
    });
    // fetch may throw non-Errors in exotic runtimes; must not itself throw
    expect(networkError("boom")).toMatchObject({ detail: "boom" });
  });
});

describe("fromProblem", () => {
  test("problem+json with a known code → that code, status from the transport", async () => {
    const r = await fromProblem(res(401, JSON.stringify({ code: "INVALID_API_KEY", status: 999 })));
    // response.status wins over the body's status claim — the transport is the truth
    expect(r).toMatchObject({ success: false, status: 401, code: "INVALID_API_KEY" });
    expect(r.success === false && r.detail).toBeUndefined();
  });

  test("carries a string detail through", async () => {
    const r = await fromProblem(res(422, JSON.stringify({ code: "VALIDATION_ERROR", detail: "must be x" })));
    expect(r.success === false && r.detail).toBe("must be x");
  });

  test("drops a non-string detail rather than lying about its type", async () => {
    const r = await fromProblem(res(422, JSON.stringify({ code: "VALIDATION_ERROR", detail: 42 })));
    expect(r.success === false && r.detail).toBeUndefined();
  });

  test("a wire body claiming NETWORK_ERROR is NOT accepted (client-only code) → UNKNOWN", async () => {
    const r = await fromProblem(res(500, JSON.stringify({ code: "NETWORK_ERROR" })));
    expect(r.success === false && r.code).toBe("UNKNOWN");
  });

  test("unknown code (server newer than SDK) → UNKNOWN, raw body as detail", async () => {
    const body = JSON.stringify({ code: "SOME_FUTURE_CODE" });
    const r = await fromProblem(res(418, body));
    expect(r).toMatchObject({ success: false, status: 418, code: "UNKNOWN", detail: body });
  });

  test("non-JSON body (proxy HTML) → UNKNOWN with the body as detail, never throws", async () => {
    const r = await fromProblem(res(502, "<html>bad gateway</html>"));
    expect(r).toMatchObject({ success: false, status: 502, code: "UNKNOWN", detail: "<html>bad gateway</html>" });
  });

  test("empty body → UNKNOWN with NO detail (not an empty string)", async () => {
    const r = await fromProblem(res(503, ""));
    expect(r.success === false && r.code).toBe("UNKNOWN");
    expect(r.success === false && "detail" in r && r.detail).toBeUndefined();
  });

  test("valid JSON that is not an object (null / string) → UNKNOWN, handled without throwing", async () => {
    for (const body of ["null", '"str"', "[]"]) {
      const r = await fromProblem(res(500, body));
      expect(r.success === false && r.code).toBe("UNKNOWN");
    }
  });
});
