import { Buns3Error, Buns3ValidationError } from "$/lib/error";
import type { Buns3AnyErrorCode } from "$/lib/error-codes";
import Elysia, {
  InternalServerError,
  NotFound,
  ParseError,
  problem,
  ValidationError,
} from "elysia";

export const ERROR_STATUS = {
  // 4xx
  MALFORMED_BODY: 400,
  INVALID_API_KEY: 401,
  PRESIGNED_EXPIRED: 401,
  API_KEY_NOT_CAPABLE: 403,
  API_KEY_SCOPE_MISMATCH: 403,
  KEY_NOT_FOUND: 404,
  BUCKET_NOT_FOUND: 404,
  API_KEY_NOT_FOUND: 404,
  NOT_FOUND: 404,
  BUCKET_ALREADY_EXIST: 409,
  BUCKET_NOT_EMPTY: 409,
  VALIDATION_ERROR: 422,

  // 5xx
  FS_ERROR: 500,
  UNKNOWN: 500,
} as const satisfies Record<Buns3AnyErrorCode, number>;

function fail(code: Buns3AnyErrorCode, detail?: string) {
  return problem(ERROR_STATUS[code], detail ? { code, detail } : { code });
}

function fail500(error: unknown) {
  const ref = crypto.randomUUID().substring(0, 8);
  console.error("Error Ref:", ref, error);
  return fail("UNKNOWN", `An unexpected error occurred (ref: ${ref})`);
}

export const useErrorHandler = new Elysia({
  name: "buns3ErrorHandler",
  as: "global",
})
  .error(Buns3Error, ({ error }) => {
    const status = ERROR_STATUS[error.code];
    if (status >= 500) {
      return fail500(error);
    }

    return fail(error.code);
  })
  .error(Buns3ValidationError, ({ error }) => {
    return fail("VALIDATION_ERROR", error.errors.summary);
  })
  .error(ValidationError, ({ error }) => {
    return fail("VALIDATION_ERROR", error.message);
  })
  .error(ParseError, ({ error }) => {
    return fail(
      "MALFORMED_BODY",
      (error.cause as Error | undefined)?.message ??
        "Failed to parse request body",
    );
  })
  .error(NotFound, ({ request }) => {
    return fail(
      "NOT_FOUND",
      `No route for ${request.method} ${new URL(request.url).pathname}`,
    );
  })
  .error(InternalServerError, ({ error }) => {
    return fail500(error);
  })
  .error(({ error }) => {
    return fail500(error);
  });
