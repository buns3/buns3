import Elysia, { NotFound, t, type Context } from "elysia";
import { apiKeyStorage } from "../api-keys/api-key-storage";
import { Buns3Error, unwrap, validate } from "$/lib/error";
import { Key } from "../validation/object";
import { BucketName } from "../validation/bucket";
import { authorize, resolveCredentials } from "../auth/authorize";
import type { AuthorizeCapability, AuthState } from "../auth/types";
import type { Logger } from "pino";

export const useBucketKey = new Elysia({ name: "middleware:bucket-key" }).macro(
  {
    bucketKey: {
      transform: ({ params }) => {
        const { bucket, "*": key } = params;
        if (!key) {
          throw new NotFound();
        }

        params["*"] = validate(Key, key);
        params.bucket = validate(BucketName, bucket);
      },

      derive: ({ params }) => {
        // Both params validated in the "transform" above
        return { bucket: params.bucket!, key: params["*"]! };
      },
    },
  },
);

export const useBucket = new Elysia({ name: "middleware:bucket" }).macro({
  bucket: {
    transform: ({ params }) => {
      params.bucket = validate(BucketName, params.bucket);
    },

    derive: ({ params }) => {
      // Bucket-param validated in the "transform" above
      return { bucket: params.bucket! };
    },
  },
});

export const useAuth = new Elysia({
  name: "middleware:auth",
}).macro({
  auth: (capability?: AuthorizeCapability) => ({
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

export const useLogger = (logger: Logger) =>
  new Elysia({ name: "middleware:logger" })
    .transform((ctx) => {
      Object.assign(ctx, {
        requestId: crypto.randomUUID(),
        t0: performance.now(),
      });
    })
    .afterResponse((ctx) => {
      const { request, set, authState, requestId, t0 } = ctx as typeof ctx & {
        authState?: AuthState;
        requestId?: string;
        t0?: number;
      };

      const path = new URL(request.url).pathname;
      const status = set.status ?? 200;
      // The healthcheck polls every 10s; a healthy answer is not worth an info line, a 503 is.
      const level = path === "/_health" && status === 200 ? "debug" : "info";

      logger[level](
        {
          requestId,
          method: request.method,
          path,
          status,
          ms: t0 === undefined ? undefined : Math.round(performance.now() - t0),
          auth: authState?.kind,
        },
        "request",
      );
    })
    .as("global");
