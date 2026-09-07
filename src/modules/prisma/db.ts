import sqlite from "@prisma/orm-sqlite/runtime";
import type { Contract } from "./contract";
import contractJson from "./contract.json" with { type: "json" };
import { config } from "$/config";
import { logger } from "$/lib/logger";

const log = logger.child({ module: "prisma" });

const connection = config.SQLITE_PATH;
if (!connection) {
  throw new Error("SQLITE_PATH not found in environment variables");
}

export const db = sqlite<Contract>({
  contractJson,
});

export const runtime = await db.connect({ path: connection });

const journalMode = await runtime.query(
  db.raw.sql`PRAGMA journal_mode = WAL`
    .returnsRow({ journal_mode: "sqlite/text@1" })
    .build(),
);

log.debug({ journalMode: journalMode[0]?.journal_mode }, "sqlite journal mode");
