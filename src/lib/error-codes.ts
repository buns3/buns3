export const ERROR_CODES = [
  "KEY_NOT_FOUND",
  "INVALID_KEY",
  "BUCKET_NOT_FOUND",
  "BUCKET_ALREADY_EXIST",
  "BUCKET_NOT_EMPTY",
  "FS_ERROR",
  "UNKNOWN",
] as const;

export type Buns3ErrorCode = (typeof ERROR_CODES)[number];

export const API_KEY_ERROR_CODES = [
  "INVALID_API_KEY",
  "BUCKET_NOT_FOUND",
  "KEY_NOT_CAPABLE",
  "KEY_SCOPE_MISMATCH",
  "UNKNOWN",
] as const;

export type Buns3ApiKeyErrorCode = (typeof API_KEY_ERROR_CODES)[number];

export const VALIDATION_ERROR_CODES = ["VALIDATION_ERROR"] as const;

export type Buns3ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

export type Buns3AnyErrorCode =
  Buns3ErrorCode | Buns3ApiKeyErrorCode | Buns3ValidationErrorCode;
