import Elysia, { NotFound, t } from "elysia";
import { apiKeyStorage } from "../api-keys/api-key-storage";
import { Buns3Error, Buns3ValidationError, unwrap } from "$/lib/error";
import { Key } from "../validation/object";
import { type } from "arktype";
import { BucketName } from "../validation/bucket";
import type { ApiKey } from "../api-keys/types";
import { bucketStorage } from "../storage/bucket";

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
        return {
          apiKey: null as ApiKey | null,
        };
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

    beforeHandle: async (ctx) => {
      // typed by hand: our own derive above guarantees this at runtime
      const { apiKey, params } = ctx as typeof ctx & { apiKey: ApiKey | null };

      if (apiKey === null) {
        if (!params?.bucket || capability !== "read")
          throw new Buns3Error("INVALID_API_KEY");

        const bucketResult = await bucketStorage.get(params.bucket);
        if (!bucketResult.success) {
          throw new Buns3Error("INVALID_API_KEY");
        }

        if (!bucketResult.bucket.publicRead) {
          throw new Buns3Error("INVALID_API_KEY");
        }
      } else {
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
      }
    },
  }),
});
