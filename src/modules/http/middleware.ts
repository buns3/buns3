import Elysia, { NotFound, t } from "elysia";
import { apiKeyStorage } from "../api-keys/api-key-storage";
import { Buns3ValidationError, unwrap } from "$/lib/error";
import { Key } from "../validation/object";
import { type } from "arktype";
import { BucketName } from "../validation/bucket";
import type { ApiKey } from "../api-keys/types";
import { authorize, resolveCredentials } from "../auth/authorize";

export const useBucketKey = new Elysia({ name: "bucketKey" }).macro({
  bucketKey: {
    derive: ({ params }) => {
      const { bucket, "*": key } = params;
      if (!key) {
        throw new NotFound();
      }

      const keyResult = Key(key);
      if (keyResult instanceof type.errors) {
        throw new Buns3ValidationError(keyResult);
      }

      const bucketResult = BucketName(bucket);
      if (bucketResult instanceof type.errors) {
        throw new Buns3ValidationError(bucketResult);
      }

      return { bucket: bucketResult, key: keyResult };
    },
  },
});

export const useAuth = new Elysia({
  name: "useAuth",
}).macro({
  auth: (capability?: "read" | "write" | "admin" | true) => ({
    derive: async ({ headers }) => {
      const { credentials } = unwrap(resolveCredentials(headers.authorization));
      let apiKey: ApiKey | null = null;
      if (credentials.kind === "bearer") {
        apiKey = unwrap(await apiKeyStorage.verify(credentials.token)).data;
      }

      return { apiKey };
    },

    beforeHandle: async ({
      apiKey,
      params,
    }: {
      // typed by hand: our own derive above guarantees this at runtime
      apiKey: ApiKey | null;
      params?: Record<string, string>;
    }) => {
      unwrap(await authorize({ apiKey, capability, bucket: params?.bucket }));
    },
  }),
});
