import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Config } from "../src/config";

// Compose forwards ONLY the variables its `environment:` block names. A knob
// that exists in config.ts but is missing there is settable in the deployment
// environment and silently dropped before the container starts — which is
// exactly what happened to CORS_ORIGINS and LOG_CLIENT_IP in production on
// 2026-09-08, with nothing failing anywhere. The config schema is the source of
// truth; this file makes the compose list total over it.

const composePath = path.join(import.meta.dir, "..", "docker-compose.yml");
const compose = Bun.YAML.parse(readFileSync(composePath, "utf8")) as {
  services: Record<string, { environment?: string[] }>;
};

/** `FOO` and `FOO=${FOO}` both forward FOO. */
const nameOf = (entry: string) => entry.split("=")[0]!.trim();

const forwarded = (compose.services.server?.environment ?? []).map(nameOf);

const configKeys = (Config as unknown as { props: readonly { key: string }[] }).props.map(
  (p) => p.key,
);

// Knobs deliberately NOT forwarded. Each needs a reason, because the default
// for anything else is that it should be settable per deployment.
const EXCLUDED: Record<string, string> = {
  DATA_PATH: "the image pins it to the volume; overriding it writes blobs somewhere that does not survive a restart",
  SQLITE_PATH: "same as DATA_PATH — the database lives on the volume",
  LOG_CAPTURE: "redirects every line to an in-memory sink for tests; enabling it in production silences the logs",
};

describe("docker-compose forwards the config", () => {
  test("the schema is readable, or this whole file proves nothing", () => {
    // If arktype's introspection shape ever changes, an empty list would make
    // every assertion below vacuously true.
    expect(configKeys.length).toBeGreaterThan(5);
    expect(configKeys).toContain("BASE_URL");
    expect(forwarded.length).toBeGreaterThan(5);
  });

  test.each(
    configKeys.filter((k) => !(k in EXCLUDED)).map((k) => [k] as const),
  )("%s reaches the container", (key) => {
    expect(forwarded).toContain(key);
  });

  test.each(Object.entries(EXCLUDED))("%s is excluded on purpose: %s", (key) => {
    expect(forwarded).not.toContain(key);
  });

  test("every excluded name is still a real config key", () => {
    // A renamed knob must not leave a stale exclusion behind, quietly
    // un-forwarding its replacement.
    for (const key of Object.keys(EXCLUDED)) expect(configKeys).toContain(key);
  });

  test("nothing is forwarded that config does not read", () => {
    // A typo here is invisible: the variable is passed to a server that never
    // looks at it, and the setting appears to do nothing.
    for (const name of forwarded) expect(configKeys).toContain(name);
  });

  test("BASE_URL is the one required knob, and compose refuses to start without it", () => {
    const entry = (compose.services.server?.environment ?? []).find(
      (e) => nameOf(e) === "BASE_URL",
    );
    expect(entry).toContain(":?");
  });

  test("the migrate service gets the database path, since it runs before the server", () => {
    const migrate = (compose.services.migrate?.environment ?? []).map(nameOf);
    expect(migrate).toContain("SQLITE_PATH");
  });
});
