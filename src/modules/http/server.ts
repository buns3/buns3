import Elysia from "elysia";
import { useErrorHandler } from "./error";
import openapi from "@elysia/openapi";
import { apiKeyRoutes } from "./routes/api-key.routes";
import { objectsRoutes } from "./routes/objects.routes";
import { bucketsRoutes } from "./routes/buckets.routes";
import { selfRoutes } from "./routes/self.routes";
import { serverRoutes } from "./routes/server.routes";
import { VERSION } from "$/lib/version";
import { cleanupRoutes } from "./routes/cleanup.routes";
import { config } from "$/config";
import { logger } from "$/lib/logger";
import { useLogger } from "./middleware";
import type { Logger } from "pino";
import { uploadsRoutes } from "./routes/uploads.routes";
import { cors } from "@elysia/cors";
import { corsOrigin } from "$/lib/cors";

const defaultLogger = logger.child({ module: "http" });

export function createServer({
  logger = defaultLogger,
  clientIp = config.LOG_CLIENT_IP,
  corsOrigins = config.CORS_ORIGINS,
}: {
  logger?: Logger;
  clientIp?: boolean;
  corsOrigins?: "*" | string[];
} = {}) {
  return new Elysia({
    serve: { maxRequestBodySize: 5 * 1024 ** 3 },
  })
    .use([
      ...(corsOrigins
        ? [
            cors({
              origin: corsOrigin(corsOrigins),
              allowedHeaders:
                "Authorization, Content-Type, If-None-Match, Range",
              exposeHeaders: "ETag, Location, Content-Range",
              maxAge: 600,
              credentials: false,
            }),
          ]
        : []),
    ])
    .use(useErrorHandler)
    .use(useLogger(logger, { clientIp }))
    .use(
      openapi({
        enabled: config.OPENAPI,
        path: "/_openapi",
        exclude: {
          paths: ["/:bucket/*", "/:bucket"],
        },
        documentation: {
          components: {
            securitySchemes: {
              bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "buns3 API key",
              },
            },
          },
          security: [{ bearerAuth: [] }],
        },
      }),
    )

    .get("/", () => ({ message: "OK" }))
    .get(
      "/favicon.ico",
      new Response(null, {
        status: 204,
        headers: { "cache-control": "public, max-age=86400" },
      }),
    )

    .use(objectsRoutes(corsOrigins))
    .use(apiKeyRoutes)
    .use(bucketsRoutes)
    .use(selfRoutes)
    .use(serverRoutes)
    .use(cleanupRoutes)
    .use(uploadsRoutes);
}

export function initServer() {
  const app = createServer().listen(config.PORT);
  defaultLogger.info(
    { url: app.server?.url.href, version: VERSION },
    "HTTP server started",
  );
  defaultLogger.info({ config }, "effective configuration");
  return app;
}
