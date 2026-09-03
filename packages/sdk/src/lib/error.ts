export const ERROR_CODES = [
  "KEY_NOT_FOUND",
  "BUCKET_NOT_FOUND",
  "BUCKET_ALREADY_EXIST",
  "BUCKET_NOT_EMPTY",
  "MALFORMED_BODY",
  "FS_ERROR",
  "NOT_FOUND",
  "INVALID_API_KEY",
  "API_KEY_NOT_CAPABLE",
  "API_KEY_SCOPE_MISMATCH",
  "API_KEY_NOT_FOUND",
  "VALIDATION_ERROR",
  "PRESIGNED_EXPIRED",
  "UNKNOWN",
] as const;

export const CLIENT_ERROR_CODES = ["NETWORK_ERROR"] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ClientErrorCode = ErrorCode | (typeof CLIENT_ERROR_CODES)[number];

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && ERROR_CODES.includes(code as ErrorCode);
}
