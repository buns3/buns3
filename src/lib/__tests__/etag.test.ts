import { describe, expect, test } from "bun:test";
import { etagMatches } from "../etag";

// RFC 9110 §13.1.2. GET/HEAD use WEAK comparison, so `W/"x"` matches `"x"`.
// The etag argument is the QUOTED form, exactly as the ETag header sends it —
// the caller quotes, this function does not (a mismatch there once made the
// GET branch silently never fire while HEAD worked).

const ID = "857aa9ac-0ca1-4364-af2a-5a5eb75b39e9";
const ETAG = `"${ID}"`;

describe("etagMatches", () => {
  test("matches an exact quoted validator", () => {
    expect(etagMatches(ETAG, ETAG)).toBe(true);
  });

  test("* matches any existing representation", () => {
    expect(etagMatches("*", ETAG)).toBe(true);
  });

  test("a weak validator matches its strong counterpart", () => {
    expect(etagMatches(`W/${ETAG}`, ETAG)).toBe(true);
  });

  test("matches any member of a list", () => {
    expect(etagMatches(`"other", ${ETAG}`, ETAG)).toBe(true);
    expect(etagMatches(`${ETAG}, "other"`, ETAG)).toBe(true);
  });

  test("matches a later member of a list of WEAK validators", () => {
    // Regression: stripping "W/" from the whole header instead of per entry
    // left every entry after the first prefixed, so it could never match.
    expect(etagMatches(`W/"a", W/${ETAG}`, ETAG)).toBe(true);
  });

  test("tolerates whitespace around list members", () => {
    expect(etagMatches(`"a",${ETAG} ,  "b"`, ETAG)).toBe(true);
  });

  test.each([
    ['"nope"', "a different validator"],
    ["", "an empty header"],
    [`"${ID}`, "a missing closing quote"],
    [ID, "an unquoted value — quotes are part of the validator"],
    [`"other", "another"`, "a list with no match"],
  ])("does not match %j (%s)", (header) => {
    expect(etagMatches(header, ETAG)).toBe(false);
  });

  test("does not strip a W/ that is not a prefix", () => {
    // The anchored regex matters: a bare replace could corrupt a value.
    expect(etagMatches(`"aW/b"`, `"aW/b"`)).toBe(true);
  });

  test("an overwritten object stops matching (the ETag is the blob id)", () => {
    // Overwrites mint a new blob id, which is what makes the validator honest.
    expect(etagMatches(ETAG, `"11111111-2222-3333-4444-555555555555"`)).toBe(false);
  });
});
