import Elysia, { NotFound, t, type Context } from "elysia";
import { apiKeyStorage } from "../api-keys/api-key-storage";
import { Buns3Error, Buns3ValidationError, unwrap } from "$/lib/error";
import { Key } from "../validation/object";
import { type } from "arktype";
import { BucketName } from "../validation/bucket";
import { authorize, resolveCredentials } from "../auth/authorize";
import type { AuthState } from "../auth/types";

export const useBucketKey = new Elysia({ name: "middleware:bucket-key" }).macro(
  {
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
  },
);

export const useAuth = new Elysia({
  name: "middleware:auth",
}).macro({
  auth: (capability?: "read" | "write" | "admin" | true) => ({
    derive: async ({ headers, query }) => {
      const { credentials } = unwrap(
        resolveCredentials(headers.authorization, query),
      );

      let authState: AuthState;
      switch (credentials.kind) {
        case "anonymous":
          authState = { kind: "anonymous" };
          break;

        case "presign":
          authState = { kind: "presign", params: credentials.params };
          break;

        case "bearer":
          authState = {
            kind: "key",
            apiKey: unwrap(await apiKeyStorage.verify(credentials.token)).data,
          };
          break;

        default:
          throw new Buns3Error("INVALID_API_KEY");
      }

      return { authState };
    },

    beforeHandle: async ({
      authState,
      params,
      request,
      bucket,
      key,
    }: {
      // typed by hand: our own derive above guarantees this at runtime
      // params re-declared optional, Elysia's Context claims it's always present
      // but it's undefined for param-less routes.
      authState: AuthState;
      params?: Record<string, string>;
      // from the bucketKey derive on data routes. validated + decoded
      bucket?: string;
      key?: string;
    } & Omit<Context, "params">) => {
      unwrap(
        await authorize({
          state: authState,
          capability,
          method: request.method,
          bucket: bucket ?? params?.bucket,
          key,
        }),
      );
    },
  }),
});
