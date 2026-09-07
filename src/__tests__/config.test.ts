import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { parseEnv } from "../config";

// Tier-1: the env schema, with no process.env involved. The cases that matter
// are the ones compose can produce by accident — an empty string for a
// variable nobody set — and the ones an operator can produce on purpose.

const valid = { BASE_URL: "https://storage.example.com" };

function ok(raw: Record<string, string | undefined>) {
  const out = parseEnv(raw);
  if (out instanceof type.errors) throw new Error(`expected valid: ${out.summary}`);
  return out;
}

function fails(raw: Record<string, string | undefined>) {
  const out = parseEnv(raw);
  if (!(out instanceof type.errors)) throw new Error("expected failure, got " + JSON.stringify(out));
  return out.summary;
}

describe("defaults", () => {
  test("a minimal env fills every default", () => {
    expect(ok(valid)).toEqual({
      BASE_URL: "https://storage.example.com",
      PORT: 8000,
      DATA_PATH: "data",
      SQLITE_PATH: "data/db.sqlite",
      OPENAPI: false,
      LOG_LEVEL: "info",
      LOG_CAPTURE: false,
      LOG_CLIENT_IP: false,
      CLEANUP_ENABLED: true,
      CLEANUP_DRY_RUN: false,
      CLEANUP_RUN_ON_STARTUP: true,
      CLEANUP_UPLOAD_OLDER_THAN_MS: 86_400_000,
      CLEANUP_OLDER_THAN_MS: 3_600_000,
      CLEANUP_INTERVAL_MS: 900_000,
    });
  });

  test("an empty string is treated as unset, not as a value", () => {
    // `${PORT}` in compose with nothing set is "", which Bun would bind as
    // port 3000 and Number() would read as 0.
    const out = ok({
      ...valid,
      PORT: "",
      DATA_PATH: "",
      OPENAPI: "",
      CLEANUP_OLDER_THAN_MS: "",
    });
    expect(out.PORT).toBe(8000);
    expect(out.DATA_PATH).toBe("data");
    expect(out.OPENAPI).toBe(false);
    expect(out.CLEANUP_OLDER_THAN_MS).toBe(3_600_000);
  });

  test("undeclared variables are not part of the result", () => {
    expect(ok({ ...valid, PATH: "/usr/bin", HOME: "/home/x" })).not.toHaveProperty("PATH");
  });
});

describe("BASE_URL", () => {
  test("is required", () => {
    expect(fails({})).toContain("BASE_URL");
  });

  test.each(["https://x.com/", "https://x.com/base", "x.com", "ftp:/x"])(
    "rejects %s — presign assembles URLs from an exact origin",
    (url) => {
      expect(fails({ BASE_URL: url })).toContain("BASE_URL");
    },
  );

  test("accepts an origin with a port", () => {
    expect(ok({ BASE_URL: "http://localhost:8000" }).BASE_URL).toBe("http://localhost:8000");
  });
});

describe("PORT", () => {
  test("parses to a number", () => {
    expect(ok({ ...valid, PORT: "9000" }).PORT).toBe(9000);
  });

  test.each(["0", "65536", "-1", "80.5", "eighty"])("rejects %s", (port) => {
    expect(fails({ ...valid, PORT: port })).toContain("PORT");
  });

  test("65535 is a valid port", () => {
    expect(ok({ ...valid, PORT: "65535" }).PORT).toBe(65535);
  });
});

describe("flags", () => {
  test.each(["true", "yes", "on", "2"])("%s is neither 0 nor 1, so it fails loudly", (v) => {
    // A flag that silently read "true" as off would be worse than a boot error.
    expect(fails({ ...valid, OPENAPI: v })).toContain("OPENAPI");
  });

  test("1 is on and 0 is off, for every flag", () => {
    const on = ok({ ...valid, OPENAPI: "1", CLEANUP_ENABLED: "1", CLEANUP_DRY_RUN: "1", CLEANUP_RUN_ON_STARTUP: "1" });
    expect([on.OPENAPI, on.CLEANUP_ENABLED, on.CLEANUP_DRY_RUN, on.CLEANUP_RUN_ON_STARTUP]).toEqual([true, true, true, true]);
    const off = ok({ ...valid, OPENAPI: "0", CLEANUP_ENABLED: "0", CLEANUP_DRY_RUN: "0", CLEANUP_RUN_ON_STARTUP: "0" });
    expect([off.OPENAPI, off.CLEANUP_ENABLED, off.CLEANUP_DRY_RUN, off.CLEANUP_RUN_ON_STARTUP]).toEqual([false, false, false, false]);
  });
});

describe("LOG_LEVEL", () => {
  test("accepts pino's levels and silent", () => {
    expect(ok({ ...valid, LOG_LEVEL: "debug" }).LOG_LEVEL).toBe("debug");
    expect(ok({ ...valid, LOG_LEVEL: "silent" }).LOG_LEVEL).toBe("silent");
  });

  test.each(["verbose", "INFO", "3"])("rejects %s", (v) => {
    expect(fails({ ...valid, LOG_LEVEL: v })).toContain("LOG_LEVEL");
  });
});

describe("cleanup timings", () => {
  test.each(["0", "1", "59999", "-5"])("CLEANUP_OLDER_THAN_MS=%s is below the floor — a small gate is a data-eater", (v) => {
    expect(fails({ ...valid, CLEANUP_OLDER_THAN_MS: v })).toContain("CLEANUP_OLDER_THAN_MS");
  });

  test.each(["0", "59999"])("CLEANUP_INTERVAL_MS=%s is below the floor", (v) => {
    expect(fails({ ...valid, CLEANUP_INTERVAL_MS: v })).toContain("CLEANUP_INTERVAL_MS");
  });

  test("the floor itself is accepted", () => {
    const out = ok({ ...valid, CLEANUP_OLDER_THAN_MS: "60000", CLEANUP_INTERVAL_MS: "60000" });
    expect(out.CLEANUP_OLDER_THAN_MS).toBe(60_000);
    expect(out.CLEANUP_INTERVAL_MS).toBe(60_000);
  });
});

describe("reporting", () => {
  test("every problem is listed at once, not just the first", () => {
    const summary = fails({ PORT: "0", OPENAPI: "true" });
    expect(summary).toContain("BASE_URL");
    expect(summary).toContain("PORT");
    expect(summary).toContain("OPENAPI");
  });
});
