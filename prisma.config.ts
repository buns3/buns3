import "dotenv/config";
import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as ormConfig } from "@prisma/orm-sqlite/config";

const connection = process.env.SQLITE_PATH;
if (!connection) {
  throw new Error("No SQLITE_PATH environment variable found");
}

export default definePrismaConfig({
  orm: ormConfig({
    contract: "./src/modules/prisma/contract.prisma",
    migrations: { dir: "./src/modules/prisma/migrations" },
    output: "./src/modules/prisma",
    db: { connection },
  }),
});
