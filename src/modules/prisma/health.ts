import { logger } from "$/lib/logger";
import { db } from "./db";

const log = logger.child({ module: "prisma" });

export async function prismaHealth() {
  try {
    void (await db.orm.Bucket.select("name").first());
    return "ok" as const;
  } catch (err) {
    log.error({ err }, "prisma health check failed");
    return "degraded" as const;
  }
}
