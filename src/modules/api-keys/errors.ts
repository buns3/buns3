export const API_KEY_ERROR_CODES = [
  "INVALID_API_KEY",
  "BUCKET_NOT_FOUND",
  "KEY_NOT_CAPABLE",
  "UNKNOWN",
] as const;

export type Buns3ApiKeyErrorCode = (typeof API_KEY_ERROR_CODES)[number];
