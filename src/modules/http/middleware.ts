import Elysia, { NotFound, t, type Context } from "elysia";
import { apiKeyStorage } from "../api-keys/api-key-storage";
import { Buns3Error, unwrap, validate } from "$/lib/error";
import { Key } from "../validation/object";
import { BucketName } from "../validation/bucket";
import { authorize, resolveCredentials } from "../auth/authorize";
import type {
  AuthorizeCapability,
  AuthState,
  Credentials,
} from "../auth/types";
import type { Logger } from "pino";
import { Id } from "../validation/upload";
import { uploadStorage } from "../storage/upload-storage";
import type { UploadRow } from "../storage/types";

async function resolveAuthState(credentials: Credentials): Promise<AuthState> {
  switch (credentials.kind) {
    case "anonymous":
      return { kind: "anonymous" };

    case "presign":
      return { kind: "presign", params: credentials.params };

    case "bearer":
      return {
        kind: "key",
        apiKey: unwrap(await apiKeyStorage.verify(credentials.token)).data,
      };

    default:
      throw new Buns3Error("INVALID_API_KEY");
  }
}

function getAuthBeforeHandler(capability?: AuthorizeCapability) {
  return async ({
    authState,
    params,
    request,
    bucket,
    key,
    upload,
  }: {
    // typed by hand: our own derive above guarantees this at runtime
    // params re-declared optional, Elysia's Context claims it's always present
    // but it's undefined for param-less routes.
    authState: AuthState;
    params?: Record<string, string>;
    // from the bucketKey derive on data routes. validated + decoded
    bucket?: string;
    key?: string;
    // from the useUpload derive
    upload?: UploadRow | null;
  } & Omit<Context, "params">) => {
    unwrap(
      await authorize({
        state: authState,
        capability,
        method: request.method,
        bucket: bucket ?? params?.bucket,
        key,
        uploadId: upload?.id,
      }),
    );
  };
}

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

export const useUpload = new Elysia({ name: "middleware:upload" }).macro({
  upload: {
    transform: async (ctx) => {
      ctx.params.id = validate(Id, ctx.params.id);
      const result = await uploadStorage.get(ctx.params.id);
      const data = result.success ? result.data : null;
      Object.assign(ctx, {
        bucket: data?.bucketName,
        key: data?.key,
        upload: data,
      });
    },

    derive: (ctx) => {
      const { bucket, key, upload } = ctx as typeof ctx & {
        bucket: string | undefined;
        key: string | undefined;
        upload: UploadRow | null;
      };

      return {
        bucket,
        key,
        upload,
      };
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
      return { authState: await resolveAuthState(credentials) };
    },

    beforeHandle: getAuthBeforeHandler(capability),
  }),
});

// Behind a proxy the socket peer is the proxy. Cloudflare's header is set by
// Cloudflare and cannot be forged by a client that came through it; Traefik
// sets X-Forwarded-For. Both are only trustworthy when the origin is reachable
// solely through the proxy, which is the operator's call — hence a flag.
function clientIpOf(
  request: Request,
  server: { requestIP(req: Request): { address: string } | null } | null,
) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    server?.requestIP(request)?.address
  );
}

export const useLogger = (logger: Logger, opts: { clientIp: boolean }) =>
  new Elysia({ name: "middleware:logger" })
    .transform((ctx) => {
      Object.assign(ctx, {
        requestId: crypto.randomUUID(),
        t0: performance.now(),
      });
    })
    .afterResponse((ctx) => {
      const { request, set, server, authState, requestId, t0, responseValue } =
        ctx as typeof ctx & {
          authState?: AuthState;
          requestId?: string;
          t0?: number;
          responseValue?: unknown;
        };

      const path = new URL(request.url).pathname;
      // A handler that returns a raw Response never touches `set.status`, so
      // the old `set.status ?? 200` logged 200 for every one of them — the
      // object HEAD route was right by luck, and a CORS preflight's 204 was
      // simply wrong. `responseValue` is the returned value (2.0 renamed it
      // from `response`), and is a Response only in exactly that case.
      const status =
        responseValue instanceof Response ? responseValue.status : (set.status ?? 200);
      // The healthcheck polls every 10s; a healthy answer is not worth an info line, a 503 is.
      const level = path === "/_health" && status === 200 ? "debug" : "info";

      logger[level](
        {
          requestId,
          method: request.method,
          path,
          status,
          ms: t0 === undefined ? undefined : Math.round(performance.now() - t0),
          auth:
            // the 2 presign flavours differ by route, not by credentials
            authState?.kind === "presign" && path.startsWith("/_uploads/")
              ? "uploadPresign"
              : authState?.kind,
          ip: opts.clientIp ? clientIpOf(request, server) : undefined,
        },
        "request",
      );
    })
    .as("global");
