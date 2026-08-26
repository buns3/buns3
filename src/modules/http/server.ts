import { withMiddleware } from "$/lib/middleware";
import { objectHeaders } from "$/lib/request";
import { fileStorage } from "../storage/file-storage";
import { errorResponse } from "./errors";
import { bucketKeyMiddleware } from "./middleware";
import type { AppServer } from "./types";

export async function initServer(): Promise<AppServer> {
  const server = Bun.serve({
    port: Bun.env.PORT ?? 8000,
    maxRequestBodySize: 1024 * 1024 * 1024 * 5, // 5GB
    routes: {
      "/": Response.json({ message: "OK" }),

      "/:bucket/*": {
        GET: withMiddleware([bucketKeyMiddleware], async (req, ctx, server) => {
          const fileResult = await fileStorage.get(ctx.bucket, ctx.key);
          if (!fileResult.success) {
            return errorResponse(fileResult.code);
          }

          const headers = objectHeaders(fileResult.object);
          return new Response(fileResult.file, { headers });
        }),

        PUT: withMiddleware([bucketKeyMiddleware], async (req, ctx, server) => {
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

          return Response.json({ ...ctx });
        }),

        DELETE: withMiddleware(
          [bucketKeyMiddleware],
          async (req, ctx, server) => {
            const fileResult = await fileStorage.delete(ctx.bucket, ctx.key);
            if (!fileResult.success) {
              return errorResponse(fileResult.code);
            }

            return new Response(null, { status: 204 });
          },
        ),

        HEAD: withMiddleware(
          [bucketKeyMiddleware],
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
    },

    development: Bun.env.NODE_ENV !== "production",
  });

  console.log("HTTP server started at", server.url.href);

  return server;
}
