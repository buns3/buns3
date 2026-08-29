import Elysia, { InternalServerError, status, t } from "elysia";
import { fileStorage } from "$/modules/storage/file-storage";
import { Buns3Error, Buns3ValidationError, unwrap } from "$/lib/error";
import { useAuth, useBucketKey } from "./middleware";
import { useErrorHandler } from "./error";
import { applyObjectHeaders } from "./headers";
import { uriEncodedKey } from "$/lib/request";
import { CreateApiKey } from "../validation/api-key";
import { apiKeyStorage } from "../api-keys/api-key-storage";
import { type } from "arktype";
import { bucketStorage } from "../storage/bucket";
import { BucketName, BucketUpdate } from "../validation/bucket";
import openapi from "@elysia/openapi";

export async function initServer() {
  const app = new Elysia({
    serve: { maxRequestBodySize: 5 * 1024 ** 3 },
  })
    .use(useErrorHandler)
    .use(useAuth)
    .use(
      openapi({
        exclude: {
          paths: ["/:bucket/*"],
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

    // /bucket/key routes
    .group("/:bucket/*", (group) =>
      group
        .use(useBucketKey)
        .get(
          "",
          { auth: "read", bucketKey: true },
          async ({ set, bucket, key }) => {
            const { file, object } = unwrap(await fileStorage.get(bucket, key));
            applyObjectHeaders(set.headers, object);
            return file;
          },
        )
        .put(
          "",
          {
            auth: "write",
            bucketKey: true,
            parse: "none",
          },
          async ({ set, bucket, key, request, headers }) => {
            const stream = request.body ?? new Blob([]).stream();
            const contentType =
              headers["content-type"] ?? "application/octet-stream";

            const { object } = unwrap(
              await fileStorage.put(bucket, key, stream, contentType),
            );

            set.headers["location"] =
              `/${object.bucketName}/${uriEncodedKey(object.key)}`;

            return status(201, {
              bucket: object.bucketName,
              key,
            });
          },
        )
        .delete(
          "",
          { auth: "write", bucketKey: true },
          async ({ bucket, key }) => {
            unwrap(await fileStorage.delete(bucket, key));
            return status(204, null);
          },
        )
        .head(
          "",
          { auth: "read", bucketKey: true },
          async ({ set, bucket, key }) => {
            const { object } = unwrap(await fileStorage.get(bucket, key));
            applyObjectHeaders(set.headers, object);
            set.headers["content-length"] = String(object.size);
          },
        ),
    )

    // whoami route
    .get("/_admin/whoami", { auth: true }, ({ apiKey }) => {
      return { apiKey };
    })

    // rest of admin routes
    .group("/_admin", { auth: "admin" }, (group) =>
      group
        .post("/keys", async ({ body }) => {
          const input = CreateApiKey(body);
          if (input instanceof type.errors) {
            throw new Buns3ValidationError(input);
          }

          const { data } = unwrap(await apiKeyStorage.create(input));
          return status(201, data);
        })

        .get("/buckets", { auth: "admin" }, async () => {
          const { buckets } = unwrap(await bucketStorage.list());
          return Response.json({ buckets });
        })
        .head("/buckets", { auth: "admin" })

        .get("/buckets/:name", { auth: "admin" }, async ({ params }) => {
          const name = BucketName(params.name);
          if (name instanceof type.errors) {
            throw new Buns3ValidationError(name);
          }

          const { bucket } = unwrap(await bucketStorage.get(name));
          return { bucket };
        })
        .put("/buckets/:name", { auth: "admin" }, async ({ set, params }) => {
          const name = BucketName(params.name);
          if (name instanceof type.errors) {
            throw new Buns3ValidationError(name);
          }

          const { bucket } = unwrap(await bucketStorage.create(name));

          set.headers["location"] = `/${name}`;
          return status(201, { bucket });
        })
        .patch(
          "/buckets/:name",
          { auth: "admin" },
          async ({ params, body }) => {
            const name = BucketName(params.name);
            if (name instanceof type.errors) {
              throw new Buns3ValidationError(name);
            }

            const input = BucketUpdate(body);
            if (input instanceof type.errors) {
              throw new Buns3ValidationError(input);
            }

            const { bucket } = unwrap(await bucketStorage.update(name, input));
            return status(200, { bucket });
          },
        )
        .delete("/buckets/:name", { auth: "admin" }, async ({ params }) => {
          const name = BucketName(params.name);
          if (name instanceof type.errors) {
            throw new Buns3ValidationError(name);
          }

          unwrap(await bucketStorage.delete(name));
          return status(204, null);
        })
        .head("/buckets/:name", { auth: "admin" }, async ({ params }) => {
          const name = BucketName(params.name);
          if (name instanceof type.errors) {
            throw new Buns3ValidationError(name);
          }

          unwrap(await bucketStorage.head(name));
        }),
    )

    .listen(process.env.PORT ?? 8000);

  console.log("HTTP server started at", app.server?.url.href);
  return app;
}
