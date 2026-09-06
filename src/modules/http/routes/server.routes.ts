import { Elysia, status } from "elysia";
import { useAuth } from "../middleware";
import { VERSION } from "$/lib/version";
import { prismaHealth } from "$/modules/prisma/health";
import { storageHealth } from "$/modules/storage/health";

export const serverRoutes = new Elysia({
  name: "routes:server",
})
  .use(useAuth)
  .get("/_server", { auth: true }, () => ({ version: VERSION }))
  .get("/_health", async () => {
    const db = await prismaHealth();
    const storage = await storageHealth();
    const anyDegraded = db === "degraded" || storage === "degraded";

    return status(anyDegraded ? 503 : 200, {
      status: anyDegraded ? "degraded" : "ok",
      checks: { db, storage },
    });
  });
