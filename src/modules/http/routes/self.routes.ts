import Elysia, { status } from "elysia";
import { useAuth } from "../middleware";
import { Buns3Error, unwrap } from "$/lib/error";
import { apiKeyStorage } from "$/modules/api-keys/api-key-storage";

export const selfRoutes = new Elysia({ name: "routes:self", prefix: "/_self" })
  .use(useAuth)

  .get("", { auth: true }, ({ authState }) => {
    return { apiKey: authState.kind === "key" ? authState.apiKey : null };
  })

  .delete("", { auth: true }, async ({ authState }) => {
    // type-narrowing guard, not a real branch
    if (authState.kind !== "key") {
      throw new Buns3Error("INVALID_API_KEY");
    }

    unwrap(await apiKeyStorage.delete(authState.apiKey.id));

    return status(204, null);
  });
