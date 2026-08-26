import sqlite from "@prisma/orm-sqlite/runtime";
import type { Contract } from "./contract";
import contractJson from "./contract.json" with { type: "json" };

const connection = process.env.SQLITE_PATH;
if (!connection) {
  throw new Error("SQLITE_PATH not found in environment variables");
}

export const db = sqlite<Contract>({
  contractJson,
});

export const runtime = await db.connect({ path: connection });
