import Elysia from "elysia";
import { useErrorHandler } from "./error";
import openapi from "@elysia/openapi";
import { apiKeyRoutes } from "./routes/api-key.routes";
import { objectsRoutes } from "./routes/objects.routes";
import { bucketsRoutes } from "./routes/buckets.routes";
import { selfRoutes } from "./routes/self.routes";

export async function initServer() {
  const app = new Elysia({
    serve: { maxRequestBodySize: 5 * 1024 ** 3 },
  })
    .use(useErrorHandler)
    .use(
      openapi({
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

    .use(objectsRoutes)
    .use(apiKeyRoutes)
    .use(bucketsRoutes)
    .use(selfRoutes)

    .listen(process.env.PORT ?? 8000);

  console.log("HTTP server started at", app.server?.url.href);
  return app;
}
