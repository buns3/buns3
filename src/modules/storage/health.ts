import fs from "node:fs/promises";
import path from "node:path";
import { BASE_PATH, TEMP_DIR_NAME } from "./constants";
import { logger } from "$/lib/logger";

const log = logger.child({ module: "storage" });

export async function storageHealth() {
  const tempDir = path.resolve(BASE_PATH, TEMP_DIR_NAME);
  try {
    await fs.access(tempDir, fs.constants.W_OK);
    return "ok" as const;
  } catch (err) {
    log.error({ tempDir, err }, "storage health check failed");
    return "degraded" as const;
  }
}
