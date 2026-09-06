import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Two rules that would otherwise erode one commit at a time: every log line
// goes through the logger, and an Error is only ever logged under `err`,
// because that is the one key pino serialises (anything else prints `{}`).

const SRC = path.resolve(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry === "__tests__") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith(".ts") ? [full] : [];
  });
}

const rel = (file: string) => path.relative(SRC, file).replaceAll("\\", "/");

describe("logging guard", () => {
  test("console.* appears only in config.ts, which runs before the logger exists", () => {
    const hits = sourceFiles(SRC)
      .filter((file) => /\bconsole\.(log|error|warn|info|debug)\(/.test(readFileSync(file, "utf8")))
      .map(rel);
    expect(hits).toEqual(["config.ts"]);
  });

  test("an error is never logged under a key other than err", () => {
    // `{ error }`, `{ reason }` or `{ error: e }` as a log field: pino would
    // serialise the Error as `{}` and drop message and stack.
    const hits = sourceFiles(SRC)
      .filter((file) => /\blog(?:ger)?\.(?:fatal|error|warn|info|debug|trace)\(\s*(?=\{)[^}]*[{,]\s*(?:error|exception|reason)\s*[,}:]/s.test(readFileSync(file, "utf8")))
      .map(rel);
    expect(hits).toEqual([]);
  });
});
