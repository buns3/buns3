import { initServer } from "./modules/http/server";
import { initScheduler } from "./modules/scheduler";
import { CLEANUP_OLDER_THAN_MS } from "./modules/storage/constants";
import { fileStorage } from "./modules/storage/file-storage";

async function shutdown() {
  console.log("Exiting gracefully...");
  stopScheduler();
  await server.stop();
  process.exit(0);
}

await fileStorage.init();

const stopScheduler = initScheduler({
  olderThanMs: CLEANUP_OLDER_THAN_MS,
  dryRun: false,
  runOnStartup: false,
});

const server = initServer();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
