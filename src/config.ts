import { type } from "arktype";
import type { LevelWithSilent } from "pino";

export const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const satisfies readonly LevelWithSilent[];

export const LogLevel = type.enumerated(...LOG_LEVELS).default("info");

const Flag = type("'0' | '1'").pipe((v) => v === "1");

const Base = type({
  BASE_URL: type("string.url").narrow(
    (v, ctx) =>
      new URL(v).origin === v ||
      ctx.mustBe("an origin with no path or trailing slash"),
  ),
  PORT: type("string.integer.parse").to("0 < number <= 65535").default("8000"),
  DATA_PATH: "string = 'data'",
  SQLITE_PATH: "string = 'data/db.sqlite'",
  OPENAPI: Flag.default("0"),
  LOG_CAPTURE: Flag.default("0"),
  LOG_CLIENT_IP: Flag.default("0"),
  LOG_LEVEL: LogLevel,
});

const Cleanup = type({
  CLEANUP_ENABLED: Flag.default("1"),
  CLEANUP_DRY_RUN: Flag.default("0"),
  CLEANUP_RUN_ON_STARTUP: Flag.default("1"),
  CLEANUP_UPLOAD_OLDER_THAN_MS: type("string.integer.parse")
    .to("number >= 3600000")
    .default("86400000"), // default 24 hours
  CLEANUP_OLDER_THAN_MS: type("string.integer.parse")
    .to("number >= 60000")
    .default("3600000"), // default 60 minutes
  CLEANUP_INTERVAL_MS: type("string.integer.parse")
    .to("number >= 60000")
    .default("900000"), // default 15 minutes
});

export const Config = type.merge(Base, Cleanup).onUndeclaredKey("delete");

export type Config = typeof Config.infer;

export function parseEnv(raw: Record<string, string | undefined>) {
  const normalized: Record<string, string | undefined> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (value) normalized[key] = value;
  });

  return Config(normalized);
}

function getConfig() {
  const env = parseEnv(process.env);
  if (env instanceof type.errors) {
    console.error("env validation failed:", env.summary);
    process.exit(1);
  }

  return Object.freeze(env);
}

export const config = getConfig();
