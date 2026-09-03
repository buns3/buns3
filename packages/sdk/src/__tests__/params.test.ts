import { describe, expect, test } from "bun:test";
import { route } from "../lib/params";

// The contract: values go in RAW. route() is the only encoder — never pre-encode.
// (Pre-encoding is the double-encode bug: %20 -> %2520.)

describe("route: :param* (multi-segment, S3-style key)", () => {
  // These four are the slash-edge keys an earlier normalizing implementation
  // silently corrupted — each maps to a DIFFERENT object on the server.
  test.each([
    ["a/b/c", "/dev/a/b/c"],
    ["a//b", "/dev/a//b"], // empty segment preserved
    ["trail/", "/dev/trail/"], // trailing slash preserved
    ["/lead", "/dev//lead"], // leading slash preserved
  ])("preserves slashes structurally: %j", (key, expected) => {
    expect(route("/:bucket/:key*", { bucket: "dev", key })).toBe(expected);
  });

  test.each([
    ["a/b c/100%.txt", "/dev/a/b%20c/100%25.txt"],
    ["ü", "/dev/%C3%BC"],
    ["\u{1F600}/emoji", "/dev/%F0%9F%98%80/emoji"],
    ["!*()'.txt", "/dev/!%2A%28%29%27.txt"],
    ["q?&=#/x", "/dev/q%3F%26%3D%23/x"],
  ])("encodes segment contents: %j", (key, expected) => {
    expect(route("/:bucket/:key*", { bucket: "dev", key })).toBe(expected);
  });

  test("encodes exactly once — a pre-encoded value double-encodes (do not do this)", () => {
    expect(route("/:bucket/:key*", { bucket: "dev", key: "100%25.txt" })).toBe(
      "/dev/100%2525.txt",
    );
  });
});

describe("route: :param (single segment)", () => {
  test("escapes / to %2F so a value cannot forge extra path segments", () => {
    expect(route("/_admin/buckets/:bucket", { bucket: "a/b" })).toBe(
      "/_admin/buckets/a%2Fb",
    );
  });

  test("passes a valid bucket name through unchanged", () => {
    expect(route("/:bucket", { bucket: "my-bucket-1" })).toBe("/my-bucket-1");
  });

  test("leaves an invalid bucket name intact so the SERVER decides (422), not the SDK", () => {
    expect(route("/:bucket", { bucket: "BAD_NAME" })).toBe("/BAD_NAME");
  });
});

describe("route: misuse", () => {
  test("throws on a missing param — a programmer error the types already make unreachable", () => {
    expect(() =>
      // @ts-expect-error: key is required by Params<"/:bucket/:key*">
      route("/:bucket/:key*", { bucket: "dev" }),
    ).toThrow('Missing param "key"');
  });

  test("a path with no params is returned unchanged", () => {
    expect(route("/_self/presign", {})).toBe("/_self/presign");
  });
});
