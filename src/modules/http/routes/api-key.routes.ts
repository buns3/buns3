import Elysia, { status } from "elysia";
import { useAuth } from "../middleware";
import { ApiKeyId, CreateApiKey } from "$/modules/validation/api-key";
import { Buns3Error, Buns3ValidationError, unwrap } from "$/lib/error";
import { apiKeyStorage } from "$/modules/api-keys/api-key-storage";
import { type } from "arktype";

export const apiKeyRoutes = new Elysia({
  name: "routes:api-keys",
  prefix: "/_admin",
})
  .use(useAuth)

  // whoami route
  .get("/whoami", { auth: true }, ({ authState }) => {
    return { apiKey: authState.kind === "key" ? authState.apiKey : null };
  })

  .group("/keys", { auth: "admin" }, (group) =>
    group
      .get("", async () => {
        const { data } = unwrap(await apiKeyStorage.getAll());
        return { apiKeys: data };
      })

      .post("", async ({ body }) => {
        const input = CreateApiKey(body);
        if (input instanceof type.errors) {
          throw new Buns3ValidationError(input);
        }

        const { data } = unwrap(await apiKeyStorage.create(input));
        return status(201, data);
      })

      .delete("/:id", async ({ params }) => {
        const keyId = ApiKeyId(params.id);
        if (keyId instanceof type.errors) {
          throw new Buns3ValidationError(keyId);
        }

        unwrap(await apiKeyStorage.delete(keyId));

        return status(204, null);
      }),
  );
