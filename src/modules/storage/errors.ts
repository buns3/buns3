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

export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

// Matches the documented shape of Prisma Next's SqlQueryError structurally,
// since the class itself lives in internal package paths.
interface SqlQueryErrorLike extends Error {
  kind: "sql_query";
  sqlState?: string;
  constraint?: string;
}

export function isSqlQueryError(err: unknown): err is SqlQueryErrorLike {
  return err instanceof Error && "kind" in err && err.kind === "sql_query";
}

export function isUniqueViolation(err: unknown, constraint?: string) {
  return (
    isSqlQueryError(err) &&
    err.sqlState === "23505" &&
    (constraint === undefined || err.constraint === constraint)
  );
}

export function isFkViolation(err: unknown, constraint?: string) {
  return (
    isSqlQueryError(err) &&
    err.sqlState === "23503" &&
    (constraint === undefined || err.constraint === constraint)
  );
}
