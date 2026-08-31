import { type } from "arktype";
import type { ApiKey } from "../api-keys/types";
import { bucketStorage } from "../storage/bucket";
import { PresignParams } from "../validation/presign";
import type {
  AuthorizeCapability,
  AuthorizeOptions,
  AuthorizeResult,
  ResolvedCredentialsResult,
} from "./types";
import { isPresignMethod, type PresignMethod } from "$/lib/presign";
import { apiKeyStorage } from "../api-keys/api-key-storage";

const PRESIGN_PARAM_KEYS = PresignParams.props.map((p) => p.key);

export const methodCapabilityMap = {
  GET: "read",
  HEAD: "read",
  DELETE: "write",
  PUT: "write",
} satisfies Record<PresignMethod, Exclude<AuthorizeCapability, "admin" | true>>;

export function resolveCredentials(
  authorization?: string,
  query?: Record<string, string | undefined>,
): ResolvedCredentialsResult {
  const isPresign = query && PRESIGN_PARAM_KEYS.some((k) => k in query);

  if (isPresign) {
    return resolvePresignCredentials(authorization, query);
  }

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

function resolvePresignCredentials(
  authorization?: string,
  query?: Record<string, string | undefined>,
): ResolvedCredentialsResult {
  if (authorization) {
    return {
      success: false,
      code: "INVALID_API_KEY",
    };
  }

  const presignParams = PresignParams({
    keyId: query?.keyId,
    expires: query?.expires,
    sig: query?.sig,
  });

  if (presignParams instanceof type.errors) {
    return {
      success: false,
      code: "INVALID_API_KEY",
    };
  }

  return {
    success: true,
    credentials: { kind: "presign", params: presignParams },
  };
}

export async function authorize(
  opts: AuthorizeOptions,
): Promise<AuthorizeResult> {
  const { state, bucket, capability, method, key } = opts;

  switch (state.kind) {
    case "anonymous":
      return authorizeAnonymous(capability, bucket);

    case "presign": {
      return authorizePresign(state.params, {
        capability,
        bucket,
        key,
        method,
      });
    }

    case "key":
      return authorizeKey(state.apiKey, capability, bucket);

    default:
      return {
        success: false,
        code: "INVALID_API_KEY",
      };
  }
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

async function authorizePresign(
  params: PresignParams,
  opts: {
    capability?: AuthorizeCapability;
    bucket?: string;
    key?: string;
    method: string;
  },
): Promise<AuthorizeResult> {
  const { capability, bucket, key, method } = opts;

  if (!bucket || !key || !isPresignMethod(method)) {
    return { success: false, code: "INVALID_API_KEY" };
  }

  const result = await apiKeyStorage.verifyPresigned({
    ...params,
    method,
    bucket,
    key,
    now: Math.floor(Date.now() / 1000), // milliseconds -> unix seconds
  });

  if (!result.success) {
    return result;
  }

  return authorizeKey(result.data, capability, bucket);
}

function authorizeKey(
  apiKey: ApiKey,
  capability?: AuthorizeCapability,
  bucket?: string,
): AuthorizeResult {
  if (!hasCapability(apiKey, capability)) {
    return {
      success: false,
      code: "API_KEY_NOT_CAPABLE",
    };
  }

  if (!inScope(apiKey, bucket)) {
    return {
      success: false,
      code: "API_KEY_SCOPE_MISMATCH",
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
