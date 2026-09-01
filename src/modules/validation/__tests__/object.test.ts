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
    // dot-segments: unaddressable via URL path (clients normalize them away)
    ["dot", "."],
    ["dotdot", ".."],
    ["leading ./", "./a"],
    ["leading ../", "../a"],
    ["trailing /.", "a/."],
    ["trailing /..", "a/.."],
    ["mid /./", "a/./b"],
    ["mid /../", "docs/../secret.txt"],
  ])("rejects %s", (_label, key) => expect(ok(Key(key))).toBe(false));

  test.each([
    ["dotfile", ".hidden"],
    ["triple dot segment", "..."],
    ["dot-prefixed segment", "..a"],
    ["dots in filename", "file..txt"],
    ["dotdot substring in segment", "a/...b/c"],
  ])("accepts %s (not an exact dot-segment)", (_label, key) =>
    expect(ok(Key(key))).toBe(true),
  );
});
