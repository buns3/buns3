import { apiKeyStorage } from "$/modules/api-keys/api-key-storage";
import { db } from "$/modules/prisma/db";
import { CreateApiKey } from "$/modules/validation/api-key";
import { type } from "arktype";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  strict: true,
  options: {
    help: {
      type: "boolean",
      short: "h",
    },
    name: {
      type: "string",
      short: "n",
    },
    bucket: {
      type: "string",
      short: "b",
    },
    read: {
      type: "boolean",
      short: "r",
      default: false,
    },
    write: {
      type: "boolean",
      short: "w",
      default: false,
    },
    admin: {
      type: "boolean",
      short: "a",
      default: false,
    },
  },
  tokens: true,
});

if (values.help) {
  console.log(`Usage:
      --name   -n   Key name
      --bucket -b   Bucket name to scope key to
      --read   -r   Read access
      --write  -w   Write access
      --admin  -a   Admin access
  `);
  process.exit(0);
}

const mapped = {
  name: values.name,
  bucketName: values.bucket ?? null,
  canRead: values.read,
  canWrite: values.write,
  isAdmin: values.admin,
};

const validated = CreateApiKey(mapped);
if (validated instanceof type.errors) {
  console.warn(validated.summary);
  process.exit(2);
}

const keyResult = await apiKeyStorage.create(validated);
if (!keyResult.success) {
  console.error(keyResult.code);
  process.exit(1);
}

console.log("Key created");
console.log("Name:", keyResult.data.apiKey.name);
console.log("Bucket:", keyResult.data.apiKey.bucketName);
console.log("Token Hint:", keyResult.data.apiKey.tokenHint);
console.log("Capabilities:");
console.log("  Can Read:", keyResult.data.apiKey.canRead);
console.log("  Can Write:", keyResult.data.apiKey.canWrite);
console.log("  Admin:", keyResult.data.apiKey.isAdmin);
console.log("Token:", keyResult.data.token);
console.log("Save this token now, it cannot be retrieved again");

await db.close();
process.exit(0);
