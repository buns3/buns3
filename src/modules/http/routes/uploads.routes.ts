import { Elysia } from "elysia";
import { useAuth, useUpload } from "../middleware";
import { Buns3Error } from "$/lib/error";
import { toUpload } from "$/modules/storage/mapping";

export const uploadsRoutes = new Elysia({
  name: "routes:uploads",
  prefix: "/_uploads",
})
  .use(useAuth)
  .use(useUpload)
  .get("/:id", { upload: true, auth: "write" }, ({ upload }) => {
    if (upload === null) throw new Buns3Error("UPLOAD_NOT_FOUND");
    return { upload: toUpload(upload) };
  });
