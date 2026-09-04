import { initServer } from "./modules/http/server";
import { fileStorage } from "./modules/storage/file-storage";

async function shutdown() {
  console.log("Exiting gracefully...");
  await server.stop();
  process.exit(0);
}

await fileStorage.init();

const server = await initServer();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
