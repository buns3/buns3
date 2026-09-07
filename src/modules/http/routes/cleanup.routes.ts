import { Elysia } from "elysia";
import { useAuth } from "../middleware";
import { Cleanup } from "$/modules/validation/cleanup";
import { validate } from "$/lib/error";
import { sweepAbandonedUploads, sweepOrphanBlobs, sweepTempFiles } from "$/modules/storage/cleanup";
import { config } from "$/config";

export const cleanupRoutes = new Elysia({
  name: "routes:cleanup",
  prefix: "/_admin/cleanup",
})
  .use(useAuth)
  .post("", { auth: "admin" }, async ({ body }) => {
    const input = validate(Cleanup, body ?? {});
    return {
      ...input,
      temp: await sweepTempFiles({
        dryRun: input.dryRun,
        olderThanMs: config.CLEANUP_OLDER_THAN_MS,
      }),
      orphans: await sweepOrphanBlobs({
        dryRun: input.dryRun,
        olderThanMs: config.CLEANUP_OLDER_THAN_MS,
      }),
      uploads: await sweepAbandonedUploads({
        dryRun: input.dryRun,
        olderThanMs: config.CLEANUP_UPLOAD_OLDER_THAN_MS,
      }),
    };
  });
