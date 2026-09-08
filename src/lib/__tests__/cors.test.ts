import { describe, expect, test } from "bun:test";
import { corsOrigin, globToRegExp } from "../cors";

// Tier-1: the origin matcher, with no Elysia and no config involved.
//
// This is the one rule in the project that nothing downstream can catch. Every
// server test is same-origin, so a wrong pattern passes the whole suite, boots
// cleanly, and shows up only as a browser error on a machine we do not have.
// The failure modes are also asymmetric: too permissive is a silent grant to an
// attacker's origin, too restrictive is a loud CORS error the operator can read.
// So the table leads with what must NOT match.

describe("a wildcard is one whole DNS label", () => {
  const re = globToRegExp("https://*.example.com")!;

  test("an attacker's lookalike host does not match", () => {
    // The headline case: `*` must never stand in for part of a label, or
    // `https://*.example.com` silently grants `evil-example.com`.
    expect(re.test("https://evil-example.com")).toBe(false);
  });

  test("a suffixed host does not match, so the pattern is anchored at the end", () => {
    expect(re.test("https://app.example.com.attacker.net")).toBe(false);
  });

  test("a prefixed host does not match, so the pattern is anchored at the start", () => {
    expect(re.test("https://not-https://app.example.com")).toBe(false);
  });

  test("the wildcard never crosses a dot", () => {
    expect(re.test("https://deep.app.example.com")).toBe(false);
  });

  test("the wildcard is not optional — the bare domain is a separate grant", () => {
    expect(re.test("https://example.com")).toBe(false);
  });

  test("one label matches", () => {
    expect(re.test("https://app.example.com")).toBe(true);
  });
});

describe("the scheme and port are part of the origin", () => {
  test("http is not https", () => {
    // A scheme is a security boundary; downgrading it must not be silent.
    expect(globToRegExp("https://example.com")!.test("http://example.com")).toBe(false);
  });

  test("a pattern without a port does not match one with a port", () => {
    expect(globToRegExp("https://example.com")!.test("https://example.com:8443")).toBe(false);
  });

  test("a literal port matches only itself", () => {
    const re = globToRegExp("http://localhost:5173")!;
    expect(re.test("http://localhost:5173")).toBe(true);
    expect(re.test("http://localhost:5174")).toBe(false);
  });

  test("a wildcard port matches any explicit port", () => {
    // Vite walks 5173 -> 5174 whenever a port is taken, so this is a real need.
    const re = globToRegExp("http://localhost:*")!;
    expect(re.test("http://localhost:5173")).toBe(true);
    expect(re.test("http://localhost:3000")).toBe(true);
  });

  test("a wildcard port does NOT match an absent port — decided, and surprising", () => {
    // Browsers omit the default port from Origin, so a dev server on 80 sends
    // `http://localhost`. Covering both means listing both entries. The strict
    // reading fails as a readable browser error; the permissive one would widen
    // the allowlist silently, which is the direction that costs more.
    expect(globToRegExp("http://localhost:*")!.test("http://localhost")).toBe(false);
  });
});

describe("what will not compile at all", () => {
  // Each of these is rejected at config time, so the boot log names it and the
  // server never starts. `globToRegExp` returning null IS the validation: the
  // builder does no regex escaping, and is only safe because nothing with a
  // metacharacter survives this gate. The two must stay one unit.
  const rejected = [
    ["a bare host", "example.com"],
    ["a trailing slash", "https://example.com/"],
    ["a path", "https://example.com/app"],
    ["a query", "https://example.com?a=1"],
    ["a fragment", "https://example.com#f"],
    ["userinfo", "https://user@example.com"],
    ["a wildcard scheme", "*://example.com"],
    ["a non-http scheme", "ftp://example.com"],
    ["the literal null origin", "null"],
    ["an empty string", ""],
    ["a wildcard whole host", "https://*"],
    ["a partial-label wildcard, suffix", "https://foo*.example.com"],
    ["a partial-label wildcard, prefix", "https://*-example.com"],
    ["a partial port, prefix", "http://localhost:51*"],
    ["a partial port, suffix", "http://localhost:*73"],
    ["two ports", "http://localhost:*:*"],
    ["an uppercase host", "https://Example.com"],
    ["an empty label", "https://example..com"],
    ["a leading dot", "https://.example.com"],
    ["a trailing dot", "https://example.com."],
    ["a leading hyphen", "https://-example.com"],
    ["a trailing hyphen", "https://example-.com"],
    ["an empty port", "https://example.com:"],
    ["a six-digit port", "https://example.com:123456"],
    ["a regex metacharacter", "https://exa.ple.com|evil.com"],
  ] as const;

  test.each(rejected)("%s is refused", (_label, glob) => {
    expect(globToRegExp(glob)).toBeNull();
  });
});

describe("more than one wildcard", () => {
  const re = globToRegExp("https://*.*.example.com")!;

  test("each wildcard still consumes exactly one label", () => {
    expect(re.test("https://a.b.example.com")).toBe(true);
    expect(re.test("https://b.example.com")).toBe(false);
    expect(re.test("https://a.b.c.example.com")).toBe(false);
  });
});

describe("corsOrigin", () => {
  test('"*" passes straight through, since the plugin understands it', () => {
    expect(corsOrigin("*")).toBe("*");
  });

  test("a list compiles to one pattern per entry, in order", () => {
    const out = corsOrigin(["https://a.example", "http://localhost:*"]);
    expect(Array.isArray(out)).toBe(true);
    const patterns = out as RegExp[];
    expect(patterns).toHaveLength(2);
    expect(patterns[0]!.test("https://a.example")).toBe(true);
    expect(patterns[1]!.test("http://localhost:5173")).toBe(true);
    expect(patterns[0]!.test("http://localhost:5173")).toBe(false);
  });

  test("an empty list compiles to an empty list, which allows nothing", () => {
    // Config refuses to produce this, but the deny-by-default shape matters:
    // an allowlist that lost its entries must grant nothing, not everything.
    expect(corsOrigin([])).toEqual([]);
  });
});

// Mutation-checked — each line measured, not guessed:
//   wildcard LABEL -> `[^.]+`               : 1 caught (a wildcard would swallow
//                                             slashes and colons, not just labels)
//   wildcard LABEL -> `.+`                  : 3 caught
//   drop the `^` anchor                     : 1 caught
//   drop the `$` anchor                     : 2 caught
//   `(https?)` -> `(https?|.*)` in GLOB     : 2 caught
//   port tail `:\d{1,5}` -> `(?::\d{1,5})?` : 1 caught (the absent-port decision)
//   join on "." instead of an escaped dot   : 1 caught
