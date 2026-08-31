import Elysia, { status } from "elysia";
import { useAuth } from "../middleware";
import { Buns3Error, Buns3ValidationError, unwrap } from "$/lib/error";
import { apiKeyStorage } from "$/modules/api-keys/api-key-storage";
import { PresignRequest } from "$/modules/validation/presign";
import { type } from "arktype";
import { authorize, methodCapabilityMap } from "$/modules/auth/authorize";
import { buildPresignedUrl } from "$/lib/presign";

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
  })

  .post("/presign", { auth: true }, async ({ authState, body }) => {
    const input = PresignRequest(body);
    if (input instanceof type.errors) {
      throw new Buns3ValidationError(input);
    }

    // type-narrowing guard, not a real branch
    if (authState.kind !== "key") {
      throw new Buns3Error("INVALID_API_KEY");
    }

    unwrap(
      await authorize({
        state: authState,
        bucket: input.bucket,
        method: input.method,
        capability: methodCapabilityMap[input.method],
      }),
    );

    const { data } = unwrap(
      await apiKeyStorage.presign({
        id: authState.apiKey.id,
        bucket: input.bucket,
        key: input.key,
        method: input.method,
        ttl: input.ttl,
      }),
    );

    return {
      url: buildPresignedUrl(
        process.env.BASE_URL ?? "http://localhost:8000",
        input.bucket,
        input.key,
        {
          expires: data.expires,
          keyId: data.keyId,
          sig: data.sig,
        },
      ),
      expires: data.expires,
    };
  });
