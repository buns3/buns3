import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import pkg from "../../package.json";

// @buns3/sdk ships with ZERO runtime dependencies: a published SDK's deps are
// every consumer's deps (version conflicts, install size, supply-chain surface).
//
// Nothing else enforces this. tsc resolves any root package (the hoisted
// workspace makes them reachable from packages/sdk) and so does bun test, so a
// stray editor auto-import typechecks AND passes tests while silently bloating
// the bundle — an unused `import { url } from "arktype/..."` in http.ts once
// dragged arktype into dist/: 155 kB for 8 kB of SDK. Only `bun run build`
// caught it, and only once index.ts finally exported something. This moves that
// signal into the suite, where it fires in milliseconds.

const SRC = path.join(import.meta.dir, "..");

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Import specifiers of a TypeScript source.
 *
 * Two passes, because neither alone is correct:
 *  - Bun's transpiler parses properly (immune to lookalikes inside strings and
 *    comments) but ERASES type-only imports, so it cannot see
 *    `import type {X} from "pkg"`, `import {type X} from "pkg"` or
 *    `export type {X} from "pkg"` — all verified missing.
 *  - A line-anchored regex catches those. Anchoring to a statement start is
 *    what keeps `test("... from \"x\" ...")` from matching; an earlier
 *    unanchored dynamic-import pattern matched text inside this very file.
 */
function importsOf(source: string): string[] {
  const specifiers = new Set(transpiler.scanImports(source).map((i) => i.path));
  for (const m of source.matchAll(
    /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  )) {
    specifiers.add(m[1]!);
  }
  return [...specifiers];
}

const isRelative = (s: string) => s.startsWith(".") || s.startsWith("/");

/** node: builtins and bun: modules are runtime-provided, never installed. */
const isRuntimeModule = (s: string) =>
  s.startsWith("node:") || s.startsWith("bun:");

/** A bare specifier may be a subpath: "pkg/sub" and "@scope/pkg/sub" name the package. */
const packageOf = (s: string) =>
  s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]!;

const declared = new Set([
  ...Object.keys((pkg as { dependencies?: object }).dependencies ?? {}),
  ...Object.keys((pkg as { peerDependencies?: object }).peerDependencies ?? {}),
]);

const files = [...new Bun.Glob("**/*.ts").scanSync(SRC)].map((rel) => ({
  rel: rel.replaceAll("\\", "/"),
  source: readFileSync(path.join(SRC, rel), "utf8"),
}));

const isTest = (rel: string) => rel.includes("__tests__");

describe("dependency hygiene", () => {
  test("the scan actually found the sources (a silent zero would pass everything)", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.map((f) => f.rel)).toContain("http.ts");
    expect(files.map((f) => f.rel)).toContain("planes/objects.ts");
  });

  test("SHIPPED code imports nothing but relative paths — zero runtime dependencies", () => {
    const offenders = files
      .filter((f) => !isTest(f.rel))
      .flatMap((f) =>
        importsOf(f.source)
          .filter((s) => !isRelative(s))
          .map((s) => `${f.rel}: ${s}`),
      );
    // Anything here lands in dist/ or becomes an unresolvable import for
    // consumers. node:/bun: builtins are rejected too — they would break the
    // SDK in browsers, which it must support (fetch + WebCrypto only).
    expect(offenders).toEqual([]);
  });

  test("test files may use bun:/node: builtins, but nothing undeclared", () => {
    const offenders = files
      .filter((f) => isTest(f.rel))
      .flatMap((f) =>
        importsOf(f.source)
          .filter(
            (s) =>
              !isRelative(s) &&
              !isRuntimeModule(s) &&
              !declared.has(packageOf(s)),
          )
          .map((s) => `${f.rel}: ${s}`),
      );
    expect(offenders).toEqual([]);
  });

  test("package.json declares no runtime dependencies at all", () => {
    // The promise the README makes. If a dependency is ever genuinely needed,
    // this is the test that forces the decision to be deliberate.
    expect((pkg as { dependencies?: object }).dependencies ?? {}).toEqual({});
  });

  describe("the scanner itself", () => {
    // Guarding the guard: if these regress, the checks above go quiet or noisy.
    test.each([
      ['import { a } from "p";', "p"],
      ['import {\n  a,\n} from "p";', "p"],
      ['import "p";', "p"],
      ['const x = await import("p");', "p"],
      ['import type { A } from "p";', "p"],
      ['import { type A } from "p";', "p"],
      ['export type { A } from "p";', "p"],
      ['export { a } from "p";', "p"],
    ])("detects %j", (source, expected) => {
      expect(importsOf(source)).toContain(expected);
    });

    test.each([
      'test("distinguishes header parsed then ignored", () => {});',
      'const s = "const y = await import(\'in-a-string\')";',
    ])("ignores the lookalike %j", (source) => {
      expect(importsOf(source)).toEqual([]);
    });

    test("reports each specifier once, even when both passes see it", () => {
      expect(importsOf('import { a } from "p";')).toEqual(["p"]);
    });
  });
});
