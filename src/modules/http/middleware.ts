import { extractKey } from "$/lib/route";
import { type } from "arktype";
import { BucketName } from "../validation/bucket";
import { errorResponse, validationErrorResponse } from "./errors";
import { Key } from "../validation/object";
import { apiKeyStorage } from "../api-keys/api-key-storage";

export function bucketKeyMiddleware(req: {
  url: string;
  params: { bucket: string };
}) {
  const result = extractKey(req.url);
  if (!result.success) {
    return errorResponse("INVALID_KEY");
  }

  const keyResult = Key(result.key);
  if (keyResult instanceof type.errors) {
    return validationErrorResponse(keyResult);
  }

  const bucketResult = BucketName(req.params.bucket);
  if (bucketResult instanceof type.errors) {
    return validationErrorResponse(bucketResult);
  }

  return { bucket: bucketResult, key: keyResult };
}

export function bucketMiddleware(req: { params: { name: string } }) {
  const name = BucketName(req.params.name);
  if (name instanceof type.errors) {
    return validationErrorResponse(name);
  }

  return { name };
}

export function requireAuth(capability?: "read" | "write" | "admin") {
  return async (req: { headers: Headers }, ctx: { bucket?: string }) => {
    const rawKey = req.headers.get("Authorization");
    if (!rawKey) {
      return errorResponse("INVALID_API_KEY");
    }

    if (!rawKey.toLowerCase().startsWith("bearer ")) {
      return errorResponse("INVALID_API_KEY");
    }

    const key = rawKey.substring(7);
    const result = await apiKeyStorage.verify(key);
    if (!result.success) {
      return errorResponse(result.code);
    }

    const apiKey = result.data;

    if (capability) {
      const isCapable = {
        read: apiKey.canRead,
        write: apiKey.canWrite,
        admin: apiKey.isAdmin,
      }[capability];

      if (!isCapable) return errorResponse("KEY_NOT_CAPABLE");
    }

    if (apiKey.bucketName && ctx.bucket && apiKey.bucketName !== ctx.bucket) {
      return errorResponse("KEY_NOT_CAPABLE");
    }

    return {
      apiKey,
    };
  };
}
