import Elysia, { status } from "elysia";
import { useAuth, useBucket, useBucketKey } from "../middleware";
import { unwrap, validate } from "$/lib/error";
import { fileStorage } from "$/modules/storage/file-storage";
import { applyPayloadHeaders, applyValidatorHeaders } from "../headers";
import { uriEncodedKey } from "$/lib/request";
import { BatchDelete, ObjectListQuery } from "$/modules/validation/object";
import { etagMatches } from "$/lib/etag";

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
      const filters = validate(ObjectListQuery, query);

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

  .delete(
    "/:bucket",
    { auth: "write", bucket: true },
    async ({ bucket, body }) => {
      const input = validate(BatchDelete, body);

      const { results, summary } = unwrap(
        await fileStorage.deleteMany(bucket, input.keys),
      );

      return { bucket, summary, results };
    },
  )

  .group("/:bucket/*", (group) =>
    group
      .get(
        "",
        { auth: "read", bucketKey: true },
        async ({ set, bucket, key, authState, headers }) => {
          const ifNoneMatch = headers["if-none-match"];
          const { file, object } = unwrap(await fileStorage.get(bucket, key));

          applyValidatorHeaders(set.headers, object, authState.kind);
          if (ifNoneMatch && etagMatches(ifNoneMatch, `"${object.id}"`)) {
            return status(304, null);
          }

          applyPayloadHeaders(set.headers, object);
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
        async ({ set, bucket, key, authState, headers }) => {
          const ifNoneMatch = headers["if-none-match"];
          const { object } = unwrap(await fileStorage.get(bucket, key));

          applyValidatorHeaders(set.headers, object, authState.kind);
          if (ifNoneMatch && etagMatches(ifNoneMatch, `"${object.id}"`)) {
            return status(304, null);
          }

          applyPayloadHeaders(set.headers, object);
          set.headers["content-length"] = String(object.size);
        },
      ),
  );
