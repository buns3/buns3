import { type } from "arktype";
import { BucketName } from "./bucket";
import { TOKEN_PREFIX } from "../api-keys/constants";

export const ApiKeyToken = type(
  new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`),
);

export const CreateAdminApiKey = type({
  name: "0 < string <= 50",
  bucketName: "null",
  canRead: "false",
  canWrite: "false",
  isAdmin: "true",
}).describe(
  "a global admin key (isAdmin: true, bucketName: null, canRead/canWrite: false)",
);

export const CreateBucketApiKey = type({
  name: "0 < string <= 50",
  bucketName: BucketName,
  canRead: "boolean",
  canWrite: "boolean",
  isAdmin: "false",
})
  .narrow((data, ctx) => {
    if (!data.canRead && !data.canWrite) {
      return ctx.reject({
        expected: "a key with at least one capability (canRead or canWrite)",
      });
    }

    return true;
  })
  .describe(
    "a bucket-scoped data key (isAdmin: false, at least one of canRead/canWrite)",
  );

export const CreateApiKey = type.or(CreateAdminApiKey, CreateBucketApiKey);

export type CreateApiKey = typeof CreateApiKey.infer;
