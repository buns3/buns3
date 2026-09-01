import Elysia, { status } from "elysia";
import { useAuth, useBucket } from "../middleware";
import { BucketUpdate } from "$/modules/validation/bucket";
import { Buns3ValidationError, unwrap } from "$/lib/error";
import { type } from "arktype";
import { bucketStorage } from "$/modules/storage/bucket";

export const bucketsRoutes = new Elysia({
  name: "routes:buckets",
  prefix: "/_admin",
})
  .use(useBucket)
  .use(useAuth)

  .get("/buckets", { auth: "admin" }, async () => {
    const { buckets } = unwrap(await bucketStorage.list());
    return Response.json({ buckets });
  })

  .head("/buckets", { auth: "admin" })

  .get(
    "/buckets/:bucket",
    { auth: "admin", bucket: true },
    async ({ bucket: bucketName }) => {
      const { bucket } = unwrap(await bucketStorage.get(bucketName));
      return { bucket };
    },
  )

  .put(
    "/buckets/:bucket",
    { auth: "admin", bucket: true },
    async ({ set, bucket: bucketName }) => {
      const { bucket } = unwrap(await bucketStorage.create(bucketName));

      set.headers["location"] = `/${bucketName}`;
      return status(201, { bucket });
    },
  )

  .patch(
    "/buckets/:bucket",
    { auth: "admin", bucket: true },
    async ({ bucket: bucketName, body }) => {
      const input = BucketUpdate(body);
      if (input instanceof type.errors) {
        throw new Buns3ValidationError(input);
      }

      const { bucket } = unwrap(await bucketStorage.update(bucketName, input));
      return status(200, { bucket });
    },
  )

  .delete(
    "/buckets/:bucket",
    { auth: "admin", bucket: true },
    async ({ bucket: bucketName }) => {
      unwrap(await bucketStorage.delete(bucketName));
      return status(204, null);
    },
  )

  .head(
    "/buckets/:bucket",
    { auth: "admin", bucket: true },
    async ({ bucket: bucketName }) => {
      unwrap(await bucketStorage.head(bucketName));
    },
  );
