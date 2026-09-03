import { describe, expect, test } from "bun:test";
import { CLIENT_ERROR_CODES, ERROR_CODES, isErrorCode } from "../error";

// The wire set: every code the server can emit (its Buns3AnyErrorCode, flattened).
// Frozen here as the SDK-side half of the drift guard; a server-side tier-2 test
// asserts equality against the real error-codes module. Change both or neither.
const SERVER_CODES = [
  "KEY_NOT_FOUND",
  "BUCKET_NOT_FOUND",
  "BUCKET_ALREADY_EXIST",
  "BUCKET_NOT_EMPTY",
  "MALFORMED_BODY",
  "FS_ERROR",
  "NOT_FOUND",
  "UNKNOWN",
  "INVALID_API_KEY",
  "API_KEY_NOT_CAPABLE",
  "API_KEY_SCOPE_MISMATCH",
  "API_KEY_NOT_FOUND",
  "VALIDATION_ERROR",
  "PRESIGNED_EXPIRED",
] as const;

describe("ERROR_CODES", () => {
  test("equals the server's flattened code set exactly (no missing, no extra)", () => {
    expect(new Set(ERROR_CODES)).toEqual(new Set(SERVER_CODES));
  });

  test("has no duplicate entries (array length == set size)", () => {
    // INVALID_API_KEY appears in two server groups; it must be listed once here.
    // receiver is the Set size (number); the tuple's literal length (14) is assignable to it
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  test("keeps client-only codes OUT of the wire set", () => {
    for (const code of CLIENT_ERROR_CODES) {
      expect(ERROR_CODES).not.toContain(code);
    }
  });
});

describe("isErrorCode", () => {
  test.each([...SERVER_CODES])("accepts wire code %s", (code) => {
    expect(isErrorCode(code)).toBe(true);
  });

  test("rejects NETWORK_ERROR — a client-only code must never be accepted from the wire", () => {
    expect(isErrorCode("NETWORK_ERROR")).toBe(false);
  });

  test.each([undefined, null, 42, "", "not_a_code", "key_not_found", {}])(
    "rejects non-code input %j",
    (input) => {
      expect(isErrorCode(input)).toBe(false);
    },
  );
});
