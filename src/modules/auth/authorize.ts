import type { ApiKey } from "../api-keys/types";
import { bucketStorage } from "../storage/bucket";
import type {
  AuthorizeCapability,
  AuthorizeOptions,
  AuthorizeResult,
  ResolvedCredentialsResult,
} from "./types";

export function resolveCredentials(
  authorization?: string,
): ResolvedCredentialsResult {
  if (!authorization) {
    return {
      success: true,
      credentials: { kind: "anonymous" },
    };
  }

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return {
      success: false,
      code: "INVALID_API_KEY",
    };
  }

  const token = authorization.slice(7);

  return {
    success: true,
    credentials: { kind: "bearer", token },
  };
}

export async function authorize(
  opts: AuthorizeOptions,
): Promise<AuthorizeResult> {
  const { apiKey, bucket, capability } = opts;

  if (apiKey === null) {
    return authorizeAnonymous(capability, bucket);
  }

  if (!hasCapability(apiKey, capability)) {
    return {
      success: false,
      code: "KEY_NOT_CAPABLE",
    };
  }

  if (!inScope(apiKey, bucket)) {
    return {
      success: false,
      code: "KEY_SCOPE_MISMATCH",
    };
  }

  return {
    success: true,
  };
}

async function authorizeAnonymous(
  capability?: AuthorizeCapability,
  bucket?: string,
): Promise<AuthorizeResult> {
  if (capability !== "read" || !bucket) {
    return {
      success: false,
      code: "INVALID_API_KEY",
    };
  }

  const result = await bucketStorage.get(bucket);
  if (!result.success || !result.bucket.publicRead) {
    return {
      success: false,
      code: "INVALID_API_KEY",
    };
  }

  return {
    success: true,
  };
}

export function hasCapability(
  apiKey: ApiKey,
  capability?: AuthorizeCapability,
) {
  if (capability === undefined || capability === true) {
    return true;
  }

  return {
    read: apiKey.canRead,
    write: apiKey.canWrite,
    admin: apiKey.isAdmin,
  }[capability];
}

export function inScope(apiKey: ApiKey, bucket?: string) {
  return !apiKey.bucketName || !bucket || apiKey.bucketName === bucket;
}
