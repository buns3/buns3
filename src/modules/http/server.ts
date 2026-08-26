import { withMiddleware } from "$/lib/middleware";
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

          const keyParts = fileResult.object.key.split("/");
          const filename = encodeURIComponent(keyParts.at(-1)!)
            .replaceAll("'", "%27")
            .replaceAll("(", "%28")
            .replaceAll(")", "%29")
            .replaceAll("*", "%2A");

          const headers = new Headers();
          headers.set("Content-Type", fileResult.object.contentType);
          headers.set(
            "Last-Modified",
            fileResult.object.createdAt.toUTCString(),
          );
          headers.set(
            "Content-Disposition",
            `inline; filename*=UTF-8''${filename}`,
          );
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

        DELETE: withMiddleware([bucketKeyMiddleware], (req, ctx, server) => {
          return Response.json({ ...ctx });
        }),

        HEAD: withMiddleware([bucketKeyMiddleware], (req, ctx, server) => {
          return Response.json({ ...ctx });
        }),
      },
    },

    development: Bun.env.NODE_ENV !== "production",
  });

  console.log("HTTP server started at", server.url.href);

  return server;
}
