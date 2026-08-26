export const ERROR_CODES = [
  "KEY_NOT_FOUND",
  "BUCKET_NOT_FOUND",
  "BUCKET_ALREADY_EXIST",
  "FS_ERROR",
  "UNKNOWN",
] as const;

export type Buns3ErrorCode = (typeof ERROR_CODES)[number];

export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
