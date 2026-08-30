import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { BucketName, BucketUpdate } from "../bucket";

const ok = (v: unknown) => !(v instanceof type.errors);

describe("BucketName", () => {
  test.each(["dev", "a", "my-bucket-2", "a".repeat(20)])(
    "accepts %s",
    (name) => expect(ok(BucketName(name))).toBe(true),
  );

  test.each([
    ["empty", ""],
    ["uppercase", "UPPER"],
    ["leading digit", "1bucket"],
    ["leading dash", "-bucket"],
    ["underscore (structurally excludes _admin)", "_admin"],
    ["dot", "my.bucket"],
    ["slash", "a/b"],
    ["21 chars", "a".repeat(21)],
    ["space", "my bucket"],
  ])("rejects %s", (_label, name) =>
    expect(ok(BucketName(name))).toBe(false),
  );
});

describe("BucketUpdate", () => {
  test("accepts publicRead boolean", () => {
    expect(ok(BucketUpdate({ publicRead: true }))).toBe(true);
    expect(ok(BucketUpdate({ publicRead: false }))).toBe(true);
  });

  test("rejects empty object (>= 1 property to update)", () => {
    expect(ok(BucketUpdate({}))).toBe(false);
  });

  test("rejects non-boolean publicRead", () => {
    expect(ok(BucketUpdate({ publicRead: "yes" }))).toBe(false);
    expect(ok(BucketUpdate({ publicRead: 1 }))).toBe(false);
  });
});
