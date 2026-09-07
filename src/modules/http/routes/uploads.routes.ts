import { Elysia, status } from "elysia";
import { useAuth, useUpload } from "../middleware";
import { Buns3Error, unwrap, validate } from "$/lib/error";
import { toUpload } from "$/modules/storage/mapping";
import { AppendQuery, CreateUpload } from "$/modules/validation/upload";
import { authorize } from "$/modules/auth/authorize";
import { uploadStorage } from "$/modules/storage/upload-storage";
import { uriEncodedKey } from "$/lib/request";

export const uploadsRoutes = new Elysia({
  name: "routes:uploads",
  prefix: "/_uploads",
})
  .use(useAuth)
  .use(useUpload)

  .post("", { auth: "write" }, async ({ request, set, body, authState }) => {
    const input = validate(CreateUpload, body);
    unwrap(
      await authorize({
        state: authState,
        capability: "write",
        bucket: input.bucket,
        method: request.method,
        key: input.key,
      }),
    );

    const { data } = unwrap(
      await uploadStorage.create(input.bucket, input.key, input.contentType),
    );

    set.headers.location = `/_uploads/${data.id}`;
    return status(201, { upload: toUpload(data) });
  })

  .patch(
    "/:id",
    { upload: true, auth: "write", parse: "none" },
    async ({ request, query, upload, params }) => {
      if (upload === null) throw new Buns3Error("UPLOAD_NOT_FOUND");

      const { offset } = validate(AppendQuery, query);
      const stream = request.body ?? new Blob([]).stream();
      const { data } = unwrap(
        await uploadStorage.append(params.id, stream, offset),
      );

      return { upload: toUpload(data) };
    },
  )

  .post(
    "/:id/complete",
    { upload: true, auth: "write" },
    async ({ set, upload, params }) => {
      if (upload === null) throw new Buns3Error("UPLOAD_NOT_FOUND");

      const {
        data: { object },
      } = unwrap(await uploadStorage.complete(params.id));

      set.headers.location = `/${object.bucketName}/${uriEncodedKey(object.key)}`;
      return status(201, {
        bucket: object.bucketName,
        key: object.key,
        location: set.headers.location,
      });
    },
  )

  .get("/:id", { upload: true, auth: "write" }, ({ upload }) => {
    if (upload === null) throw new Buns3Error("UPLOAD_NOT_FOUND");
    return { upload: toUpload(upload) };
  })

  .delete(
    "/:id",
    { upload: true, auth: "write" },
    async ({ upload, params }) => {
      if (upload === null) throw new Buns3Error("UPLOAD_NOT_FOUND");

      unwrap(await uploadStorage.abort(params.id));
      return status(204, null);
    },
  );
