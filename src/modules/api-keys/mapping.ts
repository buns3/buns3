import type { ApiKey, ApiKeyRow } from "./types";

export function toApiKey(apiKey: ApiKeyRow): ApiKey {
  return {
    id: apiKey.id,
    name: apiKey.name,
    bucketName: apiKey.bucketName,
    canRead: apiKey.canRead !== 0,
    canWrite: apiKey.canWrite !== 0,
    isAdmin: apiKey.isAdmin !== 0,
    tokenHint: apiKey.tokenHint,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
  };
}
