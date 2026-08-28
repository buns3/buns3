import Elysia, { NotFound, t } from "elysia";
import { apiKeyStorage } from "../api-keys/api-key-storage";
import { Buns3Error, Buns3ValidationError, unwrap } from "$/lib/error";
import { Key } from "../validation/object";
import { type } from "arktype";
import { BucketName } from "../validation/bucket";
import type { ApiKey } from "../api-keys/types";

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
      const rawToken = headers.authorization;
      if (!rawToken) {
        throw new Buns3Error("INVALID_API_KEY");
      }

      if (!rawToken.toLowerCase().startsWith("bearer ")) {
        throw new Buns3Error("INVALID_API_KEY");
      }

      const token = rawToken.slice(7);
      const { data: apiKey } = unwrap(await apiKeyStorage.verify(token));

      return {
        apiKey,
      };
    },

    beforeHandle: (ctx) => {
      // typed by hand: our own derive above guarantees this at runtime
      const { apiKey, params } = ctx as typeof ctx & { apiKey: ApiKey };

      if (typeof capability === "string") {
        const isCapable = {
          read: apiKey.canRead,
          write: apiKey.canWrite,
          admin: apiKey.isAdmin,
        }[capability];

        if (!isCapable) throw new Buns3Error("KEY_NOT_CAPABLE");
      }

      if (
        apiKey.bucketName &&
        params?.bucket &&
        apiKey.bucketName !== params.bucket
      ) {
        throw new Buns3Error("KEY_SCOPE_MISMATCH");
      }
    },
  }),
});
