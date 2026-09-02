import Elysia, { status } from "elysia";
import { useAuth } from "../middleware";
import { ApiKeyId, CreateApiKey } from "$/modules/validation/api-key";
import { unwrap, validate } from "$/lib/error";
import { apiKeyStorage } from "$/modules/api-keys/api-key-storage";

export const apiKeyRoutes = new Elysia({
  name: "routes:api-keys",
  prefix: "/_admin",
})
  .use(useAuth)

  .group("/keys", { auth: "admin" }, (group) =>
    group
      .get("", async () => {
        const { data } = unwrap(await apiKeyStorage.getAll());
        return { apiKeys: data };
      })

      .post("", async ({ body }) => {
        const input = validate(CreateApiKey, body);

        const { data } = unwrap(await apiKeyStorage.create(input));
        return status(201, data);
      })

      .delete("/:id", async ({ params }) => {
        const keyId = validate(ApiKeyId, params.id);

        unwrap(await apiKeyStorage.delete(keyId));

        return status(204, null);
      }),
  );
