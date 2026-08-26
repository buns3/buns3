import { initServer } from "./modules/http/server";
import { fileStorage } from "./modules/storage/file-storage";

await fileStorage.init();

const _server = await initServer();
