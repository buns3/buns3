import { describe, expect, test } from "bun:test";
import { keyToFilename, prefixUpperBound } from "../key";

describe("keyToFilename", () => {
  test.each([
    ["plain", "hello.txt", "hello.txt"],
    ["nested", "docs/deep/file.txt", "file.txt"],
    ["trailing slash", "docs/", "docs"],
    ["leading slash", "/leading.txt", "leading.txt"],
  ])("%s", (_label, key, want) => {
    expect(keyToFilename(key)).toBe(want);
  });
});

describe("prefixUpperBound", () => {
  test.each([
    ["ascii", "docs/", "docs0"], // '/' 0x2F -> '0' 0x30
    ["metachar percent is just a byte", "100%", "100&"], // '%' 0x25 -> '&' 0x26
    ["single char", "a", "b"],
  ])("%s: %s -> %s", (_label, prefix, want) => {
    expect(prefixUpperBound(prefix)).toBe(want);
  });

  test("increments a full astral code point, not half a surrogate", () => {
    const bound = prefixUpperBound("img/\u{1F600}")!; // 😀
    expect(bound).toBe("img/\u{1F601}");
    // and the result is a well-formed string
    expect(bound.isWellFormed?.() ?? true).toBe(true);
  });

  test("skips the surrogate gap: U+D7FF -> U+E000", () => {
    expect(prefixUpperBound("x퟿")).toBe("x");
  });

  test("bounding property: prefixed keys land inside [prefix, bound)", () => {
    const prefix = "docs/";
    const bound = prefixUpperBound(prefix)!;
    for (const key of ["docs/", "docs/a", "docs/zzz", "docs/\u{1F600}", "docs/100%.txt"]) {
      expect(key >= prefix).toBe(true);
      expect(key < bound).toBe(true);
    }
    for (const outsider of ["docs0", "docsz", "Docs/a", "doc", "e"]) {
      expect(outsider >= prefix && outsider < bound).toBe(false);
    }
  });

  test("U+10FFFF-final prefix carries left instead of throwing", () => {
    // last char is the max code point → can't increment it, so drop it and
    // bump the previous character. (This is reachable via ?prefix= — it used
    // to be an uncaught RangeError → 500.)
    expect(prefixUpperBound("x\u{10FFFF}")).toBe("y");
    expect(prefixUpperBound("ab\u{10FFFF}")).toBe("ac");
  });

  test("all-U+10FFFF prefix has no finite bound → null", () => {
    expect(prefixUpperBound("\u{10FFFF}")).toBeNull();
    expect(prefixUpperBound("\u{10FFFF}\u{10FFFF}")).toBeNull();
  });
});
