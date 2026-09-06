import { config } from "$/config";
import pino from "pino";

export const capturedLogs: Record<string, unknown>[] = [];

const destination = config.LOG_CAPTURE
  ? { write: (line: string) => void capturedLogs.push(JSON.parse(line)) }
  : undefined;

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  destination,
);
