import { describe, expect, test } from "bun:test";
import { strictEncode, uriEncodedKey } from "../encoding";

// Anchor table: expected strings were produced by the SERVER's src/lib/request.ts
// (uriEncodedKey) and frozen here. The SDK cannot import the server, so this table
// is the cross-package contract: both sides must spell every key identically, byte
// for byte — the SDK's URLs must equal the server's PUT Location header.
// If a row here ever changes, the server must change with it (or vice versa).
const ANCHORS: [key: string, encoded: string][] = [
  ["a/b/c", "a/b/c"],
  ["100%.txt", "100%25.txt"],
  ["sp ace/ü/日本", "sp%20ace/%C3%BC/%E6%97%A5%E6%9C%AC"],
  ["!*()'.txt", "!%2A%28%29%27.txt"],
  ["a//b", "a//b"],
  ["/lead", "/lead"],
  ["trail/", "trail/"],
  ["~-_.", "~-_."],
  ["q?&=#/x", "q%3F%26%3D%23/x"],
  ["\u{1F600}/emoji", "%F0%9F%98%80/emoji"],
  ["plus+sign", "plus%2Bsign"],
  ["semi;colon", "semi%3Bcolon"],
  ["back\\slash", "back%5Cslash"],
];

describe("uriEncodedKey", () => {
  test.each(ANCHORS)("%j encodes as the server does", (key, expected) => {
    expect(uriEncodedKey(key)).toBe(expected);
  });

  test("preserves slashes as segment separators (never encodes them)", () => {
    expect(uriEncodedKey("a/b")).not.toContain("%2F");
  });

  test("is not idempotent: encoding an encoded key double-encodes (%→%25)", () => {
    // Callers must encode exactly once — this pins that the function does not
    // try to be clever about already-encoded input.
    expect(uriEncodedKey(uriEncodedKey("100%.txt"))).toBe("100%2525.txt");
  });
});

describe("strictEncode", () => {
  test("encodes the characters encodeURIComponent leaves alone: ' ( ) *", () => {
    expect(strictEncode("'()*")).toBe("%27%28%29%2A");
  });

  test("encodes slashes (single-segment form, unlike uriEncodedKey)", () => {
    expect(strictEncode("a/b !*()'")).toBe("a%2Fb%20!%2A%28%29%27");
  });

  test("leaves ! and unreserved chars untouched (RFC 3986 unreserved + !)", () => {
    expect(strictEncode("!~-_.")).toBe("!~-_.");
  });
});
