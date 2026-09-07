import { logger } from "$/lib/logger";
import {
  sweepAbandonedUploads,
  sweepOrphanBlobs,
  sweepTempFiles,
  type SweepOptions,
  type SweepResult,
} from "../storage/cleanup";
import { config } from "$/config";

const log = logger.child({ module: "scheduler" });

function report(
  label: string,
  dryRun: boolean,
  result: SweepResult,
  forceLog = false,
) {
  if (result.success) {
    const { removed, errors } = result.data;
    if (removed || errors || forceLog) {
      log.info(
        {
          label,
          dryRun,
          result: result.data,
        },
        "sweep completed",
      );
    }
  } else {
    log.error(
      {
        label,
        errorCode: result.code,
      },
      "sweep failed",
    );
  }
}

export interface SchedulerOptions extends SweepOptions {
  runOnStartup?: boolean;
}

export function initScheduler(opts: SchedulerOptions) {
  const { dryRun, olderThanMs, runOnStartup = false } = opts;
  let running = false;

  async function sweep(forceLog = false) {
    if (running) return;
    running = true;

    const [tempResult, blobResult, uploadResult] = await Promise.allSettled([
      sweepTempFiles({ dryRun, olderThanMs }),
      sweepOrphanBlobs({ dryRun, olderThanMs }),
      sweepAbandonedUploads({ dryRun, olderThanMs: config.CLEANUP_UPLOAD_OLDER_THAN_MS }),
    ]);

    if (tempResult.status === "fulfilled")
      report("temp", dryRun, tempResult.value, forceLog);
    else log.error({ err: tempResult.reason, label: "temp" }, "sweep threw");

    if (blobResult.status === "fulfilled")
      report("orphan", dryRun, blobResult.value, forceLog);
    else log.error({ err: blobResult.reason, label: "orphan" }, "sweep threw");

    if (uploadResult.status === "fulfilled")
      report("upload", dryRun, uploadResult.value, forceLog);
    else log.error({ err: uploadResult.reason, label: "upload" }, "sweep threw");

    running = false;
  }

  if (runOnStartup) {
    sweep(true);
  }

  const timer = setInterval(sweep, config.CLEANUP_INTERVAL_MS);
  timer.unref();

  return () => {
    clearInterval(timer);
  };
}
