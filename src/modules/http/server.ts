import { withMiddleware } from "$/lib/middleware";
import { objectHeaders, uriEncodedKey } from "$/lib/request";
import { fileStorage } from "../storage/file-storage";
import { errorResponse, validationErrorResponse } from "./errors";
import {
  bucketKeyMiddleware,
  bucketMiddleware,
  requireAuth,
} from "./middleware";
import type { AppServer } from "./types";
import { bucketStorage } from "../storage/bucket";
import { CreateApiKey } from "../validation/api-key";
import { type } from "arktype";
import { apiKeyStorage } from "../api-keys/api-key-storage";

export async function initServer(): Promise<AppServer> {
  const server = Bun.serve({
    port: Bun.env.PORT ?? 8000,
    maxRequestBodySize: 1024 * 1024 * 1024 * 5, // 5GB
    routes: {
      "/": Response.json({ message: "OK" }),

      "/:bucket/*": {
        GET: withMiddleware(
          [bucketKeyMiddleware, requireAuth("read")],
          async (req, ctx, server) => {
            const fileResult = await fileStorage.get(ctx.bucket, ctx.key);
            if (!fileResult.success) {
              return errorResponse(fileResult.code);
            }

            const headers = objectHeaders(fileResult.object);
            return new Response(fileResult.file, { headers });
          },
        ),

        PUT: withMiddleware(
          [bucketKeyMiddleware, requireAuth("write")],
          async (req, ctx, server) => {
            const stream = req.body;
            if (!stream) return errorResponse("UNKNOWN");

            const contentType =
              req.headers.get("content-type") ?? "application/octet-stream";
            const fileResult = await fileStorage.put(
              ctx.bucket,
              ctx.key,
              stream,
              contentType,
            );
            if (!fileResult.success) {
              return errorResponse(fileResult.code);
            }

            const headers = new Headers();
            headers.set(
              "Location",
              `/${fileResult.object.bucketName}/${uriEncodedKey(fileResult.object.key)}`,
            );
            return Response.json(
              { bucket: ctx.bucket, key: ctx.key },
              { status: 201, headers },
            );
          },
        ),

        DELETE: withMiddleware(
          [bucketKeyMiddleware, requireAuth("write")],
          async (req, ctx, server) => {
            const fileResult = await fileStorage.delete(ctx.bucket, ctx.key);
            if (!fileResult.success) {
              return errorResponse(fileResult.code);
            }

            return new Response(null, { status: 204 });
          },
        ),

        HEAD: withMiddleware(
          [bucketKeyMiddleware, requireAuth("read")],
          async (req, ctx, server) => {
            const fileResult = await fileStorage.get(ctx.bucket, ctx.key);
            if (!fileResult.success) {
              const errResponse = errorResponse(fileResult.code);
              return new Response(null, { status: errResponse.status });
            }

            const headers = objectHeaders(fileResult.object);
            return new Response(null, { headers });
          },
        ),
      },

      "/_admin/buckets": {
        GET: withMiddleware([requireAuth("admin")], async () => {
          const bucketsResult = await bucketStorage.list();
          if (!bucketsResult.success) {
            return errorResponse(bucketsResult.code);
          }

          return Response.json({ buckets: bucketsResult.buckets });
        }),

        HEAD: withMiddleware([requireAuth("admin")], () => {
          return new Response(null);
        }),
      },

      "/_admin/whoami": {
        GET: withMiddleware([requireAuth()], async (req, ctx, server) => {
          return Response.json({ apiKey: ctx.apiKey });
        }),
      },

      "/_admin/keys": {
        POST: withMiddleware(
          [requireAuth("admin")],
          async (req, ctx, server) => {
            const input = CreateApiKey(await req.json());
            if (input instanceof type.errors) {
              return validationErrorResponse(input);
            }

            const result = await apiKeyStorage.create(input);
            if (!result.success) {
              return errorResponse(result.code);
            }

            return Response.json(result.data);
          },
        ),
      },

      "/_admin/buckets/:name": {
        GET: withMiddleware(
          [bucketMiddleware, requireAuth("admin")],
          async (req, ctx, server) => {
            const result = await bucketStorage.get(ctx.name);
            if (!result.success) {
              return errorResponse(result.code);
            }

            return Response.json({ bucket: result.bucket });
          },
        ),

        PUT: withMiddleware(
          [bucketMiddleware, requireAuth("admin")],
          async (req, ctx, server) => {
            const result = await bucketStorage.create(ctx.name);
            if (!result.success) {
              return errorResponse(result.code);
            }

            const headers = new Headers();
            headers.set("Location", `/${ctx.name}`);
            return Response.json(
              { bucket: result.bucket },
              { status: 201, headers },
            );
          },
        ),

        DELETE: withMiddleware(
          [bucketMiddleware, requireAuth("admin")],
          async (req, ctx, server) => {
            const result = await bucketStorage.delete(ctx.name);
            if (!result.success) {
              return errorResponse(result.code);
            }

            return new Response(null, { status: 204 });
          },
        ),

        HEAD: withMiddleware(
          [bucketMiddleware, requireAuth("admin")],
          async (req, ctx, server) => {
            const result = await bucketStorage.head(ctx.name);
            if (!result.success) {
              const valResponse = errorResponse(result.code);
              return new Response(null, { status: valResponse.status });
            }

            return new Response(null);
          },
        ),
      },
    },

    development: Bun.env.NODE_ENV !== "production",
  });

  console.log("HTTP server started at", server.url.href);

  return server;
}
