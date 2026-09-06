import { config } from "./config";
import { logger } from "./lib/logger";
import { initServer } from "./modules/http/server";
import { initScheduler } from "./modules/scheduler";
import { fileStorage } from "./modules/storage/file-storage";

const watching = process.execArgv.includes("--watch");

async function shutdown(signal: NodeJS.Signals) {
  const restarting = watching && signal === "SIGTERM";
  logger.info({ signal }, restarting ? "restarting" : "shutting down");
  stopScheduler();
  await server.stop();
  process.exit(0);
}

await fileStorage.init();

const stopScheduler = initScheduler({
  olderThanMs: config.CLEANUP_OLDER_THAN_MS,
  dryRun: config.CLEANUP_DRY_RUN,
  runOnStartup: config.CLEANUP_RUN_ON_STARTUP,
});

const server = initServer();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
