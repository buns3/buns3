import Elysia, { status } from "elysia";
import { useAuth } from "../middleware";
import { BucketName, BucketUpdate } from "$/modules/validation/bucket";
import { Buns3ValidationError, unwrap } from "$/lib/error";
import { type } from "arktype";
import { bucketStorage } from "$/modules/storage/bucket";

export const bucketsRoutes = new Elysia({
  name: "routes:buckets",
  prefix: "/_admin",
})
  .use(useAuth)

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

  .patch("/buckets/:name", { auth: "admin" }, async ({ params, body }) => {
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
  })

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
  });
