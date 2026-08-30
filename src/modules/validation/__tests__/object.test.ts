import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { Key } from "../object";

const ok = (v: unknown) => !(v instanceof type.errors);

describe("Key", () => {
  test.each([
    ["plain", "hello.txt"],
    ["nested", "docs/deep/path/file.txt"],
    ["spaces and brackets", "my file [1].txt"],
    ["literal percent", "100%.txt"],
    ["unicode", "påse-ä-ö.txt"],
    ["1024 chars (max)", "a".repeat(1024)],
    ["leading slash", "/leading"],
    ["trailing slash", "trailing/"],
  ])("accepts %s", (_label, key) => expect(ok(Key(key))).toBe(true));

  test.each([
    ["empty", ""],
    ["slash-only", "/"],
    ["slashes-only", "///"],
    ["1025 chars", "a".repeat(1025)],
    ["newline", "a\nb"],
    ["NUL", "a\u0000b"],
    ["DEL", "a\u007Fb"],
    ["tab", "a\tb"],
  ])("rejects %s", (_label, key) => expect(ok(Key(key))).toBe(false));
});
