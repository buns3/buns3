export const ERROR_CODES = [
  "KEY_NOT_FOUND",
  "BUCKET_NOT_FOUND",
  "BUCKET_ALREADY_EXIST",
  "BUCKET_NOT_EMPTY",
  "MALFORMED_BODY",
  "FS_ERROR",
  "NOT_FOUND",
  "UNKNOWN",
] as const;

export type Buns3ErrorCode = (typeof ERROR_CODES)[number];

export const API_KEY_ERROR_CODES = [
  "INVALID_API_KEY",
  "BUCKET_NOT_FOUND",
  "API_KEY_NOT_CAPABLE",
  "API_KEY_SCOPE_MISMATCH",
  "API_KEY_NOT_FOUND",
  "UNKNOWN",
] as const;

export type Buns3ApiKeyErrorCode = (typeof API_KEY_ERROR_CODES)[number];

export const VALIDATION_ERROR_CODES = ["VALIDATION_ERROR"] as const;

export type Buns3ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

export const PRESIGN_ERROR_CODES = [
  "INVALID_API_KEY",
  "PRESIGNED_EXPIRED",
] as const;

export type Buns3PresignErrorCode = (typeof PRESIGN_ERROR_CODES)[number];

export const UPLOAD_ERROR_CODES = [
  "UPLOAD_NOT_FOUND",
  "OFFSET_MISMATCH",
] as const;

export type Buns3UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number];

export type Buns3AnyErrorCode =
  | Buns3ErrorCode
  | Buns3ApiKeyErrorCode
  | Buns3ValidationErrorCode
  | Buns3PresignErrorCode
  | Buns3UploadErrorCode;

// Every code the server can emit, in one array. `satisfies` makes a new family
// a compile error here rather than a silent gap in the SDK drift guard, which
// used to enumerate the families by hand and so could not see a fifth one.
export const ALL_ERROR_CODES = [
  ...ERROR_CODES,
  ...API_KEY_ERROR_CODES,
  ...VALIDATION_ERROR_CODES,
  ...PRESIGN_ERROR_CODES,
  ...UPLOAD_ERROR_CODES,
] as const satisfies readonly Buns3AnyErrorCode[];

// If this errors, a code family is missing from ALL_ERROR_CODES above.
type _AllCodesCovered =
  Exclude<Buns3AnyErrorCode, (typeof ALL_ERROR_CODES)[number]> extends never
    ? true
    : never;
const _allCodesCovered: _AllCodesCovered = true;
void _allCodesCovered;
