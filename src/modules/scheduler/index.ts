import {
  sweepOrphanBlobs,
  sweepTempFiles,
  type SweepOptions,
  type SweepResult,
} from "../storage/cleanup";
import { CLEANUP_INTERVAL_MS } from "../storage/constants";

function report(label: string, dryRun: boolean, result: SweepResult) {
  if (result.success) {
    const { removed, errors } = result.data;
    if (removed || errors) {
      console.log(
        "cleanup",
        label,
        dryRun ? "dry run:" : "completed:",
        result.data,
      );
    }
  } else {
    console.error("cleanup:", label, "failed", result.code);
  }
}

export interface SchedulerOptions extends SweepOptions {
  runOnStartup?: boolean;
}

export function initScheduler(opts: SchedulerOptions) {
  const { dryRun, olderThanMs, runOnStartup = false } = opts;
  let running = false;

  async function sweep() {
    if (running) return;
    running = true;

    const [tempResult, blobResult] = await Promise.allSettled([
      sweepTempFiles({ dryRun, olderThanMs }),
      sweepOrphanBlobs({ dryRun, olderThanMs }),
    ]);

    if (tempResult.status === "fulfilled")
      report("temp", dryRun, tempResult.value);
    else console.error("cleanup: sweep threw", tempResult.reason);

    if (blobResult.status === "fulfilled")
      report("orphan", dryRun, blobResult.value);
    else console.error("cleanup: sweep threw", blobResult.reason);

    running = false;
  }

  if (runOnStartup) {
    sweep();
  }

  const timer = setInterval(sweep, CLEANUP_INTERVAL_MS);
  timer.unref();

  return () => {
    clearInterval(timer);
  };
}
