import Elysia, { status } from "elysia";
import { useAuth, useBucket, useBucketKey } from "../middleware";
import { Buns3ValidationError, unwrap } from "$/lib/error";
import { fileStorage } from "$/modules/storage/file-storage";
import { applyObjectHeaders } from "../headers";
import { uriEncodedKey } from "$/lib/request";
import { ObjectListQuery } from "$/modules/validation/object";
import { type } from "arktype";

export const objectsRoutes = new Elysia({
  name: "routes:objects",
})
  .use(useAuth)
  .use(useBucket)
  .use(useBucketKey)

  .get(
    "/:bucket",
    { auth: "list", bucket: true },
    async ({ bucket, query }) => {
      const filters = ObjectListQuery(query);
      if (filters instanceof type.errors) {
        throw new Buns3ValidationError(filters);
      }

      const {
        objects,
        filters: effectiveFilters,
        nextAfter,
      } = unwrap(await fileStorage.list({ bucket, ...filters }));

      return {
        bucket,
        filters: effectiveFilters,
        count: objects.length,
        nextAfter,
        objects,
      };
    },
  )

  .group("/:bucket/*", (group) =>
    group
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
  );
